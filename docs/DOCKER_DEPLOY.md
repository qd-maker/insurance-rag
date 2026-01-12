# 🐳 Docker 部署指南 (Ubuntu)

本文档介绍如何在 Ubuntu 服务器上使用 Docker 部署 Insurance RAG Engine。

---

## 📋 前置要求

- Ubuntu 20.04+ 服务器
- 2GB+ 内存
- Docker 已安装
- Git 已安装

---

## 🚀 部署步骤

### 1. 安装 Docker（如未安装）

```bash
# 更新包索引
sudo apt update

# 安装必要依赖
sudo apt install -y ca-certificates curl gnupg lsb-release

# 添加 Docker GPG 密钥
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 添加 Docker 源
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 验证安装
docker --version
docker compose version
```

### 2. 克隆代码

```bash
cd /home
git clone https://github.com/qd-maker/insurance-rag.git
cd insurance-rag
```

### 3. 创建生产环境变量文件

```bash
# 创建 .env.production 文件
cat > .env.production << 'EOF'
# OpenAI API 配置
OPENAI_API_KEY=你的API密钥
OPENAI_BASE_URL=https://api.bltcy.ai/v1

# 模型配置
EMBEDDING_MODEL=text-embedding-ada-002
EMBEDDING_DIM=1536
GENERATION_MODEL=gpt-4o-mini

# Supabase 配置
SUPABASE_URL=你的Supabase地址
SUPABASE_SERVICE_ROLE_KEY=你的服务端密钥

# 管理员配置
ADMIN_TOKEN=你的管理员令牌

# 可选：启用缓存
# ENABLE_SEARCH_CACHE=true
EOF

# 编辑填入实际值
nano .env.production
```

### 4. 构建并启动容器

```bash
# 使用 Docker Compose 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f

# 检查运行状态
docker compose ps
```

### 5. 验证部署

```bash
# 健康检查
curl http://localhost:3000/api/health

# 测试产品列表
curl http://localhost:3000/api/products/list
```

---

## 🌐 配置 Nginx 反向代理

### 安装 Nginx

```bash
sudo apt install -y nginx
```

### 配置站点

```bash
sudo nano /etc/nginx/sites-available/insurance-rag
```

填入以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或 IP

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置（LLM 调用可能较慢）
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/insurance-rag /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔒 配置 HTTPS（推荐）

使用 Certbot 获取免费 SSL 证书：

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书（替换域名）
sudo certbot --nginx -d your-domain.com

# 自动续期（已自动配置）
sudo systemctl enable certbot.timer
```

---

## 🔧 常用命令

```bash
# 查看容器状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启容器
docker compose restart

# 停止容器
docker compose down

# 更新代码并重新部署
git pull origin main
docker compose up -d --build

# 清理旧镜像
docker image prune -f
```

---

## ❓ 故障排除

### 容器启动失败
```bash
# 查看详细日志
docker compose logs insurance-rag

# 检查环境变量
docker compose config
```

### 端口被占用
```bash
# 查看端口占用
sudo lsof -i :3000

# 修改 docker-compose.yml 中的端口映射
# ports:
#   - "3001:3000"
```

### 内存不足
```bash
# 查看内存使用
free -h

# 增加 swap（如需要）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 📊 监控

### 查看容器资源使用

```bash
docker stats insurance-rag
```

### 查看应用日志

```bash
docker compose logs -f --tail 100
```
