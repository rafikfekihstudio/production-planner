/**
 * Assistant preferences, editable in /settings. Runtime behaviour still reads
 * environment variables as a fallback, so a deployment without stored prefs
 * keeps working exactly as before.
 */

export const THINKING_OPTIONS = ["minimal", "low", "medium", "high", "default"] as const

export type ThinkingPreference = (typeof THINKING_OPTIONS)[number]

export type AssistantPrefs = {
  /** null means "use the built-in fallback chain". */
  model: string | null
  /** null means "use the default (minimal)". */
  thinking: ThinkingPreference | null
}

export const DEFAULT_PREFS: AssistantPrefs = { model: null, thinking: null }

export const ASSISTANT_PREFS_KEY = "assistant:prefs"

export const KNOWN_MODELS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash — best quality" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash — balanced" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash — newest, often busy" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite — fastest, larger quota" },
] as const

const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{2,60}$/i

export function normalizeModel(value: string | null | undefined): string | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return MODEL_RE.test(trimmed) ? trimmed : null
}

export function normalizeThinking(value: string | null | undefined): ThinkingPreference | null {
  if (!value) return null
  const lower = value.trim().toLowerCase()
  return (THINKING_OPTIONS as readonly string[]).includes(lower) ? (lower as ThinkingPreference) : null
}

export function normalizePrefs(input: unknown): AssistantPrefs {
  const raw = (input ?? {}) as { model?: unknown; thinking?: unknown }
  return {
    model: normalizeModel(typeof raw.model === "string" ? raw.model : null),
    thinking: normalizeThinking(typeof raw.thinking === "string" ? raw.thinking : null),
  }
}

/** Stored value wins; anything malformed degrades to the defaults. */
export function coercePrefs(stored: unknown): AssistantPrefs {
  if (!stored || typeof stored !== "object") return DEFAULT_PREFS
  return normalizePrefs(stored)
}
