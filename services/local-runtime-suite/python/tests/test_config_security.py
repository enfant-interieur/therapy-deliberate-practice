from __future__ import annotations

import json
import os
import stat

from conftest import TEST_ACCESS_TOKEN

from local_runtime.core.config import RuntimeConfig


def test_missing_config_creates_stable_private_access_token(tmp_path) -> None:
    config_path = tmp_path / "runtime" / "config.json"

    first = RuntimeConfig.load(config_path)
    second = RuntimeConfig.load(config_path)

    assert len(first.access_token) >= 32
    assert second.access_token == first.access_token
    persisted = json.loads(config_path.read_text(encoding="utf-8"))
    assert persisted["access_token"] == first.access_token
    if os.name != "nt":
        assert stat.S_IMODE(config_path.stat().st_mode) == 0o600
        assert stat.S_IMODE(config_path.parent.stat().st_mode) == 0o700


def test_protected_gateway_routes_require_pairing_key(client) -> None:
    for path in (
        "/v1/models",
        "/v1/requests/cancel",
        "/logs",
        "/doctor",
        "/health/details",
        "/runtime/config",
    ):
        missing = client.get(path, headers={"Authorization": ""})
        assert missing.status_code == 401
        assert missing.headers["www-authenticate"] == "Bearer"

        wrong = client.get(path, headers={"Authorization": "Bearer wrong-token-value"})
        assert wrong.status_code == 401


def test_public_health_is_minimal_and_identifies_gateway(client) -> None:
    response = client.get("/health", headers={"Authorization": ""})

    assert response.status_code == 200
    assert response.json() == {
        "service": "therapy-local-runtime",
        "protocol_version": "1",
        "status": "ready",
    }


def test_gateway_rejects_non_loopback_host_and_untrusted_origin(client) -> None:
    bad_host = client.get(
        "/v1/models",
        headers={"Host": "attacker.example", "Authorization": f"Bearer {TEST_ACCESS_TOKEN}"},
    )
    assert bad_host.status_code == 403

    bad_origin = client.get(
        "/v1/models",
        headers={
            "Origin": "https://attacker.example",
            "Authorization": f"Bearer {TEST_ACCESS_TOKEN}",
        },
    )
    assert bad_origin.status_code == 403


def test_trusted_browser_origin_and_private_network_preflight(client) -> None:
    origin = "https://therapy-deliberate-practice.com"
    response = client.get(
        "/v1/models",
        headers={"Origin": origin, "Authorization": f"Bearer {TEST_ACCESS_TOKEN}"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin

    preflight = client.options(
        "/v1/models",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
            "Access-Control-Request-Private-Network": "true",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-private-network"] == "true"


def test_packaged_tauri_origins_are_allowed_but_neighbors_are_rejected(client) -> None:
    for origin in ("http://tauri.localhost", "tauri://localhost"):
        response = client.get(
            "/v1/models",
            headers={
                "Origin": origin,
                "Authorization": f"Bearer {TEST_ACCESS_TOKEN}",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin

    for origin in (
        "https://tauri.localhost",
        "http://tauri.localhost.attacker.example",
        "tauri://attacker",
        "null",
    ):
        response = client.get(
            "/v1/models",
            headers={
                "Origin": origin,
                "Authorization": f"Bearer {TEST_ACCESS_TOKEN}",
            },
        )
        assert response.status_code == 403


def test_ipv6_loopback_host_is_rejected_until_the_gateway_binds_ipv6(client) -> None:
    response = client.get(
        "/v1/models",
        headers={"Host": "[::1]:8484"},
    )
    assert response.status_code == 403


def test_pairing_key_is_not_returned_by_gateway_observability(client) -> None:
    details = client.get("/health/details")
    logs = client.get("/logs")

    assert TEST_ACCESS_TOKEN not in details.text
    assert TEST_ACCESS_TOKEN not in logs.text


def test_runtime_config_updates_defaults_live_and_rejects_incompatible_models(client) -> None:
    details = client.get("/health/details").json()
    defaults = details["defaults"]
    response = client.post(
        "/runtime/config",
        json={
            "port": 8484,
            "default_models": defaults,
            "prefer_local": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["default_models"] == defaults
    assert client.get("/health/details").json()["defaults"] == defaults

    wrong_endpoint = client.post(
        "/runtime/config",
        json={
            "port": 8484,
            "default_models": {
                "responses": defaults["audio.transcriptions"],
                "audio.transcriptions": defaults["audio.transcriptions"],
            },
            "prefer_local": True,
        },
    )
    assert wrong_endpoint.status_code == 400
