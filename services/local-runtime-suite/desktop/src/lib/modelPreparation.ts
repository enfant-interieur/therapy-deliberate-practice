import { invoke } from "@tauri-apps/api/core";
import type { Translator } from "../i18n";
import type { ModelInventory } from "../components/ModelLibrary";

/** Every desktop preparation entry point uses fresh resource and asset state. */
export async function confirmModelPreparation(modelIds: string[], t: Translator): Promise<boolean> {
  const inventory = await invoke<ModelInventory>("gateway_model_inventory");
  const selected = modelIds.map((id) => inventory.models.find((model) => model.id === id));
  if (selected.some((model) => !model?.compatible)) throw new Error(t("library.prepareError"));
  const models = selected.filter((model) => model !== undefined);
  if (models.some((model) => !model.loaded && !model.memory_suitable)) throw new Error(t("library.memoryWarning"));
  const remaining = models.reduce((bytes, model) => bytes + (model.assets.state === "cached" ? 0 : Math.max(0, model.assets.total_bytes - model.assets.completed_bytes)), 0);
  if (remaining > 0 && inventory.resources.cache_free_bytes < remaining + 1024 ** 3) throw new Error(t("library.diskWarning"));
  return remaining === 0 || window.confirm(t("library.downloadConfirm", { size: `${(remaining / 1_000_000_000).toFixed(2)} GB` }));
}
