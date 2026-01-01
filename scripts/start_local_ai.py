#!/usr/bin/env python3
import base64
import json
import logging
import os
import platform
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import importlib.util

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


LLM_PORT = int(os.getenv("LOCAL_LLM_PORT", "7002"))
TTS_PORT = int(os.getenv("LOCAL_TTS_PORT", "7003"))

LLM_MODEL_MLX = os.getenv("LOCAL_LLM_MODEL", "Qwen/Qwen3-4B-MLX-4bit")
LLM_MODEL_HF = os.getenv("LOCAL_LLM_MODEL", "Qwen/Qwen3-4B-Instruct-2507")

TTS_MLX_MODEL = os.getenv("LOCAL_TTS_MODEL", "mlx-community/Kokoro-82M-bf16")
TTS_MLX_VOICE_FR = os.getenv("LOCAL_TTS_VOICE_FR", "ff_siwis")
TTS_MLX_VOICE_EN = os.getenv("LOCAL_TTS_VOICE_EN", "af_bella")

LLM_MAX_TOKENS = int(os.getenv("LOCAL_LLM_MAX_TOKENS", "2048"))

logger = logging.getLogger("local-ai")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine().lower() in {"arm64", "aarch64"}


def require_module(module_name: str, hint: str) -> None:
    if importlib.util.find_spec(module_name) is None:
        raise RuntimeError(f"Missing dependency: {module_name}. {hint}")


def detect_language(text: str) -> str:
    if importlib.util.find_spec("langdetect") is not None:
        from langdetect import detect

        return detect(text)
    lower = text.lower()
    french_markers = ["bonjour", "merci", "au revoir", "ça", "être", "je suis", "docteur", "triste"]
    if any(marker in lower for marker in french_markers) or any(char in lower for char in "éèêàùçô"):
        return "fr"
    return "en"


def encode_wav(samples, sample_rate: int) -> str:
    import io
    import wave

    require_module("numpy", "Install numpy to encode audio responses.")
    import numpy as np

    data = np.asarray(samples, dtype=np.float32)
    if data.ndim > 1:
        data = data[0]
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


class EvaluateRequest(BaseModel):
    task: Dict[str, Any]
    example: Dict[str, Any]
    attempt_id: str
    transcript: Dict[str, Any]


class TtsRequest(BaseModel):
    text: str
    language: Optional[str] = None


class TtsResponse(BaseModel):
    audio_base64: str
    sample_rate: int


SYSTEM_PROMPT = (
    "You are an evaluator for psychotherapy deliberate practice tasks. "
    "Return strict JSON only that matches EvaluationResult with criterion_scores."
)


@dataclass
class LlmRuntime:
    mode: str
    model_name: str
    model: Any
    tokenizer: Any


def load_llm_runtime(use_mlx: bool) -> LlmRuntime:
    if use_mlx:
        require_module("mlx_lm", "Install mlx-lm to run MLX LLM inference.")
        from mlx_lm import load, generate

        model, tokenizer = load(LLM_MODEL_MLX)
        model.generate_text = lambda prompt: generate(model, tokenizer, prompt, max_tokens=LLM_MAX_TOKENS)
        return LlmRuntime(mode="mlx", model_name=LLM_MODEL_MLX, model=model, tokenizer=tokenizer)

    require_module("transformers", "Install transformers and torch to run the Hugging Face model.")
    require_module("torch", "Install torch to run the Hugging Face model.")
    from transformers import AutoModelForCausalLM, AutoTokenizer
    import torch

    tokenizer = AutoTokenizer.from_pretrained(LLM_MODEL_HF)
    model = AutoModelForCausalLM.from_pretrained(LLM_MODEL_HF, torch_dtype="auto", device_map="auto")

    def generate_text(prompt: str) -> str:
        if hasattr(tokenizer, "apply_chat_template"):
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ]
            text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        else:
            text = f"{SYSTEM_PROMPT}\n\n{prompt}"
        model_inputs = tokenizer([text], return_tensors="pt").to(model.device)
        generated_ids = model.generate(**model_inputs, max_new_tokens=LLM_MAX_TOKENS)
        output_ids = generated_ids[0][len(model_inputs.input_ids[0]) :].tolist()
        return tokenizer.decode(output_ids, skip_special_tokens=True)

    model.generate_text = generate_text
    return LlmRuntime(mode="hf", model_name=LLM_MODEL_HF, model=model, tokenizer=tokenizer)


@dataclass
class TtsRuntime:
    mode: str
    model_name: str
    model: Any
    sample_rate: int


def load_tts_runtime(use_mlx: bool) -> TtsRuntime:
    if use_mlx:
        require_module("mlx_audio", "Install mlx-audio to run MLX TTS inference.")
        from mlx_audio.tts.generate import generate_audio

        return TtsRuntime(
            mode="mlx",
            model_name=TTS_MLX_MODEL,
            model=generate_audio,
            sample_rate=24000
        )

    require_module("chatterbox", "Install chatterbox-mls to run multilingual TTS.")
    require_module("torchaudio", "Install torchaudio to save audio.")
    require_module("torch", "Install torch to run the TTS model.")
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    return TtsRuntime(mode="hf", model_name="chatterbox-mls", model=model, sample_rate=model.sr)


def build_prompt(payload: Dict[str, Any]) -> str:
    return f"{SYSTEM_PROMPT}\n\nInput JSON:\n{json.dumps(payload, ensure_ascii=False)}\n\nReturn JSON only."


def parse_llm_json(
    raw_text: str,
    attempt_id: str,
    task_id: str,
    example_id: str,
    transcript: Dict[str, Any]
) -> Dict[str, Any]:
    try:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON found.")
        snippet = raw_text[start : end + 1]
        return json.loads(snippet)
    except Exception:
        return {
            "version": "2.0",
            "task_id": task_id,
            "example_id": example_id,
            "attempt_id": attempt_id,
            "transcript": transcript or {"text": ""},
            "criterion_scores": [],
            "overall": {
                "score": 0,
                "pass": False,
                "summary_feedback": "Model output could not be parsed. Please retry.",
                "what_to_improve_next": ["Retry the evaluation."]
            },
            "patient_reaction": {"emotion": "neutral", "intensity": 0},
            "diagnostics": {"provider": {"stt": {"kind": "local", "model": "local"}, "llm": {"kind": "local", "model": "local"}}}
        }


def create_llm_app(runtime: LlmRuntime) -> FastAPI:
    app = FastAPI(title="Local LLM", version="1.0")

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "mode": runtime.mode, "model": runtime.model_name}

    @app.post("/evaluate")
    def evaluate(payload: EvaluateRequest) -> Dict[str, Any]:
        prompt = build_prompt(payload.dict())
        output = runtime.model.generate_text(prompt)
        parsed = parse_llm_json(
            output,
            payload.attempt_id,
            payload.task.get("id", ""),
            payload.example.get("id", ""),
            payload.transcript
        )
        return parsed

    return app


def create_tts_app(runtime: TtsRuntime) -> FastAPI:
    app = FastAPI(title="Local TTS", version="1.0")

    @app.get("/health")
    def health() -> Dict[str, Any]:
        return {"status": "ok", "mode": runtime.mode, "model": runtime.model_name}

    @app.post("/synthesize", response_model=TtsResponse)
    def synthesize(payload: TtsRequest) -> TtsResponse:
        text = payload.text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Text is required.")

        language = payload.language or detect_language(text)

        if runtime.mode == "mlx":
            lang_code = "f" if language.startswith("fr") else "en"
            voice = TTS_MLX_VOICE_FR if language.startswith("fr") else TTS_MLX_VOICE_EN
            audio = runtime.model(
                text=text,
                ref_audio="harvard.wav",
                model=TTS_MLX_MODEL,
                lang_code=lang_code,
                voice=voice
            )
            audio_b64 = encode_wav(audio, runtime.sample_rate)
            return TtsResponse(audio_base64=audio_b64, sample_rate=runtime.sample_rate)

        language_id = "fr" if language.startswith("fr") else "en"
        wav = runtime.model.generate(text, language_id=language_id)
        audio_b64 = encode_wav(wav, runtime.sample_rate)
        return TtsResponse(audio_base64=audio_b64, sample_rate=runtime.sample_rate)

    return app


def serve(app: FastAPI, port: int) -> None:
    require_module("uvicorn", "Install uvicorn to run the local servers.")
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


def main() -> None:
    use_mlx = is_apple_silicon()
    logger.info("Starting local AI servers (mode=%s)", "mlx" if use_mlx else "hf")

    llm_runtime = load_llm_runtime(use_mlx)
    tts_runtime = load_tts_runtime(use_mlx)

    threads = [
        threading.Thread(target=serve, args=(create_llm_app(llm_runtime), LLM_PORT), daemon=True),
        threading.Thread(target=serve, args=(create_tts_app(tts_runtime), TTS_PORT), daemon=True)
    ]

    for thread in threads:
        thread.start()

    logger.info("LLM server listening on http://localhost:%s", LLM_PORT)
    logger.info("TTS server listening on http://localhost:%s", TTS_PORT)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down local servers.")


if __name__ == "__main__":
    main()
