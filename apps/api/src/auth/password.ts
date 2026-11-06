import { compare } from "bcryptjs";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_ITERATIONS = 600_000;
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

export const isSupportedLegacyHash = (value: string) =>
  /^\$2[aby]\$(10|11|12|13|14)\$[./A-Za-z0-9]{53}$/.test(value);

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  // Workers caps both native crypto interfaces at 100,000 iterations. Keep the
  // full password work factor with the same portable, yielding implementation.
  return pbkdf2Async(sha256, password, salt, {
    c: PASSWORD_ITERATIONS,
    dkLen: 32,
    asyncTick: 10,
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length > PASSWORD_MAX_LENGTH)
    throw new Error("Password exceeds the supported length");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$v1$${PASSWORD_ITERATIONS}$${hex(salt)}$${hex(await derive(password, salt))}`;
}

export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  if (isSupportedLegacyHash(hash)) return compare(password, hash);
  const match =
    /^pbkdf2-sha256\$v1\$600000\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash);
  if (!match) return false;
  const actual = await derive(password, fromHex(match[1]));
  const expected = fromHex(match[2]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected[i] ^ actual[i];
  return difference === 0;
}
