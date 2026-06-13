// ============================================================
// instr_mem.v - Instruction Memory (ROM, word-addressed via byte addr)
// ============================================================
module instr_mem (
    input  wire [31:0] addr,
    output wire [31:0] instr
);
    reg [31:0] mem [0:255]; // 256 words

    initial begin
        $readmemh("program.hex", mem);
    end

    // Word aligned access: addr[31:2] indexes the array
    assign instr = mem[addr[9:2]];
endmodule
