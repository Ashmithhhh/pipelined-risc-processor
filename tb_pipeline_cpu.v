// ============================================================
// tb_pipeline_cpu.v - Testbench
// ============================================================
`timescale 1ns/1ps
`include "defines.v"

module tb_pipeline_cpu;

    reg clk;
    reg rst;

    pipeline_cpu DUT (
        .clk(clk),
        .rst(rst)
    );

    // Clock generation
    initial clk = 0;
    always #5 clk = ~clk;

    initial begin
        rst = 1;
        #12;
        rst = 0;
    end

    // Run for enough cycles to complete the program + pipeline drain
    initial begin
        #400;
        $display("\n--- Final Register File State ---");
        $display("r1  = %0d (expect 10)",  DUT.RF.regs[1]);
        $display("r2  = %0d (expect 20)",  DUT.RF.regs[2]);
        $display("r3  = %0d (expect 30)",  DUT.RF.regs[3]);
        $display("r4  = %0d (expect 20)",  DUT.RF.regs[4]);
        $display("r5  = %0d (expect 20)",  DUT.RF.regs[5]);
        $display("r6  = %0d (expect 30)",  DUT.RF.regs[6]);
        $display("r7  = %0d (expect 0, branch skipped)",  DUT.RF.regs[7]);
        $display("r8  = %0d (expect 0, branch skipped)",  DUT.RF.regs[8]);
        $display("r9  = %0d (expect 7)",   DUT.RF.regs[9]);
        $display("r10 = %0d (expect 2)",   DUT.RF.regs[10]);
        $display("r11 = %0d (expect 15)",  DUT.RF.regs[11]);
        $display("r12 = %0d (expect 1)",   DUT.RF.regs[12]);
        $display("mem[0] = %0d (expect 20)", DUT.DMEM.mem[0]);
        $finish;
    end

    // Cycle-by-cycle trace
    integer cycle;
    initial cycle = 0;
    always @(posedge clk) begin
        if (!rst) begin
            cycle = cycle + 1;
            $display("Cycle %0d | PC=%0d IF=%08h | ID/EX rd1=%0d rd2=%0d alu_res=%0d | hazard_stall=%b branch_taken=%b",
                cycle,
                DUT.pc_current,
                DUT.instr_if,
                DUT.idex_rd1,
                DUT.idex_rd2,
                DUT.ex_alu_result,
                DUT.hazard_stall,
                DUT.branch_taken);
        end
    end

endmodule
