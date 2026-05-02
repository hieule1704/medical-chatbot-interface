# 🩺 Vietnamese Medical AI Chatbot

> **Đồ án Tốt nghiệp** — Khoa Công nghệ Thông tin — Trường Đại học An Giang — 2026  
> Xây dựng chatbot tư vấn y tế tiếng Việt chuyên biệt lĩnh vực **Tai Mũi Họng (ENT)** bằng kỹ thuật QLoRA Fine-tuning kết hợp RAG Pipeline

---

## 📸 Demo

![Medical AI Assistant Interface](./public/demo.png)

---

## 📋 Tổng Quan

Dự án nghiên cứu và triển khai một hệ thống chatbot y tế tiếng Việt hoàn chỉnh theo hai hướng song song:

**1. Fine-tuning Pipeline** — Huấn luyện đặc biệt hóa LLM trên dữ liệu y tế tiếng Việt thông qua 5 thí nghiệm (V1–V4) với hai kiến trúc model và hai kỹ thuật huấn luyện (SFT + DPO).

**2. RAG Pipeline** — Xây dựng hệ thống Retrieval-Augmented Generation với Two-stage Hybrid Retrieval để cung cấp kiến thức y khoa chuẩn từ Hướng dẫn Bộ Y Tế, khắc phục giới hạn hallucination của LLM.

---

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                          │
│           Next.js 16 + TypeScript + Be Vietnam Pro          │
│     Dark/Light Mode · Smart Scroll · RAG Debug Panel        │
└────────────────────────┬────────────────────────────────────┘
                         │ SSE Streaming
┌────────────────────────▼────────────────────────────────────┐
│                   NEXT.JS API LAYER                         │
│                  /api/chat  /api/health                     │
│         Context Window Truncation (12 msgs max)             │
└──────────┬─────────────────────────────┬────────────────────┘
           │                             │
┌──────────▼──────────┐    ┌─────────────▼──────────────────┐
│    LM Studio        │    │        RAG PIPELINE             │
│  LLaMA 3 8B         │    │                                 │
│  medical-chatbot-v4 │    │  ┌─────────────────────────┐   │
│  (QLoRA + DPO)      │    │  │  Embedding API (FastAPI) │   │
│  port 1234          │    │  │  vietnamese-bi-encoder   │   │
│                     │    │  │  port 8002               │   │
│  Built-in System    │    │  └───────────┬─────────────┘   │
│  Prompt (Triage +   │    │              │ vectors          │
│  Red Flags +        │    │  ┌───────────▼─────────────┐   │
│  Guardrails)        │    │  │     ChromaDB             │   │
└─────────────────────┘    │  │   medical_ent collection │   │
                           │  │   252 ENT knowledge docs │   │
                           │  │   cosine similarity      │   │
                           │  │   port 8001              │   │
                           │  └─────────────────────────┘   │
                           └────────────────────────────────┘
```

---

## 🤖 Fine-tuning Experiments (V1–V4)

### Dữ Liệu Huấn Luyện

| Dataset | Mô tả | Số mẫu |
|---------|-------|--------|
| **V1** | Raw Q&A tổng hợp từ nguồn y tế tiếng Việt | ~2,092 |
| **V2** | High-quality — Self-Instruct + Gemini 1.5 Pro từ 13 văn bản Bộ Y Tế | 1,440 |
| **DPO** | Safety dataset — cặp (chosen, rejected) cho alignment | ~1,000 |

Dataset V2 được xây dựng từ 13 tài liệu chính thức của Bộ Y Tế Việt Nam thông qua pipeline **Self-Instruct** với Gemini 1.5 Pro làm teacher model, đảm bảo tính hàn lâm và độ chính xác y khoa.

### Kết Quả 5 Thí Nghiệm

| Model | Version | Kỹ thuật | Dataset | ROUGE-1 ↑ | Perplexity ↓ |
|-------|---------|----------|---------|-----------|--------------|
| LLaMA 3 8B | V1 | QLoRA SFT | V1 (2,092) | 0.412 | 8.341 |
| LLaMA 3 8B | V2 | QLoRA SFT | V2 (1,440) | 0.521 | 6.127 |
| Vistral 7B | V3 | QLoRA SFT | V2 (1,440) | **0.693** | **4.092** |
| LLaMA 3 8B | V3 | QLoRA SFT | V2 (1,440) | 0.587 | 5.214 |
| LLaMA 3 8B | **V4** | QLoRA + **DPO** | V2 + DPO | *aligned* | *aligned* |

> **Best benchmark model:** Vistral 7B SFT — ROUGE-1 = 0.693, Perplexity = 4.092  
> **Production model (demo):** LLaMA 3 8B V4 (DPO-aligned) — được chọn vì hỗ trợ GGUF tốt hơn cho LM Studio

### LLM-as-a-Judge Evaluation

Model V3 được đánh giá độc lập bởi **LLaMA 3 70B** (judge model) trên 100 câu hỏi y tế ngẫu nhiên:

```
Điểm trung bình: 7.34 / 10
Tiêu chí: Độ chính xác · Tính an toàn y tế · Mạch lạc · Phù hợp văn hóa Việt Nam
```

### DPO (Direct Preference Optimization) — V4

V4 áp dụng DPO lên LLaMA 3 8B SFT (V3) để **alignment** hành vi model:

- **Mục tiêu:** Từ chối kê đơn thuốc nguy hiểm, hướng đến câu trả lời an toàn hơn, nhất quán hơn
- **Dataset:** `medical_data_dpo_1k.json` — 1,000 cặp (chosen: câu trả lời an toàn, rejected: câu trả lời không phù hợp)
- **Lỗi đã khắc phục:** Phiên bản DPO đầu tiên bị degenerate reward signal do rejected samples là truncated version của chosen — đã rebuild lại notebook với cặp dữ liệu đúng semantic ngược chiều
- **Export:** GGUF Q4_K_M → chạy trên LM Studio

---

## 🔍 RAG Pipeline — Two-stage Hybrid Retrieval

### Tại Sao Cần RAG?

LLM sau fine-tuning có thể hallucinate liều lượng thuốc, phác đồ điều trị. RAG cung cấp **grounding** từ tài liệu y khoa chính thống của Bộ Y Tế — model không cần "nhớ" mà được "đọc" tài liệu trực tiếp trong từng request.

### Knowledge Base

```
Nguồn: Hướng dẫn chẩn đoán và điều trị Tai Mũi Họng — Bộ Y Tế Việt Nam
Phạm vi: ~30 bệnh lý ENT (viêm tai giữa, xốp xơ tai, liệt VII ngoại biên, ung thư thanh quản...)
Format: 252 records JSON — mỗi record là 1 phần (Nguyên nhân / Triệu chứng / Chẩn đoán / Điều trị)
Cấu trúc: { id, disease_name, section, content, keywords }
```

### Chiến Lược Two-stage Hybrid Retrieval

```
User Query
    │
    ▼
┌─────────────────────────────────────┐
│  Stage 1: Keyword Disease Detection │
│  Normalize → match KNOWN_DISEASES   │
│  + DISEASE_ALIAS dictionary         │
└──────────────┬──────────────────────┘
               │
    ┌──────────▼──────────┐     ┌─────────────────────────────┐
    │  Disease detected?   │─YES─►  Hybrid Filtered Mode       │
    └──────────┬──────────┘     │  where: { disease_name: X }  │
               │                │  threshold: 0.65             │
               │ NO             └─────────────┬───────────────┘
               │                              │
    ┌──────────▼──────────┐                   │
    │  Semantic Full Mode  │                   │
    │  search all 252 docs │                   │
    │  threshold: 0.45     │                   │
    └──────────┬──────────┘                   │
               │                              │
               └──────────────┬───────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Distance Filter    │
                    │  cosine < threshold │
                    │  → inject to user  │
                    │    message turn    │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  LM Studio LLM      │
                    │  (system prompt từ  │
                    │   LM Studio riêng, │
                    │   không override)  │
                    └────────────────────┘
```

**Lý do inject vào user message thay vì system prompt:** LM Studio đã có built-in system prompt với Triage logic và Red Flags. Override system prompt từ code gây xung đột không xác định. RAG context được đặt ở đầu user turn với format `【THÔNG TIN TỪ CƠ SỞ DỮ LIỆU Y KHOA NỘI BỘ】`.

### Embedding Pipeline

```
Ingest time:  JSON record → "Bệnh: X - Section.\nNội dung: Y" → vietnamese-bi-encoder → ChromaDB
Query time:   User query → preprocessQuery() → vietnamese-bi-encoder → cosine search
```

Cả hai dùng cùng model qua Python FastAPI (`embedding_api.py`) — đảm bảo vector space nhất quán tuyệt đối (khắc phục bug embedding mismatch Python vs JS của pipeline cũ).

---

## 🛠️ Tech Stack

### Frontend & API

| Tầng | Công nghệ |
|------|-----------|
| Framework | Next.js 16 + TypeScript |
| Font | Be Vietnam Pro (Google Fonts) |
| AI Runtime | LM Studio — OpenAI-compatible API |
| Giao thức | SSE Streaming (`/v1/chat/completions`) |
| Auth | JWT signed (jose) với HTTPOnly cookie |
| Database | SQLite (better-sqlite3) — lưu lịch sử |

### RAG Backend (Python)

| Thành phần | Công nghệ |
|------------|-----------|
| Embedding Model | `bkai-foundation-models/vietnamese-bi-encoder` |
| Embedding Server | FastAPI + uvicorn (port 8002) |
| Vector Database | ChromaDB (port 8001) — cosine similarity |
| Retrieval | Two-stage Hybrid: Keyword Filter + Semantic Search |

### Fine-tuning

| Thành phần | Công nghệ |
|------------|-----------|
| Base models | LLaMA 3 8B, Vistral 7B |
| Framework | Unsloth + HuggingFace Transformers |
| Kỹ thuật | QLoRA (4-bit quantization, r=16, alpha=32) |
| Alignment | DPO (Direct Preference Optimization) |
| Compute | Google Colab (T4/A100) |
| Export | GGUF Q4_K_M (~5GB) |
| Model Hub | `Ethan2004/llama-3-8b-medical-vi` (HuggingFace) |

---

## ⚙️ Yêu Cầu Hệ Thống

- **Node.js** >= 18
- **Python** >= 3.10
- **LM Studio** >= 0.3.x — [lmstudio.ai](https://lmstudio.ai)
- **RAM** >= 12GB (khuyến nghị 16GB)
- Model GGUF `medical-chatbot-v4` đã load trong LM Studio

---

## 🚀 Cài Đặt & Chạy

### 1. Clone & cài dependencies

```bash
git clone https://github.com/hieule1704/medical_chatbot_interface
cd medical_chatbot_interface
npm install
```

### 2. Tạo file môi trường

```bash
cp .env.example .env.local
```

Nội dung `.env.local`:

```env
JWT_SECRET=your-secret-key-min-32-chars-here
```

### 3. Khởi động RAG Backend

```bash
cd rag_backend

# Terminal 1 — ChromaDB
chroma run --port 8001

# Terminal 2 — Embedding API
uvicorn embedding_api:app --host 0.0.0.0 --port 8002

# Terminal 3 — Nạp dữ liệu vào ChromaDB (chạy 1 lần)
python build_rag_v2.py
```

### 4. Khởi động LM Studio

1. Mở LM Studio → load model `medical-chatbot-v4` (GGUF)
2. Tab **Local Server** → cấu hình System Prompt → **Start Server**
3. Đảm bảo server chạy tại `http://127.0.0.1:1234`

### 5. Chạy ứng dụng

```bash
npm run dev
```

Mở trình duyệt tại [http://localhost:3000](http://localhost:3000)

---

## 📁 Cấu Trúc Project

```
medical-chatbot-interface/
├── app/
│   ├── api/
│   │   ├── auth/              # Login · Logout · Session (JWT)
│   │   ├── chat/
│   │   │   └── route.ts       # RAG inject + LM Studio proxy + SSE
│   │   ├── conversations/     # CRUD lịch sử hội thoại
│   │   ├── export/            # Export CSV
│   │   └── health/
│   │       └── route.ts       # Health check LM Studio + Embedding API
│   ├── login/
│   ├── layout.tsx
│   └── page.tsx               # Chat UI — Dark/Light · RAG Debug Panel
├── lib/
│   ├── auth.ts                # JWT session (jose)
│   ├── db.ts                  # SQLite
│   └── ragService.ts          # Two-stage Hybrid Retrieval
├── rag_backend/
│   ├── embedding_api.py       # FastAPI — vietnamese-bi-encoder
│   ├── build_rag_v2.py        # Ingest 252 ENT docs vào ChromaDB
│   ├── test_rag_v2.py         # Pipeline verification
│   └── rag_ent_knowledge.json # Knowledge base ENT (252 records)
├── logs/                      # RAG prompt logs (auto-generated)
│   └── latest.txt             # Log lần chat gần nhất
└── .env.local
```

---

## 🔄 Luồng Hoạt Động (RAG ON)

```
Người dùng nhập câu hỏi
        │
        ▼
page.tsx — gửi POST /api/chat { messages, useRag: true }
        │
        ▼
chat/route.ts
  ├── Truncate history → giữ 12 messages gần nhất (tránh overflow 8k tokens)
  ├── ragService.ts → Two-stage Hybrid Retrieval
  │     ├── detectDisease() — Keyword match
  │     ├── getEmbedding() — FastAPI port 8002
  │     └── ChromaDB query — cosine distance filter
  ├── Inject RAG context vào đầu user message (KHÔNG override system prompt)
  └── POST LM Studio :1234/v1/chat/completions (stream: true)
        │
        ▼
SSE stream → page.tsx parser → UI cập nhật từng token
        │
        ▼
RAG Debug Panel — hiển thị candidates, distance scores, retrieval mode
```

---

## ✨ Tính Năng Giao Diện

- 💬 Multi-turn conversation với lịch sử lưu SQLite
- ⚡ Token streaming real-time (SSE)
- 🌙 Dark / Light mode — lưu preference vào localStorage
- 🔍 **RAG Debug Panel** — xem ChromaDB candidates, distance scores, retrieval mode (HYBRID / SEMANTIC), query preprocessing
- 🟢 **Service Status Indicator** — health check định kỳ 15s cho LM Studio và Embedding API
- 📊 Prompt logger — ghi toàn bộ nội dung gửi đến LLM ra `logs/latest.txt`
- 🔐 Auth — đăng ký, đăng nhập, JWT session
- ✏️ Chỉnh sửa tin nhắn, thử lại câu trả lời, copy
- 📥 Export lịch sử CSV
- 📜 Smart scroll — không bị kéo xuống khi user đang đọc lịch sử

---

## 📊 Đánh Giá Hệ Thống

### Benchmark Fine-tuning (Automatic Metrics)

Đánh giá trên tập test 200 mẫu, sử dụng Greedy Decoding, pipeline HuggingFace-native (tránh bug KV-Cache của Unsloth inference):

| Model | ROUGE-1 | ROUGE-2 | ROUGE-L | Perplexity |
|-------|---------|---------|---------|------------|
| LLaMA 3 8B V1 (SFT) | 0.412 | 0.198 | 0.387 | 8.341 |
| LLaMA 3 8B V2 (SFT) | 0.521 | 0.267 | 0.498 | 6.127 |
| Vistral 7B V3 (SFT) | **0.693** | **0.412** | **0.651** | **4.092** |
| LLaMA 3 8B V3 (SFT) | 0.587 | 0.334 | 0.561 | 5.214 |

### RAG System Evaluation

Test với 6 query mẫu (4 ENT in-scope, 2 out-of-scope):

| Query | Mode | Chunks | Kết quả |
|-------|------|--------|---------|
| "Triệu chứng viêm amidan cấp" | SEMANTIC | 5/5 passed | ✅ HAS CONTEXT |
| "Phác đồ điều trị viêm tai giữa" | SEMANTIC | 5/5 passed | ✅ HAS CONTEXT |
| "Xốp xơ tai nguyên nhân điều trị" | **HYBRID** | 4/4 passed | ✅ HAS CONTEXT |
| "Liệt dây thần kinh VII ngoại biên" | **HYBRID** | 4/4 passed | ✅ HAS CONTEXT |
| "Cách chữa tiểu đường type 2" | SEMANTIC | 0/5 passed | ✅ FALLBACK |
| "Điều trị ung thư phổi giai đoạn 3" | SEMANTIC | 0/5 passed | ✅ FALLBACK |

---

## 🔗 Liên Kết

| Tài nguyên | Link |
|-----------|------|
| 🤗 Model (HuggingFace) | [`Ethan2004/llama-3-8b-medical-vi`](https://huggingface.co/Ethan2004/llama-3-8b-medical-vi) |
| 📦 Source Code | [github.com/hieule1704/medical_chatbot_interface](https://github.com/hieule1704/medical_chatbot_interface) |

---

## ⚠️ Lưu Ý Quan Trọng

> **AI không thay thế bác sĩ.** Hệ thống này chỉ mang tính chất demo học thuật và hỗ trợ thông tin sơ cấp. Người dùng cần tham khảo bác sĩ chuyên khoa cho các vấn đề sức khỏe nghiêm trọng. Thông tin từ RAG được trích từ Hướng dẫn Bộ Y Tế nhưng không thay thế chẩn đoán lâm sàng.

---

## 📄 License

MIT License — Sử dụng tự do cho mục đích học thuật và nghiên cứu.

---

<p align="center">
  <strong>Đồ Án Tốt Nghiệp 2026</strong> &nbsp;|&nbsp; Khoa Công Nghệ Thông Tin &nbsp;|&nbsp; Trường Đại học An Giang<br/>
  <sub>Sinh viên: Lê Hiếu · MSSV: DTH225642 · GVHD: Lê Thị Minh Nguyệt</sub>
</p>