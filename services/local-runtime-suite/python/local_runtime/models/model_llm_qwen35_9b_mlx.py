from copy import deepcopy

from local_runtime.models import model_llm_qwen3_mlx as adapter

SPEC = deepcopy(adapter.SPEC)
SPEC["id"] = "local//llm/qwen35-9b-mlx"
SPEC["display"].update(
    title="Qwen3.5 9B · quality",
    description="4-bit text inference with more capacity for detailed training feedback; requires more memory.",
)
SPEC["compat"].update(priority=95, requires_ram_gb=16, disk_gb=6)
SPEC["api"]["advertised_model_name"] = "qwen35-9b-mlx"
SPEC["backend"].update(
    model_ref="mlx-community/Qwen3.5-9B-4bit", revision="8b2b98c00a6b4d291155e4890773ca8f769aee53"
)


def load(ctx):
    return adapter.load(ctx, spec=SPEC)


run = adapter.run
