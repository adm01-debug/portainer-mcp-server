#!/usr/bin/env python3
"""
Backfill v3 — concorrência com ThreadPoolExecutor para ~40+ msg/s.
"""
import os
import sys
import json
import time
import urllib.request
import urllib.error
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

EV_DB_URL = os.environ['EV_DB_URL']
WEBHOOK_URL = os.environ.get('WEBHOOK_URL', 'https://tdprnylgyrogbbhgdoik.supabase.co/functions/v1/evolution-webhook')
WEBHOOK_SECRET = os.environ.get('WEBHOOK_SECRET', 'promo-brindes-evolution-4d4565def0706d8ab270066754a2de95d11cf95cfd7da0b8e20221791bf08058')
INSTANCE_ID = os.environ.get('INSTANCE_ID', 'bd3ee04a-9054-4879-af90-84da3843fd27')
INSTANCE_NAME = os.environ.get('INSTANCE_NAME', 'wpp2')
START_EPOCH = int(os.environ.get('START_EPOCH', '1776250800'))
END_EPOCH = int(os.environ.get('END_EPOCH', '1776526800'))
MODE = os.environ.get('MODE', 'replay')
DRY_RUN = os.environ.get('DRY_RUN', 'false').lower() == 'true'
MAX_MSGS = int(os.environ.get('MAX_MSGS', '30000'))
CONCURRENCY = int(os.environ.get('CONCURRENCY', '20'))


def log(msg):
    print(f'[backfill {datetime.now(timezone.utc).isoformat()}] {msg}', flush=True)


def post_webhook(event: str, data: dict) -> int:
    payload = {'event': event, 'instance': INSTANCE_NAME, 'data': data}
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        WEBHOOK_URL,
        data=body,
        headers={
            'Content-Type': 'application/json',
            'x-webhook-secret': WEBHOOK_SECRET,
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.getcode()
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return -1


def build_upsert_event(row: dict) -> dict:
    key = row.get('key') or {}
    if isinstance(key, str):
        try:
            key = json.loads(key)
        except Exception:
            key = {}
    message = row.get('message') or {}
    if isinstance(message, str):
        try:
            message = json.loads(message)
        except Exception:
            message = {}

    return {
        'key': {
            'id': key.get('id') or row.get('id'),
            'remoteJid': key.get('remoteJid') or row.get('remoteJid'),
            'fromMe': key.get('fromMe', row.get('fromMe', False)),
        },
        'pushName': row.get('pushName') or row.get('push_name'),
        'message': message,
        'messageType': row.get('messageType') or row.get('message_type'),
        'messageTimestamp': row.get('messageTimestamp') or row.get('timestamp'),
        'status': row.get('status'),
        'instanceId': row.get('instanceId') or INSTANCE_ID,
        'source': 'backfill-recovery-2026-04-18',
    }


def send_one(event_data):
    if not event_data['key'].get('id'):
        return ('skip', event_data)
    if DRY_RUN:
        return ('ok', event_data)
    code = post_webhook('messages.upsert', event_data)
    if 200 <= code < 300:
        return ('ok', event_data)
    return ('fail', (event_data, code))


def get_table_and_columns(cur):
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema='public' AND lower(table_name) IN ('message', 'messages')
        ORDER BY table_name
    """)
    tables = [r['table_name'] for r in cur.fetchall()]
    if not tables:
        return None, []
    tbl = tables[0]
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = %s AND table_schema='public'
        ORDER BY ordinal_position
    """, (tbl,))
    cols = [(r['column_name'], r['data_type']) for r in cur.fetchall()]
    return tbl, cols


def main():
    log(f'v3 concurrent. MODE={MODE} CONCURRENCY={CONCURRENCY} window={START_EPOCH}..{END_EPOCH}')
    conn = psycopg2.connect(EV_DB_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    tbl, cols = get_table_and_columns(cur)
    if not tbl:
        log('ERROR: no Message table found')
        sys.exit(1)
    log(f'Message table: {tbl!r}  ({len(cols)} columns)')
    if MODE == 'schema':
        for c, t in cols:
            log(f'  - {c} :: {t}')
        return

    col_names = [c for c, _ in cols]
    has_instance_id = 'instanceId' in col_names
    ts_col = 'messageTimestamp' if 'messageTimestamp' in col_names else 'timestamp'

    where_clauses = [f'"{ts_col}" BETWEEN %s AND %s']
    params = [START_EPOCH, END_EPOCH]
    if has_instance_id:
        where_clauses.append('"instanceId" = %s')
        params.append(INSTANCE_ID)
    where = ' AND '.join(where_clauses)

    cur.execute(f'SELECT COUNT(*) AS n FROM "{tbl}" WHERE {where}', params)
    total_available = cur.fetchone()['n']
    log(f'COUNT_IN_WINDOW: {total_available}')

    if MODE == 'count':
        return

    log(f'Replaying up to {MAX_MSGS} with {CONCURRENCY} workers...')
    cur.execute(
        f'SELECT * FROM "{tbl}" WHERE {where} ORDER BY "{ts_col}" LIMIT %s',
        params + [MAX_MSGS]
    )

    sent_ok = 0
    sent_fail = 0
    skipped = 0
    processed = 0
    t0 = time.time()

    # Load in chunks, dispatch in parallel per chunk
    CHUNK = 200
    while True:
        rows = cur.fetchmany(CHUNK)
        if not rows:
            break
        events = [build_upsert_event(dict(r)) for r in rows]
        with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
            futures = [pool.submit(send_one, ev) for ev in events]
            for f in as_completed(futures):
                result, _info = f.result()
                processed += 1
                if result == 'ok':
                    sent_ok += 1
                elif result == 'skip':
                    skipped += 1
                else:
                    sent_fail += 1
        elapsed = time.time() - t0
        rate = processed / elapsed if elapsed > 0 else 0
        log(f'PROGRESS: {processed}/{total_available} ok={sent_ok} fail={sent_fail} skip={skipped} rate={rate:.1f} msg/s')

    elapsed = time.time() - t0
    log(f'=== REPLAY DONE === processed={processed} ok={sent_ok} fail={sent_fail} skip={skipped} elapsed={elapsed:.1f}s avg_rate={processed/max(elapsed,1):.1f} msg/s')


if __name__ == '__main__':
    main()
