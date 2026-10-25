# syntax=docker/dockerfile:1

# Claude Agent SDK 的原生 binary 需要 glibc, 所以使用 Debian slim, 不使用 Alpine.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# 只安裝 production 相依套件. pnpm 會依 build 平台安裝對應的 Claude binary (linux-arm64 或 linux-x64).
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production
# container 內要 listen 0.0.0.0, 才能透過 port mapping 連到後台.
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "src/index.ts"]
