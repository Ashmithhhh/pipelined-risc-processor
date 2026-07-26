// ============================================================
// pipeline_cpu.v - Top-Level 5-Stage Pipelined RISC CPU
//   Stages: IF -> ID -> EX -> MEM -> WB
//   Hazards: forwarding (EX/MEM, MEM/WB -> EX), load-use stall,
//            branch resolved in EX (with flush of 2 instrs)
// ============================================================
`include "defines.v"

module pipeline_cpu (
    input wire clk,
    input wire rst
);

    // ========================================================
    // IF STAGE
    // ========================================================
    wire [31:0] pc_current, pc_next, pc_plus4;
    wire        pc_write;          // hazard stall control
    wire [31:0] instr_if;

    pc_reg PC (
        .clk(clk), .rst(rst),
        .pc_write(pc_write),
        .pc_in(pc_next),
        .pc_out(pc_current)
    );

    assign pc_plus4 = pc_current + 32'd4;

    instr_mem IMEM (
        .addr(pc_current),
        .instr(instr_if)
    );

    // Branch/Jump resolution wires (from EX/MEM stage region)
    wire        branch_taken;
    wire [31:0] branch_target_addr;
    wire        jump_taken;
    wire [31:0] jump_target_addr;

    // PC source selection is oldest-first.  A taken branch in EX must beat
    // a younger, wrong-path jump currently being decoded in ID.
    assign pc_next = branch_taken ? branch_target_addr :
                     jump_taken   ? jump_target_addr   :
                     pc_plus4;

    // ========================================================
    // IF/ID PIPELINE REGISTER
    // ========================================================
    wire        if_id_write;       // hazard stall: hold IF/ID
    wire        if_id_flush;       // branch/jump flush
    wire [31:0] if_id_pc, if_id_instr;

    assign if_id_flush = branch_taken | jump_taken;
    assign if_id_write = pc_write; // same condition: stall holds both PC and IF/ID

    if_id_reg IF_ID (
        .clk(clk), .rst(rst),
        .flush(if_id_flush),
        .write_en(if_id_write),
        .pc_in(pc_plus4),
        .instr_in(instr_if),
        .pc_out(if_id_pc),
        .instr_out(if_id_instr)
    );

    // ========================================================
    // ID STAGE
    // ========================================================
    wire [5:0] id_opcode  = if_id_instr[31:26];
    wire [4:0] id_rs      = if_id_instr[25:21];
    wire [4:0] id_rt      = if_id_instr[20:16];
    wire [4:0] id_rd      = if_id_instr[15:11];
    wire [15:0] id_imm    = if_id_instr[15:0];
    wire [5:0] id_funct   = if_id_instr[5:0];
    wire [25:0] id_jaddr  = if_id_instr[25:0];

    wire [31:0] id_sign_ext = {{16{id_imm[15]}}, id_imm};

    // Control signals
    wire id_reg_dst, id_branch, id_mem_read, id_mem_to_reg,
         id_mem_write, id_alu_src, id_reg_write, id_jump;
    wire [1:0] id_alu_op;

    control_unit CTRL (
        .opcode(id_opcode),
        .reg_dst(id_reg_dst),
        .branch(id_branch),
        .mem_read(id_mem_read),
        .mem_to_reg(id_mem_to_reg),
        .alu_op(id_alu_op),
        .mem_write(id_mem_write),
        .alu_src(id_alu_src),
        .reg_write(id_reg_write),
        .jump(id_jump)
    );

    // Register file
    wire [31:0] id_rd1, id_rd2;
    wire        wb_reg_write;
    wire [4:0]  wb_write_reg;
    wire [31:0] wb_write_data;

    reg_file RF (
        .clk(clk), .rst(rst),
        .we(wb_reg_write),
        .ra1(id_rs),
        .ra2(id_rt),
        .wa(wb_write_reg),
        .wd(wb_write_data),
        .rd1(id_rd1),
        .rd2(id_rd2)
    );

    // Jump target (uses PC+4 from IF/ID stage, upper bits + shifted imm)
    assign jump_target_addr = {if_id_pc[31:28], id_jaddr, 2'b00};

    // ========================================================
    // HAZARD DETECTION UNIT (ID stage, looks at ID/EX)
    // ========================================================
    wire [4:0] idex_rt;       // ID/EX.rt (destination if load)
    wire       idex_mem_read; // ID/EX.MemRead
    wire       hazard_stall;

    // Qualify rs/rt comparisons with the operands actually read by the ID
    // instruction.  In ADDI/LW, rt is a destination; J has no register input.
    wire id_uses_rs = (id_opcode == `OP_RTYPE) ||
                      (id_opcode == `OP_ADDI)  ||
                      (id_opcode == `OP_LW)    ||
                      (id_opcode == `OP_SW)    ||
                      (id_opcode == `OP_BEQ);
    wire id_uses_rt = (id_opcode == `OP_RTYPE) ||
                      (id_opcode == `OP_SW)    ||
                      (id_opcode == `OP_BEQ);

    hazard_unit HAZ (
        .id_rs(id_rs),
        .id_rt(id_rt),
        .id_uses_rs(id_uses_rs),
        .id_uses_rt(id_uses_rt),
        .ex_rt(idex_rt),
        .ex_mem_read(idex_mem_read),
        .stall(hazard_stall)
    );

    assign pc_write = ~hazard_stall; // freeze PC and IF/ID on stall

    // ========================================================
    // ID/EX PIPELINE REGISTER
    // ========================================================
    wire id_ex_flush = hazard_stall | branch_taken | jump_taken;

    wire        idex_reg_dst, idex_branch, idex_mem_to_reg,
                idex_mem_write, idex_alu_src, idex_reg_write;
    wire [1:0]  idex_alu_op;
    wire [31:0] idex_pc_plus4, idex_rd1, idex_rd2, idex_sign_ext;
    wire [4:0]  idex_rs, idex_rd;
    wire [5:0]  idex_funct;

    id_ex_reg ID_EX (
        .clk(clk), .rst(rst),
        .flush(id_ex_flush),

        .reg_dst_in(id_reg_dst), .branch_in(id_branch),
        .mem_read_in(id_mem_read), .mem_to_reg_in(id_mem_to_reg),
        .alu_op_in(id_alu_op), .mem_write_in(id_mem_write),
        .alu_src_in(id_alu_src), .reg_write_in(id_reg_write),

        .pc_plus4_in(if_id_pc), .rd1_in(id_rd1), .rd2_in(id_rd2),
        .sign_ext_in(id_sign_ext), .rs_in(id_rs), .rt_in(id_rt),
        .rd_in(id_rd), .funct_in(id_funct),

        .reg_dst_out(idex_reg_dst), .branch_out(idex_branch),
        .mem_read_out(idex_mem_read), .mem_to_reg_out(idex_mem_to_reg),
        .alu_op_out(idex_alu_op), .mem_write_out(idex_mem_write),
        .alu_src_out(idex_alu_src), .reg_write_out(idex_reg_write),

        .pc_plus4_out(idex_pc_plus4), .rd1_out(idex_rd1), .rd2_out(idex_rd2),
        .sign_ext_out(idex_sign_ext), .rs_out(idex_rs), .rt_out(idex_rt),
        .rd_out(idex_rd), .funct_out(idex_funct)
    );

    // ========================================================
    // EX STAGE
    // ========================================================
    // Destination register select (rd for R-type, rt for I-type)
    wire [4:0] idex_write_reg = idex_reg_dst ? idex_rd : idex_rt;

    // Forwarding unit
    wire [1:0] fwd_a, fwd_b;
    wire [4:0] exmem_write_reg, memwb_write_reg;
    wire       exmem_reg_write, memwb_reg_write;

    forwarding_unit FWD (
        .id_ex_rs(idex_rs), .id_ex_rt(idex_rt),
        .ex_mem_rd(exmem_write_reg), .ex_mem_reg_write(exmem_reg_write),
        .mem_wb_rd(memwb_write_reg), .mem_wb_reg_write(memwb_reg_write),
        .forward_a(fwd_a), .forward_b(fwd_b)
    );

    // Forwarding mux sources (results coming from later stages)
    wire [31:0] exmem_alu_result_fwd; // EX/MEM.ALUResult
    wire [31:0] wb_result_fwd;        // MEM/WB result (data to write back)

    wire [31:0] alu_in_a = (fwd_a == 2'b01) ? exmem_alu_result_fwd :
                            (fwd_a == 2'b10) ? wb_result_fwd        :
                            idex_rd1;

    wire [31:0] fwd_rd2  = (fwd_b == 2'b01) ? exmem_alu_result_fwd :
                            (fwd_b == 2'b10) ? wb_result_fwd        :
                            idex_rd2;

    // ALU second operand: immediate or forwarded register value
    wire [31:0] alu_in_b = idex_alu_src ? idex_sign_ext : fwd_rd2;

    // ALU control
    wire [2:0] ex_alu_ctrl;
    alu_control ALUCTRL (
        .alu_op(idex_alu_op),
        .funct(idex_funct),
        .alu_ctrl(ex_alu_ctrl)
    );

    wire [31:0] ex_alu_result;
    wire        ex_zero;

    alu ALU (
        .a(alu_in_a),
        .b(alu_in_b),
        .alu_ctrl(ex_alu_ctrl),
        .result(ex_alu_result),
        .zero(ex_zero)
    );

    // Branch target address (computed in EX, resolved here)
    wire [31:0] ex_branch_target = idex_pc_plus4 + (idex_sign_ext << 2);

    // Branch resolution: taken if Branch control & ALU zero (BEQ)
    assign branch_taken = idex_branch & ex_zero;
    assign branch_target_addr = ex_branch_target;
    // Suppress a younger wrong-path jump when an older branch is taken.
    assign jump_taken = id_jump & ~branch_taken; // jump resolved in ID

    // ========================================================
    // EX/MEM PIPELINE REGISTER
    // ========================================================
    wire        exmem_branch, exmem_mem_read, exmem_mem_to_reg,
                exmem_mem_write, exmem_zero;
    wire [31:0] exmem_branch_target, exmem_alu_result, exmem_write_data;

    ex_mem_reg EX_MEM (
        .clk(clk), .rst(rst),

        .branch_in(idex_branch), .mem_read_in(idex_mem_read),
        .mem_to_reg_in(idex_mem_to_reg), .mem_write_in(idex_mem_write),
        .reg_write_in(idex_reg_write), .zero_in(ex_zero),

        .branch_target_in(ex_branch_target), .alu_result_in(ex_alu_result),
        .write_data_in(fwd_rd2), .write_reg_in(idex_write_reg),

        .branch_out(exmem_branch), .mem_read_out(exmem_mem_read),
        .mem_to_reg_out(exmem_mem_to_reg), .mem_write_out(exmem_mem_write),
        .reg_write_out(exmem_reg_write), .zero_out(exmem_zero),

        .branch_target_out(exmem_branch_target), .alu_result_out(exmem_alu_result),
        .write_data_out(exmem_write_data), .write_reg_out(exmem_write_reg)
    );

    assign exmem_alu_result_fwd = exmem_alu_result;

    // ========================================================
    // MEM STAGE
    // ========================================================
    wire [31:0] mem_read_data;

    data_mem DMEM (
        .clk(clk),
        .mem_write(exmem_mem_write),
        .mem_read(exmem_mem_read),
        .addr(exmem_alu_result),
        .write_data(exmem_write_data),
        .read_data(mem_read_data)
    );

    // ========================================================
    // MEM/WB PIPELINE REGISTER
    // ========================================================
    wire [31:0] memwb_read_data, memwb_alu_result;
    wire        memwb_mem_to_reg;

    mem_wb_reg MEM_WB (
        .clk(clk), .rst(rst),

        .mem_to_reg_in(exmem_mem_to_reg), .reg_write_in(exmem_reg_write),
        .read_data_in(mem_read_data), .alu_result_in(exmem_alu_result),
        .write_reg_in(exmem_write_reg),

        .mem_to_reg_out(memwb_mem_to_reg), .reg_write_out(memwb_reg_write),
        .read_data_out(memwb_read_data), .alu_result_out(memwb_alu_result),
        .write_reg_out(memwb_write_reg)
    );

    // ========================================================
    // WB STAGE
    // ========================================================
    assign wb_write_data = memwb_mem_to_reg ? memwb_read_data : memwb_alu_result;
    assign wb_reg_write  = memwb_reg_write;
    assign wb_write_reg  = memwb_write_reg;
    assign wb_result_fwd = wb_write_data; // forwarded to EX stage (MEM/WB -> EX)

endmodule
