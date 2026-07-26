import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemPrompt, buildUserPrompt, callGemini, createServer } from "../server.js";

test("Gemini prompt constrains output to the processor ISA", () => {
  const system = buildSystemPrompt();
  assert.match(system, /ONLY this exact subset/);
  assert.match(system, /add rd, rs, rt/);
  assert.match(system, /There are no pseudo-instructions/);
  assert.match(buildUserPrompt({ action: "fix", prompt: "repair it", code: "bad r1" }), /complete corrected program/);
});

test("Gemini client requests structured JSON and normalizes its response", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        title: "Add two values",
        assembly: "addi r1, r0, 2\naddi r2, r0, 3\nadd r3, r1, r2",
        explanation: "Uses forwarding.",
        assumptions: [],
      }) }] } }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await callGemini({
    apiKey: "test-key",
    model: "test-model",
    action: "generate",
    prompt: "add 2 and 3",
    code: "",
    fetchImpl,
  });

  assert.match(captured.url, /test-model:generateContent$/);
  assert.equal(captured.options.headers["x-goog-api-key"], "test-key");
  assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  assert.equal(result.title, "Add two values");
  assert.match(result.assembly, /add r3/);
});

test("local server reports missing Gemini configuration without exposing a key", async (t) => {
  const server = createServer({ apiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const statusResponse = await fetch(`${origin}/api/ai/status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), { configured: false, model: "gemini-2.5-flash" });

  const aiResponse = await fetch(`${origin}/api/ai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "generate", prompt: "add values", code: "" }),
  });
  assert.equal(aiResponse.status, 503);
  assert.match((await aiResponse.json()).error, /currently unavailable/);

  const pageResponse = await fetch(`${origin}/simulator/`);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /PIPE\/5/);
});
