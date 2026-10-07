PYTHON ?= python3

.PHONY: specs specs-check
specs:
	$(PYTHON) scripts/export_specs.py
specs-check:
	$(PYTHON) scripts/export_specs.py --check
