import crypto from "node:crypto";

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const HASH_PREFIX = "scrypt$v1$";

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

function matchesLegacyPassword(password: string, storedPassword: string): boolean {
  const supplied = Buffer.from(password);
  const stored = Buffer.from(storedPassword);
  return (
    supplied.length === stored.length &&
    crypto.timingSafeEqual(supplied, stored)
  );
}

export function isPasswordHash(value: string): boolean {
  return value.startsWith(HASH_PREFIX);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const key = await deriveKey(password, salt);
  return `${HASH_PREFIX}${salt}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  if (!isPasswordHash(storedPassword)) {
    return matchesLegacyPassword(password, storedPassword);
  }

  const [, , salt, encodedKey] = storedPassword.split("$");
  if (!salt || !encodedKey || !/^[0-9a-f]{32}$/i.test(salt)) return false;

  const expectedKey = Buffer.from(encodedKey, "hex");
  if (expectedKey.length !== KEY_LENGTH) return false;

  const suppliedKey = await deriveKey(password, salt);
  return crypto.timingSafeEqual(suppliedKey, expectedKey);
}
