# Therapy Deliberate Practice Studio

Production-grade monorepo for a psychotherapy deliberate-practice platform.

## Structure

```
/apps
  /web
  /api
/packages
  /shared
/services
  /local-stt
  /local-llm
/infra
```

## Local development

### Prereqs

- Node 20
- Docker (optional)

### Run locally

```
cp .env.example .env
npm install
npm run dev -w apps/web
npm run dev -w apps/api
```

### Run full-stack Worker locally

Build the frontend first so the Worker can serve static assets, then run Wrangler from `apps/worker`:

```
npm run build -w apps/web
cd apps/worker
npm run dev
```

### Run with Docker Compose

```
docker compose -f infra/docker-compose.yml up
```

## Cloudflare

The `apps/worker` package deploys a single Cloudflare Worker that serves the Vite app as static assets and mounts the Hono API under `/api/v1`.

1. Create the D1 database (one time) and update `apps/worker/wrangler.jsonc` with the generated `database_id`.
2. Apply migrations with Wrangler commands (local or remote).

### D1 setup & migrations

```
cd apps/worker
wrangler d1 create deliberate_practice
wrangler d1 execute DB --file=../../infra/migrations/0001_init.sql --local
wrangler d1 execute DB --file=../../infra/migrations/0001_init.sql
```

### Optional: seed demo exercise

```
cd apps/worker
wrangler d1 execute DB --file=../../infra/seed.sql --local
wrangler d1 execute DB --file=../../infra/seed.sql
```

## Configuration

- `AI_MODE` = local_prefer | openai_only | local_only
- `OPENAI_API_KEY`
- `ADMIN_TOKEN` (shared secret for admin endpoints)
- `LOCAL_STT_URL`
- `LOCAL_LLM_URL`
- `LOCAL_LLM_MODEL`
- `DB_PATH` (Node-only SQLite path for `apps/api` dev server)

## Admin library (authoring/import)

1. Set `ADMIN_TOKEN` in the API environment.
2. Set `VITE_ADMIN_TOKEN` in the web app environment so admin requests include the header.
3. Visit `/admin/library` while logged in with role `admin` to parse, edit, and import exercises.
