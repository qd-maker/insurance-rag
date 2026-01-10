from openai import OpenAI

# 配置API密钥（新版 openai>=1.0.0）
client = OpenAI(
    api_key="sk-On9fkdRGZNn4XgCroXStUyaA5teFJkQPalKySWVnDiY9dYcv",
    base_url="https://api.bltcy.ai/v1"  # 注意需要完整的 /v1 路径
)

# 测试 Embedding 模型
try:
    print("🧪 测试 Embedding 模型: text-embedding-3-small")
    print(f"📡 Base URL: {client.base_url}")
    print(f"🔑 API Key: {client.api_key[:20]}...{client.api_key[-10:]}\n")
    
    test_text = "这是一个测试文本，用于验证 embedding 模型是否可用。"
    
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=test_text
    )
    
    embedding = response.data[0].embedding
    
    print("✅ Embedding 模型调用成功！")
    print(f"   文本: {test_text}")
    print(f"   向量维度: {len(embedding)}")
    print(f"   向量前5个元素: {embedding[:5]}")
    
except Exception as e:
    print(f"❌ Embedding 模型调用失败！")
    print(f"   错误信息: {str(e)}")