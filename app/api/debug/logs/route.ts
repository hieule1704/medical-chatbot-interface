/**
 * app/api/debug/logs/route.ts
 *
 * Serves conversation log entries to the /debug Conversation Inspector page.
 *
 * GET  /api/debug/logs          → list of LogListItem[]  (sidebar)
 * GET  /api/debug/logs?id=xxx   → full LogEntry (detail panel)
 * DELETE /api/debug/logs        → clear all logs
 *
 * Log files are written by chat/route.ts as JSON to:
 *   <cwd>/logs/sessions/<id>.json
 * plus an index file:
 *   <cwd>/logs/sessions/index.json   ← ordered list of ids (newest first)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const SESSIONS_DIR = path.join(process.cwd(), 'logs', 'sessions');

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function readIndex(): string[] {
  const p = path.join(SESSIONS_DIR, 'index.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return []; }
}

function writeIndex(ids: string[]) {
  fs.writeFileSync(
    path.join(SESSIONS_DIR, 'index.json'),
    JSON.stringify(ids),
    'utf-8',
  );
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  ensureDir();

  const id = req.nextUrl.searchParams.get('id');

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (id) {
    const filePath = path.join(SESSIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    try {
      const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return NextResponse.json(entry);
    } catch {
      return NextResponse.json({ error: 'Parse error' }, { status: 500 });
    }
  }

  // ── List view ───────────────────────────────────────────────────────────────
  const ids = readIndex();
  const entries: object[] = [];

  for (const eid of ids) {
    const filePath = path.join(SESSIONS_DIR, `${eid}.json`);
    if (!fs.existsSync(filePath)) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // Return lightweight list item only
      entries.push({
        id              : entry.id,
        timestamp       : entry.timestamp,
        useRag          : entry.useRag,
        retrievalMode   : entry.ragDebug?.retrievalMode   ?? null,
        detectedDisease : entry.ragDebug?.detectedDisease ?? null,
        ragChunks       : entry.stats?.ragChunks          ?? 0,
        totalMessages   : entry.stats?.totalMessages      ?? 0,
        estimatedTokens : entry.stats?.estimatedTokens    ?? 0,
        userMsgLength   : entry.stats?.userMsgLength      ?? 0,
        hasResponse     : !!entry.response,
        responseDuration: entry.response?.durationMs      ?? null,
      });
    } catch { /* skip corrupt file */ }
  }

  return NextResponse.json({ entries });
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function DELETE() {
  ensureDir();
  const ids = readIndex();
  for (const id of ids) {
    const p = path.join(SESSIONS_DIR, `${id}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  writeIndex([]);
  return NextResponse.json({ ok: true, deleted: ids.length });
}