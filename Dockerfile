# ============ 构建阶段 ============
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装所有依赖（包括 devDependencies）
RUN npm ci

# 复制源代码
COPY . .

# 构建生产版本
RUN npm run build

# ============ 运行阶段 ============
FROM node:20-alpine AS runner

WORKDIR /app

# 设置生产环境
ENV NODE_ENV=production

# 复制必要文件
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["npm", "start"]
