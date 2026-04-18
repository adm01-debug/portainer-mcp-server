#!/usr/bin/env python3
"""
Backfill de mensagens perdidas entre 15-18/04/2026.
Lê do Postgres Evolution (local VPS) e imprime JSON batches em stdout.
Um orquestrador externo consome via logs Docker e chama fn_backfill_messages no FATOR X.

Uso:
  EV_DB_URL=... INSTANCE_ID=... START_EPOCH=... END_EPOCH=... python3 backfill.py
"""
import os
import sys
import json
import psycopg2
import psycopg2.extras
from datetime import datetime, timezone

EV_DB_URL = os.environ['EV_DB_URL']
INSTANCE_ID = os.environ.get('INSTANCE_ID', 'bd3ee04a-9054-4879-af90-84da3843fd27')
START_EPOCH = int(os.environ.get('START_EPOCH', '1776250800'))  # 15/04 11:00 UTC
END_EPOCH = int(os.environ.get('END_EPOCH', '1776526800'))      # 18/04 15:20 UTC
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '100'))
MODE = os.environ.get('MODE', 'schema')  # schema | count | dump


def log(msg):
    print(f'[backfill {datetime.now(timezone.utc).isoformat()}] {msg}', flush=True)


def main():
    log(f'Starting. MODE={MODE}  window={START_EPOCH}..{END_EPOCH}  instance={INSTANCE_ID}')
    conn = psycopg2.connect(EV_DB_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Step 1: Descobrir tabelas relevantes
    cur.execute("""
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema='public' AND (
            lower(table_name) LIKE '%message%'
            OR lower(table_name) LIKE '%chat%'
            OR lower(table_name) LIKE '%instance%'
        )
        ORDER BY table_name
    """)
    tables = [r['table_name'] for r in cur.fetchall()]
    log(f'Candidate tables: {tables}')

    # Step 2: Se mode=schema, descreve cada tabela
    if MODE == 'schema':
        for tbl in tables:
            cur.execute("""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = %s AND table_schema='public'
                ORDER BY ordinal_position
            """, (tbl,))
            cols = cur.fetchall()
            log(f'=== TABLE {tbl!r} ({len(cols)} cols) ===')
            for c in cols:
                log(f'  - {c["column_name"]} :: {c["data_type"]}')
            # Sample row count (guarded)
            try:
                cur.execute(f'SELECT COUNT(*) AS n FROM "{tbl}"')
                n = cur.fetchone()['n']
                log(f'  rows: {n}')
            except Exception as e:
                log(f'  rows: ERROR {e}')
        log('=== schema dump done ===')
        return

    # Step 3: Se mode=count, só conta mensagens da janela
    message_table = next((t for t in tables if t in ('Message', 'messages', 'message')), None)
    if not message_table:
        log('ERROR: no Message table found')
        sys.exit(1)
    log(f'Using message table: {message_table!r}')

    if MODE == 'count':
        try:
            cur.execute(f'''
                SELECT COUNT(*) AS n
                FROM "{message_table}"
                WHERE "instanceId" = %s
                  AND "messageTimestamp" BETWEEN %s AND %s
            ''', (INSTANCE_ID, START_EPOCH, END_EPOCH))
            n = cur.fetchone()['n']
            log(f'COUNT_IN_WINDOW: {n}')
        except Exception as e:
            log(f'count by instanceId failed: {e}. Trying without filter...')
            cur.execute(f'''
                SELECT COUNT(*) AS n
                FROM "{message_table}"
                WHERE "messageTimestamp" BETWEEN %s AND %s
            ''', (START_EPOCH, END_EPOCH))
            n = cur.fetchone()['n']
            log(f'COUNT_IN_WINDOW (no instance filter): {n}')
        return

    # Step 4: Dump real de mensagens em batches JSON
    log(f'Dumping messages in batches of {BATCH_SIZE}...')
    batch_num = 0
    total = 0
    cur.execute(f'''
        SELECT *
        FROM "{message_table}"
        WHERE "messageTimestamp" BETWEEN %s AND %s
        ORDER BY "messageTimestamp"
    ''', (START_EPOCH, END_EPOCH))

    batch = []
    for row in cur:
        batch.append(dict(row))
        if len(batch) >= BATCH_SIZE:
            batch_num += 1
            total += len(batch)
            # Print one-line JSON prefixed for parsing
            print(f'BATCH_START batch={batch_num} size={len(batch)}', flush=True)
            print(json.dumps(batch, default=str, ensure_ascii=False), flush=True)
            print(f'BATCH_END batch={batch_num}', flush=True)
            batch = []

    if batch:
        batch_num += 1
        total += len(batch)
        print(f'BATCH_START batch={batch_num} size={len(batch)}', flush=True)
        print(json.dumps(batch, default=str, ensure_ascii=False), flush=True)
        print(f'BATCH_END batch={batch_num}', flush=True)

    log(f'FINAL_TOTAL={total}  batches={batch_num}')
    log('=== dump done ===')


if __name__ == '__main__':
    main()
