// ============================================================
// alu_control.v - Generates ALU control signal from ALUOp + funct
// ============================================================
`include "defines.v"

module alu_control (
    input  wire [1:0] alu_op,    // 00: add(lw/sw/addi), 01: sub(beq), 10: R-type(funct)
    input  wire [5:0] funct,
    output reg  [2:0] alu_ctrl
);
    always @(*) begin
        case (alu_op)
            2'b00: alu_ctrl = `ALU_ADD;
            2'b01: alu_ctrl = `ALU_SUB;
            2'b10: begin
                case (funct)
                    `FUNC_ADD: alu_ctrl = `ALU_ADD;
                    `FUNC_SUB: alu_ctrl = `ALU_SUB;
                    `FUNC_AND: alu_ctrl = `ALU_AND;
                    `FUNC_OR : alu_ctrl = `ALU_OR;
                    `FUNC_SLT: alu_ctrl = `ALU_SLT;
                    default  : alu_ctrl = `ALU_ADD;
                endcase
            end
            default: alu_ctrl = `ALU_ADD;
        endcase
    end
endmodule
