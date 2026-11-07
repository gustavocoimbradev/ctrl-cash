#!/usr/bin/env bash
# Runs the API tests against a throwaway PostgreSQL (Docker) and removes it afterwards.
set -uo pipefail
cd "$(dirname "$0")/.."

NAME="ctrlcash-test-pg-$$"
PORT="${TEST_PG_PORT:-55433}"
docker run -d --rm --name "$NAME" -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=ctrlcash_test -p "127.0.0.1:$PORT:5432" postgres:16 >/dev/null || exit 1
trap 'docker stop "$NAME" >/dev/null 2>&1' EXIT

for _ in $(seq 1 40); do
    docker exec "$NAME" pg_isready -U postgres -d ctrlcash_test >/dev/null 2>&1 && break
    sleep 1
done

cd backend
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null
DATABASE_URL="postgres://postgres:pg@127.0.0.1:$PORT/ctrlcash_test" FIREBASE_PROJECT_ID=test-project npm test
