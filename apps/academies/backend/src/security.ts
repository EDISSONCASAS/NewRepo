import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SESSION_BYTES = 32;
const HASH_BYTES = 64;
const SCRYPT_COST = 32_768;

function deriveKey(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key as Buffer),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, HASH_BYTES);
  return `scrypt$${SCRYPT_COST}$8$1$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelism, saltText, keyText] =
    encoded.split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelism || !saltText || !keyText) {
    return false;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(keyText, "base64url");
  if (salt.length !== 16 || expected.length !== HASH_BYTES) return false;
  if (Number(cost) !== SCRYPT_COST || Number(blockSize) !== 8 || Number(parallelism) !== 1) {
    return false;
  }
  const actual = await deriveKey(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

export function createSessionToken(): string {
  return randomBytes(SESSION_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isStrongPassword(password: string): boolean {
  return password.length >= 12 && Buffer.byteLength(password, "utf8") <= 256;
}