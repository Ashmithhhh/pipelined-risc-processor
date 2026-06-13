// ============================================================
// if_id_reg.v - IF/ID Pipeline Register
// ============================================================
module if_id_reg (
    input  wire        clk,
    input  wire        rst,
    input  wire        flush,     // clear (branch taken / jump)
    input  wire        write_en,  // 0: stall (hold)
    input  wire [31:0] pc_in,
    input  wire [31:0] instr_in,
    output reg  [31:0] pc_out,
    output reg  [31:0] instr_out
);
    always @(posedge clk or posedge rst) begin
        if (rst || flush) begin
            pc_out    <= 32'b0;
            instr_out <= 32'b0; // NOP (opcode 000000, all zero)
        end else if (write_en) begin
            pc_out    <= pc_in;
            instr_out <= instr_in;
        end
        // else hold current values (stall)
    end
endmodule
