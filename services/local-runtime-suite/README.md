# Local Runtime Suite

The Local Runtime Suite runs speech and language models on the learner's computer. It combines a loopback-only FastAPI gateway with a Tauri desktop application that manages the gateway, pairing key, models, settings, logs, and diagnostics.

## How the connection works

The desktop application owns one managed gateway process. The default address is `http://127.0.0.1:8484`.

The learner copies the local URL and pairing key from the desktop application into Therapy Settings. The browser then calls the gateway directly. Protected routes require the pairing key in the `Authorization: Bearer` header.

The gateway:

- binds to loopback by default;
- accepts only approved loopback hosts and configured browser origins;
- keeps prompts, transcripts, and model output out of ordinary logs;
- exposes a minimal public health response;
- protects model, diagnostic, log, configuration, and inference routes;
- records local evaluations as unverified when the hosted application persists them.

## Supported packaged models

| Model                                  | Endpoint                   | Platforms                                                | Packaged acceleration |
| -------------------------------------- | -------------------------- | -------------------------------------------------------- | --------------------- |
| Qwen3 4B Instruct MLX                  | `/v1/responses`            | Apple-silicon macOS                                      | Metal                 |
| Qwen3 4B Instruct through Transformers | `/v1/responses`            | Apple-silicon macOS, Windows x64, Linux x64              | Metal or CPU          |
| Parakeet MLX                           | `/v1/audio/transcriptions` | Apple-silicon macOS                                      | Metal                 |
| Faster Whisper                         | `/v1/audio/transcriptions` | Apple-silicon macOS, Intel macOS, Windows x64, Linux x64 | Platform-dependent    |

The Transformers package uses the official CPU-only PyTorch wheel on Windows and Linux. This keeps the desktop payload bounded and reproducible. Each default model download resolves an immutable Hugging Face commit recorded in the generated catalog; explicit environment overrides remain available for local development. Intel macOS supports Faster Whisper but not the packaged language model because PyTorch 2.13 has no compatible Intel-macOS wheel.

Both macOS packages require macOS 14 or later. This uniform minimum matches the newest native-library floor in the locked Apple-silicon payload and prevents older systems from installing a package whose model libraries cannot load.

The desktop and web interfaces filter the model catalog by the gateway's detected platform. Model downloads begin only after the user chooses models and asks the gateway to load them.

## Run the gateway for development

From the repository root:

```bash
npm run dev:local
```

For direct Python development, the gateway defaults to `~/.therapy/local-runtime/config.json`. The packaged desktop passes its platform-specific application configuration path explicitly and shows the exact configuration, data, and model-cache locations in the control centre. It creates a strong pairing key when none exists. The configuration controls the port, allowed origins, storage, cache, and model defaults. Ordinary logs are always metadata-only; the current desktop does not expose a content-logging toggle.

Use the desktop application for normal pairing and configuration. Direct API checks must include the pairing key on protected routes:

```bash
curl http://127.0.0.1:8484/health
curl \
  -H "Authorization: Bearer <pairing-key>" \
  http://127.0.0.1:8484/health/details
```

Interactive OpenAPI documentation is available at `http://127.0.0.1:8484/docs`, and the raw schema is available at `http://127.0.0.1:8484/openapi.json`. Inference, diagnostics, model, log, and detailed-health requests remain protected by the pairing key.

## Run the desktop application for development

```bash
cd services/local-runtime-suite/desktop
npm install
npm run tauri:dev
```

`tauri:dev` builds a native launcher and a portable Python sidecar before starting Tauri. Building the portable sidecar downloads a pinned Python runtime and installs the locked machine-learning dependencies, so the first build is large.

For frontend-only work:

```bash
npm run dev
```

Browser-only frontend development uses mocked Tauri commands where a native command is unavailable.

## Generate the model catalog

Every `python/local_runtime/models/model_*.py` module declares an executable model contract. Generate and validate the catalog with:

```bash
uv run --python 3.12 --no-project \
  --with-requirements services/local-runtime-suite/python/requirements-test.txt \
  python services/local-runtime-suite/tools/gen_models_json.py
```

The command writes `apps/web/public/local-suite/models.json`. Commit the generated catalog whenever model metadata changes.

## Add a model adapter

1. Copy `python/local_runtime/models/model_template.py`.
2. Give the file a `model_*.py` name.
3. Define an accurate `SPEC`, including the endpoint, real model reference, dependencies, memory guidance, and supported platforms.
4. Implement `load`, optional `warmup`, and `run`.
5. Add normal, failure, platform, and request-shape tests.
6. Run catalog generation and verify a real bounded backend path on every claimed backend family.

A catalog entry is a support claim. Do not list a platform until its dependency and execution path have executable evidence.

## Test the gateway

```bash
npm --prefix services/local-runtime-suite test
npm --prefix services/local-runtime-suite run lint
```

The Python tests cover access control, origins, configuration, model selection, concurrent loading, inference-request cancellation, model adapters, packaged-runtime inputs, and archive safety. Model-load jobs are not cooperatively cancellable: the desktop can stop waiting after its bounded timeout and recheck the same job later.

Real backend smoke tools are kept separate from unit tests because they download model fixtures. Every native package workflow run now requires a receipt for each advertised packaged cell: Apple-silicon Qwen Transformers, Faster Whisper, Qwen MLX, and Parakeet MLX; Intel-macOS Faster Whisper; and Windows/Linux Qwen Transformers plus Faster Whisper. Missing or extra backend receipts fail closed.

## Portable sidecar guarantees

`python/python-runtime-assets.json` pins Python 3.12.13 runtime archives and SHA-256 checksums for:

- Apple-silicon macOS;
- Intel macOS;
- Windows x64;
- Linux x64.

The builder rejects unknown or non-native targets. It validates archive paths, verifies the runtime checksum, installs from `uv.lock`, and invalidates its cache when runtime source, dependencies, or build inputs change. Tauri receives a target-suffixed launcher and the complete portable Python resource.

See [desktop/README.md](desktop/README.md) for native package and release controls.
