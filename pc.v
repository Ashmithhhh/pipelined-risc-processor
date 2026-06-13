// ============================================================
// pc.v - Program Counter register
// ============================================================
module pc_reg (
    input  wire        clk,
    input  wire        rst,
    input  wire        pc_write,   // stall control
    input  wire [31:0] pc_in,
    output reg  [31:0] pc_out
);
    always @(posedge clk or posedge rst) begin
        if (rst)
            pc_out <= 32'b0;
        else if (pc_write)
            pc_out <= pc_in;
    end
endmodule
