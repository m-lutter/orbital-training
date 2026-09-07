const TOKEN_VERSION = "v1";
const IV_BYTES = 12;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(
    value.replaceAll("-", "+").replaceAll("_", "/") + padding,
  );
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length < 32) {
    throw new Error(
      "FITNESS_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.",
    );
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypts provider credentials before they leave the Worker. The database
 * stores only a versioned AES-GCM envelope; the key remains a Worker secret.
 */
export async function encryptFitnessToken(
  plaintext: string,
  secret: string,
): Promise<string> {
  if (plaintext.length === 0) throw new Error("Cannot encrypt an empty token.");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(plaintext),
  );
  return `${TOKEN_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(
    new Uint8Array(ciphertext),
  )}`;
}

export async function decryptFitnessToken(
  envelope: string,
  secret: string,
): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = envelope.split(".");
  if (
    version !== TOKEN_VERSION ||
    !encodedIv ||
    !encodedCiphertext ||
    extra !== undefined
  ) {
    throw new Error("Unsupported fitness-token envelope.");
  }
  const iv = base64UrlToBytes(encodedIv);
  if (iv.byteLength !== IV_BYTES) throw new Error("Invalid fitness-token IV.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    base64UrlToBytes(encodedCiphertext),
  );
  return new TextDecoder().decode(plaintext);
}
