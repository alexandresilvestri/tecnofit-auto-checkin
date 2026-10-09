.PHONY: up down logs seed lint typecheck test test-integration moto-up moto-down build e2e check

up:
	docker compose up -d
down:
	docker compose down
logs:
	docker compose logs -f api web
seed:
	docker compose exec api npm run connect
lint:
	npm run lint
typecheck:
	npm run typecheck
test:
	npm run test:unit
test-integration: moto-up
	npm run test:integration
moto-up:
	npm run moto:up
moto-down:
	docker compose -f tests/docker-compose.yml down
build:
	npm run build && npm run web:build
e2e:
	npm run web:build && npm run e2e
check: lint typecheck test
