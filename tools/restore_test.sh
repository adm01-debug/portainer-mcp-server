#!/bin/bash
# Restore smoke test for evolution backup
# Downloads latest dump from MinIO, restores to temp DB, validates, drops
set +e  # don't abort on non-zero, we handle errors

echo "=== RESTORE SMOKE TEST STARTING $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

export PGPASSWORD="9904a22beb873591ebb1467f20d44fb8"

echo "--- [1/8] Installing mc (MinIO client) ---"
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x /usr/local/bin/mc
mc --version | head -n1
echo

echo "--- [2/8] Connecting to MinIO ---"
mc alias set local http://minio:9000 AtomicaBR '@Promo2024' 2>&1
mc ls local/ 2>&1 | head -n 20
echo

echo "--- [3/8] Finding latest backup ---"
LATEST_MANUAL=$(mc ls local/evolution-backups/manual/ 2>/dev/null | sort | tail -n1 | awk '{print $NF}')
LATEST_DAILY=$(mc ls local/evolution-backups/daily/ 2>/dev/null | sort | tail -n1 | awk '{print $NF}')

echo "manual latest: $LATEST_MANUAL"
echo "daily latest:  $LATEST_DAILY"

if [ -n "$LATEST_MANUAL" ]; then
  SRC="local/evolution-backups/manual/$LATEST_MANUAL"
elif [ -n "$LATEST_DAILY" ]; then
  SRC="local/evolution-backups/daily/$LATEST_DAILY"
else
  echo "ERROR: No backup found in manual or daily prefix"
  exit 10
fi
echo "Source: $SRC"
echo

echo "--- [4/8] Downloading backup ---"
mc cp "$SRC" /tmp/dump.gz 2>&1
ls -lh /tmp/dump.gz
echo

echo "--- [5/8] Decompressing ---"
gunzip /tmp/dump.gz
ls -lh /tmp/dump
file /tmp/dump
echo

echo "--- [6/8] Creating temp DB restore_test ---"
psql -h postgres -U postgres -d postgres -c "DROP DATABASE IF EXISTS restore_test;" 2>&1 | tail -n 5
psql -h postgres -U postgres -d postgres -c "CREATE DATABASE restore_test;" 2>&1 | tail -n 5
echo

echo "--- [7/8] pg_restore (this takes a bit) ---"
pg_restore -h postgres -U postgres -d restore_test --no-owner --no-acl /tmp/dump 2>&1 | tail -n 40
RESTORE_EXIT=$?
echo "pg_restore exit: $RESTORE_EXIT (0=ok, 1=warnings non-fatal)"
echo

echo "--- [8/8] Validation ---"
echo "*** Top 20 tables by row count ***"
psql -h postgres -U postgres -d restore_test -c "
  SELECT schemaname, relname, n_live_tup AS rows
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC LIMIT 20;" 2>&1

echo "*** Database size ***"
psql -h postgres -U postgres -d restore_test -c "SELECT pg_size_pretty(pg_database_size(current_database())) AS size;" 2>&1

echo "*** Tables count ***"
psql -h postgres -U postgres -d restore_test -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>&1

echo "*** Sample: Messages table (if exists) ***"
psql -h postgres -U postgres -d restore_test -c "\d \"Message\"" 2>&1 | head -n 15 || echo "no Message table"
psql -h postgres -U postgres -d restore_test -t -c "SELECT COUNT(*) FROM \"Message\"" 2>&1 || echo "no count possible"

echo
echo "--- Cleanup ---"
psql -h postgres -U postgres -d postgres -c "DROP DATABASE restore_test;" 2>&1 | tail -n 3
rm -f /tmp/dump

echo "=== RESTORE SMOKE TEST COMPLETE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Result: pg_restore exit = $RESTORE_EXIT"
sleep 3600
