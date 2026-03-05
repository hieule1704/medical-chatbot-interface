'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
};

// ── Icons ──────────────────────────────────────────────────────────────────
const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);
const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const RetryIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
  </svg>
);
const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
);

// ── Main Component ─────────────────────────────────────────────────────────
export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId) ?? null;
  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  }, [input]);

  useEffect(() => {
    if (editingId && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = editTextareaRef.current.scrollHeight + 'px';
    }
  }, [editingId]);

  // ── API call helper ──
  const sendMessages = useCallback(async (
    convId: string,
    msgs: Message[],
    replaceAssistantId?: string
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: msgs.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      const assistantMessage: Message = {
        id: replaceAssistantId ?? (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      };

      if (replaceAssistantId) {
        // Replace existing assistant message (retry)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? { ...c, messages: c.messages.map((m) => m.id === replaceAssistantId ? assistantMessage : m) }
              : c
          )
        );
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId ? { ...c, messages: [...c.messages, assistantMessage] } : c
          )
        );
      }

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (line.startsWith('0:')) {
              try {
                assistantContent += JSON.parse(line.slice(2));
                const captured = assistantContent;
                setConversations((prev) =>
                  prev.map((c) =>
                    c.id === convId
                      ? { ...c, messages: c.messages.map((m) => m.id === assistantMessage.id ? { ...m, content: captured } : m) }
                      : c
                  )
                );
              } catch { /* skip */ }
            }
          }
        }
      }
    } catch (err) {
      setError('Không thể kết nối đến LM Studio. Hãy kiểm tra server đã chạy chưa.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Submit new message ──
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    let convId = activeConvId;
    let baseMessages: Message[] = [];

    if (!convId) {
      const newConv: Conversation = {
        id: Date.now().toString(),
        title: input.trim().slice(0, 45),
        messages: [],
        createdAt: new Date(),
      };
      setConversations((prev) => [newConv, ...prev]);
      setActiveConvId(newConv.id);
      convId = newConv.id;
    } else {
      baseMessages = activeConv?.messages ?? [];
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...baseMessages, userMessage];

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              title: c.messages.length === 0 ? input.trim().slice(0, 45) : c.title,
              messages: updatedMessages,
            }
          : c
      )
    );
    setInput('');
    await sendMessages(convId, updatedMessages);
  };

  // ── Retry last assistant message ──
  const handleRetry = async (assistantMsgId: string) => {
    if (!activeConvId || isLoading) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === assistantMsgId);
    if (idx === -1) return;
    const msgsBeforeAssistant = conv.messages.slice(0, idx);
    await sendMessages(activeConvId, msgsBeforeAssistant, assistantMsgId);
  };

  // ── Edit user message ──
  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditText(msg.content);
  };

  const submitEdit = async (msgId: string) => {
    if (!activeConvId || !editText.trim() || isLoading) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;

    const editedMessage: Message = { ...conv.messages[idx], content: editText.trim(), timestamp: new Date() };
    // Keep only messages up to and including the edited one, drop assistant reply after it
    const newMessages = [...conv.messages.slice(0, idx), editedMessage];

    setConversations((prev) =>
      prev.map((c) => c.id === activeConvId ? { ...c, messages: newMessages } : c)
    );
    setEditingId(null);
    setEditText('');
    await sendMessages(activeConvId, newMessages);
  };

  // ── Copy to clipboard ──
  const handleCopy = async (msgId: string, content: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(msgId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Delete conversation ──
  const deleteConv = (convId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConvId === convId) setActiveConvId(null);
  };

  const createNewConversation = () => {
    const newConv: Conversation = {
      id: Date.now().toString(),
      title: 'Cuộc trò chuyện mới',
      messages: [],
      createdAt: new Date(),
    };
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setError(null);
  };

  const formatTime = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

  // ── Render ──
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════════ */}
      <aside className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300 flex-shrink-0 ${sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'}`}>
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">✚</div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">MedAI Assistant</p>
              <p className="text-xs text-emerald-400 truncate">medical-chatbot-v4</p>
            </div>
          </div>
          <button
            onClick={createNewConversation}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-700 hover:border-emerald-500 hover:bg-gray-800/60 text-sm text-gray-400 hover:text-white transition-all duration-200"
          >
            <span className="text-base font-light">+</span>
            <span>Cuộc trò chuyện mới</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {conversations.length === 0 && (
            <p className="text-xs text-gray-600 text-center mt-10 px-3 leading-relaxed">Chưa có cuộc trò chuyện nào. Hãy bắt đầu!</p>
          )}
          {conversations.map((conv) => (
            <div key={conv.id} className={`group flex items-center gap-1 rounded-lg transition-all duration-150 ${conv.id === activeConvId ? 'bg-gray-700/70' : 'hover:bg-gray-800/60'}`}>
              <button onClick={() => setActiveConvId(conv.id)} className="flex-1 min-w-0 text-left px-3 py-2.5">
                <p className={`text-sm truncate leading-snug ${conv.id === activeConvId ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>{conv.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{formatDate(conv.createdAt)} · {conv.messages.length} tin</p>
              </button>
              <button
                onClick={() => deleteConv(conv.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 mr-1.5 rounded text-gray-600 hover:text-red-400 transition-all"
                title="Xóa"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-800">
          <p className="text-xs text-gray-600 text-center">Đồ án tốt nghiệp 2026</p>
        </div>
      </aside>

      {/* ══ MAIN ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/80 backdrop-blur flex-shrink-0">
          <button onClick={() => setSidebarOpen((v) => !v)} className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-500 hover:text-white transition-colors">
            <MenuIcon />
          </button>
          <h1 className="text-sm font-semibold text-white truncate flex-1">
            {activeConv ? activeConv.title : 'Medical AI Assistant'}
          </h1>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 flex-shrink-0">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="hidden sm:inline font-medium">LM Studio</span>
          </div>
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

            {/* Empty state */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[55vh] text-center space-y-5">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl">🩺</div>
                <div>
                  <h2 className="text-xl font-semibold text-white mb-1.5">Xin chào! Tôi là Bác sĩ AI</h2>
                  <p className="text-gray-400 text-sm max-w-xs leading-relaxed">Hãy mô tả triệu chứng hoặc đặt câu hỏi sức khỏe của bạn.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
                  {['Tôi bị đau đầu và sốt cao', 'Triệu chứng trầm cảm là gì?', 'Tôi bị mất ngủ kéo dài', 'Chế độ ăn cho người tiểu đường'].map((p) => (
                    <button key={p} onClick={() => setInput(p)}
                      className="text-left px-3.5 py-2.5 rounded-xl border border-gray-800 hover:border-emerald-500/40 hover:bg-gray-800/50 text-sm text-gray-400 hover:text-gray-200 transition-all duration-200 leading-snug">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message list */}
            {messages.map((m, idx) => (
              <div key={m.id} className={`group flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                {/* Avatar */}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-1 ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-400'
                }`}>
                  {m.role === 'user' ? 'B' : '✚'}
                </div>

                {/* Content */}
                <div className={`flex flex-col min-w-0 max-w-[82%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>

                  {/* Edit mode */}
                  {editingId === m.id ? (
                    <div className="w-full bg-gray-800 border border-emerald-500/50 rounded-2xl rounded-tr-sm p-3">
                      <textarea
                        ref={editTextareaRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full bg-transparent text-sm text-gray-100 resize-none outline-none leading-relaxed"
                        rows={3}
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

                  {/* Timestamp + Action buttons */}
                  {editingId !== m.id && (
                    <div className={`flex items-center gap-2 mt-1.5 px-1 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="text-xs text-gray-600">{formatTime(m.timestamp)}</span>

                      {/* Actions — visible on hover */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        {/* Copy */}
                        <button
                          onClick={() => handleCopy(m.id, m.content)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all"
                          title="Sao chép"
                        >
                          {copiedId === m.id ? <><CheckIcon /><span>Đã copy</span></> : <><CopyIcon /><span>Copy</span></>}
                        </button>

                        {/* Retry — only for assistant */}
                        {m.role === 'assistant' && idx === messages.length - 1 && (
                          <button
                            onClick={() => handleRetry(m.id)}
                            disabled={isLoading}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all disabled:opacity-40"
                            title="Thử lại"
                          >
                            <RetryIcon /><span>Thử lại</span>
                          </button>
                        )}

                        {/* Edit — only for user */}
                        {m.role === 'user' && (
                          <button
                            onClick={() => startEdit(m)}
                            disabled={isLoading}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all disabled:opacity-40"
                            title="Chỉnh sửa"
                          >
                            <EditIcon /><span>Sửa</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
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
                <span>⚠️</span><span>{error}</span>
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
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Nhập triệu chứng hoặc câu hỏi... (Enter để gửi)"
                disabled={isLoading}
                rows={1}
              />
              <button
                onClick={() => handleSubmit()}
                disabled={isLoading || !input.trim()}
                className="flex-shrink-0 w-8 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-700 disabled:text-gray-600 text-white flex items-center justify-center transition-all duration-200"
              >
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