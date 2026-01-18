import { generateUuid } from "./uuid";

type WarnLogger = {
  warn: (message: string, fields?: Record<string, unknown>) => void;
};

export const remapUniqueUuids = <T extends { id: string }>(
  items: T[],
  label: string,
  log?: WarnLogger
) => {
  const used = new Set<string>();
  const idMap = new Map<string, string[]>();
  const mapped = items.map((item) => {
    let id = generateUuid();
    while (used.has(id)) {
      id = generateUuid();
    }
    used.add(id);
    const existing = idMap.get(item.id);
    if (existing) {
      existing.push(id);
    } else {
      idMap.set(item.id, [id]);
    }
    return { ...item, id };
  });
  for (const [sourceId, mappedIds] of idMap.entries()) {
    if (mappedIds.length > 1) {
      log?.warn("Duplicate ids detected during parse remap", {
        label,
        id: sourceId,
        count: mappedIds.length
      });
    }
  }
  return { items: mapped, idMap };
};

export const remapIdReferences = <T>(value: T, idMaps: Array<Map<string, string[]>>): T => {
  const replaceId = (id: string) => {
    for (const map of idMaps) {
      const mapped = map.get(id);
      if (mapped?.length) {
        return mapped[0];
      }
    }
    return id;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, val]) => {
          if (key.endsWith("_id") && typeof val === "string") {
            return [key, replaceId(val)];
          }
          if (key.endsWith("_ids") && Array.isArray(val)) {
            return [
              key,
              val.map((item) => (typeof item === "string" ? replaceId(item) : item))
            ];
          }
          return [key, walk(val)];
        })
      );
    }
    return node;
  };

  return walk(value) as T;
};
