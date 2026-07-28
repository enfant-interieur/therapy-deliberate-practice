const encoder = new TextEncoder();

const getWebCrypto = async () => {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto is unavailable in this runtime.");
};

const base64Encode = (buffer: ArrayBuffer) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const base64Decode = (value: string) => {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(value, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const deriveKey = async (secret: string) => {
  const crypto = await getWebCrypto();
  const secretBytes = encoder.encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
};

export type EncryptedOpenAiKey = {
  ciphertextB64: string;
  ivB64: string;
  kid: string;
};

export const encryptOpenAiKey = async (
  secret: string,
  plaintext: string,
): Promise<EncryptedOpenAiKey> => {
  const crypto = await getWebCrypto();
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  return {
    ciphertextB64: base64Encode(ciphertext),
    ivB64: base64Encode(iv.buffer),
    kid: "v1",
  };
};

export const decryptOpenAiKey = async (
  secret: string,
  record: { ciphertextB64: string; ivB64: string },
): Promise<string> => {
  const crypto = await getWebCrypto();
  const key = await deriveKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(base64Decode(record.ivB64)) },
    key,
    base64Decode(record.ciphertextB64),
  );
  return new TextDecoder().decode(plaintext);
};
