const encoder = new TextEncoder();

const getWebCrypto = async () => {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  const { webcrypto } = await import("node:crypto");
  return webcrypto as Crypto;
};

const sha256Hex = async (value: string) => {
  const crypto = await getWebCrypto();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const normalizeTtsText = (text: string) => text.trim().replace(/\s+/g, " ");

export const buildTtsCacheKey = async (input: {
  text: string;
  model: string;
  voice: string;
  format: string;
}) => {
  const normalizedText = normalizeTtsText(input.text);
  const cacheKey = await sha256Hex(
    `${input.model}\n${input.voice}\n${input.format}\n${normalizedText}`
  );
  return { cacheKey, normalizedText };
};

export const buildTtsR2Key = (input: { cacheKey: string; model: string; voice: string; format: string }) =>
  `tts/${input.model}/${input.voice}/${input.cacheKey}.${input.format}`;
