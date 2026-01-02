from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/v1/models")
async def list_models(request: Request) -> dict:
    registry = request.app.state.registry
    data = []
    for mod in registry.values():
        data.append(
            {
                "id": mod.spec.id,
                "object": "model",
                "created": 0,
                "owned_by": "local-runtime",
                "metadata": {
                    "kind": mod.spec.kind,
                    "api": mod.spec.api.model_dump(),
                    "display": mod.spec.display.model_dump(),
                },
            }
        )
    return {"object": "list", "data": data}
