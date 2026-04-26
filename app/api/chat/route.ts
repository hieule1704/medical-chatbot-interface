import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';
import { retrieveContext, buildSystemPrompt, RAGDebugInfo } from '@/lib/ragService';

export const runtime = 'nodejs';

// ─── Prompt Logger ─────────────────────────────────────────────────────────
function logPrompt(params: {
  useRag: boolean;
  ragDebug: RAGDebugInfo | null;
  systemContent: string;
  allMessages: { role: string; content: string }[];
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

    log += `CHẾ ĐỘ RAG : ${params.useRag ? 'BẬT ✓' : 'TẮT ✗'}\n\n`;

    if (params.ragDebug) {
      const d = params.ragDebug;
      log += `QUERY GỐC  : ${d.originalQuery}\n`;
      log += `QUERY EMBED: ${d.processedQuery}\n`;
      log += `THRESHOLD  : ${d.threshold}\n`;
      log += `THỜI GIAN  : ${d.elapsedMs}ms\n\n`;
      log += `CHROMADB CANDIDATES (${d.candidates.length} kết quả):\n`;
      d.candidates.forEach((c, i) => {
        const status = c.passed ? '✓ PASSED ' : '✗ FILTERED';
        log += `  [${i + 1}] ${status} | d=${c.distance.toFixed(4)} | ${c.disease_name} — ${c.section}\n`;
      });
      log += `\nCHUNKS INJECT VÀO LLM: ${d.passedCount} chunks\n`;
    } else {
      log += `RAG: Đã tắt — không query ChromaDB\n`;
    }

    log += `\n${DIV}\n`;
    log += `SYSTEM PROMPT (toàn bộ nội dung model nhận):\n`;
    log += `${DIV}\n\n`;
    log += params.systemContent;

    log += `\n\n${DIV}\n`;
    log += `CONVERSATION HISTORY (${params.allMessages.length} messages):\n`;
    log += `${DIV}\n`;
    params.allMessages.forEach((m, i) => {
      log += `\n[${i + 1}] ${m.role.toUpperCase()}:\n${m.content}\n`;
    });

    log += `\n${SEP}\nEND OF LOG\n${SEP}\n`;

    // Ghi file timestamped + overwrite latest.txt
    fs.writeFileSync(path.join(logDir, `prompt_${timestamp}.txt`), log, 'utf-8');
    fs.writeFileSync(path.join(logDir, 'latest.txt'), log, 'utf-8');

    console.log(`[LOG] → logs/latest.txt`);
  } catch (err) {
    console.error('[LOG] Lỗi ghi file:', err);
  }
}

// ─── Route Handler ─────────────────────────────────────────────────────────
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

  // ─── RAG Pipeline ───────────────────────────────────────────────────────
  let systemContent: string;
  let ragDebug: RAGDebugInfo | null = null;

  if (useRag && lastUserMsg?.content) {
    const ragResult = await retrieveContext(lastUserMsg.content);
    ragDebug = ragResult.debug;
    systemContent = buildSystemPrompt(ragResult);

    console.log('\n' + '═'.repeat(60));
    console.log(`[RAG] Gốc:   ${ragResult.debug.originalQuery.slice(0, 80)}`);
    console.log(`[RAG] Embed: ${ragResult.debug.processedQuery}`);
    console.log(`[RAG] Pass:  ${ragResult.chunks.length}/${ragResult.debug.candidates.length} chunks`);
    ragResult.chunks.forEach((c, i) =>
      console.log(`  [${i + 1}] ${c.disease_name} — ${c.section} (d=${c.distance.toFixed(4)})`)
    );
    if (ragResult.chunks.length === 0) console.log('  → FALLBACK');
    console.log('═'.repeat(60) + '\n');
  } else {
    systemContent =
      'Bạn là trợ lý y tế AI chuyên nghiệp về Tai Mũi Họng. ' +
      'Cung cấp thông tin sức khỏe chính xác bằng tiếng Việt. ' +
      'KHÔNG chẩn đoán thay bác sĩ. Luôn khuyến nghị thăm khám khi cần thiết. ' +
      '(RAG đã tắt — trả lời từ kiến thức nền của model.)';
  }

  // Ghi toàn bộ prompt ra file
  logPrompt({ useRag, ragDebug, systemContent, allMessages: messages });
  // ────────────────────────────────────────────────────────────────────────

  try {
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer lm-studio' },
      body: JSON.stringify({
        model: 'medical-chatbot-v4',
        messages: [{ role: 'system', content: systemContent }, ...messages],
        temperature: 0.3,
        max_tokens: 512,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
    }

    let fullAssistantContent = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
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
              controller.close();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const text = parsed.choices?.[0]?.delta?.content ?? '';
              if (text) {
                fullAssistantContent += text;
                controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(text)}\n`));
              }
            } catch { /* skip */ }
          }
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  } catch (err) {
    console.error('[chat/route] LM Studio error:', err);
    return NextResponse.json({ error: 'Lỗi kết nối LM Studio.' }, { status: 500 });
  }
}