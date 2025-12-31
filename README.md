# Therapy Deliberate Practice Studio

Production-grade monorepo for a psychotherapy deliberate-practice platform.

## Structure

```
/apps
  /web
  /api
  /worker
/packages
  /shared
/services
  /local-stt
  /local-llm
/infra
```

## Prerequisites

- Node 20
- npm 10+
- Wrangler (`npm install -g wrangler`)
- A Supabase project (Google + GitHub OAuth enabled)
- Cloudflare account (for D1 + Worker deploys)

## Environment setup

### Local `.env` (API + shared defaults)

Copy the root env file and fill in the required values for local API dev (`apps/api` uses `DB_PATH`).

```
cp .env.example .env
```

Add/confirm the following variables in the root `.env`:

```
AI_MODE=local_prefer
OPENAI_API_KEY=sk-...
OPENAI_KEY_ENCRYPTION_SECRET=your-32+char-secret
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
LOCAL_STT_URL=http://localhost:7001
LOCAL_LLM_URL=http://localhost:7002
LOCAL_LLM_MODEL=mlx-community/Mistral-7B-Instruct-v0.2
DB_PATH=./infra/local.db
ENV=development
BYPASS_ADMIN_AUTH=true
DEV_ADMIN_TOKEN=local-admin-token
```

### Web env (`apps/web/.env`)

Create a Vite env file for the frontend:

```
cd apps/web
cat <<'ENV' > .env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
ENV
```

### Worker env (Cloudflare)

In `apps/worker/wrangler.jsonc`, define non-secret vars and bind the D1 database:

- `AI_MODE`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `LOCAL_STT_URL`
- `LOCAL_LLM_URL`
- `LOCAL_LLM_MODEL`

Use Wrangler secrets for sensitive values:

```
cd apps/worker
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_KEY_ENCRYPTION_SECRET
wrangler secret put SUPABASE_JWT_SECRET
```

## Supabase configuration

1. In Supabase → **Authentication** → **Providers**, enable **Google** and **GitHub**.
2. Configure OAuth redirect URLs:
   - `http://localhost:5173/login`
   - `https://your-production-domain.com/login`
3. Grab the **Project URL** and **Anon public key** for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Grab the **JWT secret** (Project Settings → API → JWT Secret) for `SUPABASE_JWT_SECRET`.

## D1 setup & migrations

Wrangler now manages tracked D1 migrations from `apps/worker/migrations`. Migrations are applied
in filename order and tracked by Wrangler, so the commands below are safe to run repeatedly.

### Create the database

```
wrangler d1 create deliberate_practice
```

Copy the resulting `database_id` into `apps/worker/wrangler.jsonc` under the `DB` binding.

### Local D1 (development)

```
npm run migrate:local -w apps/worker
```

Optional seed (idempotent):

```
wrangler d1 execute DB --file=infra/seed.sql --local
```

### Remote D1 (production)

```
npm run migrate:remote -w apps/worker
```

> Migrations run before deploy in CI via `npm run deploy:ci -w apps/worker`.

### CI deploy command sequence (Cloudflare)

```
npm ci
npm run build -w apps/web
npm run deploy:ci -w apps/worker
```

### Adding a new migration

1. Add a new SQL file under `apps/worker/migrations/` with the next numeric prefix
   (e.g. `0004_add_feature.sql`).
2. Commit the file. The next `migrate:*` run will apply it once, in order.

### Local SQLite for `apps/api`

For the Node dev server (`apps/api`), initialize the SQLite database:

```
sqlite3 infra/local.db < infra/migrations/0001_init.sql
sqlite3 infra/local.db < infra/migrations/0002_add_exercise_content.sql
sqlite3 infra/local.db < infra/migrations/0003_add_user_settings.sql
sqlite3 infra/local.db < infra/seed.sql
```

## Running locally

### Web + API (node)

```
npm install
npm run dev -w apps/web
npm run dev -w apps/api
```

### Full-stack Worker (serves web + API)

Build the frontend first so the Worker can serve static assets:

```
npm run build -w apps/web
cd apps/worker
npm run dev
```

### Local inference services (optional)

```
docker compose -f infra/docker-compose.yml up
```

## Debugging practice runs

Use request tracing to follow a single practice session end-to-end.

### Tail logs (Cloudflare Worker)

```
cd apps/worker
wrangler tail
```

Look for `request.start`, `practice.run.start`, `stt.transcribe.ok`, `llm.evaluate.ok`, and `practice.run.ok`
events. Each log line includes a `requestId` that matches the `x-request-id` response header and the
`requestId` field in the JSON response body.

### Typical failure modes

- **input**: audio missing/too small or invalid payload. UI shows the error and requestId.
- **stt**: provider unavailable or transcription failure. Check `stt.select.*` and `stt.transcribe.*` logs.
- **scoring**: LLM provider failures or invalid JSON output. Check `llm.evaluate.*` logs.
- **db**: attempt write failures. Check `db.attempt.insert.*` logs.

### Manual test checklist

- Local mode (Node dev server): start a practice run and confirm transcript + scoring.
- Worker mode (wrangler dev / production): confirm logs appear in `wrangler tail`.
- With/without OpenAI key: ensure missing key surfaces a clear `scoring` error.
- Local endpoints configured vs not configured: confirm provider selection and fallback logs.

## Deployment (Worker)

1. Build the web app:
   ```
   npm run build -w apps/web
   ```
2. Deploy the Worker:
   ```
   cd apps/worker
   wrangler deploy
   ```
3. Ensure Worker secrets/vars are set (see Environment setup section).

## Configuration reference

- `AI_MODE` = `local_prefer` | `openai_only` | `local_only`
- `OPENAI_API_KEY`
- `OPENAI_KEY_ENCRYPTION_SECRET` (required; encrypts user keys at rest)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET` (required for Supabase JWT verification)
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
- `VITE_SUPABASE_URL` (web)
- `VITE_SUPABASE_ANON_KEY` (web)

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
