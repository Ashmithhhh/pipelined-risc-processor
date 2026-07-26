// Cycle-accurate behavioral model for the Verilog CPU in this repository.
// The browser UI imports this file directly; Node's test runner uses it too.

export const EXAMPLE_PROGRAM = `# Forwarding, memory, load-use stall, and branch flush demo
addi r1,  r0, 10
addi r2,  r0, 20
add  r3,  r1, r2
sub  r4,  r3, r1
sw   r4,  0(r0)
lw   r5,  0(r0)
add  r6,  r5, r1
beq  r1,  r1, done
addi r7,  r0, 99
addi r8,  r0, 99
done:
addi r9,  r0, 7
and  r10, r9, r1
or   r11, r9, r1
slt  r12, r1, r2
`;

export const EXAMPLES = {
  main: EXAMPLE_PROGRAM,
  hazards: `# Both forwarding paths and one load-use bubble
addi r1, r0, 5
addi r2, r1, 7
add  r3, r2, r1
sw   r3, 0(r0)
lw   r4, 0(r0)
sub  r5, r4, r1
`,
  control: `# Taken/not-taken branches and an ID-stage jump
addi r1, r0, 3
addi r2, r0, 3
beq  r1, r2, equal
addi r3, r0, 99
equal:
beq  r1, r0, never
addi r4, r0, 11
j finished
never:
addi r4, r0, 99
finished:
addi r5, r0, 22
`,
};

const OPCODE = Object.freeze({
  RTYPE: 0x00,
  J: 0x02,
  BEQ: 0x04,
  ADDI: 0x08,
  LW: 0x23,
  SW: 0x2b,
});

const FUNCT = Object.freeze({
  ADD: 0x20,
  SUB: 0x22,
  AND: 0x24,
  OR: 0x25,
  SLT: 0x2a,
});

const REGISTER_ALIASES = Object.freeze({
  zero: 0, at: 1, v0: 2, v1: 3,
  a0: 4, a1: 5, a2: 6, a3: 7,
  t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15,
  s0: 16, s1: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23,
  t8: 24, t9: 25, k0: 26, k1: 27, gp: 28, sp: 29, fp: 30, s8: 30, ra: 31,
});

export class AssemblyError extends Error {
  constructor(message, line = null) {
    super(line == null ? message : `Line ${line}: ${message}`);
    this.name = "AssemblyError";
    this.line = line;
  }
}

export function hex32(value) {
  return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function stripComment(line) {
  return line.replace(/(#|\/\/|;).*$/, "").trim();
}

function parseNumber(token, line) {
  const text = token.trim().toLowerCase();
  let sign = 1;
  let digits = text;
  if (digits.startsWith("-")) {
    sign = -1;
    digits = digits.slice(1);
  } else if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  let value;
  if (/^0x[0-9a-f]+$/.test(digits)) value = Number.parseInt(digits.slice(2), 16);
  else if (/^[0-9]+$/.test(digits)) value = Number.parseInt(digits, 10);
  else throw new AssemblyError(`invalid number '${token}'`, line);

  value *= sign;
  if (!Number.isSafeInteger(value)) throw new AssemblyError(`number '${token}' is too large`, line);
  return value;
}

function parseRegister(token, line) {
  let name = token.trim().toLowerCase().replace(/^\$/, "");
  if (/^r\d+$/.test(name)) name = name.slice(1);
  if (/^\d+$/.test(name)) {
    const index = Number.parseInt(name, 10);
    if (index >= 0 && index <= 31) return index;
  }
  if (Object.prototype.hasOwnProperty.call(REGISTER_ALIASES, name)) return REGISTER_ALIASES[name];
  throw new AssemblyError(`invalid register '${token}' (use r0-r31 or a MIPS alias)`, line);
}

function splitOperands(text, expected, line) {
  const operands = text.trim() === "" ? [] : text.split(",").map((part) => part.trim());
  if (operands.length !== expected || operands.some((part) => part === "")) {
    throw new AssemblyError(`expected ${expected} operand${expected === 1 ? "" : "s"}`, line);
  }
  return operands;
}

function signed16(value, line, what = "immediate") {
  if (value < -32768 || value > 32767) {
    throw new AssemblyError(`${what} ${value} does not fit in signed 16 bits`, line);
  }
  return value & 0xffff;
}

function encodeR(rs, rt, rd, funct) {
  return (((rs & 31) << 21) | ((rt & 31) << 16) | ((rd & 31) << 11) | funct) >>> 0;
}

function encodeI(opcode, rs, rt, immediate) {
  return (((opcode & 63) << 26) | ((rs & 31) << 21) | ((rt & 31) << 16) | (immediate & 0xffff)) >>> 0;
}

function encodeJ(target) {
  return ((OPCODE.J << 26) | ((target >>> 2) & 0x03ffffff)) >>> 0;
}

function resolveValue(token, labels, line) {
  const key = token.trim().toLowerCase();
  if (labels.has(key)) return labels.get(key);
  return parseNumber(token, line);
}

function parseMemoryOperand(token, line) {
  const match = token.match(/^(.+?)\s*\(\s*([^()]+)\s*\)$/);
  if (!match) throw new AssemblyError(`expected memory operand offset(base), got '${token}'`, line);
  return {
    offset: parseNumber(match[1].trim(), line),
    base: parseRegister(match[2].trim(), line),
  };
}

function parseStatement(statement, labels) {
  const { text, line, pc } = statement;
  const match = text.match(/^(\.?[A-Za-z][\w.]*)\s*(.*)$/);
  if (!match) throw new AssemblyError(`cannot parse '${text}'`, line);
  const mnemonic = match[1].toLowerCase();
  const operandText = match[2].trim();

  if (mnemonic === ".word") {
    const [raw] = splitOperands(operandText, 1, line);
    const value = parseNumber(raw, line);
    if (value < -2147483648 || value > 0xffffffff) {
      throw new AssemblyError(`word ${raw} does not fit in 32 bits`, line);
    }
    return value >>> 0;
  }

  if (mnemonic === "nop") {
    splitOperands(operandText, 0, line);
    return 0;
  }

  const rFunctions = { add: FUNCT.ADD, sub: FUNCT.SUB, and: FUNCT.AND, or: FUNCT.OR, slt: FUNCT.SLT };
  if (Object.prototype.hasOwnProperty.call(rFunctions, mnemonic)) {
    const [rdText, rsText, rtText] = splitOperands(operandText, 3, line);
    return encodeR(
      parseRegister(rsText, line),
      parseRegister(rtText, line),
      parseRegister(rdText, line),
      rFunctions[mnemonic],
    );
  }

  if (mnemonic === "addi") {
    const [rtText, rsText, immText] = splitOperands(operandText, 3, line);
    const immediate = signed16(parseNumber(immText, line), line);
    return encodeI(OPCODE.ADDI, parseRegister(rsText, line), parseRegister(rtText, line), immediate);
  }

  if (mnemonic === "lw" || mnemonic === "sw") {
    const [rtText, addressText] = splitOperands(operandText, 2, line);
    const address = parseMemoryOperand(addressText, line);
    const immediate = signed16(address.offset, line, "memory offset");
    return encodeI(
      mnemonic === "lw" ? OPCODE.LW : OPCODE.SW,
      address.base,
      parseRegister(rtText, line),
      immediate,
    );
  }

  if (mnemonic === "beq") {
    const [rsText, rtText, targetText] = splitOperands(operandText, 3, line);
    let offset;
    const key = targetText.toLowerCase();
    if (labels.has(key)) {
      const delta = labels.get(key) - (pc + 4);
      if (delta % 4 !== 0) throw new AssemblyError(`branch target '${targetText}' is not word aligned`, line);
      offset = delta / 4;
    } else {
      offset = parseNumber(targetText, line);
    }
    return encodeI(
      OPCODE.BEQ,
      parseRegister(rsText, line),
      parseRegister(rtText, line),
      signed16(offset, line, "branch offset"),
    );
  }

  if (mnemonic === "j") {
    const [targetText] = splitOperands(operandText, 1, line);
    const target = resolveValue(targetText, labels, line);
    if (target < 0 || target > 0x0fffffff || target % 4 !== 0) {
      throw new AssemblyError(`jump target ${targetText} must be a word-aligned 28-bit byte address`, line);
    }
    if (((pc + 4) & 0xf0000000) !== (target & 0xf0000000)) {
      throw new AssemblyError(`jump target ${targetText} is outside the current 256 MB region`, line);
    }
    return encodeJ(target);
  }

  throw new AssemblyError(`unsupported instruction '${mnemonic}'`, line);
}

/** Assemble the processor's MIPS-style subset. Labels are byte addresses. */
export function assemble(source) {
  const labels = new Map();
  const statements = [];
  const lines = source.replace(/\r/g, "").split("\n");
  let pc = 0;

  lines.forEach((rawLine, index) => {
    let text = stripComment(rawLine);
    const line = index + 1;
    while (text !== "") {
      const labelMatch = text.match(/^([A-Za-z_]\w*)\s*:\s*/);
      if (!labelMatch) break;
      const label = labelMatch[1].toLowerCase();
      if (labels.has(label)) throw new AssemblyError(`duplicate label '${labelMatch[1]}'`, line);
      labels.set(label, pc);
      text = text.slice(labelMatch[0].length).trim();
    }
    if (text !== "") {
      statements.push({ text, raw: rawLine.trim(), line, pc });
      pc += 4;
    }
  });

  if (statements.length > 256) throw new AssemblyError("program exceeds the 256-word instruction memory");

  const words = statements.map((statement) => parseStatement(statement, labels));
  const sourceByPc = new Map(statements.map((statement) => [statement.pc, statement.text]));
  const lineByPc = new Map(statements.map((statement) => [statement.pc, statement.line]));
  return { words, sourceByPc, lineByPc, labels, format: "assembly" };
}

/** Parse one 32-bit hexadecimal instruction per line, like program.hex. */
export function parseHexProgram(source) {
  const words = [];
  const sourceByPc = new Map();
  const lineByPc = new Map();
  source.replace(/\r/g, "").split("\n").forEach((rawLine, index) => {
    const text = stripComment(rawLine).replace(/^0x/i, "");
    if (text === "") return;
    if (!/^[0-9a-fA-F]{1,8}$/.test(text)) {
      throw new AssemblyError(`expected one 32-bit hexadecimal word, got '${text}'`, index + 1);
    }
    if (words.length >= 256) throw new AssemblyError("program exceeds the 256-word instruction memory", index + 1);
    const pc = words.length * 4;
    const word = Number.parseInt(text, 16) >>> 0;
    words.push(word);
    sourceByPc.set(pc, disassemble(word, pc));
    lineByPc.set(pc, index + 1);
  });
  return { words, sourceByPc, lineByPc, labels: new Map(), format: "hex" };
}

/** Automatically accepts assembly or program.hex-style input. */
export function compileProgram(source) {
  const meaningful = source.replace(/\r/g, "").split("\n").map(stripComment).filter(Boolean);
  const looksLikeHex = meaningful.length > 0 && meaningful.every((line) => /^(?:0x)?[0-9a-fA-F]{8}$/.test(line));
  return looksLikeHex ? parseHexProgram(source) : assemble(source);
}

/** Format a compiled program exactly as $readmemh expects it. */
export function formatHexProgram(programOrWords) {
  const words = Array.isArray(programOrWords) ? programOrWords : programOrWords?.words;
  if (!Array.isArray(words)) throw new TypeError("expected a compiled program or word array");
  return words.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("\n") + (words.length ? "\n" : "");
}

function signExtend16(value) {
  return (value << 16) >> 16;
}

export function decode(word, pc = 0) {
  word >>>= 0;
  const opcode = word >>> 26;
  const rs = (word >>> 21) & 31;
  const rt = (word >>> 16) & 31;
  const rd = (word >>> 11) & 31;
  const funct = word & 63;
  const immediate = signExtend16(word & 0xffff);
  const jumpAddress = word & 0x03ffffff;
  const base = {
    word, pc: pc >>> 0, opcode, rs, rt, rd, funct, immediate, jumpAddress,
    name: ".word", alu: "add", regDst: false, branch: false, memRead: false,
    memToReg: false, memWrite: false, aluSrc: false, regWrite: false, jump: false,
    usesRs: false, usesRt: false,
  };

  if (word === 0) return { ...base, name: "nop" };

  if (opcode === OPCODE.RTYPE) {
    const names = { [FUNCT.ADD]: "add", [FUNCT.SUB]: "sub", [FUNCT.AND]: "and", [FUNCT.OR]: "or", [FUNCT.SLT]: "slt" };
    const name = names[funct];
    if (!name) return base;
    return {
      ...base, name, alu: name, regDst: true, regWrite: true, usesRs: true, usesRt: true,
    };
  }
  if (opcode === OPCODE.ADDI) {
    return { ...base, name: "addi", aluSrc: true, regWrite: true, usesRs: true };
  }
  if (opcode === OPCODE.LW) {
    return {
      ...base, name: "lw", aluSrc: true, memRead: true, memToReg: true, regWrite: true, usesRs: true,
    };
  }
  if (opcode === OPCODE.SW) {
    return { ...base, name: "sw", aluSrc: true, memWrite: true, usesRs: true, usesRt: true };
  }
  if (opcode === OPCODE.BEQ) {
    return { ...base, name: "beq", alu: "sub", branch: true, usesRs: true, usesRt: true };
  }
  if (opcode === OPCODE.J) return { ...base, name: "j", jump: true };
  return base;
}

export function disassemble(word, pc = 0) {
  const instruction = decode(word, pc);
  const { name, rs, rt, rd, immediate, jumpAddress } = instruction;
  if (name === "nop") return "nop";
  if (["add", "sub", "and", "or", "slt"].includes(name)) return `${name} r${rd}, r${rs}, r${rt}`;
  if (name === "addi") return `addi r${rt}, r${rs}, ${immediate}`;
  if (name === "lw" || name === "sw") return `${name} r${rt}, ${immediate}(r${rs})`;
  if (name === "beq") return `beq r${rs}, r${rt}, ${immediate}`;
  if (name === "j") {
    const target = ((((pc + 4) >>> 0) & 0xf0000000) | (jumpAddress << 2)) >>> 0;
    return `j ${hex32(target)}`;
  }
  return `.word ${hex32(word)}`;
}

function emptyStage() {
  return { valid: false, pc: 0, word: 0 };
}

function alu(operation, a, b) {
  a >>>= 0;
  b >>>= 0;
  if (operation === "sub") return (a - b) >>> 0;
  if (operation === "and") return (a & b) >>> 0;
  if (operation === "or") return (a | b) >>> 0;
  if (operation === "slt") return (a | 0) < (b | 0) ? 1 : 0;
  return (a + b) >>> 0;
}

/**
 * Five-stage IF/ID/EX/MEM/WB simulator matching pipeline_cpu.v.
 * Control priority is oldest-first: taken EX branch, ID jump, then sequential PC.
 */
export class PipelineSimulator {
  constructor(program = assemble(EXAMPLE_PROGRAM)) {
    this.load(program);
  }

  load(program) {
    this.program = typeof program === "string" ? compileProgram(program) : program;
    if (!this.program || !Array.isArray(this.program.words)) throw new TypeError("invalid compiled program");
    this.reset();
  }

  reset() {
    this.pc = 0;
    this.registers = new Uint32Array(32);
    this.memory = new Uint32Array(256);
    this.ifid = emptyStage();
    this.idex = emptyStage();
    this.exmem = emptyStage();
    this.memwb = emptyStage();
    this.cycle = 0;
    this.retired = 0;
    this.stalls = 0;
    this.flushes = 0;
    this.takenBranches = 0;
    this.jumps = 0;
    this.history = [];
    this.lastEvent = null;
  }

  fetch(pc = this.pc) {
    pc >>>= 0;
    if ((pc & 3) !== 0) return emptyStage();
    const index = pc >>> 2;
    if (index >= this.program.words.length) return emptyStage();
    return { valid: true, pc, word: this.program.words[index] >>> 0 };
  }

  assemblyAt(stage) {
    if (!stage.valid) return "bubble";
    return this.program.sourceByPc.get(stage.pc) || disassemble(stage.word, stage.pc);
  }

  getStages() {
    return [
      { name: "IF", ...this.fetch(), assembly: this.assemblyAt(this.fetch()) },
      { name: "ID", ...this.ifid, assembly: this.assemblyAt(this.ifid) },
      { name: "EX", ...this.idex, assembly: this.assemblyAt(this.idex) },
      { name: "MEM", ...this.exmem, assembly: this.assemblyAt(this.exmem) },
      { name: "WB", ...this.memwb, assembly: this.assemblyAt(this.memwb) },
    ];
  }

  isHalted() {
    return !this.fetch().valid && !this.ifid.valid && !this.idex.valid && !this.exmem.valid && !this.memwb.valid;
  }

  stats() {
    return {
      cycle: this.cycle,
      retired: this.retired,
      stalls: this.stalls,
      flushes: this.flushes,
      takenBranches: this.takenBranches,
      jumps: this.jumps,
      cpi: this.retired === 0 ? 0 : this.cycle / this.retired,
    };
  }

  step() {
    if (this.isHalted()) return null;

    const cycle = this.cycle + 1;
    const pcBefore = this.pc >>> 0;
    const stagesBefore = this.getStages().map((stage) => stage.assembly);
    const wbResult = this.memwb.valid
      ? (this.memwb.memToReg ? this.memwb.readData : this.memwb.aluResult) >>> 0
      : 0;
    let registerWrite = null;
    let memoryWrite = null;

    // WB writes on this edge. The register-file bypass makes this value visible
    // to the instruction currently in ID during the same cycle.
    if (this.memwb.valid) {
      this.retired += 1;
      if (this.memwb.regWrite && this.memwb.writeReg !== 0) {
        this.registers[this.memwb.writeReg] = wbResult;
        registerWrite = { register: this.memwb.writeReg, value: wbResult };
      }
    }
    this.registers[0] = 0;

    // MEM combinational read and edge-triggered write from the old EX/MEM stage.
    let memReadData = 0;
    if (this.exmem.valid) {
      const memoryIndex = (this.exmem.aluResult >>> 2) & 0xff;
      if (this.exmem.memRead) memReadData = this.memory[memoryIndex] >>> 0;
      if (this.exmem.memWrite) {
        const value = this.exmem.writeData >>> 0;
        this.memory[memoryIndex] = value;
        memoryWrite = { address: this.exmem.aluResult >>> 0, index: memoryIndex, value };
      }
    }

    const idInstruction = this.ifid.valid ? decode(this.ifid.word, this.ifid.pc) : decode(0, 0);
    const readRegister = (index) => index === 0 ? 0 : this.registers[index] >>> 0;
    const idRd1 = readRegister(idInstruction.rs);
    const idRd2 = readRegister(idInstruction.rt);

    const exInstruction = this.idex.valid ? this.idex.instruction : decode(0, 0);
    const exmemCanForward = this.exmem.valid && this.exmem.regWrite && this.exmem.writeReg !== 0;
    const memwbCanForward = this.memwb.valid && this.memwb.regWrite && this.memwb.writeReg !== 0;

    const forwardedOperand = (register, original) => {
      if (exmemCanForward && this.exmem.writeReg === register) {
        return { value: this.exmem.aluResult >>> 0, source: "EX/MEM" };
      }
      if (memwbCanForward && this.memwb.writeReg === register) {
        return { value: wbResult, source: "MEM/WB" };
      }
      return { value: original >>> 0, source: "ID/EX" };
    };

    const forwardA = forwardedOperand(exInstruction.rs, this.idex.rd1 || 0);
    const forwardB = forwardedOperand(exInstruction.rt, this.idex.rd2 || 0);
    const operandB = exInstruction.aluSrc ? exInstruction.immediate >>> 0 : forwardB.value;
    const exResult = this.idex.valid ? alu(exInstruction.alu, forwardA.value, operandB) : 0;
    const exWriteReg = exInstruction.regDst ? exInstruction.rd : exInstruction.rt;
    const branchTarget = this.idex.valid
      ? (this.idex.pc + 4 + exInstruction.immediate * 4) >>> 0
      : 0;
    const branchTaken = Boolean(this.idex.valid && exInstruction.branch && exResult === 0);

    // Source-aware load-use check avoids false stalls on addi/lw destination rt
    // and on jump target bits.
    const loadDestination = this.idex.valid && exInstruction.memRead ? exInstruction.rt : 0;
    const hazardStall = Boolean(
      this.ifid.valid && loadDestination !== 0
      && ((idInstruction.usesRs && idInstruction.rs === loadDestination)
        || (idInstruction.usesRt && idInstruction.rt === loadDestination)),
    );

    // An older taken branch must beat a younger wrong-path jump in ID.
    const jumpTaken = Boolean(this.ifid.valid && idInstruction.jump && !branchTaken && !hazardStall);
    const jumpTarget = ((((this.ifid.pc + 4) >>> 0) & 0xf0000000) | (idInstruction.jumpAddress << 2)) >>> 0;

    const nextMemwb = this.exmem.valid ? {
      valid: true,
      pc: this.exmem.pc,
      word: this.exmem.word,
      memToReg: this.exmem.memToReg,
      regWrite: this.exmem.regWrite,
      readData: memReadData,
      aluResult: this.exmem.aluResult >>> 0,
      writeReg: this.exmem.writeReg,
    } : emptyStage();

    const nextExmem = this.idex.valid ? {
      valid: true,
      pc: this.idex.pc,
      word: this.idex.word,
      branch: exInstruction.branch,
      memRead: exInstruction.memRead,
      memToReg: exInstruction.memToReg,
      memWrite: exInstruction.memWrite,
      regWrite: exInstruction.regWrite,
      zero: exResult === 0,
      branchTarget,
      aluResult: exResult,
      writeData: forwardB.value >>> 0,
      writeReg: exWriteReg,
    } : emptyStage();

    let nextIfid;
    let nextIdex;
    let nextPc;
    let control = "sequential";

    if (branchTaken) {
      nextPc = branchTarget;
      nextIfid = emptyStage();
      nextIdex = emptyStage();
      this.flushes += 1;
      this.takenBranches += 1;
      control = "branch";
    } else if (hazardStall) {
      nextPc = this.pc;
      nextIfid = { ...this.ifid };
      nextIdex = emptyStage();
      this.stalls += 1;
      control = "stall";
    } else if (jumpTaken) {
      nextPc = jumpTarget;
      nextIfid = emptyStage();
      nextIdex = emptyStage();
      this.flushes += 1;
      this.jumps += 1;
      this.retired += 1; // J is completed in ID and never enters the later stages.
      control = "jump";
    } else {
      nextPc = (this.pc + 4) >>> 0;
      nextIfid = this.fetch();
      nextIdex = this.ifid.valid ? {
        valid: true,
        pc: this.ifid.pc,
        word: this.ifid.word,
        instruction: idInstruction,
        rd1: idRd1,
        rd2: idRd2,
      } : emptyStage();
    }

    this.pc = nextPc >>> 0;
    this.ifid = nextIfid;
    this.idex = nextIdex;
    this.exmem = nextExmem;
    this.memwb = nextMemwb;
    this.cycle = cycle;
    this.registers[0] = 0;

    const event = {
      cycle,
      pc: pcBefore,
      stages: stagesBefore,
      control,
      hazardStall,
      branchTaken,
      branchTarget,
      jumpTaken,
      jumpTarget,
      forwardA: exInstruction.usesRs ? forwardA.source : "—",
      forwardB: exInstruction.usesRt ? forwardB.source : "—",
      registerWrite,
      memoryWrite,
    };
    this.lastEvent = event;
    this.history.unshift(event);
    if (this.history.length > 200) this.history.length = 200;
    return event;
  }

  run(maxCycles = 1000) {
    let steps = 0;
    while (!this.isHalted() && steps < maxCycles) {
      this.step();
      steps += 1;
    }
    return { halted: this.isHalted(), steps, stats: this.stats() };
  }
}
