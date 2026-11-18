import { z } from "zod"
import { isTime, prettyDate, toClock, toMinutes, weekdayOf } from "@/lib/assistant/time"

/**
 * The studio's scheduling rules. They used to be hardcoded in the assistant's
 * simulator, which meant the planner imposed someone else's assumptions. They
 * now live in the `settings` table and are editable from /settings, and both
 * the rules engine and the model prompt read the same document.
 */

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
}

export type WorkDay = {
  enabled: boolean
  start: string
  end: string
}

export type ProtectedWindow = {
  id: string
  label: string
  start: string
  end: string
  days: Weekday[]
  allowWords: string[]
}

export type ScheduleRules = {
  version: 1
  workDays: Record<Weekday, WorkDay>
  protectedWindows: ProtectedWindow[]
}

const ALL_DAYS = [...WEEKDAYS]

const FULL_DAY: WorkDay = { enabled: true, start: "07:00", end: "23:00" }

export const DEFAULT_RULES: ScheduleRules = {
  version: 1,
  workDays: {
    monday: { ...FULL_DAY },
    tuesday: { ...FULL_DAY },
    wednesday: { ...FULL_DAY },
    thursday: { ...FULL_DAY },
    friday: { ...FULL_DAY },
    saturday: { ...FULL_DAY },
    sunday: { enabled: false, start: "07:00", end: "23:00" },
  },
  protectedWindows: [
    {
      id: "morning",
      label: "Morning routine",
      start: "09:00",
      end: "10:30",
      days: ALL_DAYS,
      allowWords: [
        "morning",
        "priming",
        "routine",
        "quiet",
        "meditat",
        "breath",
        "energy",
        "reset",
        "release",
        "nervous",
        "zana",
      ],
    },
    {
      id: "break",
      label: "Break & meal",
      start: "14:00",
      end: "15:30",
      days: ALL_DAYS,
      allowWords: ["break", "meal", "lunch", "rest", "recover", "digest"],
    },
  ],
}

const timeString = z.string().refine(isTime, "Use a 24h clock time like 09:00")

const workDaySchema = z
  .object({
    enabled: z.boolean(),
    start: timeString,
    end: timeString,
  })
  .refine((day) => toMinutes(day.end) > toMinutes(day.start), {
    message: "End time must be after start time",
    path: ["end"],
  })

const protectedWindowSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(2).max(80),
    start: timeString,
    end: timeString,
    days: z.array(z.enum(WEEKDAYS)).min(1).max(7),
    allowWords: z.array(z.string().trim().min(1).max(30)).max(20),
  })
  .refine((window) => toMinutes(window.end) > toMinutes(window.start), {
    message: "End time must be after start time",
    path: ["end"],
  })

export const scheduleRulesSchema = z.object({
  version: z.literal(1),
  workDays: z.object({
    monday: workDaySchema,
    tuesday: workDaySchema,
    wednesday: workDaySchema,
    thursday: workDaySchema,
    friday: workDaySchema,
    saturday: workDaySchema,
    sunday: workDaySchema,
  }),
  protectedWindows: z.array(protectedWindowSchema).max(12),
})

const RULES_KEY = "planner:schedule"

export const SCHEDULE_RULES_KEY = RULES_KEY

export function parseScheduleRules(input: unknown): ScheduleRules {
  return scheduleRulesSchema.parse(input)
}

/** Stored rules win; anything missing or malformed falls back to the defaults. */
export function coerceScheduleRules(stored: unknown): ScheduleRules {
  const parsed = scheduleRulesSchema.safeParse(stored)
  return parsed.success ? parsed.data : DEFAULT_RULES
}

export function weekdayKey(date: string): Weekday {
  return weekdayOf(date).toLowerCase() as Weekday
}

/** Windows that apply to a given date. */
export function windowsForDate(rules: ScheduleRules, date: string): ProtectedWindow[] {
  const day = weekdayKey(date)
  return rules.protectedWindows.filter((window) => window.days.includes(day))
}

export function windowAllows(window: ProtectedWindow, title: string): boolean {
  const lower = title.toLowerCase()
  return window.allowWords.some((word) => lower.includes(word.toLowerCase()))
}

/**
 * Why a work block may not sit at this date and time, or null when it fits.
 * Personal blocks are unaffected: the studio keeps personal rhythm outside
 * working hours on purpose.
 */
export function workWindowIssue(
  rules: ScheduleRules,
  args: { date: string; start: number; end: number; area: "work" | "personal" },
): string | null {
  if (args.area !== "work") return null
  const day = weekdayKey(args.date)
  const workDay = rules.workDays[day]
  const label = WEEKDAY_LABELS[day]
  if (!workDay.enabled) {
    return `${prettyDate(args.date)} is ${label}, which you keep free of work.`
  }
  const from = toMinutes(workDay.start)
  const to = toMinutes(workDay.end)
  if (args.start < from || args.end > to) {
    return `${toClock(args.start)}–${toClock(args.end)} is outside your ${label} working hours (${workDay.start}–${workDay.end}).`
  }
  return null
}

function overlaps(a0: number, a1: number, b0: number, b1: number) {
  return a0 < b1 && b0 < a1
}

/**
 * Every reason a block may not sit where it does, in plain language. The
 * assistant's simulator uses this list to reject proposals; /settings uses the
 * first entry to warn about blocks that already break the edited rules.
 */
export function ruleViolations(
  rules: ScheduleRules,
  block: { title: string; date: string; start: number; end: number; area: "work" | "personal" },
): string[] {
  const violations: string[] = []
  const workIssue = workWindowIssue(rules, block)
  if (workIssue) violations.push(workIssue)

  for (const window of windowsForDate(rules, block.date)) {
    const w0 = toMinutes(window.start)
    const w1 = toMinutes(window.end)
    if (overlaps(block.start, block.end, w0, w1) && !windowAllows(window, block.title)) {
      violations.push(
        `"${block.title}" sits inside ${window.start}–${window.end}, which is protected for ${window.label.toLowerCase()}.`,
      )
    }
  }
  return violations
}

/** Compact "Mon–Fri 09:00–18:00 · Sun off" summary for prompts and UI. */
export function summarizeWorkDays(rules: ScheduleRules): string {
  const groups: Array<{ label: string; value: string }> = []
  for (const day of WEEKDAYS) {
    const workDay = rules.workDays[day]
    const value = workDay.enabled ? `${workDay.start}–${workDay.end}` : "off"
    const last = groups[groups.length - 1]
    if (last && last.value === value) {
      const first = last.label.split("–")[0]
      last.label = `${first}–${WEEKDAY_LABELS[day].slice(0, 3)}`
    } else {
      groups.push({ label: WEEKDAY_LABELS[day].slice(0, 3), value })
    }
  }
  return groups.map((group) => (group.value === "off" ? `${group.label} off` : `${group.label} ${group.value}`)).join(" · ")
}

export function summarizeRules(rules: ScheduleRules): string[] {
  const lines = [`Working hours — ${summarizeWorkDays(rules)}.`]
  for (const window of rules.protectedWindows) {
    const days =
      window.days.length === 7 ? "every day" : window.days.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(", ")
    const allowance =
      window.allowWords.length > 0
        ? ` Only a block whose title mentions ${window.allowWords.slice(0, 5).join(", ")} may sit there.`
        : " Nothing else may sit there."
    lines.push(
      `${window.start}–${window.end} is protected for ${window.label.toLowerCase()} (${days}).${allowance}`,
    )
  }
  return lines
}
