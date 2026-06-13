#!/bin/sh
set -e
export NODE_ENV=production

# Apply migrations, retrying while the database is still coming up (swarm
# ignores depends_on, so the app may start before Postgres is ready). Reads
# DATABASE_URL from the container env.
n=0
until npx kysely migrate:latest; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "migrations failed after $n attempts — giving up" >&2
    exit 1
  fi
  echo "database not ready (attempt $n) — retrying in 2s…" >&2
  sleep 2
done

# Serve (nitro listens on $PORT, default 3000).
node .output/server/index.mjs
