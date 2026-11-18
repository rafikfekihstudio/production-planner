import { readValue, writeValue } from "@/lib/kv"
import {
  coerceScheduleRules,
  DEFAULT_RULES,
  parseScheduleRules,
  SCHEDULE_RULES_KEY,
  type ScheduleRules,
} from "@/lib/schedule"

/**
 * Server-side persistence for the scheduling rules. Kept apart from
 * lib/schedule.ts so client components can import the types, defaults and pure
 * helpers without pulling the database into the browser bundle.
 */

export async function loadScheduleRules(): Promise<ScheduleRules> {
  const stored = await readValue<unknown>(SCHEDULE_RULES_KEY)
  if (!stored) return DEFAULT_RULES
  return coerceScheduleRules(stored)
}

export async function saveScheduleRules(input: unknown): Promise<ScheduleRules> {
  const parsed = parseScheduleRules(input)
  await writeValue(SCHEDULE_RULES_KEY, parsed)
  return parsed
}

export async function resetScheduleRules(): Promise<ScheduleRules> {
  await writeValue(SCHEDULE_RULES_KEY, DEFAULT_RULES)
  return DEFAULT_RULES
}
