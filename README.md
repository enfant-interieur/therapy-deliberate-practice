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
- `ADMIN_EMAILS` (comma-separated allowlist for admin access)
- `ADMIN_GROUPS` (optional comma-separated Cloudflare Access group IDs)
- `CF_ACCESS_AUD` (Cloudflare Access application audience)
- `BYPASS_ADMIN_AUTH` (set to `true` only for local development)
- `DEV_ADMIN_TOKEN` (dev-only token used with `x-dev-admin-token`)
- `ENV` (set to `development` to enable dev-only auth bypass)
- `LOCAL_STT_URL`
- `LOCAL_LLM_URL`
- `LOCAL_LLM_MODEL`
- `DB_PATH` (Node-only SQLite path for `apps/api` dev server)

## Admin library (authoring/import)

### Cloudflare Access setup (production)

1. In the Cloudflare dashboard, go to **Zero Trust** → **Access** → **Applications** and select **Add an application**.
2. Choose **Self-hosted**.
3. Set the **Application name** (e.g., `therapy-deliberate-practice-admin`) and enter the **Domain** that serves the Worker (e.g., `app.yourdomain.com`).
4. Under **Session Duration**, choose an appropriate timeout for admins (e.g., 8h).
5. Add an **Access policy**:
   1. Policy name: `Admins`.
   2. Action: **Allow**.
   3. Include rules:
      - **Emails** → enter each admin email (for `ADMIN_EMAILS`), **or**
      - **Access Groups** → select the group(s) you want to allow (for `ADMIN_GROUPS`).
6. Add a **Deny** policy below the Allow policy to block everyone else (default deny).
7. In the application **Self-hosted** settings, enable **Path rules** and add:
   - `/admin/*`
   - `/api/v1/admin/*`
8. Save the application.
9. Copy the **Audience (AUD)** from the application settings and set it as `CF_ACCESS_AUD` in Worker variables.
10. In the Cloudflare dashboard, go to **Workers & Pages** → your Worker → **Settings** → **Variables** and set:
    - `ADMIN_EMAILS` (comma-separated list of allowed emails), and/or
    - `ADMIN_GROUPS` (comma-separated Access group IDs)
    - `CF_ACCESS_AUD` (Access application audience)
11. Deploy the Worker and verify that:
    - Visiting `/admin/library` prompts for Access login.
    - `/api/v1/admin/whoami` returns `isAuthenticated: true` and `isAdmin: true` for an allowed user.

### Local development

1. Set `ENV=development` and `BYPASS_ADMIN_AUTH=true` for the API/Worker.
2. Set `DEV_ADMIN_TOKEN` in the API/Worker environment.
3. In the browser console, run `localStorage.setItem("devAdminToken", "<DEV_ADMIN_TOKEN>")`.
4. Visit `/admin/library` to parse, edit, and import exercises.
