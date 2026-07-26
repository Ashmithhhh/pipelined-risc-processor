import {
  AssemblyError,
  EXAMPLES,
  PipelineSimulator,
  compileProgram,
  disassemble,
  formatHexProgram,
  hex32,
} from "./core.js";

const $ = (selector) => document.querySelector(selector);
const editor = $("#source-editor");
const lineNumbers = $("#line-numbers");
const sourceMessage = $("#source-message");
const assembleButton = $("#assemble-button");
const stepButton = $("#step-button");
const runButton = $("#run-button");
const runIcon = $("#run-icon");
const runLabel = $("#run-label");
const resetButton = $("#reset-button");
const speedSelect = $("#speed-select");
const exampleSelect = $("#example-select");
const programFile = $("#program-file");
const downloadHexButton = $("#download-hex");
const downloadTraceButton = $("#download-trace");
const simState = $("#sim-state");
const simulatorTab = $("#simulator-tab");
const architectureTab = $("#architecture-tab");
const aiTab = $("#ai-tab");
const simulatorContent = $("#simulator-content");
const architectureContent = $("#architecture-content");
const aiContent = $("#ai-content");
const architectureStep = $("#architecture-step");
const architectureRun = $("#architecture-run");
const architectureRunIcon = $("#architecture-run-icon");
const architectureRunLabel = $("#architecture-run-label");
const architectureReset = $("#architecture-reset");
const aiPrompt = $("#ai-prompt");
const aiIncludeSource = $("#ai-include-source");
const aiSubmit = $("#ai-submit");
const aiSubmitLabel = $("#ai-submit-label");
const aiResult = $("#ai-result");
const aiEmptyState = $("#ai-empty-state");
const aiResultCode = $("#ai-result-code");
const errorDrawer = $("#error-drawer");
const errorBackdrop = $("#error-backdrop");
const errorLogToggle = $("#error-log-toggle");

let simulator = null;
let runTimer = null;
let radix = "hex";
let sourceDirty = false;
let activeView = "simulator";
let selectedArchitectureStage = "IF";
let aiAction = "generate";
let aiResponse = null;
let aiConfigured = false;
let diagnostics = [];
let nextDiagnosticId = 1;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function renderDiagnostics() {
  const list = $("#error-log-list");
  const errorCount = diagnostics.filter((entry) => entry.level === "error").length;
  $("#error-count").textContent = diagnostics.length;
  $("#error-summary").textContent = diagnostics.length === 0
    ? "No errors recorded"
    : `${errorCount} error${errorCount === 1 ? "" : "s"} · ${diagnostics.length} total event${diagnostics.length === 1 ? "" : "s"}`;
  errorLogToggle.classList.toggle("has-errors", errorCount > 0);
  if (diagnostics.length === 0) {
    list.innerHTML = '<div class="error-log-empty"><span>✓</span><strong>Everything looks clean</strong><small>Assembler and AI diagnostics will appear here.</small></div>';
    return;
  }
  list.innerHTML = diagnostics.map((entry) => `
    <article class="log-entry ${entry.level}">
      <div class="log-entry-head"><span class="log-entry-level">${escapeHtml(entry.level)} · ${escapeHtml(entry.source)}</span><span class="log-entry-time">${escapeHtml(entry.time)}</span></div>
      <strong>${escapeHtml(entry.message)}</strong>
      ${entry.detail ? `<div class="log-entry-detail">${escapeHtml(entry.detail)}</div>` : ""}
      <div class="log-entry-footer">
        <span class="log-entry-source">${entry.line ? `SOURCE LINE ${entry.line}` : `EVENT #${entry.id}`}</span>
        ${entry.line ? `<button class="log-line-link" type="button" data-log-line="${entry.line}" data-log-target="${entry.target}">Open line ${entry.line}</button>` : ""}
      </div>
    </article>
  `).join("");
}

function openErrorLog() {
  errorDrawer.hidden = false;
  errorBackdrop.hidden = false;
  errorLogToggle.setAttribute("aria-expanded", "true");
}

function closeErrorLog() {
  errorDrawer.hidden = true;
  errorBackdrop.hidden = true;
  errorLogToggle.setAttribute("aria-expanded", "false");
}

function addDiagnostic(level, source, message, options = {}) {
  diagnostics.unshift({
    id: nextDiagnosticId++,
    level,
    source,
    message,
    detail: options.detail || "",
    line: options.line || null,
    target: options.target || "editor",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
  if (diagnostics.length > 100) diagnostics.length = 100;
  renderDiagnostics();
  if (options.open || level === "error") openErrorLog();
}

function updateLineNumbers() {
  const count = Math.max(1, editor.value.split("\n").length);
  lineNumbers.textContent = Array.from({ length: count }, (_, index) => index + 1).join("\n");
}

function setSourceMessage(kind, text) {
  sourceMessage.className = `source-message ${kind}`;
  sourceMessage.innerHTML = `<span aria-hidden="true">${kind === "error" ? "!" : "✓"}</span><span>${escapeHtml(text)}</span>`;
}

function setState(kind, text) {
  simState.className = `state-pill ${kind}`;
  simState.innerHTML = `<span></span>${escapeHtml(text)}`;
}

function stopRunning() {
  if (runTimer != null) window.clearInterval(runTimer);
  runTimer = null;
  runButton.classList.remove("running");
  architectureRun.classList.remove("running");
  runIcon.textContent = "▶";
  runLabel.textContent = "Run";
  architectureRunIcon.textContent = "▶";
  architectureRunLabel.textContent = "Run";
}

function compileAndReset() {
  stopRunning();
  try {
    const program = compileProgram(editor.value);
    simulator = new PipelineSimulator(program);
    sourceDirty = false;
    const type = program.format === "hex" ? "hex words" : "instructions";
    setSourceMessage("ok", `Loaded ${program.words.length} ${type}. Labels and immediates resolved successfully.`);
    setState(program.words.length === 0 ? "halted" : "ready", program.words.length === 0 ? "EMPTY" : "READY");
    render();
  } catch (error) {
    const message = error instanceof AssemblyError ? error.message : `Unexpected error: ${error.message}`;
    setSourceMessage("error", message);
    setState("error", "ERROR");
    const sourceLine = error.line != null ? editor.value.split("\n")[error.line - 1]?.trim() : "";
    addDiagnostic("error", "ASSEMBLER", message, { line: error.line, detail: sourceLine });
    stepButton.disabled = true;
    runButton.disabled = true;
    architectureStep.disabled = true;
    architectureRun.disabled = true;
    if (error.line != null) {
      const lines = editor.value.split("\n");
      const start = lines.slice(0, error.line - 1).reduce((sum, line) => sum + line.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(start, start + (lines[error.line - 1]?.length || 0));
    }
  }
}

function stepCycle() {
  if (!simulator) return;
  const event = simulator.step();
  if (event == null || simulator.isHalted()) stopRunning();
  render();
}

function startRunning() {
  if (!simulator || simulator.isHalted()) return;
  stopRunning();
  runButton.classList.add("running");
  architectureRun.classList.add("running");
  runIcon.textContent = "■";
  runLabel.textContent = "Pause";
  architectureRunIcon.textContent = "■";
  architectureRunLabel.textContent = "Pause";
  setState("running", "RUNNING");
  const delay = Math.max(16, 1000 / Number(speedSelect.value));
  runTimer = window.setInterval(stepCycle, delay);
}

function toggleRunning() {
  if (runTimer != null) {
    stopRunning();
    setState("ready", "PAUSED");
  } else {
    startRunning();
  }
}

function resetCurrent() {
  if (!simulator) return;
  stopRunning();
  simulator.reset();
  setState("ready", "READY");
  render();
}

function downloadHexProgram() {
  if (!simulator) return;
  downloadText("program.hex", formatHexProgram(simulator.program));
}

function downloadTraceCsv() {
  if (!simulator || simulator.history.length === 0) return;
  const header = ["cycle", "pc", "if", "id", "ex", "mem", "wb", "control", "forward_a", "forward_b", "register_write", "memory_write"];
  const rows = simulator.history.slice().reverse().map((event) => {
    const registerWrite = event.registerWrite
      ? `r${event.registerWrite.register}=${hex32(event.registerWrite.value)}` : "";
    const memoryWrite = event.memoryWrite
      ? `${hex32(event.memoryWrite.address)}=${hex32(event.memoryWrite.value)}` : "";
    return [
      event.cycle, hex32(event.pc), ...event.stages, event.control,
      event.forwardA, event.forwardB, registerWrite, memoryWrite,
    ].map(csvCell).join(",");
  });
  downloadText("pipeline-trace.csv", `${header.join(",")}\n${rows.join("\n")}\n`, "text/csv;charset=utf-8");
}

async function importProgramFile(file) {
  if (!file) return;
  stopRunning();
  try {
    editor.value = await file.text();
    exampleSelect.value = "custom";
    updateLineNumbers();
    compileAndReset();
  } catch (error) {
    const message = `Could not read ${file.name}: ${error.message}`;
    setSourceMessage("error", message);
    setState("error", "ERROR");
    addDiagnostic("error", "FILE IMPORT", message);
  } finally {
    programFile.value = "";
  }
}

function setAiConnection(state, title, model) {
  const card = $("#ai-connection-card");
  card.className = `ai-connection-card ${state}`;
  $("#ai-connection-title").textContent = title;
  $("#ai-model-name").textContent = model;
}

async function checkAiStatus() {
  setAiConnection("checking", "Checking availability…", "Code generation service");
  try {
    const response = await fetch("/api/ai/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("AI endpoint is unavailable");
    const status = await response.json();
    aiConfigured = Boolean(status.configured);
    if (aiConfigured) {
      setAiConnection("online", "AI ready", "Code generation online");
    } else {
      setAiConnection("offline", "Service unavailable", "AI features are currently offline");
    }
  } catch {
    aiConfigured = false;
    setAiConnection("offline", "Service unavailable", "AI features are currently offline");
  }
}

function setAiMode(action) {
  aiAction = action;
  document.querySelectorAll("[data-ai-action]").forEach((button) => {
    button.classList.toggle("active", button.dataset.aiAction === action);
  });
  const placeholders = {
    generate: "Example: Add the numbers from 1 to 10, put the result in r3, and store it at memory address 0.",
    fix: "Describe the wrong result or error. The current editor source will be sent for repair.",
    explain: "What would you like explained about the current program and its pipeline behavior?",
    optimize: "Describe the goal, such as reducing stalls or making the loop shorter.",
  };
  aiPrompt.placeholder = placeholders[action];
  if (action !== "generate") aiIncludeSource.checked = true;
}

function setAiValidation(state, text) {
  const badge = $("#ai-validation-badge");
  badge.className = `validation-badge ${state}`;
  badge.textContent = text;
}

function validateAiCode({ logSuccess = false } = {}) {
  const code = aiResultCode.value.trim();
  if (!code) {
    setAiValidation("invalid", "NO CODE");
    $("#ai-load").disabled = true;
    addDiagnostic("error", "AI VALIDATION", "The response did not include assembly code.");
    return false;
  }
  setAiValidation("checking", "CHECKING");
  try {
    const compiled = compileProgram(code);
    setAiValidation("valid", `${compiled.words.length} WORDS · VALID`);
    $("#ai-load").disabled = false;
    if (logSuccess) addDiagnostic("info", "AI VALIDATION", `Generated program is valid (${compiled.words.length} instructions).`);
    return true;
  } catch (error) {
    const message = error instanceof AssemblyError ? error.message : error.message || "Validation failed.";
    const sourceLine = error.line != null ? code.split("\n")[error.line - 1]?.trim() : "";
    setAiValidation("invalid", "INVALID");
    $("#ai-load").disabled = true;
    addDiagnostic("error", "AI VALIDATION", message, { line: error.line, detail: sourceLine, target: "ai" });
    return false;
  }
}

function showAiResponse(response) {
  aiResponse = response;
  aiEmptyState.hidden = true;
  aiResult.hidden = false;
  $("#ai-result-title").textContent = response.title || "AI response";
  aiResultCode.value = response.assembly || "";
  $("#ai-explanation-text").textContent = response.explanation || "No explanation was returned.";
  const notes = (response.assumptions || []).map((text) => ({ kind: "assumption", text: `Assumption: ${text}` }));
  $("#ai-response-notes").innerHTML = notes.map((note) => `<div class="${note.kind}">${escapeHtml(note.text)}</div>`).join("");
  validateAiCode();
}

async function requestAiCode() {
  const prompt = aiPrompt.value.trim();
  const code = aiIncludeSource.checked ? editor.value : "";
  if (!prompt && !code.trim()) {
    addDiagnostic("error", "AI REQUEST", "Describe a problem or include the current assembly source.");
    aiPrompt.focus();
    return;
  }
  if (!aiConfigured) {
    addDiagnostic("error", "AI SERVICE", "The AI service is currently unavailable.");
    return;
  }

  aiSubmit.disabled = true;
  aiSubmit.classList.add("busy");
  aiSubmitLabel.textContent = "Thinking…";
  setAiValidation("checking", "GENERATING");
  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ action: aiAction, prompt, code }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `AI request failed with HTTP ${response.status}.`);
    showAiResponse(payload);
  } catch (error) {
    setAiValidation("invalid", "REQUEST FAILED");
    addDiagnostic("error", "AI SERVICE", error.message || "The AI request failed.");
  } finally {
    aiSubmit.disabled = false;
    aiSubmit.classList.remove("busy");
    aiSubmitLabel.textContent = "Generate code";
  }
}

function loadAiCode() {
  if (!validateAiCode()) return;
  editor.value = aiResultCode.value.trim() + "\n";
  exampleSelect.value = "custom";
  updateLineNumbers();
  compileAndReset();
  addDiagnostic("info", "AI ASSISTANT", "Validated program loaded into the simulator.");
  switchView("simulator");
}

async function copyAiCode() {
  try {
    await navigator.clipboard.writeText(aiResultCode.value);
    $("#ai-copy").textContent = "Copied";
    window.setTimeout(() => { $("#ai-copy").textContent = "Copy"; }, 1200);
  } catch (error) {
    addDiagnostic("error", "CLIPBOARD", `Could not copy code: ${error.message}`);
  }
}

function formatValue(value) {
  return radix === "hex" ? hex32(value) : String(value | 0);
}

function renderStats() {
  const stats = simulator.stats();
  $("#stat-cycle").textContent = stats.cycle;
  $("#stat-retired").textContent = stats.retired;
  $("#stat-cpi").textContent = stats.retired === 0 ? "—" : stats.cpi.toFixed(2);
  $("#stat-stalls").textContent = stats.stalls;
  $("#stat-flushes").textContent = stats.flushes;
}

const stageLongNames = {
  IF: "INSTRUCTION FETCH",
  ID: "DECODE / REG READ",
  EX: "EXECUTE / ALU",
  MEM: "DATA MEMORY",
  WB: "WRITE BACK",
};

const architectureStages = {
  IF: {
    title: "Instruction Fetch",
    file: "pc.v + instr_mem.v",
    components: ["PC", "PC + 4", "Instruction ROM"],
    description: "The fetch stage presents the current byte-addressed PC to the instruction ROM while an adder prepares the next sequential address. A stall holds both the PC and IF/ID latch; a redirect selects a branch or jump target.",
    inputs: "pc_next, pc_write, branch_target, jump_target",
    operation: "instr = IMEM[PC[9:2]]; sequential = PC + 4",
    outputs: "32-bit instruction and PC + 4 into IF/ID",
    controls: ["PCWrite", "PCSrc", "IF/ID.Write", "IF/ID.Flush"],
  },
  ID: {
    title: "Decode / Register Read",
    file: "control_unit.v + reg_file.v",
    components: ["Decoder", "32 × 32 RF", "Sign extend", "Hazard unit"],
    description: "Decode separates opcode, rs, rt, rd, immediate and function fields. Two register ports are read in parallel, the immediate is sign-extended, and the main controller creates the control bundle that travels with the instruction.",
    inputs: "IF/ID instruction, PC + 4, WB register/value",
    operation: "decode opcode; read rs/rt; detect load-use dependency",
    outputs: "operands, immediate, register IDs and control bundle into ID/EX",
    controls: ["RegDst", "ALUSrc", "ALUOp", "MemRead", "MemWrite", "RegWrite", "Branch", "Jump"],
  },
  EX: {
    title: "Execute / Address Generation",
    file: "alu.v + forwarding_unit.v",
    components: ["Forward mux A", "Forward mux B", "ALU", "Branch adder"],
    description: "The execute stage chooses the newest available operand from ID/EX, EX/MEM or MEM/WB. The ALU performs arithmetic and logic, computes load/store addresses, and compares BEQ operands by subtraction.",
    inputs: "ID/EX operands, immediate, EX/MEM result, MEM/WB result",
    operation: "ALU(A, B); branch_target = PC+4 + (signImm << 2)",
    outputs: "ALU result, store value, destination register and branch decision",
    controls: ["ForwardA", "ForwardB", "ALUSrc", "ALUCtrl", "RegDst", "Branch"],
  },
  MEM: {
    title: "Data Memory",
    file: "data_mem.v + ex_mem_reg.v",
    components: ["Data RAM", "Address index", "Store port"],
    description: "The memory stage uses the ALU result as a byte address. Loads read a 32-bit word combinationally; stores commit the forwarded rt value on the rising clock edge. Non-memory instructions simply pass their ALU result onward.",
    inputs: "EX/MEM ALU address, forwarded store data and memory controls",
    operation: "word_index = address[9:2]; read or clocked write",
    outputs: "RAM read data and unchanged ALU result into MEM/WB",
    controls: ["MemRead", "MemWrite", "MemToReg", "RegWrite"],
  },
  WB: {
    title: "Write Back",
    file: "mem_wb_reg.v + reg_file.v",
    components: ["Result mux", "Write port", "WB bypass"],
    description: "The final stage chooses between loaded memory data and the ALU result, then writes one non-zero destination register. Internal register-file bypass makes that value visible to an instruction reading the same register in ID on this cycle.",
    inputs: "MEM/WB memory data, ALU result, destination and controls",
    operation: "write_data = MemToReg ? memory_data : ALU_result",
    outputs: "register-file update and MEM/WB-to-EX forwarding value",
    controls: ["MemToReg", "RegWrite", "WriteReg"],
  },
};

function renderPipeline() {
  const stages = simulator.getStages();
  $("#pipeline").innerHTML = stages.map((stage, index) => `
    <article class="stage ${stage.valid ? "valid" : "bubble"}" aria-label="${stage.name} stage: ${escapeHtml(stage.assembly)}">
      <div class="stage-head"><span class="stage-name">${stage.name}</span><span class="stage-number">0${index + 1}</span></div>
      <div class="stage-label">${stageLongNames[stage.name]}</div>
      <div class="stage-pc">PC ${stage.valid ? hex32(stage.pc) : "—"}</div>
      <div class="stage-instruction">${escapeHtml(stage.assembly)}</div>
      <div class="stage-word">${stage.valid ? hex32(stage.word) : "0x--------"}</div>
      <div class="stage-status"><i></i>${stage.valid ? "VALID LATCH" : "EMPTY / BUBBLE"}</div>
    </article>
  `).join("");
}

function eventDescription(event) {
  if (!event) {
    return { kind: "neutral", icon: "○", title: "Awaiting first clock", detail: "Press Step cycle or Run." };
  }
  if (event.control === "stall") {
    return {
      kind: "stall", icon: "Ⅱ", title: "Load-use hazard — pipeline stalled",
      detail: "PC and IF/ID held; one bubble inserted into ID/EX.",
    };
  }
  if (event.control === "branch") {
    return {
      kind: "branch", icon: "↪", title: `Taken BEQ — redirect to ${hex32(event.branchTarget)}`,
      detail: "The two younger instructions in IF and ID were flushed.",
    };
  }
  if (event.control === "jump") {
    return {
      kind: "jump", icon: "↗", title: `Jump resolved in ID — redirect to ${hex32(event.jumpTarget)}`,
      detail: "The sequentially fetched instruction was flushed.",
    };
  }
  const commits = [];
  if (event.registerWrite) commits.push(`r${event.registerWrite.register} ← ${hex32(event.registerWrite.value)}`);
  if (event.memoryWrite) commits.push(`mem[${hex32(event.memoryWrite.address)}] ← ${hex32(event.memoryWrite.value)}`);
  if (commits.length > 0) {
    return { kind: "commit", icon: "✓", title: "Architectural state updated", detail: commits.join(" · ") };
  }
  const forwarding = [];
  if (event.forwardA === "EX/MEM" || event.forwardA === "MEM/WB") forwarding.push(`A from ${event.forwardA}`);
  if (event.forwardB === "EX/MEM" || event.forwardB === "MEM/WB") forwarding.push(`B from ${event.forwardB}`);
  if (forwarding.length > 0) {
    return { kind: "commit", icon: "⇢", title: "Operand forwarding active", detail: forwarding.join(" · ") };
  }
  return { kind: "neutral", icon: "·", title: `Cycle ${event.cycle} complete`, detail: "No stall or control redirect on this edge." };
}

function renderEvent() {
  let description;
  if (simulator.isHalted() && simulator.cycle > 0) {
    description = { kind: "commit", icon: "■", title: "Program complete — pipeline drained", detail: `${simulator.retired} instructions retired in ${simulator.cycle} cycles.` };
  } else {
    description = eventDescription(simulator.lastEvent);
  }
  const banner = $("#event-banner");
  banner.className = `event-banner ${description.kind}`;
  banner.innerHTML = `<span class="event-icon" aria-hidden="true">${description.icon}</span><div><strong>${escapeHtml(description.title)}</strong><small>${escapeHtml(description.detail)}</small></div>`;
}

function renderArchitectureInspector(stages) {
  const details = architectureStages[selectedArchitectureStage];
  const liveStage = stages.find((stage) => stage.name === selectedArchitectureStage);
  $("#inspector-title").textContent = `${selectedArchitectureStage} · ${details.title}`;
  $("#inspector-file").textContent = details.file;
  $("#inspector-content").innerHTML = `
    <p class="inspector-lead">${escapeHtml(details.description)}</p>
    <div class="inspector-io">
      <div><span>INPUTS</span><code>${escapeHtml(details.inputs)}</code></div>
      <div><span>OPERATION</span><code>${escapeHtml(details.operation)}</code></div>
      <div><span>OUTPUTS</span><code>${escapeHtml(details.outputs)}</code></div>
      <div><span>RTL BOUNDARY</span><code>${escapeHtml(details.file)}</code></div>
    </div>
    <div class="inspector-controls">${details.controls.map((control) => `<span>${escapeHtml(control)}</span>`).join("")}</div>
    <p class="inspector-current">Current latch: <strong>${escapeHtml(liveStage?.assembly || "bubble")}</strong>${liveStage?.valid ? ` · PC ${hex32(liveStage.pc)} · ${hex32(liveStage.word)}` : " · no valid instruction"}</p>
  `;
}

function renderArchitecture() {
  if (!simulator) return;
  const stages = simulator.getStages();
  const event = simulator.lastEvent;
  const description = simulator.isHalted() && simulator.cycle > 0
    ? { kind: "commit", title: "Program complete — pipeline drained", detail: `${simulator.retired} instructions retired in ${simulator.cycle} cycles.` }
    : eventDescription(event);

  $("#architecture-cycle").textContent = simulator.cycle;
  $("#architecture-pc").textContent = hex32(simulator.pc);
  $("#architecture-live-state").textContent = simulator.isHalted()
    ? "Pipeline drained" : `${simulator.retired} retired · ${simulator.stalls} stalls · ${simulator.flushes} flushes`;

  $("#architecture-stages").innerHTML = stages.map((stage, index) => {
    const details = architectureStages[stage.name];
    return `
      <button class="architecture-stage ${stage.valid ? "valid" : ""} ${selectedArchitectureStage === stage.name ? "selected" : ""}" type="button" data-architecture-stage="${stage.name}" aria-pressed="${selectedArchitectureStage === stage.name}">
        <i class="stage-flow-arrow" aria-hidden="true"></i>
        <div class="arch-stage-head"><strong>${stage.name}</strong><span>STAGE 0${index + 1}</span></div>
        <div class="arch-stage-role">${escapeHtml(stageLongNames[stage.name])}</div>
        <div class="arch-stage-components">${details.components.map((component) => `<span>${escapeHtml(component)}</span>`).join("")}</div>
        <div class="arch-stage-live"><small>LIVE INSTRUCTION</small><code>${escapeHtml(stage.assembly)}</code><div class="arch-stage-pc">${stage.valid ? `PC ${hex32(stage.pc)}` : "EMPTY LATCH"}</div></div>
      </button>
    `;
  }).join("");

  const forwardingActive = Boolean(event && [event.forwardA, event.forwardB].some((source) => source === "EX/MEM" || source === "MEM/WB"));
  const redirectActive = Boolean(event && (event.control === "branch" || event.control === "jump"));
  const writebackActive = Boolean(event?.registerWrite);
  $("#forwarding-lane").classList.toggle("active", forwardingActive);
  $("#redirect-lane").classList.toggle("active", redirectActive);
  $("#writeback-lane").classList.toggle("active", writebackActive);

  const architectureEvent = $("#architecture-event");
  architectureEvent.className = `architecture-event ${description.kind}`;
  architectureEvent.innerHTML = `<span>LAST CLOCK</span><strong>${escapeHtml(description.title)}</strong><small>${escapeHtml(description.detail)}</small>`;

  architectureStep.disabled = simulator.isHalted();
  architectureRun.disabled = simulator.isHalted();
  architectureReset.disabled = simulator.cycle === 0;
  renderArchitectureInspector(stages);
}

function switchView(view, updateHash = true) {
  activeView = ["architecture", "ai"].includes(view) ? view : "simulator";
  const showSimulator = activeView === "simulator";
  const showArchitecture = activeView === "architecture";
  const showAi = activeView === "ai";
  simulatorContent.hidden = !showSimulator;
  architectureContent.hidden = !showArchitecture;
  aiContent.hidden = !showAi;
  for (const [tab, selected] of [[simulatorTab, showSimulator], [architectureTab, showArchitecture], [aiTab, showAi]]) {
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  }
  document.title = showArchitecture
    ? "Architecture — PIPE/5 RISC Processor"
    : showAi ? "AI Code Assistant — PIPE/5" : "PIPE/5 — Pipelined RISC Simulator";
  if (updateHash) history.replaceState(null, "", `#${activeView}`);
  if (showArchitecture) renderArchitecture();
  if (showAi) checkAiStatus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderListing() {
  $("#word-count").textContent = `${simulator.program.words.length} WORD${simulator.program.words.length === 1 ? "" : "S"}`;
  $("#listing-body").innerHTML = simulator.program.words.map((word, index) => {
    const pc = index * 4;
    const source = simulator.program.sourceByPc.get(pc) || disassemble(word, pc);
    const line = simulator.program.lineByPc?.get(pc);
    return `<tr class="${simulator.pc === pc ? "current" : ""}"${line ? ` title="Source line ${line}"` : ""}>
      <td>${hex32(pc)}</td><td>${hex32(word)}</td><td>${escapeHtml(source)}</td>
    </tr>`;
  }).join("") || '<tr class="empty-row"><td colspan="3">No instructions loaded.</td></tr>';
}

function renderRegisters() {
  const changed = simulator.lastEvent?.registerWrite?.register;
  $("#register-grid").innerHTML = Array.from(simulator.registers, (value, index) => `
    <div class="register ${index === 0 ? "zero" : ""} ${changed === index ? "changed" : ""}">
      <div class="register-name">r${String(index).padStart(2, "0")}</div>
      <div class="register-value" title="${hex32(value)} / signed ${value | 0}">${formatValue(value)}</div>
    </div>
  `).join("");
}

function renderMemory() {
  const indexes = Array.from({ length: 16 }, (_, index) => index);
  simulator.memory.forEach((value, index) => {
    if (index >= 16 && value !== 0) indexes.push(index);
  });
  const changed = simulator.lastEvent?.memoryWrite?.index;
  $("#memory-body").innerHTML = indexes.map((index) => {
    const value = simulator.memory[index] >>> 0;
    return `<tr class="${value !== 0 ? "nonzero" : ""} ${changed === index ? "changed" : ""}">
      <td>${hex32(index * 4)}</td><td>${index}</td><td title="${hex32(value)} / signed ${value | 0}">${formatValue(value)}</td>
    </tr>`;
  }).join("");
}

function controlChip(control) {
  return `<span class="control-chip ${control}">${escapeHtml(control)}</span>`;
}

function forwardingCell(source) {
  const active = source === "EX/MEM" || source === "MEM/WB";
  return `<span class="${active ? "fwd-active" : ""}">${escapeHtml(source)}</span>`;
}

function renderTrace() {
  const body = $("#trace-body");
  if (simulator.history.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="7">No clock edges recorded yet.</td></tr>';
    return;
  }
  body.innerHTML = simulator.history.map((event) => {
    const commits = [];
    if (event.registerWrite) commits.push(`r${event.registerWrite.register}=${hex32(event.registerWrite.value)}`);
    if (event.memoryWrite) commits.push(`M[${hex32(event.memoryWrite.address)}]=${hex32(event.memoryWrite.value)}`);
    return `<tr>
      <td>${event.cycle}</td>
      <td>${hex32(event.pc)}</td>
      <td title="${escapeHtml(event.stages[2])}">${escapeHtml(event.stages[2])}</td>
      <td>${controlChip(event.control)}</td>
      <td>${forwardingCell(event.forwardA)}</td>
      <td>${forwardingCell(event.forwardB)}</td>
      <td class="${commits.length ? "commit-text" : ""}">${commits.length ? escapeHtml(commits.join(" · ")) : "—"}</td>
    </tr>`;
  }).join("");
}

function render() {
  if (!simulator) return;
  renderStats();
  renderPipeline();
  renderEvent();
  renderListing();
  renderRegisters();
  renderMemory();
  renderTrace();
  renderArchitecture();
  stepButton.disabled = simulator.isHalted();
  runButton.disabled = simulator.isHalted();
  resetButton.disabled = simulator.cycle === 0;
  downloadHexButton.disabled = simulator.program.words.length === 0;
  downloadTraceButton.disabled = simulator.history.length === 0;
  if (runTimer == null && simulator.isHalted()) setState("halted", "HALTED");
}

assembleButton.addEventListener("click", compileAndReset);
stepButton.addEventListener("click", stepCycle);
runButton.addEventListener("click", toggleRunning);
resetButton.addEventListener("click", resetCurrent);
downloadHexButton.addEventListener("click", downloadHexProgram);
downloadTraceButton.addEventListener("click", downloadTraceCsv);
programFile.addEventListener("change", () => importProgramFile(programFile.files[0]));
architectureStep.addEventListener("click", stepCycle);
architectureRun.addEventListener("click", toggleRunning);
architectureReset.addEventListener("click", resetCurrent);
simulatorTab.addEventListener("click", () => switchView("simulator"));
architectureTab.addEventListener("click", () => switchView("architecture"));
aiTab.addEventListener("click", () => switchView("ai"));
$("#open-simulator").addEventListener("click", () => switchView("simulator"));
aiSubmit.addEventListener("click", requestAiCode);
$("#ai-validate").addEventListener("click", () => validateAiCode({ logSuccess: true }));
$("#ai-load").addEventListener("click", loadAiCode);
$("#ai-copy").addEventListener("click", copyAiCode);
document.querySelectorAll("[data-ai-action]").forEach((button) => {
  button.addEventListener("click", () => setAiMode(button.dataset.aiAction));
});
aiResultCode.addEventListener("input", () => {
  setAiValidation("idle", "EDITED · REVALIDATE");
  $("#ai-load").disabled = true;
});
aiPrompt.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    requestAiCode();
  }
});

errorLogToggle.addEventListener("click", () => errorDrawer.hidden ? openErrorLog() : closeErrorLog());
$("#error-log-close").addEventListener("click", closeErrorLog);
errorBackdrop.addEventListener("click", closeErrorLog);
$("#error-log-clear").addEventListener("click", () => {
  diagnostics = [];
  renderDiagnostics();
});
$("#error-log-list").addEventListener("click", (event) => {
  const link = event.target.closest("[data-log-line]");
  if (!link) return;
  const target = link.dataset.logTarget === "ai" ? aiResultCode : editor;
  const line = Number(link.dataset.logLine);
  switchView(link.dataset.logTarget === "ai" ? "ai" : "simulator");
  closeErrorLog();
  const lines = target.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  target.focus();
  target.setSelectionRange(start, start + (lines[line - 1]?.length || 0));
});

$("#brand-home").addEventListener("click", (event) => {
  event.preventDefault();
  switchView("simulator");
});
$("#architecture-stages").addEventListener("click", (event) => {
  const stage = event.target.closest("[data-architecture-stage]");
  if (!stage) return;
  selectedArchitectureStage = stage.dataset.architectureStage;
  renderArchitecture();
});
window.addEventListener("hashchange", () => {
  const view = location.hash === "#architecture" ? "architecture" : location.hash === "#ai" ? "ai" : "simulator";
  switchView(view, false);
});

speedSelect.addEventListener("change", () => {
  if (runTimer != null) startRunning();
});

exampleSelect.addEventListener("change", () => {
  stopRunning();
  editor.value = EXAMPLES[exampleSelect.value];
  updateLineNumbers();
  compileAndReset();
});

editor.addEventListener("input", () => {
  updateLineNumbers();
  exampleSelect.value = "custom";
  if (!sourceDirty) {
    sourceDirty = true;
    stopRunning();
    setSourceMessage("ok", "Source changed. Assemble & reset to load it into instruction memory.");
    setState("ready", "DIRTY");
  }
});

editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});

editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    editor.setRangeText("  ", start, editor.selectionEnd, "end");
    editor.dispatchEvent(new Event("input"));
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    compileAndReset();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !errorDrawer.hidden) closeErrorLog();
  if (event.key === "F10") {
    event.preventDefault();
    stepCycle();
  }
});

$("#radix-hex").addEventListener("click", () => {
  radix = "hex";
  $("#radix-hex").classList.add("active");
  $("#radix-dec").classList.remove("active");
  renderRegisters();
  renderMemory();
});

$("#radix-dec").addEventListener("click", () => {
  radix = "dec";
  $("#radix-dec").classList.add("active");
  $("#radix-hex").classList.remove("active");
  renderRegisters();
  renderMemory();
});

editor.value = EXAMPLES.main;
updateLineNumbers();
renderDiagnostics();
setAiMode("generate");
compileAndReset();
const initialView = location.hash === "#architecture" ? "architecture" : location.hash === "#ai" ? "ai" : "simulator";
switchView(initialView, false);
if (initialView !== "ai") checkAiStatus();
