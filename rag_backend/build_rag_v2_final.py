"""
build_rag_v2.py — RAG Ingest Script (Version 2.1)

Thay đổi so với v2:
- texts_to_embed: thêm prefix "Bệnh: X - Section.\nNội dung: Y"
  → Vector chứa ngữ cảnh bệnh lý, không chỉ content thuần túy
  → Cải thiện đáng kể chất lượng semantic search
- documents lưu vào ChromaDB: lưu enriched text (KHÔNG phải chỉ content)
  → ragService.ts có hàm extractContent() để lấy lại phần content khi retrieve
  → documents và embeddings nhất quán với nhau (cùng 1 text)
"""

import json
import sys
import requests
import chromadb

# ─── Config ──────────────────────────────────────────────────────────────────
CHROMA_HOST     = "localhost"
CHROMA_PORT     = 8001
EMBEDDING_API   = "http://localhost:8002/embed"
COLLECTION_NAME = "medical_ent_final"
DATA_FILE       = "rag_ent_knowledge.json"
BATCH_SIZE      = 32
# ─────────────────────────────────────────────────────────────────────────────


def get_embeddings(texts: list[str]) -> list[list[float]]:
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


def kw_to_str(kw) -> str:
    if isinstance(kw, list):
        return ", ".join(kw)
    return str(kw)


def build_enriched_text(rec: dict) -> str:
    """
    Tạo text để embed VÀ lưu vào ChromaDB documents.
    Prefix disease_name + section giúp embedding model biết ngữ cảnh.
    ragService.ts dùng hàm extractContent() để parse lại khi retrieve.

    Format: "Bệnh: {disease_name} - {section}.\nNội dung: {content}"
    """
    return (
        f"Bệnh: {rec['disease_name']} - {rec['section']}.\n"
        f"Nội dung: {rec['content']}"
    )


def main():
    # 1. Kết nối ChromaDB
    print(f"🔗 Kết nối ChromaDB tại {CHROMA_HOST}:{CHROMA_PORT}...")
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)

    # 2. Xóa collection cũ nếu cần re-ingest sạch
    old_collections = ["medical_ent_v2", "medical_vi_docs", "medical_ent"] # Sửa lại sau mỗi lần test
    for old_name in old_collections:
        try:
            client.delete_collection(old_name)
            print(f"🗑️  Đã xóa collection cũ: '{old_name}'")
        except Exception:
            print(f"ℹ️  Collection '{old_name}' không tồn tại, bỏ qua.")

    # 3. Tạo/lấy collection
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )
    print(f"✅ Collection '{COLLECTION_NAME}' sẵn sàng.")

    # 4. Load & validate
    records      = load_data(DATA_FILE)
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
        model_name = r.json().get("model", "unknown")
        print(f"✅ Embedding API OK — model: {model_name}")
    except Exception as e:
        print(f"❌ Embedding API chưa chạy: {e}")
        print("   Hãy chạy: uvicorn embedding_api:app --port 8002")
        sys.exit(1)

    # 6. Bơm theo batch
    total = len(valid_records)
    print(f"\n🚀 Bắt đầu bơm {total} records (batch_size={BATCH_SIZE})...\n")
    print(f"   📝 Strategy: embed enriched text (disease_name + section + content)")
    print(f"   💾 Lưu: enriched text vào documents field\n")

    for i in range(0, total, BATCH_SIZE):
        batch = valid_records[i : i + BATCH_SIZE]

        # Enriched text: prefix bệnh + section + content
        # Cùng 1 string dùng cho cả embed và lưu vào documents
        enriched_texts = [build_enriched_text(rec) for rec in batch]
        embeddings     = get_embeddings(enriched_texts)

        ids = [f"ent_{rec['id']}" for rec in batch]

        metadatas = [
            {
                "disease_name": rec["disease_name"],
                "section"     : rec["section"],
                "keywords"    : kw_to_str(rec["keywords"]),
                "record_id"   : str(rec["id"]),
            }
            for rec in batch
        ]

        collection.upsert(
            ids       = ids,
            embeddings= embeddings,
            documents = enriched_texts,   # lưu enriched text (có prefix)
            metadatas = metadatas,
        )

        done = min(i + BATCH_SIZE, total)
        print(f"   ✅ Đã bơm {done}/{total} records")

    # 7. Verify
    final_count = collection.count()
    print(f"\n🎉 XONG! Collection '{COLLECTION_NAME}' có {final_count} documents.")
    print(f"   • Dữ liệu    : ENT (Tai Mũi Họng) — {len(valid_records)} records")
    print(f"   • Embed text  : enriched (disease + section + content)")
    print(f"   • Metric      : cosine similarity")
    print(f"\n   ⚠️  Nhớ re-ingest nếu đổi embedding model hoặc data!")


if __name__ == "__main__":
    main()