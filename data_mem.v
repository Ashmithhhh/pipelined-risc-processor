// ============================================================
// data_mem.v - Data Memory
// ============================================================
module data_mem (
    input  wire        clk,
    input  wire        mem_write,
    input  wire        mem_read,
    input  wire [31:0] addr,
    input  wire [31:0] write_data,
    output wire [31:0] read_data
);
    reg [31:0] mem [0:255]; // 256 words
    integer i;

    initial begin
        for (i = 0; i < 256; i = i + 1)
            mem[i] = 32'b0;
    end

    always @(posedge clk) begin
        if (mem_write)
            mem[addr[9:2]] <= write_data;
    end

    assign read_data = mem[addr[9:2]];
endmodule
