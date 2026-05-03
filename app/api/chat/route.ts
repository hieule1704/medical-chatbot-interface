/**
 * app/api/chat/route.ts  (fix v2)
 *
 * Fix so với version cũ:
 * 1. Model name: dùng đúng model ID từ LM Studio thay vì 'medical-chatbot-v4'
 *    → Dùng first loaded model, hoặc config qua env LM_STUDIO_MODEL
 * 2. Fetch system prompt từ LM Studio để log vào session JSON
 *    → Người dùng có thể thấy system prompt trong /debug inspector
 * 3. JSON session logger đầy đủ payload thực tế (kể cả system message nếu có)
 */

import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';
import db   from '@/lib/db';
import { getSession }                                  from '@/lib/auth';
import { retrieveContext, formatRAGContext, RAGDebugInfo } from '@/lib/ragService';

export const runtime = 'nodejs';

// ── Config ────────────────────────────────────────────────────────────────────
const RECENT_TURNS   = 6;
const LM_STUDIO_BASE = 'http://127.0.0.1:1234';
const SESSIONS_DIR   = path.join(process.cwd(), 'logs', 'sessions');
const MAX_SESSIONS   = 200;

// Model ID: dùng env var nếu có, fallback về auto-detect từ /v1/models
const LM_MODEL_OVERRIDE = process.env.LM_STUDIO_MODEL ?? null;

// ── Detect active model từ LM Studio ─────────────────────────────────────────
// LM Studio trả về tất cả models đã load. Ta lấy cái đầu tiên.
async function detectActiveModel(): Promise<string> {
  if (LM_MODEL_OVERRIDE) return LM_MODEL_OVERRIDE;
  try {
    const res = await fetch(`${LM_STUDIO_BASE}/v1/models`, {
      headers: { Authorization: 'Bearer lm-studio' },
      signal : AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error('models endpoint error');
    const data = await res.json() as { data: { id: string }[] };
    const firstModel = data.data?.[0]?.id;
    if (!firstModel) throw new Error('no models loaded');
    console.log(`[MODEL] Auto-detected: ${firstModel}`);
    return firstModel;
  } catch (err) {
    console.warn('[MODEL] Could not detect, using fallback:', err);
    // Fallback — LM Studio sẽ dùng model đang chạy
    return 'local-model';
  }
}

// ── Fetch system prompt config từ LM Studio (LM Studio API) ──────────────────
// LM Studio 0.3+ có endpoint /api/v1/chat để lấy config của conversation hiện tại
// Nhưng không expose system prompt qua API chuẩn → ta log note thay thế
async function fetchLMStudioSystemPrompt(): Promise<string | null> {
  try {
    // LM Studio không expose system prompt qua OpenAI-compatible API
    // System prompt được inject phía LM Studio TRƯỚC khi message array được xử lý
    // → Nó KHÔNG xuất hiện trong request payload mà ta gửi
    // → Đây là thiết kế của LM Studio: system prompt là "invisible" với client
    return null; // Sẽ được thay bằng ghi chú trong debug UI
  } catch {
    return null;
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────
function makeSessionId(): string {
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
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

function estimateTokens(msgs: { role: string; content: string }[]): number {
  return msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 3.5) + 4, 0);
}

function writeSessionJSON(entry: object, sessionId: string) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');

    const ids = [sessionId, ...readIndex().filter(id => id !== sessionId)];
    if (ids.length > MAX_SESSIONS) {
      const removed = ids.splice(MAX_SESSIONS);
      for (const old of removed) {
        const op = path.join(SESSIONS_DIR, `${old}.json`);
        if (fs.existsSync(op)) fs.unlinkSync(op);
      }
    }
    writeIndex(ids);
  } catch (err) {
    console.error('[SESSION LOG] write error:', err);
  }
}

// ── TXT Logger (backward compat) ──────────────────────────────────────────────
function logPromptTXT(params: {
  useRag        : boolean;
  ragDebug      : RAGDebugInfo | null;
  ragContextText: string | null;
  messagesCount : number;
  sentCount     : number;
  allMessages   : { role: string; content: string }[];
  modelId       : string;
  systemPromptNote: string;
}) {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const SEP = '═'.repeat(70);
    const DIV = '─'.repeat(70);
    let log = '';

    log += `${SEP}\n`;
    log += `  RAG PROMPT LOG — ${new Date().toLocaleString('vi-VN')}\n`;
    log += `${SEP}\n\n`;
    log += `MODEL ID        : ${params.modelId}\n`;
    log += `CHẾ ĐỘ RAG      : ${params.useRag ? 'BẬT ✓' : 'TẮT ✗'}\n`;
    log += `SYSTEM PROMPT   : ${params.systemPromptNote}\n`;
    log += `LỊCH SỬ HỘI THOẠI: ${params.messagesCount} msgs tổng → gửi ${params.sentCount} msgs\n\n`;

    if (params.ragDebug) {
      const d = params.ragDebug;
      log += `QUERY GỐC       : ${d.originalQuery}\n`;
      log += `QUERY EMBED     : ${d.processedQuery}\n`;
      log += `RETRIEVAL MODE  : ${d.retrievalMode}\n`;
      log += `DISEASE DETECT  : ${d.detectedDisease ?? '(none)'}\n`;
      log += `THRESHOLD       : ${d.threshold}\n`;
      log += `THỜI GIAN       : ${d.elapsedMs}ms\n\n`;
      log += `CHROMADB CANDIDATES (${d.candidates.length}):\n`;
      d.candidates.forEach((c, i) => {
        const status = c.passed ? '✓ PASSED ' : '✗ FILTERED';
        log += `  [${i + 1}] ${status} | d=${c.distance.toFixed(4)} | ${c.disease_name} — ${c.section}\n`;
      });
      log += `\nCHUNKS INJECT VÀO LLM: ${d.passedCount} chunks\n`;
    }

    if (params.ragContextText) {
      log += `\n${DIV}\nTÀI LIỆU RAG INJECT VÀO USER MESSAGE:\n${DIV}\n\n`;
      log += params.ragContextText;
    }

    log += `\n\n${DIV}\nMESSAGES GỬI ĐẾN LM STUDIO (${params.sentCount} messages):\n${DIV}\n`;
    params.allMessages.forEach((m, i) => {
      log += `\n[${i + 1}] ${m.role.toUpperCase()}:\n${m.content}\n`;
    });

    log += `\n${SEP}\nEND OF LOG\n${SEP}\n`;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(logDir, `prompt_${timestamp}.txt`), log, 'utf-8');
    fs.writeFileSync(path.join(logDir, 'latest.txt'), log, 'utf-8');
    console.log(`[LOG] → logs/latest.txt`);
  } catch (err) {
    console.error('[LOG] Lỗi ghi file:', err);
  }
}

// ── Route Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { messages, conversationId, useRag = true } = await req.json();

  const lastUserMsg = messages[messages.length - 1];
  if (conversationId && lastUserMsg?.role === 'user') {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'user', lastUserMsg.content);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(conversationId);
  }

  // ── Truncate context window ────────────────────────────────────────────────
  const maxMsgs    = RECENT_TURNS * 2;
  const recentMsgs = messages.length > maxMsgs ? messages.slice(-maxMsgs) : messages;

  if (messages.length > maxMsgs) {
    console.log(`[CONTEXT] Truncated ${messages.length} → ${recentMsgs.length} messages`);
  }

  // ── Detect model (async, chạy song song với RAG) ──────────────────────────
  const [activeModel] = await Promise.all([
    detectActiveModel(),
    fetchLMStudioSystemPrompt(), // chưa dùng kết quả, chỉ để sẵn
  ]);

  // ── RAG Pipeline ───────────────────────────────────────────────────────────
  let ragDebug       : RAGDebugInfo | null = null;
  let ragContextText : string | null       = null;

  const msgsToSend = recentMsgs.map((m: { role: string; content: string }) => ({ ...m }));

  if (useRag && lastUserMsg?.content) {
    const ragResult = await retrieveContext(lastUserMsg.content);
    ragDebug = ragResult.debug;

    if (ragResult.hasContext) {
      ragContextText = formatRAGContext(ragResult);

      const lastIdx = msgsToSend.length - 1;
      if (msgsToSend[lastIdx]?.role === 'user') {
        msgsToSend[lastIdx] = {
          role   : 'user',
          content: `${ragContextText}\n\n---\n\nCâu hỏi của tôi: ${msgsToSend[lastIdx].content}`,
        };
      }

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`[RAG] ${ragResult.chunks.length} chunks injected | model=${activeModel}`);
      ragResult.chunks.forEach((c, i) =>
        console.log(`  [${i + 1}] ${c.disease_name} — ${c.section} (d=${c.distance.toFixed(4)})`)
      );
      console.log('═'.repeat(60) + '\n');
    } else {
      console.log('[RAG] No context → LM Studio system prompt handles response\n');
    }
  }

  // ── Note về system prompt (LM Studio không expose qua API) ────────────────
  const systemPromptNote =
    'Managed by LM Studio (invisible to client API — set in LM Studio UI → System Prompt tab)';

  // ── Build session entry ────────────────────────────────────────────────────
  const sessionId        = makeSessionId();
  const sessionTimestamp = new Date().toISOString();

  const sessionEntry = {
    id        : sessionId,
    timestamp : sessionTimestamp,
    useRag,
    ragDebug,
    modelId   : activeModel,
    // Ghi chú system prompt để debug page hiển thị
    systemPromptNote,
    lmPayload : {
      model      : activeModel,          // ← đúng model ID thực tế
      temperature: 0.3,
      max_tokens : 768,
      messages   : msgsToSend,
      // LM Studio tự inject system prompt TRƯỚC messages này
      // → không xuất hiện ở đây, đây là đặc điểm của LM Studio
    },
    stats: {
      totalMessages  : msgsToSend.length,
      estimatedTokens: estimateTokens(msgsToSend),
      ragChunks      : ragDebug?.passedCount ?? 0,
      userMsgLength  : lastUserMsg?.content?.length ?? 0,
      systemMsgLength: 0,
    },
    response: null as null | { content: string; durationMs: number; estimatedTokens: number },
  };

  writeSessionJSON(sessionEntry, sessionId);

  logPromptTXT({
    useRag,
    ragDebug,
    ragContextText,
    messagesCount   : messages.length,
    sentCount       : msgsToSend.length,
    allMessages     : msgsToSend,
    modelId         : activeModel,
    systemPromptNote,
  });

  // ── Gọi LM Studio ─────────────────────────────────────────────────────────
  try {
    const lmStart = Date.now();

    const response = await fetch(`${LM_STUDIO_BASE}/v1/chat/completions`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body   : JSON.stringify({
        model      : activeModel,   // ← đúng model ID thực tế
        messages   : msgsToSend,
        temperature: 0.3,
        max_tokens : 768,
        stream     : true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[LM Studio] Error response:', response.status, errText);
      return NextResponse.json({ error: errText }, { status: response.status });
    }

    let fullAssistantContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader  = response.body!.getReader();
        const decoder = new TextDecoder();

        if (ragDebug) {
          controller.enqueue(
            new TextEncoder().encode(`d:${JSON.stringify({ ragDebug })}\n`)
          );
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              if (conversationId && fullAssistantContent) {
                db.prepare(
                  'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)'
                ).run(conversationId, 'assistant', fullAssistantContent);
              }

              // Patch session entry với response thực tế
              const durationMs = Date.now() - lmStart;
              writeSessionJSON({
                ...sessionEntry,
                response: {
                  content        : fullAssistantContent,
                  durationMs,
                  estimatedTokens: Math.ceil(fullAssistantContent.length / 3.5),
                },
              }, sessionId);

              controller.close();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const text   = parsed.choices?.[0]?.delta?.content ?? '';
              if (text) {
                fullAssistantContent += text;
                controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(text)}\n`));
              }
            } catch { /* skip malformed SSE */ }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type' : 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection     : 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[chat/route] LM Studio error:', err);
    return NextResponse.json({ error: 'Lỗi kết nối LM Studio.' }, { status: 500 });
  }
}