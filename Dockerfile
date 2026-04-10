# ============ 构建阶段 ============
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件（利用 Docker 层缓存）
COPY package*.json ./

# 安装所有依赖（包括 devDependencies，构建需要）
RUN npm ci

# 复制源代码
COPY . .

# 构建生产版本（Next.js standalone 模式，最小化产物）
RUN npm run build

# ============ 运行阶段 ============
FROM node:20-alpine AS runner

WORKDIR /app

# 安全：使用非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 设置生产环境
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 复制 Next.js standalone 产物（如果配置了 output: 'standalone'）
# 否则回退到标准部署
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

# 切换到非 root 用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# 启动命令
CMD ["npm", "start"]
