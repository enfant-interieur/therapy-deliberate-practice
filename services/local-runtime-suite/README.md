# Local Runtime Suite

The Local Runtime Suite provides a drop-in OpenAI-compatible gateway plus a desktop launcher for running local models.

## Development

### Gateway

```bash
# from repo root
npm run dev:local
```

This runs the FastAPI gateway on `http://127.0.0.1:8484` (configurable via `~/.therapy/local-runtime/config.json`).

### Desktop launcher

```bash
cd services/local-runtime-suite/desktop
npm install
npm run dev
```

## Adding a model module

1. Copy `services/local-runtime-suite/python/local_runtime/models/model_template.py` to a new file named
   `model_<provider>_<name>.py`.
2. Update the `SPEC` dict fields (especially `id`, `api.endpoint`, `backend`, and `deps`).
3. Implement `async def run(req: RunRequest, ctx: RunContext)`.
4. Validate the module:

```bash
python services/local-runtime-suite/tools/gen_models_json.py
```

## Model catalog generation

`tools/gen_models_json.py` imports every `model_*.py` module, validates `SPEC` via Pydantic, and writes the catalog to:

```
apps/web/public/local-suite/models.json
```

The Help → Local Suite page reads this JSON at runtime to populate the searchable model list.

## Troubleshooting / Doctor

The desktop launcher surfaces the doctor checks at `/doctor`. Example output:

```json
{
  "checks": [
    {
      "title": "Python version",
      "status": "ok",
      "details": "Running 3.11.5",
      "fix": "Install Python 3.10+ and set it as the default interpreter."
    }
  ]
}
```
