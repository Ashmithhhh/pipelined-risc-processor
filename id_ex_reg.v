// ============================================================
// id_ex_reg.v - ID/EX Pipeline Register
// ============================================================
module id_ex_reg (
    input  wire        clk,
    input  wire        rst,
    input  wire        flush,    // bubble insertion (hazard stall or branch misprediction)

    // Control signals in
    input  wire        reg_dst_in,
    input  wire        branch_in,
    input  wire        mem_read_in,
    input  wire        mem_to_reg_in,
    input  wire [1:0]  alu_op_in,
    input  wire        mem_write_in,
    input  wire        alu_src_in,
    input  wire        reg_write_in,

    // Data in
    input  wire [31:0] pc_plus4_in,
    input  wire [31:0] rd1_in,
    input  wire [31:0] rd2_in,
    input  wire [31:0] sign_ext_in,
    input  wire [4:0]  rs_in,
    input  wire [4:0]  rt_in,
    input  wire [4:0]  rd_in,
    input  wire [5:0]  funct_in,

    // Control signals out
    output reg         reg_dst_out,
    output reg         branch_out,
    output reg         mem_read_out,
    output reg         mem_to_reg_out,
    output reg  [1:0]  alu_op_out,
    output reg         mem_write_out,
    output reg         alu_src_out,
    output reg         reg_write_out,

    // Data out
    output reg  [31:0] pc_plus4_out,
    output reg  [31:0] rd1_out,
    output reg  [31:0] rd2_out,
    output reg  [31:0] sign_ext_out,
    output reg  [4:0]  rs_out,
    output reg  [4:0]  rt_out,
    output reg  [4:0]  rd_out,
    output reg  [5:0]  funct_out
);
    always @(posedge clk or posedge rst) begin
        if (rst || flush) begin
            reg_dst_out    <= 1'b0;
            branch_out     <= 1'b0;
            mem_read_out   <= 1'b0;
            mem_to_reg_out <= 1'b0;
            alu_op_out     <= 2'b00;
            mem_write_out  <= 1'b0;
            alu_src_out    <= 1'b0;
            reg_write_out  <= 1'b0;

            pc_plus4_out   <= 32'b0;
            rd1_out        <= 32'b0;
            rd2_out        <= 32'b0;
            sign_ext_out   <= 32'b0;
            rs_out         <= 5'b0;
            rt_out         <= 5'b0;
            rd_out         <= 5'b0;
            funct_out      <= 6'b0;
        end else begin
            reg_dst_out    <= reg_dst_in;
            branch_out     <= branch_in;
            mem_read_out   <= mem_read_in;
            mem_to_reg_out <= mem_to_reg_in;
            alu_op_out     <= alu_op_in;
            mem_write_out  <= mem_write_in;
            alu_src_out    <= alu_src_in;
            reg_write_out  <= reg_write_in;

            pc_plus4_out   <= pc_plus4_in;
            rd1_out        <= rd1_in;
            rd2_out        <= rd2_in;
            sign_ext_out   <= sign_ext_in;
            rs_out         <= rs_in;
            rt_out         <= rt_in;
            rd_out         <= rd_in;
            funct_out      <= funct_in;
        end
    end
endmodule
