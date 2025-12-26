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

### Run with Docker Compose

```
docker compose -f infra/docker-compose.yml up
```

## Cloudflare

API is built with Hono and ready for Cloudflare Workers. Configure `wrangler.toml` with D1 + R2.

## Configuration

- `AI_MODE` = local_prefer | openai_only | local_only
- `OPENAI_API_KEY`
- `LOCAL_STT_URL`
- `LOCAL_LLM_URL`
- `LOCAL_LLM_MODEL`
- `DB_PATH`
