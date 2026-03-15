.PHONY: up down logs logs-worker migrate fmt lint reset-keycloak

up:
	docker compose up -d --build

down:
	docker compose down

reset-keycloak:
	./scripts/reset_keycloak.sh

logs:
	docker compose logs -f --tail=200 api

logs-worker:
	docker compose logs -f --tail=200 worker

migrate:
	docker compose exec api uv run alembic -c alembic.ini upgrade head

fmt:
	cd api && uv run ruff format app

lint:
	cd api && uv run ruff check app
