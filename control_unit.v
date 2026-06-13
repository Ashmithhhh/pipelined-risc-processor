// ============================================================
// control_unit.v - Main Control Unit (ID stage)
// ============================================================
`include "defines.v"

module control_unit (
    input  wire [5:0] opcode,
    output reg        reg_dst,    // 1: rd (R-type), 0: rt (I-type)
    output reg        branch,
    output reg        mem_read,
    output reg        mem_to_reg,
    output reg [1:0]  alu_op,
    output reg        mem_write,
    output reg        alu_src,    // 1: immediate, 0: reg
    output reg        reg_write,
    output reg        jump
);
    always @(*) begin
        // defaults (NOP / unsupported -> safe no-op)
        reg_dst    = 1'b0;
        branch     = 1'b0;
        mem_read   = 1'b0;
        mem_to_reg = 1'b0;
        alu_op     = 2'b00;
        mem_write  = 1'b0;
        alu_src    = 1'b0;
        reg_write  = 1'b0;
        jump       = 1'b0;

        case (opcode)
            `OP_RTYPE: begin
                reg_dst    = 1'b1;
                alu_op     = 2'b10;
                reg_write  = 1'b1;
            end
            `OP_ADDI: begin
                alu_src    = 1'b1;
                alu_op     = 2'b00;
                reg_write  = 1'b1;
            end
            `OP_LW: begin
                alu_src    = 1'b1;
                mem_read   = 1'b1;
                mem_to_reg = 1'b1;
                reg_write  = 1'b1;
                alu_op     = 2'b00;
            end
            `OP_SW: begin
                alu_src    = 1'b1;
                mem_write  = 1'b1;
                alu_op     = 2'b00;
            end
            `OP_BEQ: begin
                branch     = 1'b1;
                alu_op     = 2'b01;
            end
            `OP_J: begin
                jump       = 1'b1;
            end
            default: begin
                // NOP
            end
        endcase
    end
endmodule
