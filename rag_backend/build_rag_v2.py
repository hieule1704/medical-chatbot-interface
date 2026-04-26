"""
build_rag_v2.py — RAG Ingest Script (Version 2)

Thay đổi so với v1:
- Gọi embedding_api.py (Python) thay vì dùng trực tiếp SentenceTransformer
  → Đảm bảo vector space GIỐNG HỆT với ragService.ts
- Chỉ embed field "content" (không nhét cả Q&A dài vào một vector)
- Lưu disease_name, section, keywords vào metadata để filter sau này
- Xóa collection cũ bị bẩn trước khi bơm mới
- Dùng upsert để có thể chạy lại an toàn
"""

import json
import sys
import requests
import chromadb

# ─── Config ───────────────────────────────────────────────────────────────────
CHROMA_HOST = "localhost"
CHROMA_PORT = 8001
EMBEDDING_API = "http://localhost:8002/embed"
COLLECTION_NAME = "medical_ent"          # tên mới, tách biệt với collection cũ bẩn
DATA_FILE = "rag_ent_knowledge.json"        # file JSON bạn đã chuẩn bị
BATCH_SIZE = 32
# ──────────────────────────────────────────────────────────────────────────────


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """Gọi embedding_api.py để lấy vector — giống hệt ragService.ts."""
    resp = requests.post(EMBEDDING_API, json={"texts": texts}, timeout=60)
    resp.raise_for_status()
    return resp.json()["embeddings"]


def load_data(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print("❌ File JSON phải là một array []")
        sys.exit(1)
    print(f"📂 Đã đọc {len(data)} records từ {path}")
    return data


def validate_record(rec: dict, idx: int) -> bool:
    required = {"id", "disease_name", "section", "content", "keywords"}
    missing = required - rec.keys()
    if missing:
        print(f"⚠️  Record #{idx} thiếu field: {missing} — bỏ qua")
        return False
    if not rec["content"].strip():
        print(f"⚠️  Record #{idx} có content rỗng — bỏ qua")
        return False
    return True


def main():
    # 1. Kết nối ChromaDB
    print(f"🔗 Kết nối ChromaDB tại {CHROMA_HOST}:{CHROMA_PORT}...")
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)

    # 2. XÓA collection cũ bẩn (medical_vi_docs / medical_ent_v2)
    old_collections = ["medical_ent_v2"] # Sửa lại sau mỗi lần test
    for old_name in old_collections:
        try:
            client.delete_collection(old_name)
            print(f"🗑️  Đã xóa collection cũ: '{old_name}'")
        except Exception:
            print(f"ℹ️  Collection '{old_name}' không tồn tại, bỏ qua.")

    # 3. Tạo collection mới (không truyền embedding_function — ta tự handle)
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},   # cosine similarity
    )
    print(f"✅ Collection '{COLLECTION_NAME}' sẵn sàng.")

    # 4. Load & validate data
    records = load_data(DATA_FILE)
    valid_records = [r for i, r in enumerate(records) if validate_record(r, i)]
    print(f"✅ {len(valid_records)}/{len(records)} records hợp lệ.")

    if not valid_records:
        print("❌ Không có record hợp lệ nào. Dừng.")
        sys.exit(1)

    # 5. Check embedding API
    print("🔌 Kiểm tra Embedding API...")
    try:
        r = requests.get("http://localhost:8002/health", timeout=5)
        r.raise_for_status()
        print(f"✅ Embedding API OK — model: {r.json()['model']}")
    except Exception as e:
        print(f"❌ Embedding API chưa chạy: {e}")
        print("   Hãy chạy: uvicorn embedding_api:app --port 8002")
        sys.exit(1)

    # 6. Bơm theo batch
    total = len(valid_records)
    print(f"\n🚀 Bắt đầu bơm {total} records (batch_size={BATCH_SIZE})...\n")

    for i in range(0, total, BATCH_SIZE):
        batch = valid_records[i : i + BATCH_SIZE]

        # Chỉ embed field "content" — không embed full Q&A
        texts_to_embed = [rec["content"] for rec in batch]
        embeddings = get_embeddings(texts_to_embed)

        # Chuẩn bị dữ liệu cho ChromaDB
        ids = [f"ent_{rec['id']}" for rec in batch]

        # keywords có thể là string hoặc list — chuẩn hóa thành string
        def kw_to_str(kw):
            if isinstance(kw, list):
                return ", ".join(kw)
            return str(kw)

        metadatas = [
            {
                "disease_name": rec["disease_name"],
                "section": rec["section"],
                "keywords": kw_to_str(rec["keywords"]),
                "record_id": str(rec["id"]),
            }
            for rec in batch
        ]

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=texts_to_embed,   # lưu content text để retrieve sau
            metadatas=metadatas,
        )

        done = min(i + BATCH_SIZE, total)
        print(f"   ✅ Đã bơm {done}/{total} records")

    # 7. Verify
    final_count = collection.count()
    print(f"\n🎉 XONG! Collection '{COLLECTION_NAME}' có {final_count} documents.")
    print(f"   • Dữ liệu: ENT (Tai Mũi Họng)")
    print(f"   • Embedding: paraphrase-multilingual-MiniLM-L12-v2 (via Python API)")
    print(f"   • Similarity metric: cosine")


if __name__ == "__main__":
    main()
