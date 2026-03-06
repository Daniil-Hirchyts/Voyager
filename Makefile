.PHONY: up down logs logs-worker migrate test test-integration fmt lint smoke-phase1 smoke-phase2 smoke-phase2-llm smoke-phase3 smoke-phase4 smoke-phase4-live smoke-phase5 smoke-phase6

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=200 api

logs-worker:
	docker compose logs -f --tail=200 worker

migrate:
	docker compose exec api uv run alembic -c alembic.ini upgrade head

test:
	cd api && uv run pytest

test-integration:
	cd api && API_BASE=http://localhost:8000 KEYCLOAK_BASE=http://localhost:8080 uv run pytest app/tests/integration -m "phase1 or phase2 or phase3 or phase4 or phase5 or phase6" -vv

smoke-phase1:
	./scripts/smoke_phase1.sh

smoke-phase2:
	./scripts/smoke_phase2.sh

smoke-phase2-llm:
	./scripts/smoke_phase2_llm.sh

smoke-phase3:
	./scripts/smoke_phase3.sh

smoke-phase4:
	./scripts/smoke_phase4.sh

smoke-phase4-live:
	./scripts/smoke_phase4_live.sh

smoke-phase5:
	./scripts/smoke_phase5.sh

smoke-phase6:
	./scripts/smoke_phase6.sh

fmt:
	cd api && uv run ruff format app

lint:
	cd api && uv run ruff check app
