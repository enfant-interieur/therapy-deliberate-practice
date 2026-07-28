# Therapy Deliberate Practice Studio

Therapy Deliberate Practice Studio helps psychotherapy trainees practise specific communication skills, record or type a response, and review structured feedback. The repository also contains an optional desktop Local Runtime Suite for running speech and language models on the learner's computer.

## What is in this repository

```text
apps/
  web/                    React learner and administration interface
  api/                    Shared Hono API, provider, and persistence code
  worker/                 Cloudflare Worker, D1 migrations, and R2 integration
packages/
  shared/                 Shared application types and utilities
services/
  local-runtime-suite/    FastAPI gateway, model adapters, and Tauri desktop app
infra/                    Local development resources
```

The production web path uses a Cloudflare Worker with D1 and R2. The desktop app starts a loopback-only FastAPI gateway. When local AI is selected, the browser calls that gateway directly; a hosted Worker cannot reach a learner's `127.0.0.1`.

## Requirements

- Node.js 24 LTS
- npm 11
- Python 3.12 and `uv` for Local Runtime development
- Rust stable and the Tauri platform prerequisites for desktop development
- Wrangler for Cloudflare Worker development
- A Supabase project for authentication
- A Cloudflare account for production D1, R2, and Worker resources

The root `package.json` pins the supported Node.js and npm ranges.

## First local setup

Install the JavaScript dependencies:

```bash
npm ci
```

Copy the environment example:

```bash
cp .env.example .env
```

Set the values required by the surface you are running. Keep all secret values out of source control.

For the web client, create `apps/web/.env`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The Vite variables are public browser configuration. Never put service-role keys or other secrets in a `VITE_` variable.

## Run the web application

For the Worker-backed application:

```bash
npm run dev
```

This starts the Worker development server and the Vite web server. You can also start them separately:

```bash
npm run dev:worker
npm run dev:web
```

The Node and SQLite API adapter remains available for focused local development:

```bash
npm run dev:api
```

## Use local models

The supported learner flow uses one local gateway for speech recognition and language evaluation.

1. Start the Local Runtime Suite from its desktop application or run the development gateway:

   ```bash
   npm run dev:local
   ```

2. Open the desktop application and wait until the gateway is ready.
3. Copy the local URL and pairing key shown by the desktop application.
4. Open Settings in the Therapy web application.
5. Select local AI, paste both values, and test the connection.
6. Load compatible speech and language models before starting practice.

The pairing key is stored in the browser for that exact loopback origin. The browser sends it only to the local gateway as a bearer credential. It is not sent to the hosted API, included in a URL, or written to ordinary application logs.

The default gateway origin is `http://127.0.0.1:8484`. Protected gateway routes require the pairing key. The public health route reveals only basic product status.

See [services/local-runtime-suite/README.md](services/local-runtime-suite/README.md) for model support, gateway development, and packaging details.

## Local-model support

The generated catalog in `apps/web/public/local-suite/models.json` is the source shown by the web and desktop interfaces.

| Model                                  | Purpose             | Packaged platforms                                       |
| -------------------------------------- | ------------------- | -------------------------------------------------------- |
| Qwen3 4B Instruct MLX                  | Language evaluation | Apple-silicon macOS                                      |
| Qwen3 4B Instruct through Transformers | Language evaluation | Apple-silicon macOS, Windows x64, Linux x64              |
| Parakeet MLX                           | Speech recognition  | Apple-silicon macOS                                      |
| Faster Whisper                         | Speech recognition  | Apple-silicon macOS, Intel macOS, Windows x64, Linux x64 |

Intel macOS does not advertise a packaged language model because PyTorch 2.13 has no Python 3.12 Intel-macOS wheel. The desktop interface filters the catalog by the detected platform instead of offering a model that cannot load.

## Configure authentication

In Supabase:

1. Enable the required Google and GitHub authentication providers.
2. Add `http://localhost:5173/login` for local development.
3. Add the production `/login` URL for the deployed application.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` for the relevant runtime.

The anonymous key is browser-visible by design. The JWT secret is sensitive and must remain a server-side secret.

## Configure text-to-speech and R2

Real Time Mode generates or reuses patient audio and stores it in R2.

The Worker uses the `deliberate_practice_audio` R2 binding declared in `apps/worker/wrangler.jsonc`. Set `R2_BUCKET` to the bound bucket name. The Worker does not need S3-compatible R2 access keys.

The Node adapter uses the S3-compatible variables in `.env`:

```dotenv
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=deliberate-practice-audio
R2_PUBLIC_BASE_URL=
R2_S3_ENDPOINT=
```

Set `OPENAI_API_KEY` when hosted text-to-speech or hosted evaluation is required. The Worker value must be a Wrangler secret.

## Configure background queues

Administrator batch parsing and patient-audio generation use Cloudflare Queues so long-running work does not block the Worker request. Create the production queues once:

```bash
npx wrangler queues create admin-batch-parse
npx wrangler queues create patient-audio
```

The `ADMIN_BATCH_PARSE_QUEUE` and `PATIENT_AUDIO_QUEUE` producer and consumer bindings are declared in `apps/worker/wrangler.jsonc`. Keep those names aligned with the queues in the intended Cloudflare account. Queue creation and remote binding changes are production mutations and require explicit deployment authorization.

## Database migrations

Cloudflare tracks D1 migrations in `apps/worker/migrations`.

Apply local D1 migrations:

```bash
npm run migrate:local -w apps/worker
```

Apply remote D1 migrations only when you are deliberately changing the configured production database:

```bash
npm run migrate:remote -w apps/worker
```

Initialize the local SQLite database from the same schema:

```bash
sqlite3 apps/api/infra/local.db < apps/worker/migrations/0001_init_v2.sql
sqlite3 apps/api/infra/local.db < apps/api/infra/seed.sql
```

Apply the text-to-speech asset migration when the local database does not yet contain it:

```bash
sqlite3 apps/api/infra/local.db < apps/worker/migrations/0002_add_tts_assets.sql
```

## Administration

Local administration can use the development bypass only when `ENV=development`:

```dotenv
ENV=development
BYPASS_ADMIN_AUTH=true
DEV_ADMIN_TOKEN=choose-a-local-token
```

Store the token in browser local storage for local testing:

```js
localStorage.setItem("devAdminToken", "<DEV_ADMIN_TOKEN>");
```

Production administration uses Cloudflare Access plus `ADMIN_EMAILS`, `ADMIN_GROUPS`, `CF_ACCESS_AUD`, and the exact Access team origin in `CF_ACCESS_ISSUER` (for example, `https://your-team.cloudflareaccess.com`, without a trailing slash). Keep the development bypass disabled in production. The API fails closed when the audience or issuer is missing or invalid.

Authorized administrators can curate authors, criteria, patient examples, interaction examples, translations, publication state, and bulk selections. Batch parsing and patient-audio generation expose queued progress instead of holding the request open.

## Validate a change

Run the bounded repository checks:

```bash
npm run lint
npm test
npm run build
npm run audit:production
```

The continuous-integration workflow also checks Python formatting and tests, the generated model catalog, Rust formatting and tests, workflow syntax, and desktop release metadata.

Desktop package builds are manual and build-only. They do not create or update a GitHub Release. See [services/local-runtime-suite/desktop/README.md](services/local-runtime-suite/desktop/README.md) for the release boundary.

## Deployment boundary

Building and testing this repository does not deploy the Worker or publish a desktop release.

The Worker deployment command is:

```bash
npm run deploy:prod
```

Run it only with explicit deployment authorization and the intended Cloudflare account selected.

Desktop publication uses a separate manual workflow that validates the selected version tag and matching native build, signatures, notarization, and an explicit `PUBLISH` confirmation before it can create a draft release. GitHub environment protection is a repository setting, not something workflow YAML can establish. Treat publication as disabled until administrators independently verify required reviewers, no-bypass rules, version-tag restrictions, and environment-scoped credentials for both desktop release environments. Even after that setup, a human must inspect and publish any draft separately.

## Environment reference

Common server-side variables are:

- `OPENAI_API_KEY`
- `OPENAI_KEY_ENCRYPTION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_JWT_SECRET`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`
- `ADMIN_EMAILS`
- `ADMIN_GROUPS`
- `CF_ACCESS_AUD`
- `CF_ACCESS_ISSUER`
- `ENV`
- `BYPASS_ADMIN_AUTH`
- `DEV_ADMIN_TOKEN`

`AI_MODE`, `LOCAL_STT_URL`, `LOCAL_LLM_URL`, and `LOCAL_LLM_MODEL` remain for the Node adapter and compatibility tests. The production learner flow does not expect a hosted Worker to call those loopback URLs. Users configure the browser-to-gateway connection in Therapy Settings.
