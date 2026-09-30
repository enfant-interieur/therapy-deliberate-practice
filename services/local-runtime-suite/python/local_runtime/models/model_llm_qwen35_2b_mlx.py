from copy import deepcopy

from local_runtime.models import model_llm_qwen3_mlx as adapter

SPEC = deepcopy(adapter.SPEC)
SPEC["id"] = "local//llm/qwen35-2b-mlx"
SPEC["display"].update(
    title="Qwen3.5 2B · compact",
    description="4-bit text inference for short French and English training responses.",
)
SPEC["compat"].update(priority=100, requires_ram_gb=8, disk_gb=2)
SPEC["api"]["advertised_model_name"] = "qwen35-2b-mlx"
SPEC["backend"].update(
    model_ref="mlx-community/Qwen3.5-2B-4bit", revision="674aaa7240b91e8012fcad5d791b7dfe5ba90207"
)


def load(ctx):
    return adapter.load(ctx, spec=SPEC)


run = adapter.run
