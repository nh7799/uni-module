#!/usr/bin/env bash
# Runs the migrations + RLS/integrity tests on a throwaway PostgreSQL database.
# Usage: PGHOST=/tmp/pgt PGPORT=54399 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=mc_test_$$
createdb "$DB"; trap 'dropdb --if-exists "$DB"' EXIT
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }
run supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do run "$f"; done
psql -X -q -t -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/10_rls.test.sql
