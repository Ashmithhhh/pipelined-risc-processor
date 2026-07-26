// ============================================================
// tb_regression.v - Directed RTL regression tests for hazards/control
// Compile with SystemVerilog enabled (-g2012).
// ============================================================
`timescale 1ns/1ps

module tb_regression;
    reg clk;
    reg rst;
    integer i;
    integer errors;
    integer stalls;

    pipeline_cpu DUT (
        .clk(clk),
        .rst(rst)
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    task clear_machine;
        begin
            rst = 1'b1;
            @(posedge clk);
            #1;
            for (i = 0; i < 256; i = i + 1) begin
                DUT.IMEM.mem[i] = 32'b0;
                DUT.DMEM.mem[i] = 32'b0;
            end
            stalls = 0;
        end
    endtask

    task run_cycles;
        input integer count;
        integer cycle_index;
        begin
            @(negedge clk);
            rst = 1'b0;
            for (cycle_index = 0; cycle_index < count; cycle_index = cycle_index + 1) begin
                @(posedge clk);
                #1;
                if (DUT.hazard_stall)
                    stalls = stalls + 1;
            end
        end
    endtask

    task expect_reg;
        input integer index;
        input [31:0] expected;
        begin
            if (DUT.RF.regs[index] !== expected) begin
                $display("FAIL: r%0d = %08h, expected %08h", index,
                         DUT.RF.regs[index], expected);
                errors = errors + 1;
            end
        end
    endtask

    task expect_stalls;
        input integer expected;
        begin
            if (stalls !== expected) begin
                $display("FAIL: stalls = %0d, expected %0d", stalls, expected);
                errors = errors + 1;
            end
        end
    endtask

    initial begin
        rst = 1'b1;
        errors = 0;

        // ADDI reads rs but writes rt. A load to the same rt must not cause
        // the old, over-conservative hazard detector to insert a false stall.
        $display("TEST: no false load -> ADDI destination stall");
        clear_machine;
        DUT.IMEM.mem[0] = 32'h8c020000; // lw   r2, 0(r0)
        DUT.IMEM.mem[1] = 32'h20020009; // addi r2, r0, 9
        DUT.IMEM.mem[2] = 32'h20030001; // addi r3, r0, 1
        run_cycles(14);
        expect_reg(2, 32'd9);
        expect_reg(3, 32'd1);
        expect_stalls(0);

        // A true load-use dependency must still insert exactly one bubble.
        $display("TEST: true load-use dependency");
        clear_machine;
        DUT.DMEM.mem[0] = 32'd13;
        DUT.IMEM.mem[0] = 32'h8c020000; // lw  r2, 0(r0)
        DUT.IMEM.mem[1] = 32'h00421820; // add r3, r2, r2
        run_cycles(14);
        expect_reg(2, 32'd13);
        expect_reg(3, 32'd26);
        expect_stalls(1);

        // When BEQ is in EX while a wrong-path J is in ID, the older branch
        // redirect wins. The old jump-first PC mux incorrectly reached r2=42.
        $display("TEST: taken branch has priority over younger jump");
        clear_machine;
        DUT.IMEM.mem[0] = 32'h20010001; // addi r1, r0, 1
        DUT.IMEM.mem[1] = 32'h10210002; // beq  r1, r1, branch_target
        DUT.IMEM.mem[2] = 32'h08000006; // j    wrong_target (must be flushed)
        DUT.IMEM.mem[3] = 32'h20020063; // addi r2, r0, 99 (flushed)
        DUT.IMEM.mem[4] = 32'h20020007; // branch_target: addi r2, r0, 7
        DUT.IMEM.mem[5] = 32'h08000007; // j done
        DUT.IMEM.mem[6] = 32'h2002002a; // wrong_target: addi r2, r0, 42
        DUT.IMEM.mem[7] = 32'h20030005; // done: addi r3, r0, 5
        run_cycles(24);
        expect_reg(2, 32'd7);
        expect_reg(3, 32'd5);
        expect_stalls(0);

        // The forwarded rt value is also the data captured for SW.
        $display("TEST: store-data forwarding");
        clear_machine;
        DUT.IMEM.mem[0] = 32'h20010015; // addi r1, r0, 21
        DUT.IMEM.mem[1] = 32'hac010000; // sw   r1, 0(r0)
        DUT.IMEM.mem[2] = 32'h8c020000; // lw   r2, 0(r0)
        run_cycles(16);
        expect_reg(2, 32'd21);
        if (DUT.DMEM.mem[0] !== 32'd21) begin
            $display("FAIL: mem[0] = %08h, expected 00000015", DUT.DMEM.mem[0]);
            errors = errors + 1;
        end
        expect_stalls(0);

        if (errors == 0) begin
            $display("PASS: all directed RTL regression tests matched.");
            $finish;
        end else begin
            $fatal(1, "FAIL: %0d directed RTL regression check(s) failed", errors);
        end
    end
endmodule
