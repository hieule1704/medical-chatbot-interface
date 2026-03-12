import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Chưa đăng nhập.' }, { status: 401 });

  const rows = db.prepare(`
    SELECT
      c.id            AS conv_id,
      c.title         AS conv_title,
      c.created_at    AS conv_date,
      m.role,
      m.content,
      m.created_at    AS msg_time
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id
    WHERE c.user_id = ?
    ORDER BY c.id ASC, m.id ASC
  `).all(user.id) as {
    conv_id: number; conv_title: string; conv_date: string;
    role: string; content: string; msg_time: string;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Chưa có lịch sử hội thoại.' }, { status: 404 });
  }

  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

  // Format datetime: "2026-03-12 08:58:44" → "12/03/2026 08:58"
  const fmtDate = (s: string) => {
    const d = new Date(s.replace(' ', 'T') + 'Z');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  };

  // Group messages by conversation for session numbering
  let sessionNum = 0;
  let lastConvId = -1;

  const lines: string[] = [
    // BOM for Excel Vietnamese
    '\uFEFF' + ['Phiên hội thoại', 'Chủ đề', 'Thời gian bắt đầu', 'Người gửi', 'Nội dung', 'Thời gian gửi']
      .map(esc).join(','),
  ];

  for (const r of rows) {
    if (r.conv_id !== lastConvId) {
      sessionNum++;
      lastConvId = r.conv_id;
    }

    const sender = r.role === 'user' ? `${user.full_name || user.username}` : 'Medical AI';
    const sessionLabel = `Phiên ${sessionNum}`;
    // Title: use actual title or fallback to "Chủ đề không đặt tên"
    const title = r.conv_title === 'Cuộc trò chuyện mới' ? '(Chưa đặt tên)' : r.conv_title;

    lines.push(
      [sessionLabel, title, fmtDate(r.conv_date), sender, r.content, fmtDate(r.msg_time)]
        .map(v => esc(String(v)))
        .join(',')
    );
  }

  const csv = lines.join('\r\n');
  const date = new Date().toISOString().slice(0, 10);
  const filename = `MedAI_LichSuHoiThoai_${user.username}_${date}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}