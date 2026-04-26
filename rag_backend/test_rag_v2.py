"""
test_rag_v2.py — Kiểm tra pipeline RAG v2 sau khi ingest

Chạy sau khi:
  1. embedding_api.py đang chạy (port 8002)
  2. ChromaDB đang chạy (port 8001)
  3. build_rag_v2.py đã bơm xong data

Usage:
  python test_rag_v2.py
"""

import requests
import chromadb
import json

CHROMA_HOST = "localhost"
CHROMA_PORT = 8001
EMBEDDING_API = "http://localhost:8002/embed"
COLLECTION_NAME = "medical_ent_v2"
DISTANCE_THRESHOLD = 0.4


def get_embedding(text: str) -> list[float]:
    resp = requests.post(EMBEDDING_API, json={"texts": [text]}, timeout=30)
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


def query(question: str, top_k: int = 5):
    client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    collection = client.get_collection(COLLECTION_NAME)

    embedding = get_embedding(question)
    results = collection.query(
        query_embeddings=[embedding],
        n_results=top_k,
        include=["documents", "metadatas", "distances"],
    )

    docs = results["documents"][0]
    metas = results["metadatas"][0]
    distances = results["distances"][0]

    print(f"\n{'─'*60}")
    print(f"🔍 Query: {question}")
    print(f"{'─'*60}")
    print(f"  Candidates: {len(docs)} | Threshold: {DISTANCE_THRESHOLD}")

    passed = 0
    for i in range(len(docs)):
        dist = distances[i]
        meta = metas[i]
        status = "✅ PASSED" if dist < DISTANCE_THRESHOLD else "❌ FILTERED"
        if dist < DISTANCE_THRESHOLD:
            passed += 1
        print(f"\n  [{i+1}] {status} | Distance: {dist:.4f}")
        print(f"       Disease: {meta.get('disease_name', '?')}")
        print(f"       Section: {meta.get('section', '?')}")
        print(f"       Content preview: {docs[i][:120]}...")

    print(f"\n  → {passed}/{len(docs)} chunks passed threshold\n")
    return passed


# ─── Test Cases ───────────────────────────────────────────────────────────────
TEST_CASES = [
    # Relevant queries (nên có context)
    ("Triệu chứng viêm amidan cấp là gì?", True),
    ("Phác đồ điều trị viêm tai giữa", True),
    ("Bị điếc đột ngột một bên tai phải làm gì?", True),
    ("Dấu hiệu Charles Bell là gì?", True),
    # Out-of-scope queries (không nên có context, fallback)
    ("Cách chữa tiểu đường type 2", False),
    ("Điều trị ung thư phổi giai đoạn 3", False),
]

if __name__ == "__main__":
    print("=" * 60)
    print("🧪 RAG v2 — Pipeline Verification")
    print("=" * 60)

    # Check services
    try:
        h = requests.get("http://localhost:8002/health", timeout=3)
        print(f"✅ Embedding API: {h.json()['model']}")
    except Exception:
        print("❌ Embedding API chưa chạy! (port 8002)")
        exit(1)

    try:
        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        col = client.get_collection(COLLECTION_NAME)
        print(f"✅ ChromaDB: collection '{COLLECTION_NAME}' có {col.count()} docs")
    except Exception as e:
        print(f"❌ ChromaDB error: {e}")
        exit(1)

    print()
    results_summary = []
    for question, should_have_context in TEST_CASES:
        passed = query(question, top_k=5)
        got_context = passed > 0
        ok = got_context == should_have_context
        results_summary.append((question[:50], should_have_context, got_context, ok))

    print("\n" + "=" * 60)
    print("📊 SUMMARY")
    print("=" * 60)
    for q, expected, got, ok in results_summary:
        icon = "✅" if ok else "⚠️ "
        exp_str = "HAS CONTEXT" if expected else "FALLBACK"
        got_str = "HAS CONTEXT" if got else "FALLBACK"
        print(f"  {icon} [{exp_str:>12}] → [{got_str:>12}]  {q}...")
    print()
