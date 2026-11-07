#!/usr/bin/env bash
# Production: back to an empty database (used by `make reset:prod`). Saves a backup to backups/ first and erases
# nothing if that fails, asks you to type the site's address (YES=1 skips the question), then recreates the database.
# Sign-in accounts live in Firebase, so people can still sign in; they just start with no data.
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env.prod ] || { echo "There is no .env.prod: nothing to reset."; exit 1; }
set -a; . ./.env.prod; set +a
PROD=(docker compose --profile tunnel --env-file .env.prod -f docker-compose.prod.yml)

mkdir -p backups
FILE="backups/ctrlcash-before-reset-$(date +%Y%m%d-%H%M%S).sql.gz"
if ! "${PROD[@]}" exec -T postgres pg_dump -U ctrlcash ctrlcash | gzip > "$FILE" || [ ! -s "$FILE" ]; then
    rm -f "$FILE"
    echo "The backup failed, so nothing was erased."; exit 1
fi
echo "Backup saved: $FILE"

if [ "${YES:-}" != "1" ]; then
    echo "This erases ALL the data of ALL accounts on this server."
    read -r -p "Type the address ($PUBLIC_URL) to confirm: " answer
    [ "$answer" = "$PUBLIC_URL" ] || { echo "Not confirmed. Nothing was erased."; exit 1; }
fi

"${PROD[@]}" down
docker volume rm ctrlcash-prod_pgdata >/dev/null && echo "Database erased."
./scripts/prod.sh
