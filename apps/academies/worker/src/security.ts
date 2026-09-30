const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
export const PASSWORD_ITERATIONS = 310_000;
const HASH_BYTES = 32;
const DUMMY_SALT = "MDEyMzQ1Njc4OWFiY2RlZg";
const DUMMY_PASSWORD_HASH =
  `pbkdf2-hmac$${PASSWORD_ITERATIONS}$SHA-256$${DUMMY_SALT}$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

interface PasswordHashParts {
  salt: string;
  verifier: string;
  algorithm: "pbkdf2" | "pbkdf2-hmac";
}

function passwordHashParts(encoded: string): PasswordHashParts | undefined {
  const [algorithm, iterations, hash, saltText, expectedText] = encoded.split("$");
  if ((algorithm !== "pbkdf2" && algorithm !== "pbkdf2-hmac") ||
      Number(iterations) !== PASSWORD_ITERATIONS ||
      hash !== "SHA-256" || saltText?.length !== 22 || expectedText?.length !== 43 ||
      !/^[A-Za-z0-9_-]+$/u.test(saltText) ||
      !/^[A-Za-z0-9_-]+$/u.test(expectedText)) return undefined;
  try {
    if (decodeBase64Url(saltText).length !== 16 ||
        decodeBase64Url(expectedText).length !== HASH_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return {
    salt: saltText,
    verifier: expectedText,
    algorithm,
  };
}

export function isValidPasswordHash(encoded: string): boolean {
  return passwordHashParts(encoded)?.algorithm === "pbkdf2";
}

export function isValidStoredPasswordHash(encoded: string): boolean {
  return passwordHashParts(encoded) !== undefined;
}

export function passwordSalt(encoded?: string): string {
  return passwordHashParts(encoded ?? DUMMY_PASSWORD_HASH)?.salt ?? DUMMY_SALT;
}

async function hmacVerifier(
  verifier: Uint8Array<ArrayBuffer>,
  pepper: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, verifier));
}

export async function protectPasswordHash(encoded: string, pepper: string): Promise<string> {
  const parts = passwordHashParts(encoded);
  if (!parts || parts.algorithm !== "pbkdf2") {
    throw new Error("La contraseña no tiene un formato PBKDF2 válido.");
  }
  const protectedVerifier = await hmacVerifier(decodeBase64Url(parts.verifier), pepper);
  return `pbkdf2-hmac$${PASSWORD_ITERATIONS}$SHA-256$${parts.salt}$${encodeBase64Url(protectedVerifier)}`;
}

export async function verifyPasswordProof(
  proof: string,
  encoded: string | undefined,
  pepper: string,
): Promise<boolean> {
  const parts = passwordHashParts(encoded ?? DUMMY_PASSWORD_HASH);
  let candidate = new Uint8Array(HASH_BYTES);
  let validEncoding = proof.length === 43 && /^[A-Za-z0-9_-]+$/u.test(proof);
  try {
    if (!validEncoding) throw new Error("Invalid password proof");
    candidate = decodeBase64Url(proof);
    validEncoding = candidate.length === HASH_BYTES;
  } catch {
    validEncoding = false;
  }
  const expected = decodeBase64Url(parts?.verifier ?? DUMMY_PASSWORD_HASH.split("$").at(-1)!);
  const actual = parts?.algorithm === "pbkdf2-hmac"
    ? await hmacVerifier(candidate, pepper)
    : candidate;
  let difference = validEncoding && parts ? 0 : 1;
  for (let index = 0; index < HASH_BYTES; index += 1) {
    difference |= actual[index]! ^ expected[index]!;
  }
  return difference === 0;
}

export function createSessionToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashLoginKey(value: string): Promise<string> {
  return hashToken(value);
}

export { SESSION_DURATION_MS };
