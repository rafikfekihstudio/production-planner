import { readValue, writeValue } from "@/lib/kv"
import {
  ASSISTANT_PREFS_KEY,
  coercePrefs,
  DEFAULT_PREFS,
  normalizePrefs,
  type AssistantPrefs,
} from "@/lib/assistant/preferences"

export async function loadAssistantPrefs(): Promise<AssistantPrefs> {
  const stored = await readValue<unknown>(ASSISTANT_PREFS_KEY)
  if (!stored) return DEFAULT_PREFS
  return coercePrefs(stored)
}

export async function saveAssistantPrefs(input: unknown): Promise<AssistantPrefs> {
  const prefs = normalizePrefs(input)
  await writeValue(ASSISTANT_PREFS_KEY, prefs)
  return prefs
}

export async function resetAssistantPrefs(): Promise<AssistantPrefs> {
  await writeValue(ASSISTANT_PREFS_KEY, DEFAULT_PREFS)
  return DEFAULT_PREFS
}
