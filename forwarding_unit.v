// ============================================================
// forwarding_unit.v - Forwarding Unit for EX stage operand selection
// ============================================================
module forwarding_unit (
    input  wire [4:0] id_ex_rs,
    input  wire [4:0] id_ex_rt,

    input  wire [4:0] ex_mem_rd,
    input  wire       ex_mem_reg_write,

    input  wire [4:0] mem_wb_rd,
    input  wire       mem_wb_reg_write,

    output reg  [1:0] forward_a,  // 00: reg file, 01: EX/MEM result, 10: MEM/WB result
    output reg  [1:0] forward_b
);
    always @(*) begin
        // Forward A (rs)
        if (ex_mem_reg_write && (ex_mem_rd != 5'b0) && (ex_mem_rd == id_ex_rs))
            forward_a = 2'b01;
        else if (mem_wb_reg_write && (mem_wb_rd != 5'b0) && (mem_wb_rd == id_ex_rs))
            forward_a = 2'b10;
        else
            forward_a = 2'b00;

        // Forward B (rt)
        if (ex_mem_reg_write && (ex_mem_rd != 5'b0) && (ex_mem_rd == id_ex_rt))
            forward_b = 2'b01;
        else if (mem_wb_reg_write && (mem_wb_rd != 5'b0) && (mem_wb_rd == id_ex_rt))
            forward_b = 2'b10;
        else
            forward_b = 2'b00;
    end
endmodule
