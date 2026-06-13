// ============================================================
// mem_wb_reg.v - MEM/WB Pipeline Register
// ============================================================
module mem_wb_reg (
    input  wire        clk,
    input  wire        rst,

    // Control in
    input  wire        mem_to_reg_in,
    input  wire        reg_write_in,

    // Data in
    input  wire [31:0] read_data_in,
    input  wire [31:0] alu_result_in,
    input  wire [4:0]  write_reg_in,

    // Control out
    output reg         mem_to_reg_out,
    output reg         reg_write_out,

    // Data out
    output reg  [31:0] read_data_out,
    output reg  [31:0] alu_result_out,
    output reg  [4:0]  write_reg_out
);
    always @(posedge clk or posedge rst) begin
        if (rst) begin
            mem_to_reg_out <= 1'b0;
            reg_write_out  <= 1'b0;
            read_data_out  <= 32'b0;
            alu_result_out <= 32'b0;
            write_reg_out  <= 5'b0;
        end else begin
            mem_to_reg_out <= mem_to_reg_in;
            reg_write_out  <= reg_write_in;
            read_data_out  <= read_data_in;
            alu_result_out <= alu_result_in;
            write_reg_out  <= write_reg_in;
        end
    end
endmodule
