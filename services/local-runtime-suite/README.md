# Local Runtime Suite

The Local Runtime Suite ships a desktop launcher and a local OpenAI-compatible gateway.

## Quickstart

```bash
cd services/local-runtime-suite
python -m venv .venv
source .venv/bin/activate
pip install -e python[dev]

# run the gateway
./tools/dev.sh
```

Gateway defaults to `http://127.0.0.1:8000`.

## Model Modules

Models are Python modules in `python/local_runtime/models` with a `SPEC` dict and `run()` function.

To add a model:

1. Copy `python/local_runtime/models/model_template.py`.
2. Update the `SPEC` fields.
3. Implement `run()` for the endpoint in `SPEC["api"]["endpoint"]`.
4. Validate with:
   ```bash
   python -m local_runtime.core.loader --validate
   ```

## Doctor

Run preflight checks:

```bash
python -m local_runtime.core.doctor
```

Example output:

```
[doctor] ffmpeg: missing
Fix: brew install ffmpeg
```

## Troubleshooting

- **Gateway won't start**: ensure Python dependencies are installed and port 8000 is free.
- **Models missing**: run `python -m local_runtime.core.loader --validate` and fix any spec errors.
- **STT file too large**: default max is 25MB; increase in config if needed.

## Development Scripts

- `./tools/dev.sh` launches the gateway with auto-reload.
- `./tools/dev.ps1` is the PowerShell equivalent on Windows.
