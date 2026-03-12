import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { messages, conversationId } = await req.json();

  // Save the last user message to DB
  const lastUserMsg = messages[messages.length - 1];
  if (conversationId && lastUserMsg?.role === 'user') {
    db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
      .run(conversationId, 'user', lastUserMsg.content);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(conversationId);
  }

  try {
    const response = await fetch('http://127.0.0.1:1234/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer lm-studio',
      },
      body: JSON.stringify({
        model: 'medical-chatbot-v4',
        messages: [
          {
            role: 'system',
            content: 'Bạn là trợ lý y tế AI chuyên nghiệp. Cung cấp thông tin sức khỏe chính xác và hữu ích bằng tiếng Việt. KHÔNG chẩn đoán bệnh thay bác sĩ. Luôn khuyến nghị gặp chuyên gia y tế khi cần thiết. Trả lời ngắn gọn, rõ ràng.',
          },
          ...messages,
        ],
        temperature: 0.7,
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              // Save completed assistant response to DB
              if (conversationId && fullAssistantContent) {
                db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)')
                  .run(conversationId, 'assistant', fullAssistantContent);
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
            } catch { /* skip malformed */ }
          }
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (err) {
    console.error('LM Studio error:', err);
    return NextResponse.json({ error: 'Không thể kết nối LM Studio.' }, { status: 503 });
  }
}
