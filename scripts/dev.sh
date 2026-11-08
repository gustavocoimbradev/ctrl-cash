#!/usr/bin/env bash
# Development stack on this machine (used by `make up:dev` / `make start:dev`):
#   PostgreSQL + the API (Docker), the Firebase Auth emulator and the web app (Expo), with a demo account.
#   scripts/dev.sh              in the foreground: Ctrl+C stops the web app and the emulator (the database stays)
#   scripts/dev.sh --background start everything and return; stop it with make down:dev
#   scripts/dev.sh --stop       stop what --background started
#   PORT=8082 scripts/dev.sh    use another port for the web app
set -uo pipefail
cd "$(dirname "$0")/.."

MODE="foreground"
for argument in "$@"; do
    [ "$argument" = "--background" ] && MODE="background"
    [ "$argument" = "--stop" ] && MODE="stop"
done

# a closed port can hang for minutes on some setups (WSL), so every probe is capped at 1 second
port_open() { timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1; }

LOGS=".logs"
mkdir -p "$LOGS"
# the web port: the one asked for, or the first free one from 8081
if [ -z "${PORT:-}" ]; then
    PORT=8081
    while port_open "$PORT" && [ "$PORT" -lt 8095 ]; do PORT=$((PORT + 1)); done
fi
export WEB_PORT="$PORT"
AUTH_PORT=19099
API_PORT=3300

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    G=$'\033[32m'; R=$'\033[31m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
    G=""; R=""; D=""; B=""; N=""
fi
ok()   { printf '%s✔%s %s\n' "$G" "$N" "$1"; }
fail() { printf '%s✖%s %s%s%s\n' "$R" "$N" "$B" "$1" "$N"; shift; for l in "$@"; do printf '  %s%s%s\n' "$D" "$l" "$N"; done; exit 1; }

wait_port() { for _ in $(seq 1 "${3:-60}"); do port_open "$1" && return 0; sleep 1; done; fail "$2 did not start." "Look at $LOGS/."; }

stop_pid() {
    local f="$LOGS/$1.pid"
    [ -f "$f" ] || return 0
    local pid; pid="$(cat "$f")"
    # a graceful stop first (the Auth emulator saves its users on exit), then make sure
    kill -INT -- "-$pid" 2>/dev/null || kill -INT "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$pid" 2>/dev/null
    rm -f "$f"
}

if [ "$MODE" = "stop" ]; then
    stop_pid web
    stop_pid auth
    docker compose down >/dev/null 2>&1
    ok "Stopped (the database data stays in its Docker volume)."
    exit 0
fi

command -v docker >/dev/null 2>&1 || fail "Docker is not installed." "Install it from https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || fail "Docker is not running." "Start it (for example: sudo systemctl start docker)."
command -v node >/dev/null 2>&1 || fail "Node is not installed." "Install Node 20 or newer."
[ -d node_modules ] || { printf 'Installing the dependencies...\n'; npm install --no-audit --no-fund >"$LOGS/npm-install.log" 2>&1 || fail "npm install failed." "See $LOGS/npm-install.log"; }

# the project id the app signs in with (public web config): the Auth emulator and the API must use the same one
PROJECT_ID="$(sed -n "s/.*projectId: *'\([^']*\)'.*/\1/p" src/firebase/config.ts | head -n1)"
[ -n "$PROJECT_ID" ] || fail "Could not read the Firebase project id from src/firebase/config.ts."
export FIREBASE_PROJECT_ID="$PROJECT_ID"

# ---- 1. PostgreSQL and the API
printf 'Starting the database and the API...\n'
docker compose up -d --build --wait --remove-orphans >"$LOGS/docker.log" 2>&1 || fail "Docker could not start the database and the API." "See $LOGS/docker.log"
ok "Database and API are up (http://localhost:$API_PORT/api/health)"

# ---- 2. Firebase Auth emulator (keeps its users between runs, so the demo account keeps its id)
if port_open "$AUTH_PORT"; then
    ok "Auth emulator already running"
else
    IMPORT=()
    [ -d "$LOGS/auth-emulator" ] && IMPORT=(--import "$LOGS/auth-emulator")
    setsid nohup npx --yes firebase-tools@13 emulators:start --only auth --config firebase/firebase.json \
        --project "$PROJECT_ID" "${IMPORT[@]}" --export-on-exit "$LOGS/auth-emulator" >"$LOGS/auth-emulator.log" 2>&1 &
    echo $! >"$LOGS/auth.pid"
    wait_port "$AUTH_PORT" "The Auth emulator" 90
    ok "Auth emulator is up (port $AUTH_PORT)"
fi

# ---- 3. the demo account and its data
FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:$AUTH_PORT" API_URL="http://localhost:$API_PORT/api" \
    npx --yes tsx scripts/dev/seed.ts >"$LOGS/seed.log" 2>&1 || fail "Could not create the demo data." "See $LOGS/seed.log"
ok "$(tail -n1 "$LOGS/seed.log")"

# ---- 4. the web app
if port_open "$PORT"; then
    fail "Port $PORT is busy." "Use another one: PORT=8082 make up:dev"
fi
EXPO_PUBLIC_FIREBASE_EMULATOR=1 EXPO_PUBLIC_API_URL="http://localhost:$API_PORT/api" BROWSER=none \
    setsid nohup npx expo start --web --non-interactive --port "$PORT" >"$LOGS/web.log" 2>&1 &
echo $! >"$LOGS/web.pid"
echo "$PORT" >"$LOGS/web.port"
wait_port "$PORT" "The web app" 120
ok "Web app is up"

printf '\n  %sOpen%s      http://localhost:%s\n' "$B" "$N" "$PORT"
printf '  %sLogin%s     demo@ctrlcash.dev / demo1234  (a demo account, only on this machine)\n' "$B" "$N"
printf '  %sAPI%s       http://localhost:%s/api\n\n' "$B" "$N" "$API_PORT"

if [ "$MODE" = "background" ]; then
    printf '  %sRunning in the background: make logs:dev to follow it, make down:dev to stop it.%s\n\n' "$D" "$N"
    exit 0
fi

printf '  %sCtrl+C stops it.%s\n\n' "$D" "$N"
cleanup() { trap - INT TERM EXIT; printf '\nStopping...\n'; stop_pid web; stop_pid auth; docker compose stop >/dev/null 2>&1; exit 0; }
trap cleanup INT TERM EXIT
tail -n0 -F "$LOGS/web.log" 2>/dev/null &
wait "$(cat "$LOGS/web.pid")" 2>/dev/null || while kill -0 "$(cat "$LOGS/web.pid")" 2>/dev/null; do sleep 2; done
