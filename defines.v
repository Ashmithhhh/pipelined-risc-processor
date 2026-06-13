// ============================================================
// defines.v - Opcode and constant definitions
// ============================================================
`ifndef DEFINES_V
`define DEFINES_V

// Opcodes (6-bit)
`define OP_RTYPE 6'b000000
`define OP_ADDI  6'b001000
`define OP_LW    6'b100011
`define OP_SW    6'b101011
`define OP_BEQ   6'b000100
`define OP_J     6'b000010

// Function codes for R-type (6-bit)
`define FUNC_ADD 6'b100000
`define FUNC_SUB 6'b100010
`define FUNC_AND 6'b100100
`define FUNC_OR  6'b100101
`define FUNC_SLT 6'b101010

// ALU control codes (3-bit)
`define ALU_ADD  3'b000
`define ALU_SUB  3'b001
`define ALU_AND  3'b010
`define ALU_OR   3'b011
`define ALU_SLT  3'b100

`endif
