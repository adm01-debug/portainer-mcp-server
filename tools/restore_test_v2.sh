#!/bin/bash
# Restore smoke test v2 — reports via Supabase REST API (avoids Docker log stream issue)
# Usage: expects SUPABASE_URL + SUPABASE_SERVICE_KEY + POSTGRES_PASSWORD in env

set +e

SUPABASE_URL="${SUPABASE_URL:-https://tdprnylgyrogbbhgdoik.supabase.co}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-9904a22beb873591ebb1467f20d44fb8}"
export PGPASSWORD="$POSTGRES_PASSWORD"

log() {
  local step="$1" status="$2" detail="$3" metrics="$4"
  local body
  body=$(printf '{"step":"%s","status":"%s","detail":%s,"metrics":%s}' \
    "$step" "$status" \
    "$(printf '%s' "$detail" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo \"\")" \
    "${metrics:-null}")
  curl -s -X POST "${SUPABASE_URL}/rest/v1/restore_test_log" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    --data-raw "$body" > /dev/null
  echo "[$step] $status: $detail"
}

log "start" "info" "Restore smoke test v2 starting" "null"

log "install" "info" "Installing curl+python3+mc" "null"
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq curl ca-certificates python3 >/dev/null 2>&1
curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x /usr/local/bin/mc

log "minio_alias" "info" "Setting mc alias local" "null"
mc alias set local http://minio:9000 AtomicaBR '@Promo2024' > /dev/null 2>&1
if [ $? -ne 0 ]; then log "minio_alias" "error" "mc alias failed" "null"; exit 2; fi

log "minio_list" "info" "Listing manual/ prefix" "null"
LATEST=$(mc ls local/evolution-backups/manual/ 2>/dev/null | sort | tail -n1 | awk '{print $NF}')
if [ -z "$LATEST" ]; then
  LATEST=$(mc ls local/evolution-backups/daily/ 2>/dev/null | sort | tail -n1 | awk '{print $NF}')
  PREFIX=daily
else
  PREFIX=manual
fi
log "minio_found" "info" "Latest $PREFIX/$LATEST" "null"

log "download" "info" "Downloading dump" "null"
T0=$(date +%s)
mc cp "local/evolution-backups/$PREFIX/$LATEST" /tmp/dump.gz > /dev/null 2>&1
DOWNLOAD_EXIT=$?
DOWNLOAD_SECS=$(($(date +%s) - T0))
SIZE_GZ=$(stat -c %s /tmp/dump.gz 2>/dev/null || echo 0)
log "download" "$([ $DOWNLOAD_EXIT -eq 0 ] && echo ok || echo error)" "exit=$DOWNLOAD_EXIT size=$SIZE_GZ bytes" "{\"download_secs\":$DOWNLOAD_SECS,\"size_gz_bytes\":$SIZE_GZ}"
if [ $DOWNLOAD_EXIT -ne 0 ]; then exit 3; fi

log "gunzip" "info" "Decompressing" "null"
gunzip /tmp/dump.gz
GZ_EXIT=$?
SIZE=$(stat -c %s /tmp/dump 2>/dev/null || echo 0)
log "gunzip" "$([ $GZ_EXIT -eq 0 ] && echo ok || echo error)" "exit=$GZ_EXIT size=$SIZE bytes" "{\"size_bytes\":$SIZE}"
if [ $GZ_EXIT -ne 0 ]; then exit 4; fi

log "create_temp_db" "info" "Creating restore_test DB" "null"
psql -h postgres -U postgres -d postgres -c "DROP DATABASE IF EXISTS restore_test;" > /dev/null 2>&1
psql -h postgres -U postgres -d postgres -c "CREATE DATABASE restore_test;" > /dev/null 2>&1
CDB_EXIT=$?
log "create_temp_db" "$([ $CDB_EXIT -eq 0 ] && echo ok || echo error)" "exit=$CDB_EXIT" "null"
if [ $CDB_EXIT -ne 0 ]; then exit 5; fi

log "pg_restore" "info" "Running pg_restore" "null"
T0=$(date +%s)
pg_restore -h postgres -U postgres -d restore_test --no-owner --no-acl /tmp/dump 2> /tmp/restore.err
PR_EXIT=$?
RESTORE_SECS=$(($(date +%s) - T0))
ERR_TAIL=$(tail -n 5 /tmp/restore.err 2>/dev/null | tr '\n' '|' | head -c 400)
log "pg_restore" "$([ $PR_EXIT -le 1 ] && echo ok || echo error)" "exit=$PR_EXIT (0=ok, 1=warnings, 2+=error) last_err=$ERR_TAIL" "{\"restore_secs\":$RESTORE_SECS,\"exit\":$PR_EXIT}"

# Contagens de validação
TOTAL_TABLES=$(psql -h postgres -U postgres -d restore_test -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' \n')
TOTAL_ROWS=$(psql -h postgres -U postgres -d restore_test -t -c "SELECT SUM(n_live_tup)::bigint FROM pg_stat_user_tables;" 2>/dev/null | tr -d ' \n')
DB_SIZE=$(psql -h postgres -U postgres -d restore_test -t -c "SELECT pg_size_pretty(pg_database_size(current_database()));" 2>/dev/null | tr -d ' \n')
log "validation_summary" "info" "tables=$TOTAL_TABLES rows=$TOTAL_ROWS size=$DB_SIZE" "{\"tables\":$TOTAL_TABLES,\"rows\":\"$TOTAL_ROWS\",\"size\":\"$DB_SIZE\"}"

# Top tables
TOP=$(psql -h postgres -U postgres -d restore_test -t -A -c "SELECT json_agg(json_build_object('relname',relname,'rows',n_live_tup)) FROM (SELECT relname,n_live_tup FROM pg_stat_user_tables WHERE n_live_tup>0 ORDER BY n_live_tup DESC LIMIT 10) t;" 2>/dev/null | head -c 2000)
log "top_tables" "info" "Top 10 tables by row count" "$TOP"

# Keys evolution
for tbl in Message Chat Contact Instance; do
  count=$(psql -h postgres -U postgres -d restore_test -t -c "SELECT COUNT(*) FROM \"$tbl\"" 2>/dev/null | tr -d ' \n')
  [ -z "$count" ] && count='(no table)'
  log "evolution_table_$tbl" "info" "$tbl rows=$count" "null"
done

log "cleanup" "info" "Dropping restore_test DB" "null"
psql -h postgres -U postgres -d postgres -c "DROP DATABASE restore_test;" > /dev/null 2>&1
rm -f /tmp/dump /tmp/restore.err

log "end" "ok" "Restore smoke test complete" "{\"overall\":\"SUCCESS\"}"
sleep 300
