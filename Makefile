# Every command has two versions: `:dev` (this machine, with a demo account) and `:prod` (the server).
#   make up:dev      make up:prod      start it (dev stays in the foreground, prod runs for good)
#   make down:dev    make down:prod    stop it (the data stays)
#   make logs:dev    make logs:prod    follow the logs
#   make status:dev  make status:prod  what is running
#   make urls:dev    make urls:prod    where to open it
#   make migrate:dev make migrate:prod run the database migrations
#   make reset:dev   make reset:prod   back to a fresh install (asks first; prod saves a backup before)
#   make backup:dev  make backup:prod  save the database to backups/
#   make start:dev   make start:prod   start it in the background, for scripts (prod always is)
#   make seed:dev    make setup:prod   demo data / ask for the address again
#   make import:dev  make import:prod  load a Firestore export (FILE=backups/....json), idempotent; DRY=1 only checks
#   make test:dev                      run the checks (types, then the API tests on a throwaway database)
#   make env:prod                      create .env.prod only (asks the address): add the tunnel token BEFORE the first start
#   make screenshots                   take the README screenshots (needs make start:dev running)
.PHONY: env\:prod up\:dev up\:prod start\:dev start\:prod down\:dev down\:prod urls\:dev urls\:prod logs\:dev logs\:prod \
	status\:dev status\:prod seed\:dev seed\:prod migrate\:dev migrate\:prod reset\:dev reset\:prod \
	backup\:dev backup\:prod import\:dev import\:prod setup\:prod test\:dev \
	up start down urls logs seed migrate reset status backup import test

PROD := docker compose --profile tunnel --env-file .env.prod -f docker-compose.prod.yml
DRY_FLAG := $(if $(DRY),--dry-run,)

# ---------------------------------------------------------------- start

# Development, in the foreground: Ctrl+C stops the web app and the emulator (the database stays).
up\:dev:
	@./scripts/dev.sh

# Production: builds and starts everything in the background and keeps it running (reads .env.prod).
up\:prod:
	@./scripts/prod.sh

# The same stack in the background (for scripts and automation); stop it with `make down:dev`.
start\:dev:
	@./scripts/dev.sh --background

start\:prod: up\:prod

# Creates .env.prod (and asks the address) WITHOUT starting anything: edit it (TUNNEL_TOKEN...), then make up:prod.
env\:prod:
	@./scripts/prod.sh --no-start

# Asks for the address again (a domain, or an IP address), then starts it.
setup\:prod:
	@./scripts/prod.sh --setup

# ---------------------------------------------------------------- stop, look

# Stops it; the data (database) stays.
down\:dev:
	@./scripts/dev.sh --stop

down\:prod:
	@$(PROD) down

status\:dev:
	@docker compose ps
	@for f in web auth; do [ -f .logs/$$f.pid ] && kill -0 $$(cat .logs/$$f.pid) 2>/dev/null && echo "$$f: running" || echo "$$f: stopped"; done

status\:prod:
	@$(PROD) ps

urls\:dev:
	@echo "  App       http://localhost:$$(cat .logs/web.port 2>/dev/null || echo 8081)"
	@echo "  API       http://localhost:3300/api"
	@echo "  Login     demo@ctrlcash.dev / demo1234"

urls\:prod:
	@set -a; . ./.env.prod; set +a; \
	echo "  App       $$PUBLIC_URL"; \
	echo "  API       $$PUBLIC_URL/api/health"

# Follows the logs of a running stack.
logs\:dev:
	@tail -n 100 -F .logs/web.log .logs/auth-emulator.log & docker compose logs -f --tail=50; kill %1 2>/dev/null; true

logs\:prod:
	@$(PROD) logs -f --tail=100

# ---------------------------------------------------------------- database

migrate\:dev:
	@docker compose exec api npm run migrate --silent

migrate\:prod:
	@$(PROD) exec api npm run migrate --silent

seed\:dev:
	@FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:19099 API_URL=http://localhost:3300/api npx --yes tsx scripts/dev/seed.ts

seed\:prod:
	@echo "Nothing to seed in production: the data of each account is created in the app (or imported: make import:prod)."

# Back to a fresh install (asks first). `make reset:dev YES=1` skips the question.
reset\:dev:
	@if [ "$(YES)" != "1" ]; then read -r -p "This erases the development database and the demo account. Continue? [y/N] " a; [ "$$a" = "y" ] || exit 1; fi
	@./scripts/dev.sh --stop
	@docker compose down -v
	@rm -rf .logs/auth-emulator
	@echo "Fresh. Run make up:dev."

# Production: saves a backup, then erases everything (asks first). `make reset:prod YES=1` skips the question.
reset\:prod:
	@YES=$(YES) ./scripts/reset-prod.sh

# Saves the database to backups/. Copy that folder somewhere safe.
backup\:dev:
	@mkdir -p backups
	@docker compose exec -T postgres pg_dump -U ctrlcash ctrlcash | gzip > backups/ctrlcash-dev-$$(date +%Y%m%d-%H%M%S).sql.gz
	@echo "Saved in backups/."

backup\:prod:
	@mkdir -p backups
	@$(PROD) exec -T postgres pg_dump -U ctrlcash ctrlcash | gzip > backups/ctrlcash-$$(date +%Y%m%d-%H%M%S).sql.gz
	@echo "Saved in backups/. Sign-in accounts live in Firebase, not in this dump."

# Loads a Firestore export (npm run firebase:export) into the database. Safe to run again: it changes nothing twice.
import\:dev:
	@test -n "$(FILE)" || { echo "Say which file: make import:dev FILE=backups/firestore-export-....json"; exit 1; }
	@docker compose cp "$(FILE)" api:/tmp/import.json
	@docker compose exec -u root api chmod 644 /tmp/import.json
	@docker compose exec api npm run import --silent -- /tmp/import.json $(DRY_FLAG)
	@docker compose exec -u root api rm -f /tmp/import.json

import\:prod:
	@test -n "$(FILE)" || { echo "Say which file: make import:prod FILE=backups/firestore-export-....json"; exit 1; }
	@$(PROD) cp "$(FILE)" api:/tmp/import.json
	@$(PROD) exec -u root api chmod 644 /tmp/import.json
	@$(PROD) exec api npm run import --silent -- /tmp/import.json $(DRY_FLAG)
	@$(PROD) exec -u root api rm -f /tmp/import.json

# ---------------------------------------------------------------- tests

test\:dev:
	@npx tsc --noEmit
	@./scripts/test-api.sh

# Without :dev or :prod it is not clear what is meant.
up start down urls logs seed migrate reset status backup import:
	@echo "Say which one: make $@:dev or make $@:prod"; exit 1

test:
	@echo "Use make test:dev"; exit 1

# ---------------------------------------------------------------- screenshots

# Takes the README screenshots of the running development stack (make start:dev first), in a throwaway Chromium container.
.PHONY: screenshots
screenshots:
	@P=$$(cat .logs/web.port 2>/dev/null || echo 8081); \
	docker run --rm --network host --add-host=host.docker.internal:host-gateway \
		-e BASE_URL="http://localhost:$$P" -e FORWARD_PORTS="$$P,19099" -v "$$PWD":/work -w /work \
		mcr.microsoft.com/playwright:v1.49.0-noble bash -c \
		"mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i playwright@1.49.0 >/dev/null 2>&1 && cd /work && node scripts/dev/screenshots.mjs"

# The picture shown when the link is shared (public/og-image.png), from scripts/og-image.html and the dashboard screenshot.
.PHONY: og-image
og-image:
	@docker run --rm -v "$$PWD":/work -w /work mcr.microsoft.com/playwright:v1.49.0-noble bash -c \
		"mkdir -p /tmp/pw && cd /tmp/pw && npm init -y >/dev/null && npm i playwright@1.49.0 >/dev/null 2>&1 && cd /work && node scripts/og-image.mjs"
