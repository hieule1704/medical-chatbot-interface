/**
 * app/api/chat/route.ts
 *
 * Fix so với version cũ:
 * 1. Context Window Overflow → chỉ gửi RECENT_TURNS lượt cuối cho LLM
 * 2. System Prompt conflict → KHÔNG gửi system prompt từ code khi RAG tắt,
 *    để LM Studio system prompt tự xử lý. Khi RAG bật, chỉ inject TÀI LIỆU
 *    vào user message thay vì override system prompt hoàn toàn.
 * 3. Prompt logger cập nhật để log rõ strategy đang dùng
 */

import { NextRequest, NextResponse } from 'next/server';
import fs   from 'fs';
import path from 'path';
import db   from '@/lib/db';
import { getSession }                                  from '@/lib/auth';
import { retrieveContext, formatRAGContext, RAGDebugInfo } from '@/lib/ragService';

export const runtime = 'nodejs';

// ── Config ───────────────────────────────────────────────────────────────────
// Số lượt hội thoại gần nhất gửi cho LLM (1 lượt = 1 user + 1 assistant)
// LLaMA 3 8B context 8k tokens ≈ ~10 lượt an toàn với RAG context
const RECENT_TURNS = 6;   // 6 lượt = 12 tin nhắn

// ── Prompt Logger ─────────────────────────────────────────────────────────────
function logPrompt(params: {
  useRag        : boolean;
  ragDebug      : RAGDebugInfo | null;
  ragContextText: string | null;   // đoạn text tài liệu inject vào user msg
  messagesCount : number;
  sentCount     : number;          // số msg thực sự gửi đi sau truncate
  allMessages   : { role: string; content: string }[];
}) {
  try {
    const logDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const SEP = '═'.repeat(70);
    const DIV = '─'.repeat(70);
    let log = '';

    log += `${SEP}\n`;
    log += `  RAG PROMPT LOG — ${new Date().toLocaleString('vi-VN')}\n`;
    log += `${SEP}\n\n`;

    log += `CHẾ ĐỘ RAG      : ${params.useRag ? 'BẬT ✓' : 'TẮT ✗'}\n`;
    log += `SYSTEM PROMPT   : LM Studio built-in (không override từ code)\n`;
    log += `LỊCH SỬ HỘI THOẠI: ${params.messagesCount} msgs tổng → gửi ${params.sentCount} msgs (truncated)\n\n`;

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
    } else {
      log += `RAG: Đã tắt — không query ChromaDB\n`;
    }

    if (params.ragContextText) {
      log += `\n${DIV}\n`;
      log += `TÀI LIỆU RAG INJECT VÀO USER MESSAGE:\n`;
      log += `${DIV}\n\n`;
      log += params.ragContextText;
    }

    log += `\n\n${DIV}\n`;
    log += `MESSAGES GỬI ĐẾN LM STUDIO (${params.sentCount} messages, NO system override):\n`;
    log += `${DIV}\n`;
    params.allMessages.forEach((m, i) => {
      log += `\n[${i + 1}] ${m.role.toUpperCase()}:\n${m.content}\n`;
    });

    log += `\n${SEP}\nEND OF LOG\n${SEP}\n`;

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

  // Lưu tin nhắn user mới vào DB
  const lastUserMsg = messages[messages.length - 1];
  if (conversationId && lastUserMsg?.role === 'user') {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'user', lastUserMsg.content);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(conversationId);
  }

  // ── Truncate context window ────────────────────────────────────────────────
  // Giữ RECENT_TURNS * 2 tin nhắn gần nhất, tránh overflow 8k tokens của LLaMA 3 8B
  const maxMsgs    = RECENT_TURNS * 2;
  const recentMsgs = messages.length > maxMsgs
    ? messages.slice(-maxMsgs)
    : messages;

  if (messages.length > maxMsgs) {
    console.log(`[CONTEXT] Truncated ${messages.length} → ${recentMsgs.length} messages (RECENT_TURNS=${RECENT_TURNS})`);
  }

  // ── RAG Pipeline ───────────────────────────────────────────────────────────
  // STRATEGY: Không override system prompt của LM Studio.
  // Thay vào đó, inject tài liệu RAG vào đầu TIN NHẮN USER cuối cùng.
  // LM Studio system prompt vẫn chạy nguyên vẹn → không có xung đột.
  let ragDebug       : RAGDebugInfo | null = null;
  let ragContextText : string | null       = null;

  // Clone messages để không mutate original
  const msgsToSend = recentMsgs.map((m: { role: string; content: string }) => ({ ...m }));

  if (useRag && lastUserMsg?.content) {
    const ragResult = await retrieveContext(lastUserMsg.content);
    ragDebug = ragResult.debug;

    if (ragResult.hasContext) {
      // Format tài liệu RAG thành block text
      ragContextText = formatRAGContext(ragResult);

      // Inject vào đầu tin nhắn user CUỐI CÙNG trong array gửi đi
      const lastIdx = msgsToSend.length - 1;
      if (msgsToSend[lastIdx]?.role === 'user') {
        msgsToSend[lastIdx] = {
          role   : 'user',
          content: `${ragContextText}\n\n---\n\nCâu hỏi của tôi: ${msgsToSend[lastIdx].content}`,
        };
      }

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`[RAG] ${ragResult.chunks.length} chunks injected vào user message`);
      ragResult.chunks.forEach((c, i) =>
        console.log(`  [${i + 1}] ${c.disease_name} — ${c.section} (d=${c.distance.toFixed(4)})`)
      );
      console.log('═'.repeat(60) + '\n');
    } else {
      console.log('[RAG] No context → LM Studio system prompt handles response\n');
    }
  }

  // Log đầy đủ
  logPrompt({
    useRag,
    ragDebug,
    ragContextText,
    messagesCount : messages.length,
    sentCount     : msgsToSend.length,
    allMessages   : msgsToSend,
  });

  // ── Gọi LM Studio ─────────────────────────────────────────────────────────
  // KHÔNG gửi system message từ code → LM Studio dùng built-in system prompt
  try {
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body   : JSON.stringify({
        model      : 'medical-chatbot-v4',
        messages   : msgsToSend,           // ← NO system role prepended
        temperature: 0.3,
        max_tokens : 768,                  // tăng lên 768 vì không có system prompt chiếm token
        stream     : true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
    }

    let fullAssistantContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader  = response.body!.getReader();
        const decoder = new TextDecoder();

        // Gửi RAG debug info về frontend trước
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection     : 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[chat/route] LM Studio error:', err);
    return NextResponse.json({ error: 'Lỗi kết nối LM Studio.' }, { status: 500 });
  }
}