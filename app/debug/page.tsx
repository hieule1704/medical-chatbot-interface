'use client';

/**
 * /debug — Full Conversation Inspector (v2)
 *
 * Thêm so với v1:
 * - System Prompt panel: giải thích tại sao không thấy system prompt trong payload
 *   và hướng dẫn xem nó trong LM Studio
 * - Model ID hiển thị rõ ràng (trước đây ẩn)
 * - Cảnh báo nếu messages array chỉ có USER messages (không có ASSISTANT trước đó)
 */

import { useState, useEffect, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
interface RAGCandidate {
  disease_name: string;
  section: string;
  distance: number;
  passed: boolean;
}
interface RAGDebugInfo {
  originalQuery: string;
  processedQuery: string;
  retrievalMode: 'hybrid_filtered' | 'semantic_full';
  detectedDisease: string | null;
  threshold: number;
  candidates: RAGCandidate[];
  passedCount: number;
  elapsedMs: number;
}
interface LMMessage { role: string; content: string; }
interface LogEntry {
  id: string;
  timestamp: string;
  useRag: boolean;
  modelId?: string;
  systemPromptNote?: string;
  ragDebug: RAGDebugInfo | null;
  lmPayload: {
    model: string;
    temperature: number;
    max_tokens: number;
    messages: LMMessage[];
  };
  stats: {
    totalMessages: number;
    estimatedTokens: number;
    ragChunks: number;
    userMsgLength: number;
    systemMsgLength: number;
  };
  response?: {
    content: string;
    durationMs: number;
    estimatedTokens: number;
  };
}
interface LogListItem {
  id: string;
  timestamp: string;
  useRag: boolean;
  retrievalMode: string | null;
  detectedDisease: string | null;
  ragChunks: number;
  totalMessages: number;
  estimatedTokens: number;
  userMsgLength: number;
  hasResponse: boolean;
  responseDuration: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function tokenColor(n: number) {
  if (n < 2000) return '#10b981';
  if (n < 5000) return '#f59e0b';
  return '#ef4444';
}

// ── System Prompt Panel ───────────────────────────────────────────────────────
function SystemPromptPanel({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  // Paste your LM Studio system prompt here to display it in the inspector
  // (LM Studio doesn't expose it via API, so we show the note instead)
  const SYSTEM_PROMPT_CONTENT = entry.systemPromptNote ?? 
    'LM Studio quản lý system prompt phía server — không xuất hiện trong API payload.\n\n' +
    'Để xem: LM Studio → tab "Chat" → icon "System Prompt" (bên trái input box)\n\n' +
    'System prompt được inject TRƯỚC messages array trước khi model xử lý.\n' +
    'Đây là thiết kế của LM Studio: client API không nhìn thấy nó — chỉ model thấy.';

  return (
    <div style={{ background: '#1e1b4b', border: '1px solid #4338ca40', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 800,
          background: '#6366f1', color: '#fff', fontFamily: 'monospace',
          letterSpacing: '0.08em',
        }}>
          SYSTEM
        </span>
        <span style={{ fontSize: 12, color: '#a5b4fc', flex: 1 }}>
          LM Studio built-in system prompt
        </span>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 700,
          background: '#f59e0b15', color: '#f59e0b', border: '1px solid #f59e0b30',
        }}>
          ⚠ invisible to API
        </span>
        <span style={{ color: '#475569', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #4338ca30', padding: '12px 14px' }}>
          <div style={{
            background: '#0f172a', borderRadius: 8, padding: '12px 14px',
            border: '1px solid #f59e0b20',
          }}>
            <p style={{
              fontSize: 10, color: '#f59e0b', fontWeight: 700, marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}>
              ℹ️ Tại sao không thấy system prompt trong payload?
            </p>
            <pre style={{
              fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', lineHeight: 1.7, margin: 0, fontFamily: 'monospace',
            }}>
              {SYSTEM_PROMPT_CONTENT}
            </pre>
          </div>

          {/* Actual system prompt content — paste vào đây nếu muốn xem trong inspector */}
          <div style={{ marginTop: 10, background: '#1e1b4b', borderRadius: 8, padding: '10px 12px', border: '1px solid #4338ca30' }}>
            <p style={{ fontSize: 10, color: '#6366f1', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              📋 System prompt hiện tại (copy từ LM Studio)
            </p>
            <pre style={{ fontSize: 12, color: '#a5b4fc', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, margin: 0 }}>
{`Bạn là Trợ lý Tư vấn Y tế Sơ cấp và Sàng lọc Thông tin bằng tiếng Việt.
Nhiệm vụ: cung cấp kiến thức y khoa phổ thông, giải thích triệu chứng cơ bản
và thực hiện phân luồng an toàn (Triage) cho bệnh nhân.

1. VAI TRÒ VÀ GIỚI HẠN: KHÔNG chẩn đoán, KHÔNG kê đơn, KHÔNG chỉ định liều lượng.
2. CẤU TRÚC TƯ VẤN: thấu cảm → giải thích → hướng dẫn → miễn trừ trách nhiệm.
3. RED FLAGS: cảnh báo ngay triệu chứng nguy hiểm, yêu cầu gọi 115.
4. GUARDRAILS: từ chối yêu cầu ngoài ngành / kê đơn nguy hiểm / gây hại.
5. TÍNH XÁC THỰC: dựa trên tiêu chuẩn y tế chính thống, không bịa đặt.`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message Block ─────────────────────────────────────────────────────────────
function MessageBlock({ msg, index, total }: { msg: LMMessage; index: number; total: number }) {
  const [collapsed, setCollapsed] = useState(msg.role !== 'user' && msg.content.length > 400);

  const roleColors: Record<string, { bg: string; border: string; badge: string; label: string }> = {
    system   : { bg: '#1e1b4b', border: '#4338ca', badge: '#6366f1', label: 'SYSTEM'    },
    user     : { bg: '#0c1a2e', border: '#1d4ed8', badge: '#3b82f6', label: 'USER'      },
    assistant: { bg: '#0a1f16', border: '#065f46', badge: '#10b981', label: 'ASSISTANT' },
  };
  const c = roleColors[msg.role] ?? roleColors['user'];
  const chars  = msg.content.length;
  const tokens = Math.ceil(chars / 3.5);

  const hasRAGInjection = msg.role === 'user' && msg.content.includes('【THÔNG TIN TỪ CƠ SỞ DỮ LIỆU');
  const ragPart   = hasRAGInjection ? msg.content.split('---\n\nCâu hỏi của tôi:')[0] : null;
  const queryPart = hasRAGInjection ? msg.content.split('---\n\nCâu hỏi của tôi:')[1] : null;

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, overflow: 'hidden', background: c.bg }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        borderBottom: `1px solid ${c.border}40`, background: `${c.border}15`,
      }}>
        <span style={{
          background: c.badge, color: '#fff', fontSize: 10, fontWeight: 800,
          padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace', letterSpacing: '0.08em',
        }}>
          {c.label}
        </span>
        <span style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
          [{index + 1}/{total}]
        </span>
        {hasRAGInjection && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            background: '#7c3aed20', color: '#a78bfa', border: '1px solid #7c3aed30',
            fontWeight: 700,
          }}>
            ⊕ RAG INJECTED
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
          {chars.toLocaleString()} chars · ~{tokens} tokens
        </span>
        <button onClick={() => setCollapsed(v => !v)} style={{
          fontSize: 11, padding: '2px 10px', borderRadius: 6, border: '1px solid #334155',
          background: '#1e293b', color: '#94a3b8', cursor: 'pointer',
        }}>
          {collapsed ? '▼ Mở rộng' : '▲ Thu gọn'}
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: '12px 14px' }}>
          {hasRAGInjection && ragPart && queryPart ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{
                background: '#1e1b4b', border: '1px solid #4338ca40',
                borderRadius: 8, padding: '10px 12px',
              }}>
                <p style={{
                  fontSize: 10, color: '#6366f1', fontWeight: 700, marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  📚 RAG Context (injected from ChromaDB)
                </p>
                <pre style={{
                  fontSize: 12, color: '#a5b4fc', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', lineHeight: 1.6, margin: 0, fontFamily: 'monospace',
                }}>
                  {ragPart.trim()}
                </pre>
              </div>
              <div style={{
                background: '#0f172a', border: '1px solid #1d4ed840',
                borderRadius: 8, padding: '10px 12px',
              }}>
                <p style={{
                  fontSize: 10, color: '#3b82f6', fontWeight: 700, marginBottom: 6,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  💬 Câu hỏi thực sự của người dùng
                </p>
                <pre style={{
                  fontSize: 13, color: '#93c5fd', whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', lineHeight: 1.6, margin: 0,
                }}>
                  {queryPart.trim()}
                </pre>
              </div>
            </div>
          ) : (
            <pre style={{
              fontSize: 12, color: '#cbd5e1', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', lineHeight: 1.65, margin: 0, fontFamily: 'monospace',
            }}>
              {msg.content}
            </pre>
          )}
        </div>
      )}

      {collapsed && (
        <div style={{ padding: '8px 14px' }}>
          <p style={{ fontSize: 12, color: '#475569', fontStyle: 'italic', margin: 0 }}>
            {msg.content.slice(0, 120)}...
          </p>
        </div>
      )}
    </div>
  );
}

// ── Entry Detail ──────────────────────────────────────────────────────────────
function EntryDetail({ entry }: { entry: LogEntry }) {
  const msgs = entry.lmPayload.messages;

  // Detect anomaly: nếu messages toàn là USER → cảnh báo
  const hasOnlyUserMsgs = msgs.every(m => m.role === 'user');
  const hasAssistantMsg = msgs.some(m => m.role === 'assistant');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Model info bar */}
      <div style={{
        background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 11, color: '#475569' }}>Model:</span>
        <code style={{ fontSize: 12, color: '#93c5fd', background: '#1e293b', padding: '2px 8px', borderRadius: 4 }}>
          {entry.modelId ?? entry.lmPayload.model}
        </code>
        <span style={{ fontSize: 11, color: '#475569' }}>temp:</span>
        <code style={{ fontSize: 12, color: '#fbbf24', fontFamily: 'monospace' }}>
          {entry.lmPayload.temperature}
        </code>
        <span style={{ fontSize: 11, color: '#475569' }}>max_tokens:</span>
        <code style={{ fontSize: 12, color: '#fbbf24', fontFamily: 'monospace' }}>
          {entry.lmPayload.max_tokens}
        </code>
      </div>

      {/* Anomaly warning */}
      {hasOnlyUserMsgs && msgs.length > 0 && (
        <div style={{
          background: '#f59e0b10', border: '1px solid #f59e0b30',
          borderRadius: 10, padding: '10px 14px',
        }}>
          <p style={{ fontSize: 12, color: '#f59e0b', margin: 0 }}>
            ⚠️ <strong>Lưu ý:</strong> Payload chỉ có USER messages — không có ASSISTANT message nào.
            Đây là câu hỏi đầu tiên của conversation (bình thường), hoặc lịch sử chat chưa được load đúng.
          </p>
        </div>
      )}

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: 'Messages', value: msgs.length, sub: 'trong payload' },
          { label: 'Est. Tokens', value: `~${entry.stats.estimatedTokens.toLocaleString()}`, sub: 'tổng payload', color: tokenColor(entry.stats.estimatedTokens) },
          { label: 'RAG Chunks', value: entry.stats.ragChunks, sub: `mode: ${entry.ragDebug?.retrievalMode ?? 'off'}` },
          { label: 'Response', value: entry.response ? `${entry.response.durationMs}ms` : '—', sub: entry.response ? `~${entry.response.estimatedTokens} tokens` : 'chưa có' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{
            background: '#0f172a', border: '1px solid #1e293b',
            borderRadius: 10, padding: '12px 14px',
          }}>
            <p style={{ fontSize: 11, color: '#475569', margin: '0 0 4px' }}>{label}</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: color ?? '#f1f5f9', margin: '0 0 2px', fontFamily: 'monospace' }}>
              {value}
            </p>
            <p style={{ fontSize: 11, color: '#334155', margin: 0 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* System Prompt Panel */}
      <SystemPromptPanel entry={entry} />

      {/* ChromaDB detail */}
      {entry.ragDebug && (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid #1e293b',
            background: '#7c3aed10', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase' }}>
              🔍 ChromaDB Retrieval
            </span>
            <span style={{
              fontSize: 11, padding: '1px 8px', borderRadius: 99,
              background: entry.ragDebug.retrievalMode === 'hybrid_filtered' ? '#7c3aed20' : '#1d4ed820',
              color: entry.ragDebug.retrievalMode === 'hybrid_filtered' ? '#a78bfa' : '#60a5fa',
              border: `1px solid ${entry.ragDebug.retrievalMode === 'hybrid_filtered' ? '#7c3aed30' : '#1d4ed830'}`,
              fontWeight: 700, fontFamily: 'monospace',
            }}>
              {entry.ragDebug.retrievalMode === 'hybrid_filtered' ? '⊕ HYBRID' : '◎ SEMANTIC'}
            </span>
          </div>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, fontFamily: 'monospace' }}>
              <div><span style={{ color: '#475569' }}>Query gốc:   </span><span style={{ color: '#94a3b8' }}>{entry.ragDebug.originalQuery}</span></div>
              <div><span style={{ color: '#475569' }}>Query embed: </span><span style={{ color: '#93c5fd' }}>{entry.ragDebug.processedQuery}</span></div>
              <div><span style={{ color: '#475569' }}>Disease:     </span><span style={{ color: '#c4b5fd' }}>{entry.ragDebug.detectedDisease ?? '(none)'}</span></div>
              <div><span style={{ color: '#475569' }}>Threshold:   </span><span style={{ color: '#fbbf24' }}>{entry.ragDebug.threshold}</span></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {entry.ragDebug.candidates.map((c, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '5px 10px', borderRadius: 6,
                  background: c.passed ? '#10b98108' : '#0f172a',
                  border: `1px solid ${c.passed ? '#10b98120' : '#1e293b'}`,
                }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: c.passed ? '#10b981' : '#475569', fontWeight: 700 }}>
                    {c.passed ? '✓' : '✗'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#64748b' }}>
                    d={c.distance.toFixed(4)}
                  </span>
                  <div style={{ flex: 1, fontSize: 11, color: c.passed ? '#86efac' : '#475569' }}>
                    {c.disease_name} — {c.section}
                  </div>
                  <div style={{ width: 60, height: 4, background: '#1e293b', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 99,
                      width: `${Math.min(c.distance, 1) * 100}%`,
                      background: c.passed ? '#10b981' : c.distance < 0.7 ? '#f59e0b' : '#475569',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* All messages */}
      <div>
        <p style={{
          fontSize: 12, color: '#475569', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.07em', marginBottom: 8,
        }}>
          Payload đến LM Studio — {msgs.length} messages
          {!hasAssistantMsg && msgs.length === 1 && (
            <span style={{ color: '#f59e0b', fontWeight: 400, textTransform: 'none',
              letterSpacing: 'normal', marginLeft: 8, fontSize: 11 }}>
              (conversation mới)
            </span>
          )}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {msgs.map((m, i) => (
            <MessageBlock key={i} msg={m} index={i} total={msgs.length} />
          ))}
        </div>
      </div>

      {/* Model response */}
      {entry.response && (
        <div style={{ background: '#0a1f16', border: '1px solid #065f46', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            padding: '8px 14px', borderBottom: '1px solid #065f4640',
            background: '#10b98110', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700, textTransform: 'uppercase' }}>
              ✚ Model Response
            </span>
            <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
              {entry.response.durationMs}ms · ~{entry.response.estimatedTokens} tokens
            </span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <pre style={{
              fontSize: 13, color: '#86efac', whiteSpace: 'pre-wrap',
              wordBreak: 'break-word', lineHeight: 1.65, margin: 0,
            }}>
              {entry.response.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DebugPage() {
  const [list, setList]         = useState<LogListItem[]>([]);
  const [selected, setSelected] = useState<LogEntry | null>(null);
  const [loading, setLoading]   = useState(false);
  const [detailLoading, setDL]  = useState(false);
  const [autoRefresh, setAuto]  = useState(true);
  const [filter, setFilter]     = useState<'all' | 'rag' | 'norag'>('all');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/debug/logs');
      const data = await res.json();
      setList(data.entries ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setDL(true);
    try {
      const res  = await fetch(`/api/debug/logs?id=${id}`);
      const data = await res.json();
      setSelected(data);
    } catch { /* ignore */ }
    finally { setDL(false); }
  }, []);

  const clearLogs = async () => {
    if (!confirm('Xóa toàn bộ logs?')) return;
    await fetch('/api/debug/logs', { method: 'DELETE' });
    setList([]); setSelected(null);
  };

  useEffect(() => { fetchList(); }, [fetchList]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchList, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchList]);

  const filtered = list.filter(e => {
    if (filter === 'rag')   return e.useRag;
    if (filter === 'norag') return !e.useRag;
    return true;
  });

  return (
    <div style={{
      minHeight: '100vh', background: '#030712', color: '#f1f5f9',
      fontFamily: "'Be Vietnam Pro', system-ui, sans-serif",
    }}>
      {/* Top bar */}
      <div style={{
        background: '#0f172a', borderBottom: '1px solid #1e293b',
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 30,
      }}>
        <a href="/" style={{ fontSize: 12, color: '#475569', textDecoration: 'none' }}>← Chat</a>
        <div style={{ width: 1, height: 16, background: '#1e293b' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>🔬 Conversation Inspector</span>
        <span style={{ fontSize: 12, color: '#475569' }}>
          — xem toàn bộ payload gửi đến LM Studio
        </span>
        <div style={{ flex: 1 }} />

        {/* Filter */}
        <div style={{ display: 'flex', background: '#1e293b', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['all', 'rag', 'norag'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12,
              background: filter === f ? '#3b82f6' : 'transparent',
              color: filter === f ? '#fff' : '#64748b',
              fontWeight: filter === f ? 600 : 400,
            }}>
              {f === 'all' ? 'Tất cả' : f === 'rag' ? 'RAG ON' : 'RAG OFF'}
            </button>
          ))}
        </div>

        <button onClick={() => setAuto(v => !v)} style={{
          padding: '5px 12px', borderRadius: 8, border: '1px solid #1e293b',
          background: autoRefresh ? '#10b98115' : '#1e293b', cursor: 'pointer', fontSize: 12,
          color: autoRefresh ? '#10b981' : '#64748b',
        }}>
          {autoRefresh ? '⟳ Auto 5s' : '⟳ Paused'}
        </button>

        <button onClick={fetchList} disabled={loading} style={{
          padding: '5px 12px', borderRadius: 8, border: '1px solid #1e293b',
          background: '#1e293b', cursor: 'pointer', fontSize: 12, color: '#94a3b8',
        }}>
          {loading ? '...' : '↻ Refresh'}
        </button>

        <button onClick={clearLogs} style={{
          padding: '5px 12px', borderRadius: 8, border: '1px solid #7f1d1d40',
          background: '#7f1d1d20', cursor: 'pointer', fontSize: 12, color: '#f87171',
        }}>
          🗑 Xóa logs
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', height: 'calc(100vh - 53px)' }}>

        {/* Left: Log list */}
        <div style={{ borderRight: '1px solid #1e293b', overflowY: 'auto', background: '#0a0f1e' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#334155' }}>
              <p style={{ fontSize: 32, margin: '0 0 8px' }}>📭</p>
              <p style={{ fontSize: 13 }}>Chưa có log nào.<br />Gửi 1 tin nhắn để bắt đầu.</p>
            </div>
          )}
          {filtered.map(item => (
            <button key={item.id} onClick={() => fetchDetail(item.id)} style={{
              width: '100%', textAlign: 'left', padding: '12px 14px',
              background: selected?.id === item.id ? '#1e293b' : 'transparent',
              border: 'none', borderBottom: '1px solid #0f172a',
              cursor: 'pointer', transition: 'background 0.1s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                  {fmt(item.timestamp)}
                </span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
                  background: item.useRag ? '#10b98115' : '#47556915',
                  color: item.useRag ? '#10b981' : '#64748b',
                  border: `1px solid ${item.useRag ? '#10b98120' : '#1e293b'}`,
                }}>
                  {item.useRag ? 'RAG' : 'NO RAG'}
                </span>
                {item.retrievalMode && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
                    background: item.retrievalMode === 'hybrid_filtered' ? '#7c3aed15' : '#1d4ed815',
                    color: item.retrievalMode === 'hybrid_filtered' ? '#a78bfa' : '#60a5fa',
                    border: `1px solid ${item.retrievalMode === 'hybrid_filtered' ? '#7c3aed20' : '#1d4ed820'}`,
                  }}>
                    {item.retrievalMode === 'hybrid_filtered' ? 'HYBRID' : 'SEMANTIC'}
                  </span>
                )}
              </div>

              {item.detectedDisease && (
                <p style={{
                  fontSize: 12, color: '#c4b5fd', margin: '0 0 4px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  🏷 {item.detectedDisease}
                </p>
              )}

              <div style={{ display: 'flex', gap: 12, fontSize: 11, fontFamily: 'monospace' }}>
                <span style={{ color: '#475569' }}>{item.totalMessages} msgs</span>
                <span style={{ color: tokenColor(item.estimatedTokens) }}>~{item.estimatedTokens} tk</span>
                {item.ragChunks > 0 && <span style={{ color: '#10b981' }}>{item.ragChunks} chunks</span>}
                {item.responseDuration && <span style={{ color: '#64748b' }}>{item.responseDuration}ms</span>}
              </div>
            </button>
          ))}
        </div>

        {/* Right: Detail panel */}
        <div style={{ overflowY: 'auto', padding: 24 }}>
          {detailLoading && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: 200, color: '#475569', fontSize: 13,
            }}>
              Đang tải...
            </div>
          )}

          {!selected && !detailLoading && (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: 300, color: '#334155', textAlign: 'center',
            }}>
              <p style={{ fontSize: 40, margin: '0 0 12px' }}>👈</p>
              <p style={{ fontSize: 14, margin: 0 }}>Chọn một session để xem chi tiết</p>
              <p style={{ fontSize: 12, color: '#1e293b', marginTop: 6 }}>
                Tất cả messages, RAG context, chromaDB scores, system prompt info
              </p>
            </div>
          )}

          {selected && !detailLoading && <EntryDetail entry={selected} />}
        </div>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </div>
  );
}