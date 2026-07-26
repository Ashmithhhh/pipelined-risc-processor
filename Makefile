RTL_SOURCES := defines.v pc.v instr_mem.v reg_file.v alu.v alu_control.v \
	control_unit.v hazard_unit.v forwarding_unit.v data_mem.v if_id_reg.v \
	id_ex_reg.v ex_mem_reg.v mem_wb_reg.v pipeline_cpu.v

.PHONY: test test-js test-hdl test-hdl-main test-hdl-regression check-iverilog serve serve-static clean

test: test-js

test-js:
	node --test

test-hdl: test-hdl-main test-hdl-regression

test-hdl-main: check-iverilog
	iverilog -g2012 -Wall -s tb_pipeline_cpu -o sim-main.out $(RTL_SOURCES) tb_pipeline_cpu.v
	vvp sim-main.out $(VVP_ARGS)

test-hdl-regression: check-iverilog
	iverilog -g2012 -Wall -s tb_regression -o sim-regression.out $(RTL_SOURCES) tb_regression.v
	vvp sim-regression.out

check-iverilog:
	@command -v iverilog >/dev/null || { echo "error: iverilog is required for HDL tests" >&2; exit 1; }

serve:
	node server.js

serve-static:
	python3 -m http.server 8000

clean:
	rm -f sim.out sim-main.out sim-regression.out wave.vcd
