import {
  BUSINESS_NAME_KEY,
  DEFAULT_BUSINESS_NAME,
  normalizeBusinessName,
} from "@/lib/brand"
import { readValue, writeValue } from "@/lib/kv"

/**
 * The studio name is global to this installation (one operator, one calendar).
 * It is a small value in the settings table, so it needs no migration.
 */
export async function loadBusinessName(): Promise<string> {
  try {
    const stored = await readValue<unknown>(BUSINESS_NAME_KEY)
    return normalizeBusinessName(stored)
  } catch {
    return DEFAULT_BUSINESS_NAME
  }
}

export async function saveBusinessName(input: string): Promise<string> {
  const name = normalizeBusinessName(input)
  await writeValue(BUSINESS_NAME_KEY, name)
  return name
}
