import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { deleteValue, readValue, writeValue } from "@/lib/kv"

const ENCRYPTION_SECRET_ENV = "GEMINI_KEY_ENCRYPTION_SECRET"
const SHARED_KEY_ENV = "GEMINI_API_KEY"
const STORAGE_PREFIX = "user:"
const STORAGE_SUFFIX = ":assistant:gemini_key"
const MIN_KEY_LENGTH = 20
const MAX_KEY_LENGTH = 256

export type AssistantKeySource = "personal" | "environment"

export type AssistantKeyStatus = {
  personalKeySaved: boolean
  sharedKeyAvailable: boolean
  encryptionConfigured: boolean
  activeSource: AssistantKeySource | null
}

type StoredKey = {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

export const MISSING_KEY_MESSAGE =
  "Add your Gemini API key in Settings → Gemini API key to use the assistant."

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}${STORAGE_SUFFIX}`
}

function normalizeKey(value: string) {
  return value.trim()
}

function validateKey(value: string) {
  const apiKey = normalizeKey(value)
  if (apiKey.length < MIN_KEY_LENGTH || apiKey.length > MAX_KEY_LENGTH || /\s/.test(apiKey)) {
    throw new Error("Enter a valid Gemini API key.")
  }
  return apiKey
}

function encryptionConfigured() {
  const secret = process.env[ENCRYPTION_SECRET_ENV]?.trim()
  return Boolean(secret && Buffer.byteLength(secret, "utf8") >= 32)
}

function encryptionKey() {
  const secret = process.env[ENCRYPTION_SECRET_ENV]?.trim()
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error(
      `${ENCRYPTION_SECRET_ENV} must be set to at least 32 characters before personal API keys can be saved.`,
    )
  }
  return createHash("sha256").update(secret, "utf8").digest()
}

function encryptKey(apiKey: string): StoredKey {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()])
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  }
}

function decryptKey(stored: StoredKey): string | null {
  if (stored?.version !== 1 || !stored.iv || !stored.tag || !stored.ciphertext) return null
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(stored.iv, "base64url"),
    )
    decipher.setAuthTag(Buffer.from(stored.tag, "base64url"))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8")
    return normalizeKey(plain) || null
  } catch {
    // A stale or corrupted record should never break the whole assistant.
    return null
  }
}

function sharedKey() {
  const key = process.env[SHARED_KEY_ENV]?.trim()
  return key || null
}

export async function getAssistantKeyStatus(userId: string): Promise<AssistantKeyStatus> {
  const stored = await readValue<StoredKey>(storageKey(userId)).catch(() => null)
  const personalKeySaved = Boolean(stored && decryptKey(stored))
  const environmentKey = sharedKey()
  return {
    personalKeySaved,
    sharedKeyAvailable: Boolean(environmentKey),
    encryptionConfigured: encryptionConfigured(),
    activeSource: personalKeySaved ? "personal" : environmentKey ? "environment" : null,
  }
}

/** Personal keys win; the shared environment key is only a local/deployment fallback. */
export async function resolveAssistantApiKey(
  userId: string,
): Promise<{ key: string; source: AssistantKeySource } | null> {
  const stored = await readValue<StoredKey>(storageKey(userId)).catch(() => null)
  const personalKey = stored ? decryptKey(stored) : null
  if (personalKey) return { key: personalKey, source: "personal" }
  const environmentKey = sharedKey()
  return environmentKey ? { key: environmentKey, source: "environment" } : null
}

export async function saveAssistantApiKey(userId: string, input: string): Promise<AssistantKeyStatus> {
  const apiKey = validateKey(input)
  if (!encryptionConfigured()) {
    throw new Error(
      `${ENCRYPTION_SECRET_ENV} is missing on the server. Add at least 32 characters and restart.`,
    )
  }
  await writeValue(storageKey(userId), encryptKey(apiKey))
  return getAssistantKeyStatus(userId)
}

export async function deleteAssistantApiKey(userId: string): Promise<AssistantKeyStatus> {
  await deleteValue(storageKey(userId))
  return getAssistantKeyStatus(userId)
}
