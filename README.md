# Therapy Deliberate Practice Studio

Production-grade monorepo for Therapy Studio, a psychotherapy deliberate-practice platform that pairs a Vite/React front end with a Cloudflare Worker API and a local runtime suite for on-device STT/LLM/TTS. This README reflects the current v0.1.6 setup (no Docker, native dev tooling only).

## Table of Contents
1. [Repository layout](#repository-layout)
2. [Stack & prerequisites](#stack--prerequisites)
3. [Install & bootstrap](#install--bootstrap)
4. [Configuration](#configuration)
5. [Local development](#local-development)
6. [Database & migrations](#database--migrations)
7. [Local Runtime Suite](#local-runtime-suite)
8. [Testing & linting](#testing--linting)
9. [Builds & releases](#builds--releases)
10. [Troubleshooting](#troubleshooting)

## Repository layout
```
/apps
  /web        – Vite + React therapist UI
  /api        – shared Hono API (logic reused by the Worker)
  /worker     – Cloudflare Worker (serves /api routes + static assets)
/packages
  /shared     – TypeScript types, schemas, prompts, helpers
/services
  /local-runtime-suite – Python FastAPI gateway + Tauri desktop launcher
/docs         – supplementary architecture notes
/scripts      – release helpers, local AI tools
```

## Stack & prerequisites
| Requirement | Purpose |
| --- | --- |
| Node 20.x & npm 10.x | workspace installs, Vite dev server, Wranger tasks |
| Python 3.10+ | local runtime FastAPI gateway + tooling |
| Rust toolchain & `@tauri-apps/cli` | building/running the desktop launcher |
| Wrangler CLI (`npm i -g wrangler`) | Worker dev server, deploys, D1 migrations |
| Supabase project | auth + persistence |
| Cloudflare account | D1 database + R2 cached audio |
| Optional: `ffmpeg` | microphone recordings + audio conversions |

> MLX-based local models require macOS on Apple Silicon. On other platforms, configure the local runtime to use Hugging Face/torch backends.

## Install & bootstrap
1. **Clone & install JS workspaces**
   ```bash
   git clone <repo> therapy-deliberate-practice
   cd therapy-deliberate-practice
   npm install
   ```
2. **Set up the Python environment (local runtime gateway)**
   ```bash
   cd services/local-runtime-suite/python
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[lint,test]"
   ```
   Reactivate the virtualenv whenever running `npm run dev:local`.
3. **(Optional) Install desktop launcher deps**
   ```bash
   cd services/local-runtime-suite/desktop
   npm install
   ```
4. **Ensure toolchains stay current** – `rustup update`, `npm i -g wrangler`, `pip install --upgrade pip`.

## Configuration & environment prep
The platform relies on Supabase (auth), Cloudflare (Worker + D1 + R2), and the Local Runtime Suite. Follow the steps below in order for a clean setup.

### Step 1 – Supabase project
1. **Create a Supabase project** from the dashboard (choose the free tier or higher).
2. **Record credentials**:
   - Project URL – copy from Settings → Project Settings → API (`https://xyz.supabase.co`).
   - Public anon key – same page, used by the web app.
   - JWT secret – Settings → API → JWT Secret (used by the Worker API).
   - Optional: service-role key if you plan to seed data directly.
3. **Enable providers**:
   - Go to Authentication → Providers and enable **Email**, **Google**, and **GitHub**.
   - For each OAuth provider, add redirect URLs:
     - `http://localhost:5173/login`
     - `https://<your-prod-domain>/login`
4. **Configure site settings**:
   - Authentication → URL Configuration: set Site URL to your production domain (can be changed later).
   - Add `http://localhost:5173` to `Additional Redirect URLs` for dev.
5. **Create the default storage bucket (optional)** if you plan to store assets or exports via Supabase Storage.
6. **Verify email templates** (Authentication → Templates) if you customize copy.

You now have all values needed for the `.env` files.

### Step 2 – Cloudflare Worker, D1, and R2
1. **Authenticate Wrangler**
   ```bash
   wrangler login
   wrangler whoami   # confirm account + subscription
   ```
2. **Provision D1**
   ```bash
   cd apps/worker
   wrangler d1 create deliberate_practice
   ```
   Copy the `database_id` that Wrangler prints and paste it into `apps/worker/wrangler.jsonc` under the `d1_databases[0].database_id` field.
3. **Create an R2 bucket** (Cloudflare dashboard → R2 → Create bucket). Name it `deliberate-practice-audio` or similar.
   - Add the bucket binding to `wrangler.jsonc` (already present by default).
   - Note your Account ID (R2 overview) plus the Access Key / Secret (R2 → Manage R2 API Tokens → Create API Token).
4. **Configure routes + assets**:
   - `wrangler.jsonc` already maps `therapy-deliberate-practice.com` / `www` to the Worker.
   - Update these routes to your domain if different, or remove them for dev-only usage.
5. **Set Worker secrets** (never store these in the repo):
   ```bash
   wrangler secret put OPENAI_API_KEY
   wrangler secret put OPENAI_KEY_ENCRYPTION_SECRET
   wrangler secret put SUPABASE_JWT_SECRET
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   wrangler secret put DEV_ADMIN_TOKEN   # optional, for CLI admin auth
   ```
6. **Create the queues** – long-running admin parsing and patient audio generation now dispatch to Cloudflare Queues so long-running jobs never block the Worker request thread.
   ```bash
   # One time, per environment
   cd apps/worker
   wrangler queues create admin-batch-parse
   wrangler queues create patient-audio
   ```
   - Queue bindings (`ADMIN_BATCH_PARSE_QUEUE`, `PATIENT_AUDIO_QUEUE`) are defined in `apps/worker/wrangler.jsonc`; adjust the `queue_name` if you used a different name.
   - Deploying via `wrangler deploy` automatically attaches the queue binding; for local `wrangler dev`, Wrangler emulates the queue consumer.
7. **Verify bindings** by running:
   ```bash
   wrangler dev
   ```
   Visit `http://localhost:8787/api/health` and confirm you receive a JSON payload instead of an error.

### Step 3 – Environment files
Create `.env` in the repo root (used by Wrangler dev + Worker deploys):
```env
AI_MODE=local_prefer                # local_prefer | local_only | openai_only
OPENAI_API_KEY=sk-...
OPENAI_KEY_ENCRYPTION_SECRET=32+char-secret
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<public-anon-key>
SUPABASE_JWT_SECRET=<project-jwt-secret>
LOCAL_STT_URL=http://127.0.0.1:8484
LOCAL_LLM_URL=http://127.0.0.1:8484
LOCAL_TTS_URL=http://127.0.0.1:8484
LOCAL_LLM_MODEL=Qwen/Qwen3-4B-MLX-4bit
LOCAL_TTS_MODEL=mlx-community/Kokoro-82M-bf16
LOCAL_TTS_VOICE=af_bella
LOCAL_TTS_FORMAT=mp3
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=sage
BYPASS_ADMIN_AUTH=true
DEV_ADMIN_TOKEN=local-dev-token
R2_BUCKET=deliberate-practice-audio
R2_PUBLIC_BASE_URL= # optional CDN prefix
ENV=development
```
> `BYPASS_ADMIN_AUTH=true` lets you access admin pages locally without SSO. Disable it in production.

Create `apps/web/.env` for Vite:
```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```
No extra API base env is required—the dev Vite server proxies `/api/*` to Wrangler automatically.

### Step 4 – Local runtime configuration
The Local Runtime Suite (Python gateway + desktop app) keeps its config at:
- macOS: `~/Library/Application Support/com.therapy.localruntime/therapy/local-runtime/config.json`
- Windows: `%APPDATA%\com.therapy.localruntime\therapy\local-runtime\config.json`
- Linux: `~/.therapy/local-runtime/config.json`

After running the desktop app once, edit the config (or use the Settings tab) to ensure:
```json
{
  "port": 8484,
  "prefer_local": true,
  "default_models": {
    "responses": "local//llm/qwen3-mlx",
    "audio.transcriptions": "local//stt/parakeet-mlx"
  }
}
```
All `LOCAL_*` env vars should match the base URL exposed here (`http://127.0.0.1:8484`).

## Local development
### Step 5 – Run the full stack locally
1. **Start the Local Runtime Suite (LLM/STT/TTS)**
   ```bash
   npm run dev:local              # FastAPI gateway only
   # or launch the GUI:
   cd services/local-runtime-suite/desktop
   npm run tauri:dev
   ```
   - Visit `http://127.0.0.1:8484/health` – you should see `{ "status": "ok" }`.
   - Use `http://127.0.0.1:8484/logs` to inspect structured logs if anything fails.
2. **Run Wrangler dev (Worker + D1 + assets)**
   ```bash
   npm run dev:worker -- --port 8787
   ```
   - `http://localhost:8787/api/health` should return a JSON payload describing build info.
   - D1 migrations are auto-applied when you run `npm run migrate:local -w apps/worker`.
3. **Run the web app**
   ```bash
   npm run dev:web
   ```
   - Visit `http://localhost:5173` and sign in through Supabase.
   - The Vite dev server proxies `/api/*` to Wrangler automatically; no extra config needed.
4. **Optional shortcut**
   ```bash
   npm run dev   # runs worker + web in parallel
   ```
5. **End-to-end sanity check**
   - Navigate to `/practice/<taskSlug>`.
   - Hit “Start recording”, speak for a few seconds, then “Run evaluation”.
   - Watch `npm run dev:local` output to confirm STT + LLM runs execute locally.
   - Open the Practice history sidebar to verify scores and transcripts render.

> When `AI_MODE=local_prefer`, the API uses the local runtime first with OpenAI fallback. Set `AI_MODE=openai_only` if you want to exercise the remote path instead.

## Database & migrations
Therapy Studio uses Cloudflare D1 for production and development (Wrangler dev). SQL migrations live in `apps/worker/migrations`.

1. **Create the database**
   ```bash
   cd apps/worker
   wrangler d1 create deliberate_practice
   ```
   Copy the `database_id` into `wrangler.jsonc`.

2. **Apply migrations**
   ```bash
   npm run migrate:local -w apps/worker    # apply to wrangler dev (local miniflare)
   npm run migrate:remote -w apps/worker   # apply to remote D1
   ```

3. **Seed sample data (optional)**
   ```bash
   wrangler d1 execute DB --file=../api/infra/seed.sql --local
   wrangler d1 execute DB --file=../api/infra/seed.sql --remote
   ```

The Node API is not run separately; `apps/worker` imports the shared Hono app (`apps/api/src/app.ts`). API unit tests use in-memory SQLite via `better-sqlite3`.

## Local Runtime Suite
`services/local-runtime-suite` replaces Dockerized services with native tooling.

### Python FastAPI gateway
- Entrypoint: `python -m local_runtime.main` (invoked via `npm run dev:local`).
- Exposes OpenAI-compatible endpoints:
  - `POST /v1/audio/transcriptions`
  - `POST /v1/responses`
  - `POST /v1/audio/speech`
  - `GET /health`, `GET /logs`
- Models live under `services/local-runtime-suite/python/local_runtime/models`.
- Generate/update the model catalog for the web UI:
  ```bash
  python services/local-runtime-suite/tools/gen_models_json.py
  ```

### Desktop launcher (Tauri)
- Location: `services/local-runtime-suite/desktop`
- Scripts:
  ```bash
  npm run tauri:dev       # build sidecar + run app
  npm run tauri:build     # produce production installers
  npm run tauri:appstore  # App Store target (macOS universal)
  ```
- Provides GUI toggles, status checks, `/doctor` diagnostics, and auto-starts the gateway + model sidecars.

### Logs & data
Runtime logs, cache, and downloaded weights live under the same config directory noted above (`~/.therapy/local-runtime/...`).

## Testing & linting
```bash
# Frontend lint (ESLint)
npm run lint -w apps/web

# Worker/API types
npm run build -w apps/api          # type-check the shared API

# API unit tests (better-sqlite3 + tsx)
npm run test -w apps/api

# Local runtime suite lint/tests
npm run lint -w services/local-runtime-suite
cd services/local-runtime-suite/python && pytest

# Desktop lint
cd services/local-runtime-suite/desktop && npm run lint

# Format everything
npm run format
```

## Builds & releases
- **Web + Worker + API**: `npm run build` (web bundle + API type check + worker bundle). Deploy via `npm run deploy:prod -w apps/worker`.
- **Local runtime assets**:
  ```bash
  npm run build -w services/local-runtime-suite             # python catalog + tooling
  npm run build:local                                       # python build + tauri build
  ```
- **Release automation**: `npm run release` (tags + changelog). Use `npm run release:dmg` / `npm run release:appstore` for macOS deliverables, or `npm run release:gh` for GitHub artifacts.

## Troubleshooting
- **Local runtime connection errors** – ensure `npm run dev:local` (or the desktop app) is running and the env variables point to `http://127.0.0.1:8484`. Check logs under `~/Library/Application Support/com.therapy.localruntime/.../logs`.
- **Audio capture fails** – confirm browser mic permissions, and verify `ffmpeg` is installed if you rely on media conversions.
- **Real Time Mode audio missing** – verify `R2_BUCKET` env vars and rerun `npm run migrate:local -w apps/worker` so the `tts_assets` table exists.
- **Supabase auth loop** – double-check the redirect URLs, and make sure `SUPABASE_*` envs match the dev project.
- **Wrangler dev 5xx** – run `wrangler whoami`, ensure D1 migrations are applied, and restart with `npm run dev:worker`.
- **Local evaluations wrong language** – open the Local Runtime desktop app → Settings → Models and confirm both STT + LLM defaults use the expected language/runtime.

When in doubt, inspect component-specific READMEs (especially `services/local-runtime-suite/README.md`) or run the desktop doctor's diagnostics page.
