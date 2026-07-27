import test from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../simulator/core.js";
import { buildReference, compareFrames, parseTrace } from "../tools/differential.js";

function asRtlFrame(reference) {
  return {
    cycle: reference.cycle,
    pc: reference.pc,
    ifInstr: reference.ifInstr,
    idInstr: reference.idInstr,
    stall: Number(reference.stall),
    branch: Number(reference.branch),
    jump: Number(reference.jump),
    forwardA: reference.forwardA,
    forwardB: reference.forwardB,
    exResult: reference.exResult,
    memRead: Number(reference.memRead),
    memWrite: Number(reference.memWrite),
    memAddress: reference.memAddress,
    memWriteData: reference.memWriteData,
    wbWrite: Number(reference.wbWrite),
    wbRegister: reference.wbRegister,
    wbData: reference.wbData,
    postPc: reference.postPc,
    registers: [...reference.registers],
    memory: [...reference.memory],
  };
}

test("differential reference records every pre-edge signal and post-edge state", () => {
  const frames = buildReference(assemble(`
    addi r1, r0, 8
    sw   r1, 0(r0)
    lw   r2, 0(r0)
    add  r3, r2, r1
  `));

  assert.ok(frames.length >= 9);
  assert.ok(frames.some((frame) => frame.stall));
  assert.ok(frames.some((frame) => frame.memWrite));
  assert.equal(frames.at(-1).registers[3], 16);
  assert.equal(frames.at(-1).memory[0], 8);
  for (const key of ["ifInstr", "idInstr", "forwardA", "exResult", "wbWrite", "postPc"]) {
    assert.ok(Object.hasOwn(frames[0], key), `missing ${key}`);
  }
});

test("differential comparator passes identical traces and identifies first changed signal", () => {
  const reference = buildReference(assemble("addi r1, r0, 7"));
  const rtl = reference.map(asRtlFrame);
  const matching = compareFrames(reference, rtl);
  assert.equal(matching.mismatches.length, 0);
  assert.ok(matching.comparisons > 1000);

  rtl.at(-1).registers[1] = 9;
  const changed = compareFrames(reference, rtl);
  assert.ok(changed.mismatches.some((mismatch) => mismatch.signal === "r1"));
  assert.deepEqual(
    changed.mismatches.find((mismatch) => mismatch.signal === "r1"),
    { cycle: reference.at(-1).cycle, signal: "r1", expected: "0x00000007", actual: "0x00000009" },
  );
});

test("machine-readable RTL CSV parser accepts the complete state vector", () => {
  const reference = buildReference(assemble("nop"))[0];
  const rtl = asRtlFrame(reference);
  const hex = (value) => (value >>> 0).toString(16).padStart(8, "0");
  const headers = [
    "cycle", "pc", "if_instr", "id_instr", "stall", "branch", "jump",
    "fwd_a", "fwd_b", "ex_result", "mem_read", "mem_write", "mem_addr",
    "mem_wdata", "wb_write", "wb_reg", "wb_data", "post_pc",
    ...Array.from({ length: 32 }, (_, index) => `r${index}`),
    ...Array.from({ length: 256 }, (_, index) => `m${index}`),
  ];
  const values = [
    rtl.cycle, hex(rtl.pc), hex(rtl.ifInstr), hex(rtl.idInstr), rtl.stall,
    rtl.branch, rtl.jump, rtl.forwardA, rtl.forwardB, hex(rtl.exResult),
    rtl.memRead, rtl.memWrite, hex(rtl.memAddress), hex(rtl.memWriteData),
    rtl.wbWrite, rtl.wbRegister, hex(rtl.wbData), hex(rtl.postPc),
    ...rtl.registers.map(hex), ...rtl.memory.map(hex),
  ];
  const parsed = parseTrace(`${headers.join(",")}\n${values.join(",")}\n`);
  assert.equal(parsed.length, 1);
  assert.equal(compareFrames([reference], parsed).mismatches.length, 0);
});
