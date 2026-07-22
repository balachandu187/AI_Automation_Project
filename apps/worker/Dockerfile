# ---- Build stage ----
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/tsconfig.json apps/worker/

RUN pnpm install --frozen-lockfile --filter @flowmind/worker

COPY apps/worker/src apps/worker/src/

WORKDIR /build/apps/worker
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY --from=builder /build/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /build/apps/worker/package.json ./
COPY --from=builder /build/apps/worker/dist ./dist

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
