from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from model_fakes import fake_model_run

from local_runtime.main import app

TEST_ACCESS_TOKEN = "test-local-access-token-32-characters"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("LOCAL_RUNTIME_SELFTEST", "0")
    monkeypatch.setenv("LOCAL_RUNTIME_PRELOAD_ALL", "0")
    monkeypatch.setenv("LOCAL_RUNTIME_PRELOAD_DEFAULTS", "0")
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps({"access_token": TEST_ACCESS_TOKEN}), encoding="utf-8")
    monkeypatch.setenv("LOCAL_RUNTIME_CONFIG", str(config_path))
    with TestClient(
        app,
        headers={
            "Authorization": f"Bearer {TEST_ACCESS_TOKEN}",
            "Host": "127.0.0.1:8484",
        },
    ) as test_client:
        for loaded in app.state.registry.list_models():
            monkeypatch.setattr(loaded.module, "run", fake_model_run)
        yield test_client
