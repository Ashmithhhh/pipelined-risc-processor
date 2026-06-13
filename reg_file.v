// ============================================================
// reg_file.v - Register File (32 x 32-bit), R0 hardwired to 0
// ============================================================
module reg_file (
    input  wire        clk,
    input  wire        rst,
    input  wire        we,
    input  wire [4:0]  ra1,
    input  wire [4:0]  ra2,
    input  wire [4:0]  wa,
    input  wire [31:0] wd,
    output wire [31:0] rd1,
    output wire [31:0] rd2
);
    reg [31:0] regs [0:31];
    integer i;

    always @(posedge clk or posedge rst) begin
        if (rst) begin
            for (i = 0; i < 32; i = i + 1)
                regs[i] <= 32'b0;
        end else if (we && wa != 5'b0) begin
            regs[wa] <= wd;
        end
    end

    assign rd1 = (ra1 == 5'b0) ? 32'b0 :
                  (we && wa == ra1) ? wd : regs[ra1];
    assign rd2 = (ra2 == 5'b0) ? 32'b0 :
                  (we && wa == ra2) ? wd : regs[ra2];
endmodule