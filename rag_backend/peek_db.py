import chromadb
import json

print("🔗 Đang kết nối tới Docker ChromaDB (Port 8001)...")
try:
    client = chromadb.HttpClient(host='localhost', port=8001)
    
    COLLECTION_NAME = "medical_ent_v2"
    collection = client.get_collection(name=COLLECTION_NAME)

    # 1. Đếm tổng số tài liệu
    count = collection.count()
    print(f"\n📊 TỔNG SỐ TÀI LIỆU TRONG RAG: {count} mẫu")

    if count == 0:
        print("⚠️ Database đang rỗng!")
    else:
        # 2. Lấy thử 3 mẫu đầu tiên để xem nội dung
        print("\n👀 XEM THỬ 3 TÀI LIỆU BẤT KỲ:")
        
        # Hàm peek() giúp lấy ra các mẫu đầu tiên kèm theo vector và metadata
        results = collection.peek(limit=3) 
        
        # Nếu muốn xem các mẫu cụ thể, có thể dùng: 
        # results = collection.get(limit=3, offset=10) # Bỏ qua 10 mẫu đầu
        
        for i in range(len(results['ids'])):
            print(f"\n🔹 ID Tài liệu: {results['ids'][i]}")
            print(f"📝 Nội dung Text: \n{results['documents'][i]}")
            # print(f"🔢 Vector Embedding (5 chiều đầu tiên): {results['embeddings'][i][:5]}...")
            print("-" * 60)

except Exception as e:
    print(f"❌ Có lỗi xảy ra: {e}")