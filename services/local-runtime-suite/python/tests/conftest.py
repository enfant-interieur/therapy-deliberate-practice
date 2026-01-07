from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from local_runtime.main import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("LOCAL_RUNTIME_SELFTEST", "0")
    with TestClient(app) as test_client:
        yield test_client
