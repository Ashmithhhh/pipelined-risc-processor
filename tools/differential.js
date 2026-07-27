#!/usr/bin/env node
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { PipelineSimulator, compileProgram, formatHexProgram, hex32 } from "../simulator/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RTL_FILES = [
  "defines.v", "pc.v", "instr_mem.v", "reg_file.v", "alu.v", "alu_control.v",
  "control_unit.v", "hazard_unit.v", "forwarding_unit.v", "data_mem.v",
  "if_id_reg.v", "id_ex_reg.v", "ex_mem_reg.v", "mem_wb_reg.v",
  "pipeline_cpu.v", "tb_differential.v",
];

function usage() {
  console.log(`PIPE/5 RTL ↔ JavaScript differential verifier

Usage:
  node tools/differential.js [program.hex ...] [--max-cycles N] [--report FILE]

Without program arguments, program.hex and every test_programs/*.hex file are checked.`);
}

function commandAvailable(command) {
  const result = spawnSync(command, ["-V"], { encoding: "utf8", stdio: "ignore" });
  return !result.error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} exited with status ${result.status}${details ? `\n${details}` : ""}`);
  }
  return result;
}

function parseArguments(argv) {
  const programs = [];
  let maxCycles = 2000;
  let reportPath = path.join(ROOT, "verification-report.json");
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--max-cycles") {
      maxCycles = Number(argv[++index]);
      if (!Number.isInteger(maxCycles) || maxCycles < 1) throw new Error("--max-cycles must be a positive integer");
    } else if (argument === "--report") {
      reportPath = path.resolve(argv[++index]);
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      programs.push(path.resolve(argument));
    }
  }
  return { help: false, programs, maxCycles, reportPath };
}

async function defaultPrograms() {
  const directory = path.join(ROOT, "test_programs");
  const tests = (await readdir(directory))
    .filter((name) => name.endsWith(".hex"))
    .sort()
    .map((name) => path.join(directory, name));
  return [path.join(ROOT, "program.hex"), ...tests];
}

async function loadProgram(filePath) {
  const source = await readFile(filePath, "utf8");
  const program = compileProgram(source);
  if (program.words.length === 0) throw new Error(`${filePath} contains no instructions`);
  return program;
}

export function buildReference(program, maxCycles = 2000) {
  const simulator = new PipelineSimulator(program);
  const frames = [];
  while (!simulator.isHalted()) {
    if (frames.length >= maxCycles) {
      throw new Error(`JavaScript model did not drain within ${maxCycles} cycles`);
    }
    const event = simulator.step();
    frames.push({
      cycle: event.cycle,
      pc: event.pc >>> 0,
      ...event.rtl,
      registers: Array.from(simulator.registers, (value) => value >>> 0),
      memory: Array.from(simulator.memory, (value) => value >>> 0),
    });
  }
  return frames;
}

function parseInteger(value, base, label) {
  if (value == null || value === "" || /[xz]/i.test(value)) {
    throw new Error(`RTL trace contains an unknown value for ${label}: '${value}'`);
  }
  const parsed = Number.parseInt(value, base);
  if (!Number.isFinite(parsed)) throw new Error(`Could not parse RTL value for ${label}: '${value}'`);
  return parsed >>> 0;
}

export function parseTrace(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("RTL trace is empty");
  const headers = lines[0].split(",");
  return lines.slice(1).map((line, lineIndex) => {
    const values = line.split(",");
    if (values.length !== headers.length) {
      throw new Error(`RTL trace line ${lineIndex + 2} has ${values.length} fields; expected ${headers.length}`);
    }
    const raw = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    return {
      cycle: parseInteger(raw.cycle, 10, "cycle"),
      pc: parseInteger(raw.pc, 16, "pc"),
      ifInstr: parseInteger(raw.if_instr, 16, "if_instr"),
      idInstr: parseInteger(raw.id_instr, 16, "id_instr"),
      stall: parseInteger(raw.stall, 10, "stall"),
      branch: parseInteger(raw.branch, 10, "branch"),
      jump: parseInteger(raw.jump, 10, "jump"),
      forwardA: parseInteger(raw.fwd_a, 10, "fwd_a"),
      forwardB: parseInteger(raw.fwd_b, 10, "fwd_b"),
      exResult: parseInteger(raw.ex_result, 16, "ex_result"),
      memRead: parseInteger(raw.mem_read, 10, "mem_read"),
      memWrite: parseInteger(raw.mem_write, 10, "mem_write"),
      memAddress: parseInteger(raw.mem_addr, 16, "mem_addr"),
      memWriteData: parseInteger(raw.mem_wdata, 16, "mem_wdata"),
      wbWrite: parseInteger(raw.wb_write, 10, "wb_write"),
      wbRegister: parseInteger(raw.wb_reg, 10, "wb_reg"),
      wbData: parseInteger(raw.wb_data, 16, "wb_data"),
      postPc: parseInteger(raw.post_pc, 16, "post_pc"),
      registers: Array.from({ length: 32 }, (_, index) => parseInteger(raw[`r${index}`], 16, `r${index}`)),
      memory: Array.from({ length: 256 }, (_, index) => parseInteger(raw[`m${index}`], 16, `m${index}`)),
    };
  });
}

function displayValue(value, kind) {
  return kind === "decimal" ? String(value) : hex32(value);
}

export function compareFrames(reference, rtl) {
  const mismatches = [];
  let comparisons = 0;
  const compare = (cycle, signal, expected, actual, kind = "hex") => {
    comparisons += 1;
    if ((expected >>> 0) !== (actual >>> 0) && mismatches.length < 25) {
      mismatches.push({
        cycle,
        signal,
        expected: displayValue(expected >>> 0, kind),
        actual: displayValue(actual >>> 0, kind),
      });
    }
  };

  if (reference.length !== rtl.length) {
    mismatches.push({ cycle: 0, signal: "trace_length", expected: String(reference.length), actual: String(rtl.length) });
  }

  const length = Math.min(reference.length, rtl.length);
  for (let index = 0; index < length; index += 1) {
    const expected = reference[index];
    const actual = rtl[index];
    const cycle = expected.cycle;
    compare(cycle, "cycle", expected.cycle, actual.cycle, "decimal");
    compare(cycle, "pc", expected.pc, actual.pc);
    compare(cycle, "if_instr", expected.ifInstr, actual.ifInstr);
    compare(cycle, "id_instr", expected.idInstr, actual.idInstr);
    compare(cycle, "stall", Number(expected.stall), actual.stall, "decimal");
    compare(cycle, "branch", Number(expected.branch), actual.branch, "decimal");
    compare(cycle, "jump", Number(expected.jump), actual.jump, "decimal");

    if (expected.exValid) {
      compare(cycle, "forward_a", expected.forwardA, actual.forwardA, "decimal");
      compare(cycle, "forward_b", expected.forwardB, actual.forwardB, "decimal");
      compare(cycle, "ex_result", expected.exResult, actual.exResult);
    }

    compare(cycle, "mem_read", Number(expected.memRead), actual.memRead, "decimal");
    compare(cycle, "mem_write", Number(expected.memWrite), actual.memWrite, "decimal");
    if (expected.memValid) compare(cycle, "mem_address/exmem_result", expected.memAddress, actual.memAddress);
    if (expected.memWrite) compare(cycle, "mem_write_data", expected.memWriteData, actual.memWriteData);

    compare(cycle, "wb_write", Number(expected.wbWrite), actual.wbWrite, "decimal");
    if (expected.wbWrite) {
      compare(cycle, "wb_register", expected.wbRegister, actual.wbRegister, "decimal");
      compare(cycle, "wb_data", expected.wbData, actual.wbData);
    }
    compare(cycle, "post_pc", expected.postPc, actual.postPc);

    for (let register = 0; register < 32; register += 1) {
      compare(cycle, `r${register}`, expected.registers[register], actual.registers[register]);
    }
    for (let word = 0; word < 256; word += 1) {
      compare(cycle, `mem[${word}]`, expected.memory[word], actual.memory[word]);
    }
  }
  return { comparisons, mismatches };
}

async function compileRtl(workDirectory) {
  const image = path.join(workDirectory, "differential.vvp");
  run("iverilog", [
    "-g2012", "-Wall", "-I", ROOT, "-s", "tb_differential", "-o", image,
    ...RTL_FILES.map((file) => path.join(ROOT, file)),
  ], { cwd: ROOT });
  return image;
}

async function verifyProgram(filePath, program, image, workDirectory, maxCycles) {
  const reference = buildReference(program, maxCycles);
  const caseDirectory = path.join(workDirectory, path.basename(filePath).replace(/[^a-z0-9_.-]/gi, "_"));
  await mkdir(caseDirectory, { recursive: true });
  await writeFile(path.join(caseDirectory, "program.hex"), formatHexProgram(program));

  run("vvp", [image, `+CYCLES=${reference.length}`, "+TRACE_FILE=rtl-trace.csv"], { cwd: caseDirectory });
  const rtl = parseTrace(await readFile(path.join(caseDirectory, "rtl-trace.csv"), "utf8"));
  const comparison = compareFrames(reference, rtl);
  return {
    program: path.relative(ROOT, filePath) || path.basename(filePath),
    words: program.words.length,
    cycles: reference.length,
    comparisons: comparison.comparisons,
    passed: comparison.mismatches.length === 0,
    mismatches: comparison.mismatches,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!commandAvailable("iverilog") || !commandAvailable("vvp")) {
    console.error("RTL verification requires Icarus Verilog (iverilog and vvp) on PATH.");
    process.exitCode = 2;
    return;
  }

  const programs = options.programs.length ? options.programs : await defaultPrograms();
  const workDirectory = await mkdtemp(path.join(os.tmpdir(), "pipe5-diff-"));
  const startedAt = new Date().toISOString();
  const results = [];
  try {
    const image = await compileRtl(workDirectory);
    console.log("PIPE/5 differential verification");
    console.log(`Comparing ${programs.length} program${programs.length === 1 ? "" : "s"}...\n`);
    for (const filePath of programs) {
      try {
        const program = await loadProgram(filePath);
        const result = await verifyProgram(filePath, program, image, workDirectory, options.maxCycles);
        results.push(result);
        if (result.passed) {
          console.log(`PASS  ${result.program} — ${result.cycles} cycles, ${result.comparisons.toLocaleString()} comparisons`);
        } else {
          console.log(`FAIL  ${result.program} — ${result.mismatches.length} mismatch${result.mismatches.length === 1 ? "" : "es"}`);
          for (const mismatch of result.mismatches.slice(0, 5)) {
            console.log(`      cycle ${mismatch.cycle} ${mismatch.signal}: JS=${mismatch.expected}, RTL=${mismatch.actual}`);
          }
        }
      } catch (error) {
        results.push({ program: path.relative(ROOT, filePath), passed: false, error: error.message });
        console.log(`ERROR ${path.relative(ROOT, filePath)} — ${error.message}`);
      }
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }

  const report = {
    generatedAt: startedAt,
    passed: results.every((result) => result.passed),
    rtl: "pipeline_cpu.v",
    reference: "simulator/core.js",
    results,
  };
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.passed ? "PASS" : "FAIL"}: ${results.filter((result) => result.passed).length}/${results.length} programs matched.`);
  console.log(`Report: ${path.relative(process.cwd(), options.reportPath) || options.reportPath}`);
  if (!report.passed) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`Differential verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
