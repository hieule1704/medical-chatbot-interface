'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────
type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp: Date };
type Conversation = { id: number; title: string; message_count: number; updated_at: string };
type User = { id: number; username: string; email: string; full_name: string | null };

// ── Icons ──────────────────────────────────────────────────────────────────
const SendIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const CopyIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const RetryIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>;
const EditIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const MenuIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>;
const CheckIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
const TrashIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const DownloadIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const LogoutIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;

// ── Component ──────────────────────────────────────────────────────────────
export default function Chat() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [exporting, setExporting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Auth check ──
  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json())
      .then(d => {
        if (!d.user) { router.replace('/login'); return; }
        setUser(d.user);
        setAuthLoading(false);
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  // ── Load conversations ──
  useEffect(() => {
    if (!user) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(d => setConversations(d.conversations ?? []));
  }, [user]);

  // ── Load messages when switching conversation ──
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    fetch(`/api/conversations/${activeConvId}`)
      .then(r => r.json())
      .then(d => {
        setMessages((d.messages ?? []).map((m: { id: number; role: 'user' | 'assistant'; content: string; created_at: string }) => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
        })));
      });
  }, [activeConvId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // ── Create new conversation ──
  const createConversation = useCallback(async (title: string): Promise<number> => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const { id } = await res.json();
    // Refresh list
    const list = await fetch('/api/conversations').then(r => r.json());
    setConversations(list.conversations ?? []);
    return id;
  }, []);

  // ── Send message ──
  const sendMessages = useCallback(async (convId: number, msgs: Message[], replaceId?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs.map(({ role, content }) => ({ role, content })),
          conversationId: convId,
        }),
      });

      if (!res.ok) throw new Error();

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let content = '';

      const assistantMsg: Message = {
        id: replaceId ?? `ai-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
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
          if (!line.startsWith('0:')) continue;
          try {
            content += JSON.parse(line.slice(2));
            const captured = content;
            setMessages(prev => prev.map(m => m.id === assistantMsg.id ? { ...m, content: captured } : m));
          } catch { /* skip */ }
        }
      }

      // Auto-rename conversation from first user message (only if still default title)
      const currentConv = conversations.find(c => c.id === convId);
      const isDefaultTitle = !currentConv || currentConv.title === 'Cuộc trò chuyện mới';
      const firstUserMsg = msgs.find(m => m.role === 'user');

      if (isDefaultTitle && firstUserMsg && !replaceId) {
        // Generate smart title: trim to 50 chars, clean up punctuation
        const raw = firstUserMsg.content.trim();
        const smartTitle = raw.length > 50 ? raw.slice(0, 47).trimEnd() + '...' : raw;
        await fetch(`/api/conversations/${convId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: smartTitle }),
        });
      }

      // Refresh conversation list
      fetch('/api/conversations').then(r => r.json()).then(d => setConversations(d.conversations ?? []));

    } catch {
      setError('Không thể kết nối đến LM Studio.');
    } finally {
      setIsLoading(false);
    }
  }, [conversations]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    let convId = activeConvId;
    if (!convId) {
      convId = await createConversation('Cuộc trò chuyện mới');
      setActiveConvId(convId);
    }

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: input.trim(), timestamp: new Date() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    await sendMessages(convId, updated);
  };

  const handleRetry = async (msgId: string) => {
    if (!activeConvId || isLoading) return;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    await sendMessages(activeConvId, messages.slice(0, idx), msgId);
  };

  const submitEdit = async (msgId: string) => {
    if (!activeConvId || !editText.trim() || isLoading) return;
    const idx = messages.findIndex(m => m.id === msgId);
    if (idx === -1) return;
    const edited: Message = { ...messages[idx], content: editText.trim() };
    const newMsgs = [...messages.slice(0, idx), edited];
    setMessages(newMsgs);
    setEditingId(null);
    await sendMessages(activeConvId, newMsgs);
  };

  const handleCopy = async (id: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (s: string) => new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  const formatTime = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-emerald-400 text-sm animate-pulse">Đang tải...</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════ */}
      <aside className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300 flex-shrink-0 ${sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'}`}>

        {/* User profile */}
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{user?.full_name || user?.username}</p>
              <p className="text-xs text-gray-500 truncate">{user?.email}</p>
            </div>
          </div>

          <button
            onClick={async () => {
              const id = await createConversation('Cuộc trò chuyện mới');
              setActiveConvId(id);
              setMessages([]);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-700 hover:border-emerald-500 hover:bg-gray-800/60 text-sm text-gray-400 hover:text-white transition-all duration-200"
          >
            <span className="text-base font-light">+</span>
            <span>Cuộc trò chuyện mới</span>
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-gray-600 text-center mt-10 px-3 leading-relaxed">Chưa có cuộc trò chuyện nào</p>
          )}
          {conversations.map(conv => (
            <div key={conv.id} className={`group flex items-center gap-1 rounded-lg transition-all duration-150 ${conv.id === activeConvId ? 'bg-gray-700/70' : 'hover:bg-gray-800/60'}`}>
              <button onClick={() => setActiveConvId(conv.id)} className="flex-1 min-w-0 text-left px-3 py-2.5">
                <p className={`text-sm truncate leading-snug ${conv.id === activeConvId ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>{conv.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{formatDate(conv.updated_at)} · {conv.message_count} tin</p>
              </button>
              <button onClick={() => deleteConversation(conv.id)} className="opacity-0 group-hover:opacity-100 p-1.5 mr-1.5 rounded text-gray-600 hover:text-red-400 transition-all" title="Xóa">
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer actions */}
        <div className="p-3 border-t border-gray-800 space-y-1">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800 text-sm text-gray-400 hover:text-emerald-400 transition-all disabled:opacity-40"
          >
            <DownloadIcon />
            <span>{exporting ? 'Đang xuất...' : 'Xuất lịch sử CSV'}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800 text-sm text-gray-400 hover:text-red-400 transition-all"
          >
            <LogoutIcon />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* ══ MAIN ══════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/80 backdrop-blur flex-shrink-0">
          <button onClick={() => setSidebarOpen(v => !v)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition-colors">
            <MenuIcon />
          </button>
          <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">✚</div>
          <h1 className="text-sm font-semibold text-white truncate flex-1">
            {conversations.find(c => c.id === activeConvId)?.title ?? 'Medical AI Assistant'}
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 flex-shrink-0">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="hidden sm:inline font-medium">LM Studio</span>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] text-center space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl">🩺</div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-1.5">
                    Xin chào{user?.full_name ? `, ${user.full_name.split(' ').pop()}` : ''}!
                  </h2>
                  <p className="text-gray-400 text-sm max-w-xs leading-relaxed">Hãy mô tả triệu chứng hoặc đặt câu hỏi sức khỏe.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                  {['Tôi bị đau đầu và sốt cao', 'Triệu chứng trầm cảm là gì?', 'Tôi bị mất ngủ kéo dài', 'Chế độ ăn cho người tiểu đường'].map(p => (
                    <button key={p} onClick={() => setInput(p)}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-gray-800 hover:border-emerald-500/40 hover:bg-gray-800/50 text-sm text-gray-400 hover:text-gray-200 transition-all duration-200 leading-snug">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => (
              <div key={m.id} className={`group flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1 ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
                }`}>
                  {m.role === 'user' ? (user?.username?.[0]?.toUpperCase() ?? 'U') : '✚'}
                </div>

                <div className={`flex flex-col min-w-0 max-w-[82%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {editingId === m.id ? (
                    <div className="w-full bg-gray-800 border border-emerald-500/50 rounded-2xl rounded-tr-sm p-3">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        className="w-full bg-transparent text-sm text-gray-100 resize-none outline-none leading-relaxed"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2 mt-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors">Hủy</button>
                        <button onClick={() => submitEdit(m.id)} className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors">Gửi lại</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-sm'
                        : 'bg-gray-800/80 text-gray-100 border border-gray-700/60 rounded-tl-sm'
                    }`}>
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    </div>
                  )}

                  {editingId !== m.id && (
                    <div className={`flex items-center gap-2 mt-1.5 px-1 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="text-xs text-gray-600">{formatTime(m.timestamp)}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleCopy(m.id, m.content)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all" title="Sao chép">
                          {copiedId === m.id ? <><CheckIcon /><span>Đã copy</span></> : <><CopyIcon /><span>Copy</span></>}
                        </button>
                        {m.role === 'assistant' && idx === messages.length - 1 && (
                          <button onClick={() => handleRetry(m.id)} disabled={isLoading} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all disabled:opacity-40">
                            <RetryIcon /><span>Thử lại</span>
                          </button>
                        )}
                        {m.role === 'user' && (
                          <button onClick={() => { setEditingId(m.id); setEditText(m.content); }} disabled={isLoading} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all disabled:opacity-40">
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
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 text-xs flex-shrink-0">✚</div>
                <div className="bg-gray-800/80 border border-gray-700/60 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/40 border border-red-900/60 rounded-xl px-4 py-3">
                ⚠️ {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input */}
        <footer className="flex-shrink-0 px-4 py-4 border-t border-gray-800 bg-gray-900/80 backdrop-blur">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-3 bg-gray-800/70 border border-gray-700 rounded-2xl px-4 py-3 focus-within:border-emerald-500/60 transition-colors duration-200">
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 resize-none outline-none leading-relaxed min-h-[24px] max-h-40"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Nhập triệu chứng hoặc câu hỏi... (Enter để gửi)"
                disabled={isLoading}
                rows={1}
              />
              <button onClick={() => handleSubmit()} disabled={isLoading || !input.trim()}
                className="flex-shrink-0 w-8 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 disabled:text-gray-600 text-white flex items-center justify-center transition-all duration-200">
                <SendIcon />
              </button>
            </div>
            <p className="text-center text-xs text-gray-700 mt-2">AI không thay thế bác sĩ · Shift+Enter để xuống dòng</p>
          </div>
        </footer>
      </div>
    </div>
  );
}