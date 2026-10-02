GEMMA_MODEL ?= $(shell grep -s '^GEMMA_MODEL=' .env | cut -d= -f2)
GEMMA_MODEL := $(or $(GEMMA_MODEL),gemma4:e4b)

.PHONY: setup dev backend frontend test eval check

setup:
	test -f .env || cp .env.example .env
	cd backend && uv sync
	cd frontend && pnpm install
	ollama pull $(GEMMA_MODEL)

# Runs both apps on 127.0.0.1; Ctrl-C stops both.
dev:
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload) & \
	(cd frontend && pnpm dev) & \
	wait

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm test

eval:
	cd backend && uv run python -m eval.eval_drill_picker $(ARGS)

check:
	cd backend && uv run python -m eval.check_models
