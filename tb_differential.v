// ============================================================
// tb_differential.v - Machine-readable RTL trace for comparison
// against simulator/core.js. The trace combines pre-edge control
// signals with post-edge architectural state for every clock.
// ============================================================
`timescale 1ns/1ps

module tb_differential;
    reg clk;
    reg rst;
    integer trace_fd;
    integer max_cycles;
    integer cycle;
    integer i;
    reg [1023:0] trace_file;

    pipeline_cpu DUT (
        .clk(clk),
        .rst(rst)
    );

    initial clk = 1'b0;
    always #5 clk = ~clk;

    initial begin
        rst = 1'b1;
        max_cycles = 100;
        trace_file = "rtl-trace.csv";
        if (!$value$plusargs("CYCLES=%d", max_cycles))
            max_cycles = 100;
        if (!$value$plusargs("TRACE_FILE=%s", trace_file))
            trace_file = "rtl-trace.csv";

        trace_fd = $fopen(trace_file, "w");
        if (trace_fd == 0)
            $fatal(1, "Could not open differential trace file");

        $fwrite(trace_fd,
            "cycle,pc,if_instr,id_instr,stall,branch,jump,fwd_a,fwd_b,ex_result,mem_read,mem_write,mem_addr,mem_wdata,wb_write,wb_reg,wb_data,post_pc");
        for (i = 0; i < 32; i = i + 1)
            $fwrite(trace_fd, ",r%0d", i);
        for (i = 0; i < 256; i = i + 1)
            $fwrite(trace_fd, ",m%0d", i);
        $fwrite(trace_fd, "\n");

        // Reset covers the first positive edge at 5 ns. The first traced
        // active edge is at 15 ns, matching PipelineSimulator.step() cycle 1.
        #12;
        rst = 1'b0;

        for (cycle = 1; cycle <= max_cycles; cycle = cycle + 1) begin
            @(posedge clk);

            // Active-region values are the combinational/pre-edge signals
            // whose effects commit on this edge.
            $fwrite(trace_fd,
                "%0d,%08x,%08x,%08x,%0d,%0d,%0d,%0d,%0d,%08x,%0d,%0d,%08x,%08x,%0d,%0d,%08x",
                cycle,
                DUT.pc_current,
                DUT.instr_if,
                DUT.if_id_instr,
                DUT.hazard_stall,
                DUT.branch_taken,
                DUT.jump_taken,
                DUT.fwd_a,
                DUT.fwd_b,
                DUT.ex_alu_result,
                DUT.exmem_mem_read,
                DUT.exmem_mem_write,
                DUT.exmem_alu_result,
                DUT.exmem_write_data,
                DUT.wb_reg_write && (DUT.wb_write_reg != 5'b0),
                DUT.wb_write_reg,
                DUT.wb_write_data
            );

            // Wait for non-blocking assignments, then capture complete state.
            #1;
            $fwrite(trace_fd, ",%08x", DUT.pc_current);
            for (i = 0; i < 32; i = i + 1)
                $fwrite(trace_fd, ",%08x", DUT.RF.regs[i]);
            for (i = 0; i < 256; i = i + 1)
                $fwrite(trace_fd, ",%08x", DUT.DMEM.mem[i]);
            $fwrite(trace_fd, "\n");
        end

        $fclose(trace_fd);
        $display("DIFF_TRACE_COMPLETE cycles=%0d file=%0s", max_cycles, trace_file);
        $finish;
    end
endmodule
