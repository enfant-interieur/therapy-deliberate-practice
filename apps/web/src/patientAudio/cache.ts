const CACHE_NAME = "patient-audio-v1";

const blobUrlByAudioUrl = new Map<string, string>();

const hasCacheStorage = () => typeof caches !== "undefined";

export const getCachedResponse = async (audioUrl: string, signal?: AbortSignal) => {
  if (signal?.aborted) return null;
  if (!hasCacheStorage()) return null;
  const cache = await caches.open(CACHE_NAME);
  return cache.match(audioUrl);
};

export const putIfMissing = async (audioUrl: string, response: Response) => {
  if (!hasCacheStorage()) return;
  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(audioUrl);
  if (existing) return;
  await cache.put(audioUrl, response.clone());
};

export const getBlobUrlForAudio = (audioUrl: string) => blobUrlByAudioUrl.get(audioUrl);

export const toBlobUrl = async (audioUrl: string, response: Response) => {
  const existing = blobUrlByAudioUrl.get(audioUrl);
  if (existing) return existing;
  const blob = await response.clone().blob();
  const blobUrl = URL.createObjectURL(blob);
  blobUrlByAudioUrl.set(audioUrl, blobUrl);
  return blobUrl;
};

export const revokeBlobUrl = (audioUrl: string) => {
  const blobUrl = blobUrlByAudioUrl.get(audioUrl);
  if (!blobUrl) return;
  URL.revokeObjectURL(blobUrl);
  blobUrlByAudioUrl.delete(audioUrl);
};

export const revokeAllBlobUrls = () => {
  blobUrlByAudioUrl.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
  blobUrlByAudioUrl.clear();
};
