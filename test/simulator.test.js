import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AssemblyError,
  EXAMPLE_PROGRAM,
  PipelineSimulator,
  assemble,
  compileProgram,
  disassemble,
  formatHexProgram,
  parseHexProgram,
} from "../simulator/core.js";

function run(source, maxCycles = 500) {
  const simulator = new PipelineSimulator(assemble(source));
  const result = simulator.run(maxCycles);
  assert.equal(result.halted, true, `program did not drain in ${maxCycles} cycles`);
  return simulator;
}

test("assembles and executes the repository sample program", () => {
  const simulator = run(EXAMPLE_PROGRAM);
  const expected = [0, 10, 20, 30, 20, 20, 30, 0, 0, 7, 2, 15, 1];
  expected.forEach((value, register) => {
    assert.equal(simulator.registers[register], value, `r${register}`);
  });
  assert.equal(simulator.memory[0], 20);
  assert.equal(simulator.stalls, 1);
  assert.equal(simulator.takenBranches, 1);
});

test("forwards EX/MEM and MEM/WB results without extra stalls", () => {
  const simulator = run(`
    addi r1, r0, 4
    addi r2, r1, 3
    add  r3, r1, r2
    sub  r4, r3, r1
  `);
  assert.equal(simulator.registers[1], 4);
  assert.equal(simulator.registers[2], 7);
  assert.equal(simulator.registers[3], 11);
  assert.equal(simulator.registers[4], 7);
  assert.equal(simulator.stalls, 0);
  assert.ok(simulator.history.some((event) => event.forwardA === "EX/MEM" || event.forwardB === "EX/MEM"));
  assert.ok(simulator.history.some((event) => event.forwardA === "MEM/WB" || event.forwardB === "MEM/WB"));
});

test("stalls once for a true load-use dependency", () => {
  const simulator = run(`
    addi r1, r0, 13
    sw   r1, 0(r0)
    lw   r2, 0(r0)
    add  r3, r2, r1
  `);
  assert.equal(simulator.registers[3], 26);
  assert.equal(simulator.stalls, 1);
});

test("does not falsely stall when rt is an I-type destination", () => {
  const simulator = run(`
    lw   r2, 0(r0)
    addi r2, r0, 9
    lw   r2, 4(r0)
    j done
  done:
    addi r3, r0, 1
  `);
  assert.equal(simulator.stalls, 0);
  assert.equal(simulator.registers[2], 0);
  assert.equal(simulator.registers[3], 1);
});

test("an older taken branch overrides a younger wrong-path jump", () => {
  const simulator = run(`
    addi r1, r0, 1
    beq  r1, r1, branch_target
    j    wrong_target
    addi r2, r0, 99
  branch_target:
    addi r2, r0, 7
    j done
  wrong_target:
    addi r2, r0, 42
  done:
    addi r3, r0, 5
  `);
  assert.equal(simulator.registers[2], 7);
  assert.equal(simulator.registers[3], 5);
  assert.equal(simulator.takenBranches, 1);
  assert.equal(simulator.jumps, 1, "the flushed wrong-path jump must not execute");
});

test("beq supports backward labels and signed slt", () => {
  const simulator = run(`
    addi r1, r0, 3
    addi r2, r0, 0
  loop:
    addi r2, r2, 1
    addi r1, r1, -1
    beq  r1, r0, done
    beq  r0, r0, loop
  done:
    addi r4, r0, -1
    slt  r5, r4, r0
  `);
  assert.equal(simulator.registers[1], 0);
  assert.equal(simulator.registers[2], 3);
  assert.equal(simulator.registers[5], 1);
});

test("accepts program.hex input and emits useful disassembly", () => {
  const program = compileProgram("2001000a\n00211020\n");
  assert.equal(program.format, "hex");
  assert.deepEqual(program.words, [0x2001000a, 0x00211020]);
  assert.equal(disassemble(program.words[0]), "addi r1, r0, 10");
  assert.equal(parseHexProgram("0x00000000").words[0], 0);
  assert.equal(formatHexProgram(program), "2001000a\n00211020\n");
});

test("assembler reports source line errors", () => {
  assert.throws(() => assemble("addi r1, r0, 99999"), (error) => {
    assert.ok(error instanceof AssemblyError);
    assert.equal(error.line, 1);
    return true;
  });
  assert.throws(() => assemble("same: nop\nsame: nop"), /duplicate label/);
});

test("UI includes architecture, Gemini assistant, and error-log sections", () => {
  const html = readFileSync(new URL("../simulator/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../simulator/app.js", import.meta.url), "utf8");
  for (const id of [
    "architecture-tab", "architecture-stages", "architecture-event",
    "inspector-content", "control-matrix", "architecture-step",
    "ai-tab", "ai-prompt", "ai-result-code", "ai-submit",
    "error-drawer", "error-log-list", "error-count",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(app, /function renderArchitecture\(\)/);
  assert.match(app, /const architectureStages =/);
});
