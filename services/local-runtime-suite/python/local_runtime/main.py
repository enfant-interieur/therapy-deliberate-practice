from __future__ import annotations

import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from local_runtime.api.openai_compat import (
    format_audio_transcription_response,
    format_error,
    format_models_list,
    format_responses_create,
    format_responses_stream,
)
from local_runtime.core.config import RuntimeConfig
from local_runtime.core.doctor import run_doctor
from local_runtime.core.errors import ModelNotFoundError
from local_runtime.core.loader import LoadedModel, load_models
from local_runtime.core.logging import configure_logging, get_recent_logs, pop_log_context, push_log_context
from local_runtime.core.readiness import ReadinessTracker
from local_runtime.core.load_manager import ModelLoadManager
from local_runtime.core.registry import ModelRegistry
from local_runtime.core.selector import SelectionStrategy, detect_platform, is_platform_supported
from local_runtime.core.selftest import run_startup_self_test
from local_runtime.core.supervisor import Supervisor
from local_runtime.helpers.multipart_helpers import enforce_max_size, extract_form_fields
from local_runtime.helpers.structured_enforcer import (
    StructuredOutputEnforcer,
    StructuredOutputFailure,
    detect_structured_mode,
    stream_validated_json,
)
from local_runtime.runtime_types import RunContext, RunRequest

LOGGER = configure_logging()
HOME_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Runtime Gateway</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at top, #101828 0%, #05060a 60%, #030303 100%);
      color: #f7f7f8;
    }
    .page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 24px 80px;
    }
    .hero {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 24px;
      margin-bottom: 32px;
    }
    .hero h1 {
      font-size: 2.6rem;
      margin: 0;
    }
    .hero p {
      margin: 4px 0 0;
      color: #cbd5f5;
      max-width: 640px;
    }
    .hero-meta {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hero-meta span {
      display: block;
    }
    .chip {
      background: rgba(255, 255, 255, 0.08);
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 0.9rem;
      color: #e3e8ff;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    .card {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(226, 232, 255, 0.08);
      border-radius: 20px;
      padding: 24px;
      box-shadow: 0 20px 60px rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(6px);
    }
    .card h2 {
      margin: 0 0 8px;
      font-size: 1.3rem;
    }
    .card p {
      margin: 0 0 16px;
      color: #94a3b8;
    }
    label {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 6px;
      color: #c3d3ff;
    }
    .inline-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      margin: 8px 0;
      color: #c3d3ff;
    }
    input[type="text"],
    input[type="number"],
    textarea,
    select {
      width: 100%;
      border-radius: 12px;
      border: 1px solid rgba(226, 232, 255, 0.2);
      background: rgba(15, 18, 30, 0.9);
      color: #f2f2f7;
      padding: 10px 14px;
      font-size: 1rem;
      margin-bottom: 12px;
      font-family: inherit;
    }
    textarea {
      min-height: 110px;
      resize: vertical;
    }
    button {
      border: none;
      border-radius: 999px;
      padding: 10px 20px;
      background: linear-gradient(120deg, #6366f1, #8b5cf6);
      color: white;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: transform 120ms ease, box-shadow 120ms ease;
    }
    button:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
    }
    .output {
      background: rgba(5, 8, 20, 0.85);
      border-radius: 14px;
      padding: 12px;
      min-height: 120px;
      overflow: auto;
      border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .logs {
      max-height: 320px;
      overflow: auto;
      font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
      background: rgba(2, 6, 23, 0.9);
      border-radius: 16px;
      padding: 16px;
      border: 1px solid rgba(99, 102, 241, 0.24);
    }
    .logs pre {
      margin: 0;
      color: #cbd5ff;
      white-space: pre-wrap;
      word-break: break-word;
    }
    audio {
      width: 100%;
      margin-top: 8px;
    }
    @media (max-width: 640px) {
      .hero h1 { font-size: 2rem; }
      .page { padding: 24px 16px 60px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <div>
        <h1>Local Runtime Gateway</h1>
        <p>Exercise the Responses, Speech, and Transcription pipelines without leaving your browser. Every action proxies the same OpenAI-compatible APIs exposed to the desktop app.</p>
      </div>
      <div class="hero-meta">
        <div class="chip">
          <span style="font-size:0.8rem; text-transform:uppercase; letter-spacing:0.08em;">Platform</span>
          <span id="platform-label">detecting…</span>
        </div>
        <div class="chip">
          <span style="font-size:0.8rem; text-transform:uppercase; letter-spacing:0.08em;">Default Models</span>
          <span id="defaults-summary">pending…</span>
        </div>
      </div>
    </header>

    <section class="grid">
      <article class="card">
        <h2>Responses API</h2>
        <p>Send a JSON Responses request and inspect the payload returned by the server.</p>
        <form id="responses-form">
          <label for="responses-model">Model Override</label>
          <input id="responses-model" type="text" placeholder="leave blank for default">
          <label for="responses-system">System Prompt</label>
          <input id="responses-system" type="text" placeholder="You are a helpful therapist...">
          <label for="responses-input">User Message</label>
          <textarea id="responses-input" placeholder="Describe your current mood..."></textarea>
          <button type="submit">Call /v1/responses</button>
        </form>
        <pre id="responses-output" class="output">// responses output</pre>
      </article>

      <article class="card">
        <h2>Structured Output Test</h2>
        <p>Exercise <code>text.format.type = "json_schema"</code> with strict validation enforced in the gateway.</p>
        <form id="structured-form">
          <label for="structured-model">Model Override</label>
          <input id="structured-model" type="text" placeholder="leave blank for default">
          <label for="structured-schema-name">Schema Name</label>
          <input id="structured-schema-name" type="text" value="StructuredOutput">
          <label for="structured-schema">JSON Schema</label>
          <textarea id="structured-schema" rows="6" placeholder='{"type":"object","properties":{"summary":{"type":"string"}}}'></textarea>
          <label class="inline-toggle">
            <input id="structured-strict" type="checkbox" checked>
            Strict mode (additional properties blocked)
          </label>
          <label for="structured-input">User Message</label>
          <textarea id="structured-input" placeholder="Ask the model for a JSON-only reply..."></textarea>
          <button type="submit">Run Structured Test</button>
        </form>
        <pre id="structured-output" class="output">// structured output</pre>
      </article>

      <article class="card">
        <h2>Speech API</h2>
        <p>Generate audio using the unified Chatterbox TTS backend with CFG + exaggeration controls.</p>
        <form id="speech-form">
          <label for="speech-model">Model Override</label>
          <input id="speech-model" type="text" placeholder="auto">
          <label for="speech-language">Language / Lang Code</label>
          <input id="speech-language" type="text" placeholder="en / fr / zh">
          <label for="speech-audio-prompt">Audio Prompt Path (optional)</label>
          <input id="speech-audio-prompt" type="text" placeholder="/path/to/reference.wav">
          <label for="speech-text">Narration Text</label>
          <textarea id="speech-text" placeholder="Share a short calming message."></textarea>
          <div style="display:flex; gap:12px;">
            <div style="flex:1;">
              <label for="speech-cfg">CFG Weight</label>
              <input id="speech-cfg" type="number" value="0.5" step="0.1">
            </div>
            <div style="flex:1;">
              <label for="speech-exaggeration">Exaggeration</label>
              <input id="speech-exaggeration" type="number" value="0" step="0.5">
            </div>
          </div>
          <button type="submit">Call /v1/audio/speech</button>
        </form>
        <div id="speech-output" class="output">// speech status</div>
        <audio id="speech-audio" controls></audio>
      </article>

      <article class="card">
        <h2>Transcriptions API</h2>
        <p>Upload a short WAV/MP3 and watch the transcription come back in OpenAI format.</p>
        <form id="transcribe-form" enctype="multipart/form-data">
          <label for="transcribe-model">Model Override</label>
          <input id="transcribe-model" type="text" placeholder="auto">
          <label for="transcribe-language">Language Hint</label>
          <input id="transcribe-language" type="text" placeholder="fr / en / auto">
          <label for="transcribe-file">Audio File</label>
          <input id="transcribe-file" type="file" accept="audio/*">
          <button type="submit">Call /v1/audio/transcriptions</button>
        </form>
        <pre id="transcribe-output" class="output">// transcription output</pre>
      </article>
    </section>

    <section class="card">
      <h2 style="margin-top:0;">Live Logs</h2>
      <p style="color:#94a3b8; margin-top:0;">Latest structured log events streamed from the runtime (auto-refresh every 3s).</p>
      <div class="logs"><pre id="log-stream">waiting for events…</pre></div>
    </section>
  </div>

  <script>
    const pretty = (value) => {
      if (value === undefined || value === null) return "";
      if (typeof value === "string") {
        try { return JSON.stringify(JSON.parse(value), null, 2); }
        catch { return value; }
      }
      return JSON.stringify(value, null, 2);
    };
    const defaultStructuredSchema = {
      type: "object",
      properties: {
        summary: { type: "string" },
        mood: { type: "string" }
      }
    };
    const structuredSchemaEl = document.getElementById("structured-schema");
    if (structuredSchemaEl) {
      structuredSchemaEl.value = JSON.stringify(defaultStructuredSchema, null, 2);
    }

    async function fetchHealth() {
      try {
        const res = await fetch("/health");
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById("platform-label").textContent = data.platform_id || "unknown";
        const defaults = data.defaults || {};
        const summary = Object.entries(defaults).map(([key, value]) => key + ": " + value).join(" • ") || "auto-select";
        document.getElementById("defaults-summary").textContent = summary;
      } catch (err) {
        console.error(err);
      }
    }

    async function refreshLogs() {
      try {
        const res = await fetch("/logs?limit=120");
        if (!res.ok) return;
        const data = await res.json();
        const lines = (data.logs || []).map((entry) => JSON.stringify(entry));
        document.getElementById("log-stream").textContent = lines.join("\\n");
      } catch (err) {
        document.getElementById("log-stream").textContent = "Failed to load logs: " + err.message;
      }
    }

    document.getElementById("responses-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const model = document.getElementById("responses-model").value.trim();
      const systemPrompt = document.getElementById("responses-system").value.trim();
      const userInput = document.getElementById("responses-input").value.trim();
      if (!userInput) {
        document.getElementById("responses-output").textContent = "Enter a prompt first.";
        return;
      }
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: userInput });
      const payload = { messages, stream: false };
      if (model) payload.model = model;
      try {
        const res = await fetch("/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        if (!res.ok) {
          document.getElementById("responses-output").textContent = pretty(body);
          return;
        }
        document.getElementById("responses-output").textContent = pretty(body);
      } catch (err) {
        document.getElementById("responses-output").textContent = err.message;
      }
    });

    document.getElementById("structured-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const model = document.getElementById("structured-model").value.trim();
      const schemaName = document.getElementById("structured-schema-name").value.trim() || "StructuredOutput";
      const schemaText = document.getElementById("structured-schema").value.trim();
      const strict = document.getElementById("structured-strict").checked;
      const userInput = document.getElementById("structured-input").value.trim();
      const outputEl = document.getElementById("structured-output");
      if (!userInput) {
        outputEl.textContent = "Enter a prompt first.";
        return;
      }
      let schema;
      try {
        schema = JSON.parse(schemaText);
      } catch (err) {
        outputEl.textContent = "Schema must be valid JSON: " + err.message;
        return;
      }
      const payload = {
        input: userInput,
        stream: false,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: strict,
            schema,
          },
        },
      };
      if (model) payload.model = model;
      outputEl.textContent = "Calling /v1/responses…";
      try {
        const res = await fetch("/v1/responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json();
        outputEl.textContent = pretty(body);
      } catch (err) {
        outputEl.textContent = err.message;
      }
    });

    document.getElementById("speech-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const model = document.getElementById("speech-model").value.trim();
      const language = document.getElementById("speech-language").value.trim();
      const audioPrompt = document.getElementById("speech-audio-prompt").value.trim();
      const text = document.getElementById("speech-text").value.trim();
      const cfg = parseFloat(document.getElementById("speech-cfg").value || "0.5");
      const exaggeration = parseFloat(document.getElementById("speech-exaggeration").value || "0");
      if (!text) {
        document.getElementById("speech-output").textContent = "Provide text to synthesize.";
        return;
      }
      const payload = {
        input: text,
        stream: false,
        cfg_weight: cfg,
        exaggeration,
      };
      if (language) payload.language = language;
      if (audioPrompt) payload.audio_prompt_path = audioPrompt;
      if (model) payload.model = model;
      document.getElementById("speech-output").textContent = "Generating audio…";
      document.getElementById("speech-audio").removeAttribute("src");
      try {
        const res = await fetch("/v1/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json();
          document.getElementById("speech-output").textContent = pretty(err);
          return;
        }
        const arrayBuf = await res.arrayBuffer();
        const blob = new Blob([arrayBuf], { type: res.headers.get("content-type") || "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = document.getElementById("speech-audio");
        audio.src = url;
        audio.load();
        document.getElementById("speech-output").textContent = "Ready. Hit play to listen.";
      } catch (err) {
        document.getElementById("speech-output").textContent = err.message;
      }
    });

    document.getElementById("transcribe-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = document.getElementById("transcribe-file").files[0];
      if (!file) {
        document.getElementById("transcribe-output").textContent = "Pick an audio file first.";
        return;
      }
      const formData = new FormData();
      formData.append("file", file, file.name);
      const model = document.getElementById("transcribe-model").value.trim();
      const language = document.getElementById("transcribe-language").value.trim();
      if (model) formData.append("model", model);
      if (language) formData.append("language", language);
      formData.append("response_format", "json");
      formData.append("stream", "false");
      document.getElementById("transcribe-output").textContent = "Transcribing…";
      try {
        const res = await fetch("/v1/audio/transcriptions", {
          method: "POST",
          body: formData,
        });
        const body = await res.json();
        if (!res.ok) {
          document.getElementById("transcribe-output").textContent = pretty(body);
          return;
        }
        document.getElementById("transcribe-output").textContent = pretty(body);
      } catch (err) {
        document.getElementById("transcribe-output").textContent = err.message;
      }
    });

    fetchHealth();
    refreshLogs();
    setInterval(refreshLogs, 3000);
  </script>
</body>
</html>
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = LOGGER
    app.state.logger = logger
    readiness = ReadinessTracker()
    app.state.readiness = readiness
    readiness.mark_phase("config", "ok")
    try:
        config = RuntimeConfig.load()
        config.ensure_dirs()
        app.state.config = config
        platform_id = detect_platform()
        app.state.platform_id = platform_id
        readiness.platform_id = platform_id
        logger.info("startup.platform", extra={"platform_id": platform_id})

        models = load_models()
        readiness.mark_phase("discover_models", "ok", detail=f"models={len(models)}")
        registry = ModelRegistry(models, platform_id, logger)
        app.state.registry = registry

        selection = SelectionStrategy(platform_id)
        app.state.selection = selection
        computed_defaults = selection.compute_defaults(registry.models_by_endpoint)
        allowed_endpoints = set(registry.models_by_endpoint.keys())
        user_defaults = config.default_models or {}
        defaults: dict[str, str] = {
            endpoint: model_id
            for endpoint, model_id in computed_defaults.items()
            if endpoint in allowed_endpoints
        }
        for endpoint, model_id in user_defaults.items():
            if endpoint not in allowed_endpoints:
                logger.warning(
                    "defaults.override.skipped",
                    extra={"endpoint": endpoint, "model_id": model_id, "reason": "unknown_endpoint"},
                )
                continue
            loaded_model = registry.get_loaded(model_id)
            if loaded_model and is_platform_supported(loaded_model.spec, platform_id):
                defaults[endpoint] = model_id
            else:
                logger.warning(
                    "defaults.override.skipped",
                    extra={"endpoint": endpoint, "model_id": model_id, "reason": "platform_not_supported"},
                )
        config.default_models = defaults
        registry.set_defaults(defaults)
        readiness.defaults = defaults
        readiness.mark_phase("select_defaults", "ok", detail=str(defaults))

        app.state.http_client = httpx.AsyncClient(timeout=30)
        app.state.supervisor = Supervisor()
        app.state.started_at = time.time()
        load_manager = ModelLoadManager(registry, lambda rid: _ctx_factory(rid), readiness, logger)
        app.state.load_manager = load_manager

        await registry.run_startup_hooks(lambda rid: _ctx_factory(rid))
        readiness.mark_phase("startup_hooks", "ok")

        preload_all = _env_flag("LOCAL_RUNTIME_PRELOAD_ALL", False)
        if preload_all:
            targets = [model.spec.id for model in registry.list_models()]
        else:
            targets = list(dict.fromkeys(defaults.values()))
        if targets:
            job = load_manager.create_job(targets)
            await load_manager.wait_for_job(job.id)
            readiness.loaded_models = sorted(registry.model_instances.keys())
            readiness.mark_phase("preload", "ok", detail=f"job_id={job.id} status={job.status}")
        else:
            readiness.mark_phase("preload", "ok", detail="no targets")

        selftest_enabled = _env_flag("LOCAL_RUNTIME_SELFTEST", False)
        strict_selftest = _env_flag("LOCAL_RUNTIME_SELFTEST_STRICT", False)
        if selftest_enabled:
            try:
                await run_startup_self_test(registry, defaults, _ctx_factory, readiness, strict_selftest)
            except Exception as exc:
                logger.exception("selftest.failed", extra={"error": str(exc)})
                if strict_selftest:
                    readiness.mark_error("self_test_failed")
                    raise
        else:
            readiness.self_test.status = "skipped"
            readiness.self_test.started_at = readiness.self_test.finished_at = time.time()
        readiness.mark_ready()
        yield
    except Exception:
        readiness.mark_error("startup_failure")
        raise
    finally:
        registry: ModelRegistry | None = getattr(app.state, "registry", None)
        if registry:
            await registry.shutdown(lambda rid: _ctx_factory(rid))
        http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
        if http_client:
            await http_client.aclose()


app = FastAPI(title="Local Runtime Gateway", version="0.2.0", lifespan=lifespan)


def _parse_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _resolve_cors_settings() -> tuple[list[str], str | None]:
    """
    Allow localhost/127.0.0.1 origins by default while enabling overrides via env.
    LOCAL_RUNTIME_ALLOW_ORIGINS="https://app.example.com,https://studio.example.com"
    """
    raw = os.getenv("LOCAL_RUNTIME_ALLOW_ORIGINS")
    if raw:
        origins = _parse_csv(raw)
        if "*" in origins:
            return ["*"], None
        return origins, None
    # Allow any localhost / 127.0.0.1 origin + port (dev server, desktop wrapper, etc).
    return [], r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


cors_origins, cors_regex = _resolve_cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or [],
    allow_origin_regex=cors_regex,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _build_context(request_id: str, endpoint: str | None = None, model_id: str | None = None) -> RunContext:
    config: RuntimeConfig = app.state.config
    return RunContext(
        request_id=request_id,
        logger=app.state.logger,
        data_dir=config.data_dir,
        cache_dir=config.cache_dir,
        platform=app.state.platform_id,
        registry=app.state.registry,
        http_client=app.state.http_client,
        cancellation_token=None,
    )


def _resolve_requested_model(endpoint: str, requested: str | None) -> str | None:
    if requested:
        return requested
    registry: ModelRegistry = app.state.registry
    return registry.selected_defaults.get(endpoint)


def _ctx_factory(request_id: str, endpoint: str | None = None, model_id: str | None = None) -> RunContext:
    return _build_context(request_id, endpoint=endpoint, model_id=model_id)


@app.get("/", response_class=HTMLResponse)
async def home_page() -> HTMLResponse:
    return HTMLResponse(HOME_HTML)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next: Callable):
    request_id = request.headers.get("x-request-id") or f"req_{uuid.uuid4().hex}"
    request.state.request_id = request_id
    token = push_log_context(request_id=request_id, endpoint=str(request.url.path))
    start = time.perf_counter()
    logger = getattr(app.state, "logger", LOGGER)
    try:
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.info(
            "request.complete",
            extra={"request_id": request_id, "endpoint": str(request.url.path), "status": response.status_code, "duration_ms": duration_ms},
        )
        response.headers["x-request-id"] = request_id
        return response
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        logger.exception("request.error", extra={"request_id": request_id, "endpoint": str(request.url.path), "duration_ms": duration_ms})
        raise
    finally:
        pop_log_context(token)


@app.get("/health")
async def health() -> JSONResponse:
    data = app.state.readiness.as_payload()
    workers = [worker.__dict__ for worker in app.state.supervisor.status()]
    data["workers"] = workers
    return JSONResponse(data)


@app.get("/logs")
async def logs(limit: int = 200) -> JSONResponse:
    safe_limit = 200
    try:
        safe_limit = max(1, min(int(limit), 500))
    except (TypeError, ValueError):
        pass
    payload = {"logs": get_recent_logs(safe_limit)}
    return JSONResponse(payload)


@app.get("/v1/models")
async def list_models() -> JSONResponse:
    registry: ModelRegistry = app.state.registry
    payload = format_models_list(registry.list_models(), int(app.state.started_at))
    return JSONResponse(payload)


@app.post("/load_models")
async def trigger_model_load(request: Request) -> JSONResponse:
    load_manager: ModelLoadManager = app.state.load_manager
    registry: ModelRegistry = app.state.registry
    logger = getattr(app.state, "logger", LOGGER)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    requested_models = payload.get("models")
    scope = str(payload.get("scope") or "selected").lower()
    targets: list[str]
    if requested_models:
        if isinstance(requested_models, str):
            targets = [requested_models]
        elif isinstance(requested_models, (list, tuple, set)):
            targets = [str(model_id) for model_id in requested_models if model_id]
        else:
            raise HTTPException(status_code=400, detail="models must be a string or list of strings")
        scope = "custom"
    else:
        if scope == "all":
            targets = [loaded.spec.id for loaded in registry.list_models()]
        elif scope == "selected":
            targets = [model_id for model_id in dict.fromkeys(registry.selected_defaults.values()) if model_id]
        else:
            raise HTTPException(status_code=400, detail="scope must be 'selected' or 'all'")
    filtered: list[str] = []
    missing: list[str] = []
    for model_id in dict.fromkeys(targets):
        if not model_id:
            continue
        if registry.get_loaded(model_id):
            filtered.append(model_id)
        else:
            missing.append(model_id)
    if missing:
        logger.warning("load_models.unknown_models", extra={"models": missing, "scope": scope})
    targets = filtered
    if not targets:
        raise HTTPException(status_code=400, detail="No models specified for loading")

    job = load_manager.create_job(targets)
    return JSONResponse({"job_id": job.id, "status": job.to_dict()})


@app.get("/load_models/{job_id}")
async def get_model_load_status(job_id: str) -> JSONResponse:
    load_manager: ModelLoadManager = app.state.load_manager
    job = load_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Load job not found")
    return JSONResponse(job.to_dict())


def _select_model(endpoint: str, requested: str | None) -> LoadedModel:
    registry: ModelRegistry = app.state.registry
    selection: SelectionStrategy = app.state.selection
    requested_id = _resolve_requested_model(endpoint, requested)
    models = registry.models_by_endpoint.get(endpoint, [])
    if not models:
        raise ModelNotFoundError(f"No models available for endpoint {endpoint}")
    return selection.select(models, endpoint, requested=requested_id)


@app.post("/v1/responses")
async def responses(request: Request) -> Response:
    payload = await request.json()
    stream = bool(payload.get("stream"))
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("responses", payload.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    ctx = _ctx_factory(request_id, endpoint="responses", model_id=model_id)
    try:
        structured_config = detect_structured_mode(payload)
    except ValueError as exc:
        return format_error(str(exc), err_type="invalid_request_error", status_code=400)
    start = time.perf_counter()
    if structured_config:
        enforcer = StructuredOutputEnforcer(selected=selected, ctx=ctx, config=structured_config, request_id=request_id)
        try:
            structured_result = await enforcer.run(payload)
        except StructuredOutputFailure as exc:
            return format_error(str(exc), err_type="invalid_request_error", status_code=422)
        except RuntimeError as exc:  # jsonschema missing or unexpected enforcement failure
            return format_error(str(exc), status_code=500)
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        app.state.logger.info(
            "responses.run",
            extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms, "structured": True, "attempts": structured_result.attempts},
        )
        if stream:
            return StreamingResponse(
                format_responses_stream(stream_validated_json(model_id, structured_result.canonical_text, request_id=request_id)),
                media_type="text/event-stream",
            )
        payload_out = format_responses_create(structured_result.canonical_text, model_id, request_id=request_id)
        return JSONResponse(payload_out)
    run_request = RunRequest(endpoint="responses", model=model_id, json=payload, stream=stream)
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("responses.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    if stream:
        return StreamingResponse(format_responses_stream(result), media_type="text/event-stream")
    payload_out = format_responses_create(result, model_id, request_id=request_id)
    return JSONResponse(payload_out)


@app.post("/v1/audio/speech")
async def audio_speech(request: Request) -> JSONResponse:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    app.state.logger.info(
        "audio.speech.disabled",
        extra={"request_id": request_id},
    )
    return JSONResponse(
        {"message": "Text-to-speech is not enabled in this build of the local runtime."},
        status_code=503,
    )


@app.post("/v1/audio/transcriptions")
async def audio_transcriptions(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    response_format = fields.get("response_format", "json")
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("audio.transcriptions", fields.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    if "file" not in files:
        return format_error("Missing file", err_type="invalid_request_error", status_code=400)
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)
    run_request = RunRequest(
        endpoint="audio.transcriptions",
        model=model_id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    ctx = _ctx_factory(request_id, endpoint="audio.transcriptions", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("audio.transcriptions.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    return format_audio_transcription_response(result, response_format, stream)


@app.post("/v1/audio/translations")
async def audio_translations(request: Request) -> Response:
    form = await request.form()
    fields, files = extract_form_fields(form)
    stream = str(fields.get("stream", "false")).lower() == "true"
    response_format = fields.get("response_format", "json")
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex}")
    try:
        selected = _select_model("audio.translations", fields.get("model"))
    except ModelNotFoundError as exc:
        return format_error(str(exc), err_type="not_found", status_code=404)
    model_id = selected.spec.id
    if "file" not in files:
        return format_error("Missing file", err_type="invalid_request_error", status_code=400)
    enforce_max_size(files["file"], selected.spec.limits.max_input_mb)
    run_request = RunRequest(
        endpoint="audio.translations",
        model=model_id,
        form=fields,
        files={"file": files["file"].__dict__},
        stream=stream,
    )
    ctx = _ctx_factory(request_id, endpoint="audio.translations", model_id=model_id)
    start = time.perf_counter()
    result = await selected.module.run(run_request, ctx)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    app.state.logger.info("audio.translations.run", extra={"request_id": request_id, "model_id": model_id, "duration_ms": duration_ms})
    return format_audio_transcription_response(result, response_format, stream)


@app.get("/doctor")
async def doctor() -> JSONResponse:
    return JSONResponse({"checks": [check.__dict__ for check in run_doctor()]})


def main() -> None:
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Local runtime gateway")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--config", type=str, default=None)
    args = parser.parse_args()

    config_path = Path(args.config) if args.config else None
    config = RuntimeConfig.load(config_path)
    if args.port is not None:
        config.port = args.port
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=config.port,
        reload=_env_flag("LOCAL_RUNTIME_RELOAD", False),
    )


if __name__ == "__main__":
    main()
