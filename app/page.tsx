'use client';

// ── DIFF: Chỉ liệt kê những phần thay đổi so với page.tsx hiện tại ──────────
//
// VẤN ĐỀ GỐC:
//   userScrolled là React state → bên trong ReadableStream async callback
//   nó bị "stale closure": luôn đọc giá trị tại thời điểm tạo closure (false)
//   dù user đã scroll lên từ lâu → auto-scroll vẫn kéo xuống.
//
// FIX:
//   1. Thêm userScrolledRef = useRef(false) — đọc real-time, không bị stale
//   2. Mỗi khi setUserScrolled(x) thì đồng thời userScrolledRef.current = x
//   3. Streaming loop đọc userScrolledRef.current thay vì userScrolled state
//   4. handleScroll: chỉ set userScrolled=true khi user THỰC SỰ scroll lên
//      (không phụ thuộc isStreamingRef nữa — ref đó gây race condition)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── Types (giữ nguyên) ────────────────────────────────────────────────────
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  ragDebug?: RAGDebugInfo | null;
};
type Conversation = { id: number; title: string; message_count: number; updated_at: string };
type User = { id: number; username: string; email: string; full_name: string | null };
interface RAGCandidate { disease_name: string; section: string; distance: number; passed: boolean; }
interface RAGDebugInfo {
  originalQuery: string; processedQuery: string;
  retrievalMode: 'hybrid_filtered' | 'semantic_full';
  detectedDisease: string | null; threshold: number;
  candidates: RAGCandidate[]; passedCount: number; elapsedMs: number;
}

// ── Icons (giữ nguyên — copy từ file gốc) ────────────────────────────────
const SendIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const CopyIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const RetryIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>;
const EditIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const MenuIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
const CheckIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
const TrashIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const DownloadIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const LogoutIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const BugIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 2l1.5 1.5"/><path d="M14.5 3.5L16 2"/><path d="M9 7.5a3 3 0 0 1 6 0v4a3 3 0 0 1-6 0v-4z"/><path d="M6.5 11H4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h2"/><path d="M17.5 11H20a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/><path d="M9 17v3"/><path d="M15 17v3"/><path d="M4.5 7.5l2.5 2"/><path d="M19.5 7.5L17 9.5"/></svg>;
const FilterIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
const GlobeIcon = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const SunIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const MoonIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const ArrowDownIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>;
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

// ── Theme (giữ nguyên) ────────────────────────────────────────────────────
const DARK_THEME = {
  '--bg-base':       '#030712',
  '--bg-surface':    '#0f172a',
  '--bg-elevated':   '#1e293b',
  '--bg-subtle':     '#1e293b80',
  '--border':        '#1e293b',
  '--border-mid':    '#334155',
  '--text-primary':  '#f1f5f9',
  '--text-secondary':'#94a3b8',
  '--text-muted':    '#475569',
  '--text-faint':    '#1e293b',
  '--accent':        '#10b981',
  '--accent-dim':    '#10b98120',
  '--accent-border': '#10b98130',
  '--user-bubble':   '#1d4ed8',
  '--shadow':        '0 4px 24px #00000060',
};
const LIGHT_THEME = {
  '--bg-base':       '#f8fafc',
  '--bg-surface':    '#ffffff',
  '--bg-elevated':   '#f1f5f9',
  '--bg-subtle':     '#f8fafc80',
  '--border':        '#e2e8f0',
  '--border-mid':    '#cbd5e1',
  '--text-primary':  '#0f172a',
  '--text-secondary':'#475569',
  '--text-muted':    '#94a3b8',
  '--text-faint':    '#e2e8f0',
  '--accent':        '#059669',
  '--accent-dim':    '#05966910',
  '--accent-border': '#05966930',
  '--user-bubble':   '#1d4ed8',
  '--shadow':        '0 4px 24px #0f172a18',
};

// ── RAG Debug Panel (giữ nguyên) ──────────────────────────────────────────
function RAGDebugPanel({ debug, ragEnabled }: { debug: RAGDebugInfo | null | undefined; ragEnabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!ragEnabled) return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--bg-elevated)', width: 'fit-content' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
        RAG: TẮT — model dùng kiến thức nền
      </span>
    </div>
  );
  if (!debug) return null;
  const hasContext  = debug.passedCount > 0;
  const isHybrid    = debug.retrievalMode === 'hybrid_filtered';
  const queryChanged = debug.originalQuery.trim() !== debug.processedQuery.trim();
  return (
    <div style={{ marginTop: 8, borderRadius: 12, border: '1px solid var(--border)',
      background: 'var(--bg-surface)', overflow: 'hidden', maxWidth: 520, fontSize: 12 }}>
      <button onClick={() => setExpanded(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px',
        background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
        color: 'var(--text-secondary)',
      }}>
        <BugIcon />
        <span style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px',
          borderRadius: 4, fontWeight: 700, fontFamily: 'monospace', fontSize: 10,
          background: isHybrid ? '#7c3aed20' : '#1d4ed820',
          color: isHybrid ? '#a78bfa' : '#60a5fa',
          border: `1px solid ${isHybrid ? '#7c3aed30' : '#1d4ed830'}`,
        }}>
          {isHybrid ? <><FilterIcon /> HYBRID</> : <><GlobeIcon /> SEMANTIC</>}
        </span>
        {debug.detectedDisease
          ? <span style={{ color: '#c4b5fd', fontWeight: 500, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{debug.detectedDisease}</span>
          : <span style={{ color: 'var(--text-muted)', flex: 1, textAlign: 'left', fontFamily: 'monospace' }}>no disease detected</span>
        }
        <span style={{
          padding: '2px 8px', borderRadius: 99, fontWeight: 700, flexShrink: 0,
          background: hasContext ? '#10b98115' : '#f59e0b10',
          color: hasContext ? '#10b981' : '#f59e0b',
          border: `1px solid ${hasContext ? '#10b98125' : '#f59e0b20'}`,
        }}>
          {hasContext ? `✓ ${debug.passedCount} docs` : '⚠ fallback'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>{debug.elapsedMs}ms</span>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, marginBottom: 6 }}>Query pipeline</p>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'monospace', fontSize: 11 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>raw:</span>
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{debug.originalQuery}</span>
              </div>
              {queryChanged && <>
                <div style={{ height: 1, background: 'var(--border)' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#60a5fa', flexShrink: 0 }}>→ embed:</span>
                  <span style={{ color: '#93c5fd', wordBreak: 'break-all' }}>{debug.processedQuery}</span>
                </div>
              </>}
              {debug.detectedDisease && <>
                <div style={{ height: 1, background: 'var(--border)' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ color: '#a78bfa', flexShrink: 0 }}>filter:</span>
                  <span style={{ color: '#c4b5fd' }}>disease_name = &quot;{debug.detectedDisease}&quot;</span>
                </div>
              </>}
            </div>
          </div>
          <div>
            <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: 10, marginBottom: 6 }}>
              ChromaDB results (threshold = {debug.threshold})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {debug.candidates.map((c, i) => (
                <div key={i} style={{
                  borderRadius: 8, padding: '7px 10px',
                  background: c.passed ? '#10b98108' : 'var(--bg-elevated)',
                  border: `1px solid ${c.passed ? '#10b98120' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, color: c.passed ? '#10b981' : 'var(--text-muted)', fontSize: 11 }}>{c.disease_name}</span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>— {c.section}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, flexShrink: 0, fontFamily: 'monospace', fontSize: 11 }}>
                      <span style={{ color: c.passed ? '#10b981' : 'var(--text-muted)' }}>{c.distance.toFixed(4)}</span>
                      <span style={{ fontWeight: 700, color: c.passed ? '#10b981' : 'var(--text-muted)' }}>{c.passed ? '✓' : '✗'}</span>
                    </div>
                  </div>
                  <div style={{ height: 3, width: '100%', background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
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
          {!hasContext && (
            <div style={{ borderRadius: 8, padding: '7px 10px', background: '#f59e0b08', border: '1px solid #f59e0b20' }}>
              <p style={{ color: '#f59e0b', fontSize: 11 }}>
                Không có chunk nào vượt ngưỡng {debug.threshold}. Model trả lời từ kiến thức nền.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Service Health (giữ nguyên) ───────────────────────────────────────────
interface ServiceStatus { ok: boolean; latencyMs: number; name: string; }
interface HealthData {
  ok: boolean;
  services: { lmStudio: ServiceStatus; embeddingApi: ServiceStatus; };
  timestamp: number;
}
type HealthState = 'checking' | 'ok' | 'degraded' | 'down';

function useServiceHealth(intervalMs = 15000) {
  const [health, setHealth]     = useState<HealthData | null>(null);
  const [state, setState]       = useState<HealthState>('checking');
  const [expanded, setExpanded] = useState(false);
  const check = useCallback(async () => {
    try {
      const res  = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json() as HealthData;
      setHealth(data);
      if (data.ok) setState('ok');
      else if (data.services.lmStudio.ok || data.services.embeddingApi.ok) setState('degraded');
      else setState('down');
    } catch { setState('down'); setHealth(null); }
  }, []);
  useEffect(() => {
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [check, intervalMs]);
  return { health, state, expanded, setExpanded, check };
}

function StatusIndicator() {
  const { health, state, expanded, setExpanded, check } = useServiceHealth(15000);
  const cfg: Record<HealthState, { dot: string; pulse: boolean; label: string; bg: string; border: string }> = {
    checking: { dot: '#94a3b8', pulse: false, label: 'Đang kiểm tra...', bg: 'var(--bg-elevated)', border: 'var(--border)'    },
    ok      : { dot: '#10b981', pulse: true,  label: 'Hệ thống OK',      bg: '#10b98108',         border: '#10b98125'         },
    degraded: { dot: '#f59e0b', pulse: true,  label: 'Một dịch vụ lỗi',  bg: '#f59e0b08',         border: '#f59e0b25'         },
    down    : { dot: '#ef4444', pulse: false, label: 'Mất kết nối',       bg: '#ef444408',         border: '#ef444425'         },
  };
  const c = cfg[state];
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setExpanded(v => !v)} title="Trạng thái dịch vụ"
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px',
          borderRadius: 99, cursor: 'pointer', border: `1px solid ${c.border}`,
          background: c.bg, transition: 'all 0.2s' }}>
        <span style={{ position: 'relative', width: 8, height: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: c.dot,
            animation: c.pulse ? 'healthPulse 2s ease-in-out infinite' : 'none' }} />
          {c.pulse && <span style={{ position: 'absolute', inset: -2, borderRadius: '50%',
            background: c.dot, opacity: 0.3, animation: 'healthRing 2s ease-in-out infinite' }} />}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: c.dot, whiteSpace: 'nowrap' }}>{c.label}</span>
      </button>
      {expanded && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setExpanded(false)} />
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 264,
            zIndex: 50, background: 'var(--bg-surface)', border: '1px solid var(--border-mid)',
            borderRadius: 12, boxShadow: 'var(--shadow)', overflow: 'hidden',
            animation: 'dropIn 0.15s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Trạng thái dịch vụ</span>
              <button onClick={(e) => { e.stopPropagation(); check(); }}
                style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>
                ↻ Refresh
              </button>
            </div>
            <div style={{ padding: '6px 0' }}>
              {health ? (
                [
                  { icon: '🤖', label: 'LM Studio',    data: health.services.lmStudio     },
                  { icon: '🧬', label: 'Embedding API', data: health.services.embeddingApi },
                ].map(({ icon, label, data }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', padding: '7px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{icon}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {data.ok && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{data.latencyMs}ms</span>}
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99,
                        background: data.ok ? '#10b98115' : '#ef444415',
                        color: data.ok ? '#10b981' : '#ef4444',
                        border: `1px solid ${data.ok ? '#10b98125' : '#ef444425'}` }}>
                        {data.ok ? '● ONLINE' : '● OFFLINE'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '12px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  Không thể kết nối server
                </div>
              )}
            </div>
            {health && (
              <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border)',
                fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                Cập nhật: {new Date(health.timestamp).toLocaleTimeString('vi-VN')} · tự động mỗi 15s
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ── Main Component ────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
export default function Chat() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [useRag, setUseRag] = useState(true);
  const [showDebug, setShowDebug] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ── SCROLL FIX: dùng ref thay vì state để tránh stale closure ────────────
  // userScrolledRef.current = true → user đã scroll lên, KHÔNG auto-scroll
  // userScrolledRef.current = false → user ở cuối, auto-scroll bình thường
  const userScrolledRef  = useRef(false);
  // Để sync với React render (cho nút "Về cuối")
  const [userScrolled, _setUserScrolled] = useState(false);

  // Helper: set cả ref và state cùng lúc
  const setUserScrolled = useCallback((val: boolean) => {
    userScrolledRef.current = val;
    _setUserScrolled(val);
  }, []);

  const mainRef         = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);

  // ── Apply theme ──────────────────────────────────────────────────────────
  useEffect(() => {
    const theme = darkMode ? DARK_THEME : LIGHT_THEME;
    const root = document.documentElement;
    Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
  }, [darkMode]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved) setDarkMode(saved === 'dark');
  }, []);
  useEffect(() => {
    localStorage.setItem('theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // ── SCROLL FIX: detect user scroll ───────────────────────────────────────
  // Logic đơn giản hơn: đo khoảng cách từ đáy
  // Nếu > THRESHOLD → user đã scroll lên → lock auto-scroll
  // Nếu <= THRESHOLD → user đang ở cuối → unlock
  const SCROLL_THRESHOLD = 80; // px từ đáy

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const scrolledAway   = distFromBottom > SCROLL_THRESHOLD;
      // Luôn update ref ngay lập tức (không qua React batching)
      userScrolledRef.current = scrolledAway;
      // State chỉ dùng để render nút "Về cuối"
      _setUserScrolled(scrolledAway);
      setShowScrollBtn(scrolledAway);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []); // empty deps — chỉ mount 1 lần, đọc ref trực tiếp nên không cần deps

  // Helper scroll xuống
  const scrollToBottom = useCallback((force = false) => {
    if (force || !userScrolledRef.current) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []); // không cần userScrolled trong deps vì đọc ref

  // Scroll khi thêm message mới (non-streaming, chỉ khi user ở cuối)
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  // ── Auth & data loading ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return; }
      setUser(d.user); setAuthLoading(false);
    }).catch(() => router.replace('/login'));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/conversations').then(r => r.json()).then(d => setConversations(d.conversations ?? []));
  }, [user]);

  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    fetch(`/api/conversations/${activeConvId}`).then(r => r.json()).then(d => {
      setMessages((d.messages ?? []).map((m: { id: number; role: 'user' | 'assistant'; content: string; created_at: string }) => ({
        id: String(m.id), role: m.role, content: m.content,
        timestamp: new Date(m.created_at), ragDebug: null,
      })));
    });
  }, [activeConvId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // ── Conversations CRUD ───────────────────────────────────────────────────
  const createConversation = useCallback(async (title: string): Promise<number> => {
    const res = await fetch('/api/conversations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const { id } = await res.json();
    const list = await fetch('/api/conversations').then(r => r.json());
    setConversations(list.conversations ?? []);
    return id;
  }, []);

  // ── SCROLL FIX: sendMessages dùng ref, không dùng state ─────────────────
  const sendMessages = useCallback(async (convId: number, msgs: Message[], replaceId?: string) => {
    setIsLoading(true); setError(null);

    // Reset scroll khi gửi tin mới → snap xuống cuối
    setUserScrolled(false);
    setTimeout(() => bottomAnchorRef.current?.scrollIntoView({ behavior: 'instant' }), 0);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs.map(({ role, content }) => ({ role, content })),
          conversationId: convId,
          useRag,
        }),
      });
      if (!res.ok) throw new Error();

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let content = '';
      let parsedDebug: RAGDebugInfo | null = null;
      let tokenCount = 0;

      const assistantMsg: Message = {
        id: replaceId ?? `ai-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        ragDebug: null,
      };
      setMessages(prev =>
        replaceId
          ? prev.map(m => m.id === replaceId ? assistantMsg : m)
          : [...prev, assistantMsg]
      );

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('d:')) {
            try {
              const p = JSON.parse(line.slice(2));
              if (p.ragDebug) parsedDebug = p.ragDebug;
            } catch { /* skip */ }
            continue;
          }
          if (!line.startsWith('0:')) continue;
          try {
            content += JSON.parse(line.slice(2));
            tokenCount++;
            const c = content;
            const d = parsedDebug;
            setMessages(prev =>
              prev.map(m => m.id === assistantMsg.id ? { ...m, content: c, ragDebug: d } : m)
            );

            // ── SCROLL FIX: đọc REF, không đọc state ─────────────────────
            // Mỗi 8 token, nếu user chưa scroll lên → auto-scroll xuống cuối
            if (tokenCount % 8 === 0 && !userScrolledRef.current) {
              bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
          } catch { /* skip */ }
        }
      }

      // Final scroll khi stream kết thúc
      if (!userScrolledRef.current) {
        setTimeout(() => bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }

      // Auto-rename conversation
      const currentConv = conversations.find(c => c.id === convId);
      const firstUserMsg = msgs.find(m => m.role === 'user');
      if ((!currentConv || currentConv.title === 'Cuộc trò chuyện mới') && firstUserMsg && !replaceId) {
        const raw = firstUserMsg.content.trim();
        await fetch(`/api/conversations/${convId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: raw.length > 50 ? raw.slice(0, 47) + '...' : raw }),
        });
      }
      fetch('/api/conversations').then(r => r.json()).then(d => setConversations(d.conversations ?? []));

    } catch {
      setError('Không thể kết nối đến LM Studio.');
    } finally {
      setIsLoading(false);
    }
  }, [conversations, useRag, setUserScrolled]); // setUserScrolled stable (useCallback)

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation('Cuộc trò chuyện mới');
      setActiveConvId(convId);
    }
    const userMsg: Message = {
      id: `u-${Date.now()}`, role: 'user',
      content: input.trim(), timestamp: new Date(),
    };
    const updated = [...messages, userMsg];
    setMessages(updated); setInput('');
    await sendMessages(convId, updated);
  };

  const handleRetry = async (msgId: string) => {
    if (!activeConvId || isLoading) return;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx !== -1) await sendMessages(activeConvId, messages.slice(0, idx), msgId);
  };

  const submitEdit = async (msgId: string) => {
    if (!activeConvId || !editText.trim() || isLoading) return;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const newMsgs = [...messages.slice(0, idx), { ...messages[idx], content: editText.trim() }];
    setMessages(newMsgs); setEditingId(null);
    await sendMessages(activeConvId, newMsgs);
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id); setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteConversation = async (id: number) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/export');
      if (!res.ok) { alert('Chưa có lịch sử để xuất.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lich-su-${user?.username}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const fmt = (s: string) => new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const fmtT = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  const s = {
    base:    { background: 'var(--bg-base)',    color: 'var(--text-primary)',    transition: 'background 0.25s, color 0.25s' },
    surface: { background: 'var(--bg-surface)', borderRight: '1px solid var(--border)' },
    header:  { background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', backdropFilter: 'blur(12px)' },
    input:   { background: 'var(--bg-elevated)', border: '1px solid var(--border-mid)', color: 'var(--text-primary)', outline: 'none' },
    btn: (active: boolean, activeStyle: object) => ({
      border: `1px solid ${active ? 'transparent' : 'var(--border-mid)'}`,
      background: active ? undefined : 'var(--bg-elevated)',
      color: active ? undefined : 'var(--text-muted)',
      cursor: 'pointer', transition: 'all 0.15s',
      ...(active ? activeStyle : {}),
    }),
  };

  if (authLoading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--accent)', fontSize: 14, animation: 'pulse 1.5s infinite' }}>Đang tải...</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', ...s.base }}>

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════ */}
      <aside style={{
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        width: sidebarOpen ? 256 : 0, overflow: 'hidden',
        transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
        ...s.surface,
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || user?.username}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</p>
            </div>
          </div>
          <button
            onClick={async () => { const id = await createConversation('Cuộc trò chuyện mới'); setActiveConvId(id); setMessages([]); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10, border: '1.5px dashed var(--border-mid)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, transition: 'all 0.15s' }}>
            <span style={{ fontSize: 16, fontWeight: 300, lineHeight: 1 }}>+</span>
            <span>Cuộc trò chuyện mới</span>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {conversations.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 40, padding: '0 12px', lineHeight: 1.6 }}>Chưa có cuộc trò chuyện nào</p>
          )}
          {conversations.map(conv => (
            <div key={conv.id} style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, background: conv.id === activeConvId ? 'var(--bg-elevated)' : 'transparent', transition: 'background 0.15s' }}>
              <button onClick={() => setActiveConvId(conv.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '9px 12px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                <p style={{ fontSize: 13, color: conv.id === activeConvId ? 'var(--text-primary)' : 'var(--text-secondary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.4 }}>{conv.title}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{fmt(conv.updated_at)} · {conv.message_count} tin</p>
              </button>
              <button onClick={() => deleteConversation(conv.id)}
                style={{ padding: 6, marginRight: 6, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={handleExport} disabled={exporting} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, width: '100%', textAlign: 'left', transition: 'color 0.15s' }}>
            <DownloadIcon /><span>{exporting ? 'Đang xuất...' : 'Xuất lịch sử CSV'}</span>
          </button>
          <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, width: '100%', textAlign: 'left', transition: 'color 0.15s' }}>
            <LogoutIcon /><span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* ══ MAIN ════════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>

        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexShrink: 0, ...s.header }}>
          <button onClick={() => setSidebarOpen(v => !v)} style={{ padding: 6, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><MenuIcon /></button>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>✚</div>
          <h1 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
            {conversations.find(c => c.id === activeConvId)?.title ?? 'Medical AI Assistant'}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setDarkMode(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 99, fontSize: 12, fontWeight: 500, ...s.btn(false, {}) }}>
              {darkMode ? <SunIcon /> : <MoonIcon />}
            </button>
            <button onClick={() => setShowDebug(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600, ...s.btn(showDebug, { background: '#7c3aed20', color: '#a78bfa', border: '1px solid #7c3aed30' }) }}>
              <BugIcon /><span>Debug</span>
            </button>
            <button onClick={() => setUseRag(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, ...s.btn(useRag, { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }) }}>
              {useRag ? '● RAG BẬT' : '○ RAG TẮT'}
            </button>
          </div>
          <StatusIndicator />
        </header>

        {/* Messages area */}
        <main ref={mainRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          <div style={{ maxWidth: 768, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

            {messages.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '55vh', textAlign: 'center', gap: 20 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🩺</div>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
                    Xin chào{user?.full_name ? `, ${user.full_name.split(' ').pop()}` : ''}!
                  </h2>
                  <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, maxWidth: 280, lineHeight: 1.6 }}>Hãy mô tả triệu chứng hoặc đặt câu hỏi sức khỏe.</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%', maxWidth: 420 }}>
                  {[
                    'Triệu chứng của viêm amidan cấp là gì?',
                    'Phác đồ điều trị viêm tai giữa ở trẻ em',
                    'Xốp xơ tai là bệnh gì? Nguyên nhân và điều trị?',
                    'Liệt dây thần kinh VII ngoại biên điều trị thế nào?',
                  ].map(p => (
                    <button key={p} onClick={() => setInput(p)} style={{
                      textAlign: 'left', padding: '10px 14px', borderRadius: 12,
                      border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, lineHeight: 1.5,
                      transition: 'all 0.15s',
                    }}>{p}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={m.id} style={{ display: 'flex', gap: 12, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: m.role === 'user' ? 'var(--user-bubble)' : 'var(--accent-dim)',
                  color: m.role === 'user' ? '#fff' : 'var(--accent)',
                  border: m.role === 'assistant' ? '1px solid var(--accent-border)' : 'none',
                }}>
                  {m.role === 'user' ? (user?.username?.[0]?.toUpperCase() ?? 'U') : '✚'}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: '82%', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  {editingId === m.id ? (
                    <div style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--accent-border)', borderRadius: 16, padding: 12 }}>
                      <textarea value={editText} onChange={e => setEditText(e.target.value)}
                        style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, resize: 'none', lineHeight: 1.6 }}
                        rows={3} autoFocus />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                        <button onClick={() => setEditingId(null)} style={{ padding: '4px 12px', fontSize: 12, color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}>Hủy</button>
                        <button onClick={() => submitEdit(m.id)} style={{ padding: '4px 12px', fontSize: 12, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Gửi lại</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: '12px 16px', borderRadius: 16, fontSize: 14, lineHeight: 1.65,
                      background: m.role === 'user' ? 'var(--user-bubble)' : 'var(--bg-elevated)',
                      color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                      border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                      borderBottomRightRadius: m.role === 'user' ? 4 : 16,
                      borderBottomLeftRadius: m.role === 'assistant' ? 4 : 16,
                    }}>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                    </div>
                  )}

                  {m.role === 'assistant' && showDebug && editingId !== m.id && (
                    <RAGDebugPanel debug={m.ragDebug} ragEnabled={useRag} />
                  )}

                  {editingId !== m.id && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 4, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtT(m.timestamp)}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, opacity: 0 }}
                        className="msg-actions"
                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                        <button onClick={() => handleCopy(m.id, m.content)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>
                          {copiedId === m.id ? <><CheckIcon /><span>Đã copy</span></> : <><CopyIcon /><span>Copy</span></>}
                        </button>
                        {m.role === 'assistant' && idx === messages.length - 1 && (
                          <button onClick={() => handleRetry(m.id)} disabled={isLoading}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, opacity: isLoading ? 0.4 : 1 }}>
                            <RetryIcon /><span>Thử lại</span>
                          </button>
                        )}
                        {m.role === 'user' && (
                          <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} disabled={isLoading}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, opacity: isLoading ? 0.4 : 1 }}>
                            <EditIcon /><span>Sửa</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>✚</div>
                <div style={{ padding: '12px 16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 16, borderBottomLeftRadius: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
                  {[0, 150, 300].map(delay => (
                    <span key={delay} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: `bounce 1s ${delay}ms infinite` }} />
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f87171', fontSize: 14, background: '#7f1d1d20', border: '1px solid #7f1d1d40', borderRadius: 12, padding: '10px 16px' }}>
                ⚠️ {error}
              </div>
            )}

            <div ref={bottomAnchorRef} style={{ height: 1 }} />
          </div>

          {/* Nút "Về cuối" — chỉ hiện khi user đã scroll lên */}
          {showScrollBtn && (
            <button
              onClick={() => {
                setUserScrolled(false);
                bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{
                position: 'sticky', bottom: 16, left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 99,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-mid)',
                color: 'var(--text-secondary)', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                boxShadow: 'var(--shadow)', zIndex: 10,
                marginTop: -48,
                animation: 'fadeIn 0.2s ease',
              }}
            >
              <ArrowDownIcon /> Về cuối
            </button>
          )}
        </main>

        {/* Input */}
        <footer style={{ flexShrink: 0, padding: '16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <div style={{ maxWidth: 768, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, ...s.input, borderRadius: 18, padding: '12px 16px' }}>
              <textarea ref={textareaRef}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 14, resize: 'none', lineHeight: 1.6, minHeight: 24, maxHeight: 160, fontFamily: 'inherit' }}
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Nhập triệu chứng hoặc câu hỏi... (Enter để gửi)"
                disabled={isLoading} rows={1} />
              <button onClick={() => handleSubmit()} disabled={isLoading || !input.trim()}
                style={{
                  flexShrink: 0, width: 34, height: 34, borderRadius: 10, border: 'none',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s',
                  background: isLoading || !input.trim() ? 'var(--bg-elevated)' : 'var(--accent)',
                  color: isLoading || !input.trim() ? 'var(--text-muted)' : '#fff',
                }}>
                <SendIcon />
              </button>
            </div>
            <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              AI không thay thế bác sĩ · Shift+Enter để xuống dòng
            </p>
          </div>
        </footer>
      </div>

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Be Vietnam Pro', system-ui, sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border-mid); border-radius: 4px; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes bounce { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-4px); } }
        @keyframes fadeIn { from { opacity:0; transform:translateX(-50%) translateY(8px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        .msg-actions { transition: opacity 0.15s; }
        .msg-actions:hover { opacity: 1 !important; }
        @keyframes healthPulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.7; transform:scale(0.85); } }
        @keyframes healthRing  { 0% { transform:scale(1); opacity:0.4; } 100% { transform:scale(2.5); opacity:0; } }
        @keyframes dropIn      { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}