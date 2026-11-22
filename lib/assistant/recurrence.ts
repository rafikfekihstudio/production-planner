import { GoogleGenAI, Type } from "@google/genai"
import { z } from "zod"
import { DAY_END_MIN, DAY_START_MIN } from "@/lib/timeline-constants"
import { ruleViolations, weekdayKey, type ScheduleRules } from "@/lib/schedule"
import { addDays, isDate, prettyDate, toClock, toMinutes } from "./time"
import { AssistantError } from "./gemini"
import type { AssistantPrefs } from "./preferences"
import { MAX_OPERATIONS, type Operation } from "./schema"
import type { CalendarArea, CalendarState } from "./state"

/**
 * Cheap gate. A recurring range always contains one of these phrases. When it
 * does not match, the route never pays for the extra model call.
 */
export const RECURRENCE_HINT =
  /\b(every\s+(?:day|week|morning|evening|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|each\s+day|recurr\w*|upcoming\s+(?:\w+\s+)?weeks?|next\s+(?:\w+\s+)?weeks?|for\s+(?:the\s+)?(?:next\s+)?\d+\s+days?|couple\s+(?:of\s+)?weeks|whole\s+week)\b/i

const AREAS = ["work", "personal"] as const
const PRIORITIES = ["low", "medium", "high", "urgent"] as const

/** The model returns this compact template — never individual dated blocks. */
export const RECURRENCE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isRecurring: {
      type: Type.BOOLEAN,
      description: "true ONLY when the same short list of activities is to be repeated over several dates",
    },
    startDate: { type: Type.STRING, description: "First date as YYYY-MM-DD, resolved against Today" },
    days: { type: Type.INTEGER, description: "How many calendar days the range covers. Two weeks = 14." },
    weekdays: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Only these weekdays, e.g. monday, wednesday. Empty means every day.",
    },
    activities: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "Exactly the activity name the user gave." },
          minutes: { type: Type.INTEGER, description: "Duration in minutes exactly as stated." },
          area: { type: Type.STRING, enum: [...AREAS] },
          projectId: { type: Type.INTEGER },
          workTypeId: { type: Type.INTEGER },
          priority: { type: Type.STRING, enum: [...PRIORITIES] },
        },
        required: ["title", "minutes"],
        propertyOrdering: ["title", "minutes", "area", "projectId", "workTypeId", "priority"],
      },
    },
    reply: { type: Type.STRING, description: "One short sentence describing what will be proposed." },
  },
  required: ["isRecurring", "startDate", "days", "activities", "reply"],
  propertyOrdering: ["isRecurring", "startDate", "days", "weekdays", "activities", "reply"],
}

const recurrenceResponseSchema = z.object({
  isRecurring: z.boolean(),
  startDate: z.string(),
  days: z.number().int(),
  weekdays: z.array(z.string()).default([]),
  activities: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(140),
        minutes: z.number().int().min(15).max(600),
        area: z.string().optional(),
        projectId: z.number().int().positive().nullish(),
        workTypeId: z.number().int().positive().nullish(),
        priority: z.string().optional(),
      }),
    )
    .max(30)
    .default([]),
  reply: z.string().max(500).default(""),
})

export type RecurringActivity = {
  title: string
  minutes: number
  area?: CalendarArea
  projectId?: number | null
  workTypeId?: number | null
  priority?: (typeof PRIORITIES)[number]
}

export type RecurrenceTemplate = {
  startDate: string
  days: number
  weekdays: string[]
  activities: RecurringActivity[]
  reply: string
}

type TranscriptMessage = { role: "user" | "assistant"; content: string }

function recurrenceSystemPrompt() {
  return `You extract a compact recurring-scheduling template from the user's latest request.

Return isRecurring:false when the user is NOT asking to plan the same short list of activities across several dates — for example a single task, a day view, or a move/delete/mark-done request.

When it IS a recurring range request, return:
- isRecurring: true
- startDate: the first date as YYYY-MM-DD, resolved against Today. "starting Monday November 23" must become the real calendar date.
- days: how many calendar days the range covers. "two weeks" = 14, "one week" = 7, "next 10 days" = 10. Never more than 90.
- weekdays: only for "every Monday and Wednesday" style requests. Leave it empty for "every day".
- activities: EVERY activity the user listed, each with its exact title and duration in minutes. "60 minutes" = 60, "1.5 hours" = 90. Never cap the list and never invent an activity.
- reply: one short sentence describing what will be proposed.

Do NOT emit individual dated operations — only the template. The server expands the template across every date and validates the result.`
}

function recurrenceContents(transcript: TranscriptMessage[], context: string) {
  const history = transcript
    .slice(-8)
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content.slice(0, 1500)}`)
    .join("\n")
  return [
    "CALENDAR CONTEXT",
    context,
    "",
    "CONVERSATION SO FAR",
    history || "(new conversation)",
    "",
    "Extract the recurring template for the latest USER message now.",
  ].join("\n")
}

const TEMPLATE_TIMEOUT_MS = 20_000
const TEMPLATE_CHAIN_MS = 45_000

/** Keep this path independent of the main chain so neither file blocks the other. */
function recurrenceModels(preferred?: string | null) {
  const configured = preferred?.trim() || process.env.GEMINI_MODEL?.trim()
  return [...new Set([configured, "gemini-3.5-flash-lite"].filter((m): m is string => !!m))]
}

/** One small model call. Returns null when the request is not a recurring range. */
export async function runRecurrencePlanner(input: {
  transcript: TranscriptMessage[]
  context: string
  prefs?: AssistantPrefs
}): Promise<{ template: RecurrenceTemplate; model: string } | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new AssistantError("GEMINI_API_KEY is not set.", 503, "missing_api_key")

  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000 } })
  const contents = recurrenceContents(input.transcript, input.context)
  const deadline = Date.now() + TEMPLATE_CHAIN_MS

  for (const model of recurrenceModels(input.prefs?.model)) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: recurrenceSystemPrompt(),
            responseMimeType: "application/json",
            responseSchema: RECURRENCE_SCHEMA,
            temperature: 0.1,
            topP: 0.9,
            maxOutputTokens: 1024,
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("model timeout")),
            Math.min(TEMPLATE_TIMEOUT_MS, remaining),
          )
        }),
      ])
      const json: unknown = JSON.parse(response.text ?? "")
      const parsed = recurrenceResponseSchema.safeParse(json)
      if (!parsed.success || !parsed.data.isRecurring) return null

      const data = parsed.data
      const activities: RecurringActivity[] = data.activities.map((a) => ({
        title: a.title,
        minutes: a.minutes,
        area: AREAS.includes(a.area as (typeof AREAS)[number]) ? (a.area as CalendarArea) : undefined,
        projectId: a.projectId ?? undefined,
        workTypeId: a.workTypeId ?? undefined,
        priority: PRIORITIES.includes(a.priority as (typeof PRIORITIES)[number])
          ? (a.priority as (typeof PRIORITIES)[number])
          : undefined,
      }))
      if (activities.length === 0) return null

      return {
        model,
        template: {
          startDate: data.startDate,
          days: data.days,
          weekdays: data.weekdays.map((d) => d.trim().toLowerCase()).filter(Boolean),
          activities,
          reply: data.reply,
        },
      }
    } catch {
      // A slow or busy model should hand off to the next candidate.
      continue
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  return null
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\(copy\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function projectArea(state: CalendarState, projectId: number | null | undefined): CalendarArea | null {
  if (!projectId) return null
  return state.projects.find((p) => p.id === projectId)?.area ?? null
}

const PERSONAL_WORK_TYPE = /^(training|personal\s*&\s*social|personal|fitness|workout|rest|recovery)$/i

function workTypeArea(state: CalendarState, workTypeId: number | null | undefined): CalendarArea | null {
  if (!workTypeId) return null
  const type = state.workTypes.find((t) => t.id === workTypeId)
  if (!type) return null
  return PERSONAL_WORK_TYPE.test(type.name.trim()) ? "personal" : "work"
}

type Metadata = {
  projectId: number | null
  workTypeId: number | null
  area: CalendarArea
  priority: (typeof PRIORITIES)[number]
  start: number
  date: string
}

/** Reuse the ids and rhythm of the most recent matching block, so we never invent them. */
function buildMetadata(state: CalendarState): Map<string, Metadata> {
  const map = new Map<string, Metadata>()
  const sorted = [...state.tasks]
    .filter((t) => t.scheduledDate && t.startTime)
    .sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? ""))

  for (const task of sorted) {
    const key = normalizeTitle(task.title)
    const area =
      projectArea(state, task.projectId) ??
      workTypeArea(state, task.workTypeId) ??
      "work"
    const existing = map.get(key)
    if (existing && existing.date > (task.scheduledDate as string)) continue
    map.set(key, {
      projectId: task.projectId,
      workTypeId: task.workTypeId,
      area,
      priority: PRIORITIES.includes(task.priority) ? task.priority : "medium",
      start: toMinutes(task.startTime as string),
      date: task.scheduledDate as string,
    })
  }
  return map
}

function findSlot(args: {
  rules: ScheduleRules
  date: string
  title: string
  minutes: number
  area: CalendarArea
  preferred: number
  occupied: Array<{ start: number; end: number }>
}): number | null {
  const { rules, date, title, minutes, area, preferred, occupied } = args
  const candidates: number[] = []
  for (let start = DAY_START_MIN; start + minutes <= DAY_END_MIN; start += 15) candidates.push(start)
  candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)

  for (const start of candidates) {
    const end = start + minutes
    if (ruleViolations(rules, { title, date, start, end, area }).length > 0) continue
    if (occupied.some((block) => start < block.end && block.start < end)) continue
    return start
  }
  return null
}

/**
 * Turns the compact template into every dated operation. Each slot is checked
 * with the same rule engine the simulator uses, so the resulting plan passes
 * validation without a slow model round-trip.
 */
export function expandRecurrence(args: {
  template: RecurrenceTemplate
  state: CalendarState
  today: string
  rules: ScheduleRules
}): { operations: Operation[]; notes: string[] } {
  const { template, state, today, rules } = args
  const operations: Operation[] = []
  const notes: string[] = []

  if (!isDate(template.startDate)) {
    return { operations, notes: ["The recurring start date was not a real calendar date."] }
  }

  const days = Math.min(Math.max(Math.round(template.days), 1), 90)
  const activities = template.activities.slice(0, 12)
  const metadata = buildMetadata(state)

  for (let offset = 0; offset < days && operations.length < MAX_OPERATIONS; offset++) {
    const date = addDays(template.startDate, offset)
    if (date < today) continue
    if (template.weekdays.length > 0 && !template.weekdays.includes(weekdayKey(date))) continue

    const occupied: Array<{ start: number; end: number }> = []
    for (const task of state.tasks) {
      if (task.scheduledDate !== date || !task.startTime) continue
      if (task.status === "completed" || task.status === "cancelled") continue
      const start = toMinutes(task.startTime)
      const end = task.endTime ? toMinutes(task.endTime) : start + task.estimatedMinutes
      occupied.push({ start, end })
    }

    for (const activity of activities) {
      if (operations.length >= MAX_OPERATIONS) break
      const key = normalizeTitle(activity.title)
      if (
        state.tasks.some(
          (t) => t.scheduledDate === date && t.status !== "cancelled" && normalizeTitle(t.title) === key,
        )
      ) {
        continue
      }

      const meta = metadata.get(key)
      const projectId = state.projects.some((p) => p.id === activity.projectId)
        ? (activity.projectId as number)
        : (meta?.projectId ?? null)
      const workTypeId = state.workTypes.some((w) => w.id === activity.workTypeId)
        ? (activity.workTypeId as number)
        : (meta?.workTypeId ?? null)
      const area =
        projectArea(state, projectId) ??
        activity.area ??
        workTypeArea(state, workTypeId) ??
        meta?.area ??
        "work"
      const minutes = Math.max(15, Math.min(600, Math.round(activity.minutes / 15) * 15))
      const preferred = meta?.start ?? (area === "personal" ? 18 * 60 : 10 * 60 + 30)

      const slot = findSlot({ rules, date, title: activity.title, minutes, area, preferred, occupied })
      if (slot === null) {
        notes.push(`No free slot for "${activity.title}" on ${prettyDate(date)} — that date was skipped.`)
        continue
      }

      operations.push({
        kind: "create",
        title: activity.title,
        date,
        start: toClock(slot),
        minutes,
        projectId,
        workTypeId,
        priority: activity.priority ?? meta?.priority ?? "medium",
        area,
      })
      occupied.push({ start: slot, end: slot + minutes })
    }
  }

  return { operations, notes }
}

/** A short, factual reply built from the operations — no model needed. */
export function recurrenceReply(operations: Operation[]) {
  const dates = [...new Set(operations.map((op) => ("date" in op ? op.date : "")).filter(Boolean))].sort()
  const first = dates[0]
  const last = dates[dates.length - 1]
  return `I propose ${operations.length} blocks across ${dates.length} days${first ? ` from ${prettyDate(first)} to ${prettyDate(last)}` : ""}. Nothing is saved until you click Apply.`
}
