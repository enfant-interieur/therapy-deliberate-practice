from __future__ import annotations


def test_models_shape(client):
    response = client.get("/v1/models")
    assert response.status_code == 200
    payload = response.json()
    assert payload["object"] == "list"
    assert isinstance(payload["data"], list)
    first = payload["data"][0]
    assert first["object"] == "model"
    assert "metadata" in first
    assert "owned_by" in first


def test_responses_shape(client):
    response = client.post("/v1/responses", json={"input": "Shape test"})
    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "response"
    assert body["model"]
    assert body["output"][0]["content"][0]["type"] == "output_text"
