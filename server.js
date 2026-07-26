import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 20;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".hex": "text/plain; charset=utf-8",
  ".v": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ACTIONS = new Set(["generate", "fix", "explain", "optimize"]);
const requestBuckets = new Map();

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "Short name for the solution or analysis." },
    assembly: { type: "STRING", description: "Complete assembly source compatible with the given ISA. Empty only if no code is relevant." },
    explanation: { type: "STRING", description: "Clear explanation of the approach and important pipeline behavior." },
    assumptions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["title", "assembly", "explanation", "assumptions"],
};

export function buildSystemPrompt() {
  return `You are the code assistant for PIPE/5, a 32-bit, five-stage, in-order MIPS-style teaching processor.

You may emit assembly using ONLY this exact subset:
- add rd, rs, rt
- sub rd, rs, rt
- and rd, rs, rt
- or rd, rs, rt
- slt rd, rs, rt (signed comparison)
- addi rt, rs, signed_16_bit_immediate
- lw rt, signed_offset(rs)
- sw rt, signed_offset(rs)
- beq rs, rt, label_or_signed_word_offset
- j label_or_word_aligned_byte_address
- nop

Registers are r0 through r31. r0 is permanently zero. There are no pseudo-instructions, syscall, halt, multiply, divide, shifts, bne, lui, floating point, stack convention, byte access, or indirect jump. Instruction and data memories each contain 256 32-bit words. Data addresses should be word aligned. Labels are supported. A program ends by falling past its final loaded instruction; do not invent a halt instruction.

Return only the requested JSON object. Generated code must be complete, use comments beginning with #, fit the ISA, and avoid infinite loops unless the user explicitly asks for one. Prefer readable labels. For optimization, reduce avoidable load-use stalls while preserving behavior. For fixes, return the full corrected program, not a patch. Explain any unavoidable one-cycle load-use stall or control flush.`;
}

export function buildUserPrompt({ action, prompt, code }) {
  const instructions = {
    generate: "Generate a complete PIPE/5 assembly program for the problem.",
    fix: "Find every issue in the supplied assembly and return a complete corrected program.",
    explain: "Explain the supplied program, including results, memory effects, hazards, forwarding, stalls, and flushes. Return the original code in assembly unless a correction is essential.",
    optimize: "Optimize the supplied program for this five-stage pipeline while preserving behavior. Explain each useful scheduling or instruction change.",
  };
  return `${instructions[action]}\n\nUSER REQUEST:\n${prompt || "No additional request."}\n\nCURRENT ASSEMBLY:\n${code || "(none supplied)"}`;
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const blocked = payload?.promptFeedback?.blockReason;
    throw new Error(blocked ? `The AI service blocked the request: ${blocked}` : "The AI service returned no response text.");
  }
  return parts.map((part) => part.text || "").join("").trim();
}

function parseStructuredText(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const result = JSON.parse(cleaned);
  if (!result || typeof result !== "object") throw new Error("The AI service returned an invalid response object.");
  return {
    title: String(result.title || "AI response").slice(0, 200),
    assembly: String(result.assembly || "").slice(0, 30000),
    explanation: String(result.explanation || "").slice(0, 30000),
    assumptions: Array.isArray(result.assumptions) ? result.assumptions.map(String).slice(0, 20) : [],
  };
}

export async function callGemini({ apiKey, model = DEFAULT_MODEL, action, prompt, code, fetchImpl = fetch }) {
  if (!apiKey) throw Object.assign(new Error("The AI service is currently unavailable."), { statusCode: 503 });
  if (!ACTIONS.has(action)) throw Object.assign(new Error("Unsupported AI action."), { statusCode: 400 });
  if (String(prompt || "").length > 12000 || String(code || "").length > 30000) {
    throw Object.assign(new Error("The request is too large."), { statusCode: 413 });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: "user", parts: [{ text: buildUserPrompt({ action, prompt, code }) }] }],
      generationConfig: {
        temperature: action === "explain" ? 0.2 : 0.35,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const upstream = payload?.error?.message || `AI request failed with HTTP ${response.status}.`;
    throw Object.assign(new Error(upstream), { statusCode: response.status === 429 ? 429 : 502 });
  }
  return { ...parseStructuredText(extractGeminiText(payload)), model };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

function allowRequest(address) {
  const now = Date.now();
  const bucket = requestBuckets.get(address) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  requestBuckets.set(address, recent);
  return true;
}

async function serveStatic(request, response, pathname) {
  if (pathname === "/") {
    response.writeHead(302, { Location: "/simulator/" });
    response.end();
    return;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(response, 400, { error: "Invalid URL path." });
    return;
  }
  const relative = decoded === "/simulator/" ? "simulator/index.html" : decoded.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }
  try {
    const metadata = await stat(filePath);
    const finalPath = metadata.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const body = await readFile(finalPath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(finalPath).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") sendJson(response, 404, { error: "Not found." });
    else sendJson(response, 500, { error: "Could not read the requested file." });
  }
}

export function createServer(options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/ai/status") {
        sendJson(response, 200, { configured: Boolean(apiKey), model });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai") {
        if (!allowRequest(request.socket.remoteAddress || "local")) {
          sendJson(response, 429, { error: "Too many AI requests. Wait a few minutes and try again." });
          return;
        }
        const body = await readJsonBody(request);
        const result = await callGemini({
          apiKey,
          model,
          action: String(body.action || ""),
          prompt: String(body.prompt || ""),
          code: String(body.code || ""),
          fetchImpl,
        });
        sendJson(response, 200, result);
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { error: "Method not allowed." });
        return;
      }
      await serveStatic(request, response, url.pathname);
    } catch (error) {
      const statusCode = Number(error.statusCode) || (error.name === "TimeoutError" ? 504 : 500);
      sendJson(response, statusCode, { error: error.message || "Unexpected server error." });
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  const port = Number(process.env.PORT) || 8000;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();
  server.listen(port, host, () => {
    const configured = Boolean(process.env.GEMINI_API_KEY);
    console.log(`PIPE/5 simulator: http://${host}:${port}/simulator/`);
    console.log(`AI service: ${configured ? "ready" : "unavailable"}`);
  });
}
