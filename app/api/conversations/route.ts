import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/conversations — list all conversations for current user
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const conversations = db
    .prepare(`
      SELECT c.id, c.title, c.created_at, c.updated_at,
             COUNT(m.id) as message_count
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.user_id = ?
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `)
    .all(user.id);

  return NextResponse.json({ conversations });
}

// POST /api/conversations — create new conversation
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const { title } = await req.json();
  const result = db
    .prepare('INSERT INTO conversations (user_id, title) VALUES (?, ?)')
    .run(user.id, title?.trim() || 'Cuộc trò chuyện mới');

  return NextResponse.json({ id: result.lastInsertRowid });
}
