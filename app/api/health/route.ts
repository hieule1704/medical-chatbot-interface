/**
 * app/api/health/route.ts
 *
 * Server-side health check — gọi từ frontend định kỳ.
 * Lý do dùng server-side thay vì frontend gọi thẳng:
 * - LM Studio (port 1234) và Embedding API (port 8002) là localhost của server
 * - Browser không thể gọi localhost của server → phải proxy qua Next.js
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Timeout ngắn để health check không block UI lâu
const TIMEOUT_MS = 3000;

async function checkService(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);

    return { ok: res.ok, latencyMs: Date.now() - t0 };
  } catch {
    return { ok: false, latencyMs: Date.now() - t0 };
  }
}

export async function GET() {
  // Chạy song song cả 2 để không chờ tuần tự
  const [lmStudio, embeddingApi] = await Promise.all([
    checkService('http://127.0.0.1:1234/v1/models'),
    checkService('http://localhost:8002/health'),
  ]);

  const allOk = lmStudio.ok && embeddingApi.ok;

  return NextResponse.json({
    ok: allOk,
    services: {
      lmStudio    : { ...lmStudio,     name: 'LM Studio' },
      embeddingApi: { ...embeddingApi, name: 'Embedding API' },
    },
    timestamp: Date.now(),
  }, {
    status: 200, // luôn 200 — frontend tự đọc field ok
    headers: { 'Cache-Control': 'no-store' },
  });
}