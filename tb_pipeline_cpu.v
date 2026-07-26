// ============================================================
// tb_pipeline_cpu.v - Testbench
// ============================================================
`timescale 1ns/1ps
`include "defines.v"

module tb_pipeline_cpu;

    reg clk;
    reg rst;
    integer errors;

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
        errors = 0;
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

        // Alternate programs can request a trace-only run.  The default path
        // stays self-checking so CI receives a failure on RTL regressions.
        if ($test$plusargs("no-check")) begin
            $display("\nINFO: final checks skipped (+no-check).");
            $finish;
        end

        if (DUT.RF.regs[1]  !== 32'd10) errors = errors + 1;
        if (DUT.RF.regs[2]  !== 32'd20) errors = errors + 1;
        if (DUT.RF.regs[3]  !== 32'd30) errors = errors + 1;
        if (DUT.RF.regs[4]  !== 32'd20) errors = errors + 1;
        if (DUT.RF.regs[5]  !== 32'd20) errors = errors + 1;
        if (DUT.RF.regs[6]  !== 32'd30) errors = errors + 1;
        if (DUT.RF.regs[7]  !== 32'd0)  errors = errors + 1;
        if (DUT.RF.regs[8]  !== 32'd0)  errors = errors + 1;
        if (DUT.RF.regs[9]  !== 32'd7)  errors = errors + 1;
        if (DUT.RF.regs[10] !== 32'd2)  errors = errors + 1;
        if (DUT.RF.regs[11] !== 32'd15) errors = errors + 1;
        if (DUT.RF.regs[12] !== 32'd1)  errors = errors + 1;
        if (DUT.DMEM.mem[0] !== 32'd20) errors = errors + 1;

        if (errors == 0) begin
            $display("\nPASS: all architectural checks matched.");
            $finish;
        end else begin
            $fatal(1, "FAIL: %0d architectural check(s) did not match", errors);
        end
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
