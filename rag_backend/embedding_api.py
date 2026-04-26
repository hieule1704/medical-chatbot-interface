"""
embedding_api.py — Unified Embedding Server
Chạy: uvicorn embedding_api:app --host 0.0.0.0 --port 8002

Cả build_rag.py (ingest) và Next.js ragService.ts (query) đều gọi vào đây.
Đảm bảo vector space nhất quán 100%.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List
import uvicorn

app = FastAPI(title="Embedding API", version="2.0")

print("🧠 Đang tải model embedding...")
# model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2") # Hỗ trợ detect tiếng Việt không tốt
model = SentenceTransformer("bkai-foundation-models/vietnamese-bi-encoder") # Hỗ trợ detect tiếng Việt tốt hơn, nhưng embedding vector có thể khác với model cũ
print("✅ Model sẵn sàng.")


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    model: str
    count: int


@app.get("/health")
def health():
    return {"status": "ok", "model": "bkai-foundation-models/vietnamese-bi-encoder"}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.texts:
        raise HTTPException(status_code=400, detail="texts cannot be empty")
    if len(req.texts) > 512:
        raise HTTPException(status_code=400, detail="Max 512 texts per request")

    vectors = model.encode(req.texts, normalize_embeddings=True).tolist()

    return EmbedResponse(
        embeddings=vectors,
        model="bkai-foundation-models/vietnamese-bi-encoder",
        count=len(vectors),
    )


if __name__ == "__main__":
    uvicorn.run("embedding_api:app", host="0.0.0.0", port=8002, reload=False)
