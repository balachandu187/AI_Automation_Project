# FlowMind

**AI-first workflow automation platform** — one canvas for integrations, logic, and AI agents.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 6 + ReactFlow 12 + Tailwind CSS 4 |
| Backend | Fastify 5 + TypeScript + Drizzle ORM |
| Database | PostgreSQL 17 + pgvector |
| Cache/Queue | Redis 7.4 + BullMQ 5 |
| Monorepo | pnpm workspaces + Turborepo |

## Getting Started

### Prerequisites
- Node.js >= 22
- pnpm >= 9
- Docker & Docker Compose

### Development

```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres + Redis)
docker compose -f docker-compose.dev.yml up -d

# Apply database migrations
pnpm db:push

# Start all apps in dev mode
pnpm dev
```

- **API**: http://localhost:3001
- **Web**: http://localhost:5173
- **Health check**: http://localhost:3001/health

### Production (Docker)

```bash
docker compose up -d
```

## Project Structure

```
flowmind/
├── apps/
│   ├── api/        # Fastify API server
│   ├── web/        # React frontend
│   └── worker/     # BullMQ worker
├── packages/       # Shared libraries
├── docker-compose.yml
└── turbo.json
```

## License

Proprietary — All rights reserved.
