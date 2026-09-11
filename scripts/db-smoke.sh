#!/usr/bin/env bash
# Applies all migrations to $DATABASE_URL (a scratch Postgres) and runs the smoke test.
# Migrations that need Supabase-only schemas (storage.*) are skipped on vanilla Postgres.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to a scratch Postgres}"
SKIP="${SKIP_MIGRATIONS:-0002_storage.sql}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;"
for f in supabase/migrations/*.sql; do
  base=$(basename "$f")
  if [[ " $SKIP " == *" $base "* ]]; then echo "skipping $base (needs Supabase storage schema)"; continue; fi
  echo "applying $base"
  if ! out=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "$out"; echo "FAILED: $base"; exit 1
  fi
  echo "$out" | grep -v 'NOTICE' || true
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f scripts/db-smoke.sql
