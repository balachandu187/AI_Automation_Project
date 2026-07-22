# ---- Build stage ----
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/

RUN pnpm install --frozen-lockfile --filter @flowmind/web

COPY apps/web/src apps/web/src/

WORKDIR /build/apps/web
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

RUN pnpm add -g serve

COPY --from=builder /build/apps/web/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npx", "serve", "-s", "dist", "-l", "3000", "--no-clipboard"]
