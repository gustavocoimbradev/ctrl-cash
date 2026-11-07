#!/usr/bin/env bash
# Starts Ctrl+Cash in production (used by `make up:prod`): the first time it asks for the address and creates
# .env.prod, then it builds and starts everything in the background (Docker brings it back after a restart of the
# server). Safe to run again to update.
#   scripts/prod.sh             set up if needed, then build and start
#   scripts/prod.sh --setup     ask for the address again, then build and start
#   scripts/prod.sh --no-start  only set up (create .env.prod and ask for the address)
#   ADDRESS=ctrlcash.gustavocoimbra.com scripts/prod.sh    no questions: for scripts and automation
set -uo pipefail

cd "$(dirname "$0")/.."

ASK_AGAIN=0
START=1
for argument in "$@"; do
    [ "$argument" = "--setup" ] && ASK_AGAIN=1
    [ "$argument" = "--no-start" ] && START=0
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; N=$'\033[0m'
else
    G=""; R=""; Y=""; D=""; B=""; N=""
fi

ok()   { printf '%s✔%s %s\n' "$G" "$N" "$1"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$1"; }
fail() {
    printf '%s✖%s %s%s%s\n' "$R" "$N" "$B" "$1" "$N"
    shift
    for line in "$@"; do printf '  %s%s%s\n' "$D" "$line" "$N"; done
    exit 1
}

printf '\n%sCtrl+Cash%s\n\n' "$B" "$N"

ENV_FILE=".env.prod"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml)

# ------------------------------------------------------------ prerequisites
if [ "$START" = 1 ]; then
    command -v docker >/dev/null 2>&1 || fail "Docker is not installed." "Install it from https://docs.docker.com/engine/install/ and run make up:prod again."
    docker info >/dev/null 2>&1 || fail "Docker is installed but not running." "Start it (for example: sudo systemctl start docker) and run make up:prod again."
    docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 was not found." "Update Docker, or install the compose plugin, and run make up:prod again."
fi

# ------------------------------------------------------------ the settings file (created once)
if [ ! -f "$ENV_FILE" ]; then
    cp .env.prod.example "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "Created $ENV_FILE."
    ASK_AGAIN=1
fi

# The database password is generated once, whenever it is empty. Never replaced when it already has a value: a new
# one would not open the existing database. | is safe as the sed separator: the value cannot contain it.
random() { openssl rand -base64 "$1" | tr -d '\n=+/' | cut -c1-"$2"; }
if ! grep -Eq '^POSTGRES_PASSWORD=.+' "$ENV_FILE"; then
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(random 48 32)|" "$ENV_FILE"
    ok "Generated the database password."
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# A tunnel token means the server sits behind a Cloudflare Tunnel: the tunnel brings https, so Caddy listens on plain
# http and the ports stay on this machine only.
TUNNEL=0
if [ -n "${TUNNEL_TOKEN:-}" ]; then
    TUNNEL=1
    export COMPOSE_PROFILES=tunnel SITE_ADDRESS=":80" BIND_ADDRESS="127.0.0.1" HTTP_PORT="18180" HTTPS_PORT="18443"
fi

# ------------------------------------------------------------ the address
# What people type becomes a full address: a domain gets https (the certificate is automatic); an IP address,
# localhost or a name without dots can only use plain http, because nobody issues a certificate for them.
# Prints the address, or nothing (and a reason on stderr) when it cannot be used.
normalize_address() {
    local text scheme="" host
    text="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

    case "$text" in
        https://*) scheme="https"; text="${text#https://}" ;;
        http://*) scheme="http"; text="${text#http://}" ;;
    esac

    host="${text%%/*}"
    [ -n "$host" ] || { echo "Type an address." >&2; return 1; }

    case "$host" in
        *:*) echo "Leave the port out: the server uses 80 and 443." >&2; return 1 ;;
    esac

    if printf '%s' "$host" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
        for octet in ${host//./ }; do
            [ "$octet" -le 255 ] || { echo "An IP address has numbers up to 255." >&2; return 1; }
        done
        [ -n "$scheme" ] || scheme="http"
    elif [ "$host" = "localhost" ] || printf '%s' "$host" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'; then
        [ -n "$scheme" ] || scheme="http"
    elif printf '%s' "$host" | grep -Eq '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'; then
        [ -n "$scheme" ] || scheme="https"
    else
        echo "That does not look like a domain or an IP address." >&2
        return 1
    fi

    printf '%s://%s' "$scheme" "$host"
}

current_is_usable() {
    [ -n "${PUBLIC_URL:-}" ] && normalize_address "$PUBLIC_URL" >/dev/null 2>&1
}

chosen=""

if [ -n "${ADDRESS:-}" ]; then
    # No questions (scripts, automation).
    chosen="$(normalize_address "$ADDRESS")" || fail "ADDRESS is not usable: $ADDRESS" "Use a domain (ctrlcash.gustavocoimbra.com) or an IP address (203.0.113.5)."
elif [ "$ASK_AGAIN" = 1 ] || ! current_is_usable; then
    [ -t 0 ] || fail "I need to know the address, and there is no one to ask." \
        "Run it like this: ADDRESS=ctrlcash.gustavocoimbra.com make up:prod" \
        "or set PUBLIC_URL in $ENV_FILE."

    guess="$(hostname -I 2>/dev/null | awk '{print $1}')"

    printf '%sWhat address will people use to open it?%s\n' "$B" "$N"
    printf '  %sA domain (ctrlcash.gustavocoimbra.com) gets https by itself, as long as it points at this server.%s\n' "$D" "$N"
    printf '  %sAn IP address (%s) or localhost works too, over plain http.%s\n\n' "$D" "${guess:-203.0.113.5}" "$N"

    attempts=0
    while [ -z "$chosen" ]; do
        attempts=$((attempts + 1))
        [ "$attempts" -le 5 ] || fail "That is not working out." "Run make up:prod again when you know the address."
        default=""
        current_is_usable && default="$PUBLIC_URL"
        if [ -n "$default" ]; then
            read -r -p "  Address [$default]: " answer || fail "No answer."
            answer="${answer:-$default}"
        else
            read -r -p "  Address: " answer || fail "No answer."
        fi
        chosen="$(normalize_address "$answer")" || chosen=""
    done
fi

if [ -n "$chosen" ]; then
    PUBLIC_URL="$chosen"
    export PUBLIC_URL
    if grep -Eq '^PUBLIC_URL=' "$ENV_FILE"; then
        sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$chosen|" "$ENV_FILE"
    else
        printf 'PUBLIC_URL=%s\n' "$chosen" >> "$ENV_FILE"
    fi
    ok "Address: $chosen"
fi

if [ "$TUNNEL" = 1 ]; then
    case "$PUBLIC_URL" in
        https://*) ok "Behind a Cloudflare Tunnel: ports stay on this machine." ;;
        *) warn "A tunnel needs the https address you gave it in PUBLIC_URL." ;;
    esac
fi

[ "$START" = 1 ] || { ok "Set up. Run make up:prod to build and start."; exit 0; }

# ------------------------------------------------------------ build and start
printf '\nBuilding and starting (the first build takes a few minutes)...\n\n'
"${COMPOSE[@]}" up -d --build --remove-orphans || fail "Docker could not start it." "Look at the lines above, or run make logs:prod."

# wait for the health check (web only turns healthy after the API and the database are)
for _ in $(seq 1 45); do
    status="$("${COMPOSE[@]}" ps --format '{{.Health}}' web 2>/dev/null | head -n1)"
    [ "$status" = "healthy" ] && break
    sleep 2
done
[ "${status:-}" = "healthy" ] || fail "It did not become healthy." "Run make logs:prod to see why."

printf '\n'
ok "Ctrl+Cash is running: ${B}${PUBLIC_URL}${N}"
[ "$TUNNEL" = 1 ] || case "$PUBLIC_URL" in https://*) printf '  %sThe https certificate is issued the first time someone opens it (the domain must point at this server).%s\n' "$D" "$N" ;; esac
