// ============================================================
// hazard_unit.v - Hazard Detection Unit (load-use stall)
// ============================================================
module hazard_unit (
    input  wire [4:0] id_rs,
    input  wire [4:0] id_rt,
    input  wire       id_uses_rs,   // decoded ID instruction reads rs
    input  wire       id_uses_rt,   // decoded ID instruction reads rt
    input  wire [4:0] ex_rt,        // destination reg in EX (IF/ID->ID/EX rt)
    input  wire       ex_mem_read,  // ID/EX.MemRead
    output wire       stall         // 1: stall (PCWrite=0, IF/ID write=0, insert bubble)
);
    // Classic load-use hazard: instruction in EX is a load, and its
    // destination register matches a source operand of instruction in ID.
    // Source-use qualifiers prevent false stalls when rt is a destination
    // (ADDI/LW) or when instruction bits are a jump target rather than regs.
    assign stall = ex_mem_read && (ex_rt != 5'b0) &&
                   ((id_uses_rs && (ex_rt == id_rs)) ||
                    (id_uses_rt && (ex_rt == id_rt)));
endmodule
