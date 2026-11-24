"use server"

import { auth } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { businessNameProblem } from "@/lib/brand"
import { saveBusinessName } from "@/lib/business-name-store"
import { resetAssistantPrefs, saveAssistantPrefs } from "@/lib/assistant/preferences-store"
import type { AssistantPrefs } from "@/lib/assistant/preferences"
import { resetScheduleRules, saveScheduleRules } from "@/lib/schedule-store"
import type { ScheduleRules } from "@/lib/schedule"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

/**
 * Rules and preferences are global to the studio (one operator, one calendar).
 * Both are read by the assistant at request time, so saving them only needs to
 * refresh the pages that display them.
 */
function revalidateSettings() {
  revalidatePath("/settings")
  revalidatePath("/timeline")
  revalidatePath("/")
  revalidatePath("/login")
}

export async function saveStudioName(input: string) {
  await requireUser()
  const problem = businessNameProblem(input)
  if (problem) throw new Error(problem)
  const name = await saveBusinessName(input)
  revalidateSettings()
  return name
}

export async function saveRules(input: ScheduleRules) {
  await requireUser()
  const rules = await saveScheduleRules(input)
  revalidateSettings()
  return rules
}

export async function restoreDefaultRules() {
  await requireUser()
  const rules = await resetScheduleRules()
  revalidateSettings()
  return rules
}

export async function savePrefs(input: AssistantPrefs) {
  await requireUser()
  const prefs = await saveAssistantPrefs(input)
  revalidateSettings()
  return prefs
}

export async function restoreDefaultPrefs() {
  await requireUser()
  const prefs = await resetAssistantPrefs()
  revalidateSettings()
  return prefs
}
