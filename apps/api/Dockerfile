# ---- Build stage ----
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json apps/api/

RUN pnpm install --frozen-lockfile --filter @flowmind/api

COPY apps/api/src apps/api/src/
COPY apps/api/drizzle.config.ts apps/api/

WORKDIR /build/apps/api
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY --from=builder /build/node_modules/.pnpm ./node_modules/.pnpm
COPY --from=builder /build/apps/api/package.json ./
COPY --from=builder /build/apps/api/dist ./dist

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
