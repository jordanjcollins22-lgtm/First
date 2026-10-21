#!/usr/bin/env bash
# Applies 0370 and 0371 to a throwaway Postgres, twice (they must be safe to
# re-run), runs the assertions, then applies the rollbacks. Needs initdb and
# postgres on PATH or under /usr/lib/postgresql/*/bin. Touches nothing else.
#
#   supabase/tests/event-backbone/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
bin="$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")"
data="$(mktemp -d)"
port=55432
# pg_ctl will not run as root, so as root everything runs as postgres.
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$data"
  as=(runuser -u postgres --)
else
  as=()
fi
cleanup() { "${as[@]}" "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT
"${as[@]}" "$bin/initdb" -D "$data" -U postgres -A trust >/dev/null
"${as[@]}" "$bin/pg_ctl" -D "$data" -o "-p $port -k /tmp" -l "$data/log" start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
psql=(psql -h /tmp -p "$port" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${psql[@]}" -f "$here/stub.sql"
for pass in 1 2; do
  "${psql[@]}" -f "$root/supabase/migrations/0370_event_backbone.sql"
  "${psql[@]}" -f "$root/supabase/migrations/0371_event_views.sql"
done
"${psql[@]}" -o /dev/null -f "$here/assertions.sql"
"${psql[@]}" -f "$root/supabase/rollback/0371_event_views_down.sql"
"${psql[@]}" -f "$root/supabase/rollback/0370_event_backbone_down.sql"
left=$("${psql[@]}" -At -c "select count(*) from pg_tables where schemaname = 'public' and tablename in ('domain_events','outbox_messages','automation_actions','workflow_tasks','automation_audit','automation_rules','automation_controls')")
[ "$left" = "0" ] || { echo "rollback left $left tables behind"; exit 1; }
echo "event backbone migrations: all checks passed"
