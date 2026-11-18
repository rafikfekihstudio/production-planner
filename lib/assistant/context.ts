import { DAY_END_MIN, DAY_START_MIN } from "@/lib/timeline-constants"
import { DEFAULT_RULES, summarizeRules, type ScheduleRules } from "@/lib/schedule"
import type { CalendarState } from "./state"
import { addDays, clockInTimezone, relativeDay, TIMEZONE, todayInTimezone, toClock, weekdayOf } from "./time"

export type PlannerContext = {
  timezone: string
  today: string
  weekday: string
  localTime: string
  grid: { start: string; end: string }
  rules: string[]
  clients: Array<{ id: number; name: string; company: string | null; active: boolean }>
  projects: Array<{
    id: number
    name: string
    area: string
    clientName: string | null
    status: string
    deadline: string | null
  }>
  workTypes: Array<{ id: number; name: string; defaultMinutes: number }>
  scheduled: Array<{
    id: number
    date: string
    day: string
    start: string
    end: string
    minutes: number
    title: string
    project: string | null
    type: string | null
    status: string
    area: string
  }>
  backlog: Array<{ id: number; title: string; minutes: number; project: string | null }>
}

const STATIC_RULES = [
  "Never overlap two tasks on the same day. Leave 10–15 minutes between demanding blocks where practical.",
  "Confirmed client work outranks personal development and personal projects. If they collide, move the personal block — never delete it silently.",
  "Studio rhythm: outreach and client work in the 10:30–14:00 block, learning/development 15:30–18:30, physical activity from 19:00, evenings personal.",
  "Use 15-minute increments and the existing work types and projects where they fit. Do not invent project or work-type ids.",
  "Do not duplicate a block that already exists with the same title on the same day.",
  "Keep some slack in the day. Do not fill every free slot.",
]

/** Working hours and protected windows come from /settings, not from code. */
function standingRules(rules: ScheduleRules): string[] {
  return [...summarizeRules(rules), ...STATIC_RULES]
}

export function buildPlannerContext(
  state: CalendarState,
  now: Date = new Date(),
  rules: ScheduleRules = DEFAULT_RULES,
): PlannerContext {
  const today = todayInTimezone(now)

  // Include recent past days: the user routinely asks to complete or review
  // work from earlier in the week, and those tasks must be in the prompt.
  const from = addDays(today, -30)
  const to = addDays(today, 28)

  const projectName = (id: number | null) => (id ? (state.projects.find((p) => p.id === id)?.name ?? null) : null)
  const clientName = (id: number | null) => (id ? (state.clients.find((c) => c.id === id)?.name ?? null) : null)
  const typeName = (id: number | null) => (id ? (state.workTypes.find((w) => w.id === id)?.name ?? null) : null)
  const areaOf = (task: { projectId: number | null; workTypeId: number | null }) => {
    const project = task.projectId ? state.projects.find((p) => p.id === task.projectId) : null
    if (project) return project.area
    const type = task.workTypeId ? state.workTypes.find((w) => w.id === task.workTypeId) : null
    if (type && /^(training|personal\s*&\s*social|personal|fitness|workout|rest|recovery)$/i.test(type.name.trim())) {
      return "personal"
    }
    return "work"
  }

  const scheduled = state.tasks
    .filter((t) => t.scheduledDate && t.startTime && t.scheduledDate >= from && t.scheduledDate <= to)
    .sort((a, b) => `${a.scheduledDate}${a.startTime}`.localeCompare(`${b.scheduledDate}${b.startTime}`))
    .map((t) => ({
      id: t.id,
      date: t.scheduledDate as string,
      day: weekdayOf(t.scheduledDate as string),
      start: t.startTime as string,
      end: t.endTime ?? "",
      minutes: t.estimatedMinutes,
      title: t.title,
      project: projectName(t.projectId),
      type: typeName(t.workTypeId),
      status: t.status,
      area: areaOf(t),
    }))

  const backlog = state.tasks
    .filter((t) => !t.scheduledDate && t.status !== "completed" && t.status !== "cancelled")
    .slice(0, 40)
    .map((t) => ({
      id: t.id,
      title: t.title,
      minutes: t.estimatedMinutes,
      project: projectName(t.projectId),
    }))

  return {
    timezone: TIMEZONE,
    today,
    weekday: weekdayOf(today),
    localTime: clockInTimezone(now),
    grid: { start: toClock(DAY_START_MIN), end: toClock(DAY_END_MIN) },
    rules: standingRules(rules),
    clients: state.clients.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      active: c.active,
    })),
    projects: state.projects.map((p) => ({
      id: p.id,
      name: p.name,
      area: p.area,
      clientName: clientName(p.clientId),
      status: p.status,
      deadline: p.deadline,
    })),
    workTypes: state.workTypes.map((w) => ({ id: w.id, name: w.name, defaultMinutes: w.defaultDuration })),
    scheduled,
    backlog,
  }
}

export function renderContext(context: PlannerContext) {
  const lines: string[] = []
  lines.push(`Today is ${context.today} (${context.weekday}), local time ${context.localTime} (${context.timezone}).`)
  lines.push(`Planner grid: ${context.grid.start}–${context.grid.end}. Resolve relative dates ("next week", "tomorrow", "Wednesday") against today.`)
  lines.push("")
  lines.push("CLIENTS (use these ids; do not schedule new work for archived clients):")
  if (context.clients.length === 0) {
    lines.push("- None yet.")
  } else {
    for (const c of context.clients) {
      lines.push(
        `- ${c.id} · ${c.name}${c.company ? ` · ${c.company}` : ""}${c.active ? "" : " · archived"}`,
      )
    }
  }
  lines.push("")
  lines.push("PROJECTS (use these ids, never invent one):")
  for (const p of context.projects) {
    lines.push(
      `- ${p.id} · ${p.name} · ${p.area} · ${p.clientName ?? "no client"} · ${p.status}${
        p.deadline ? ` · deadline ${p.deadline}` : ""
      }`,
    )
  }
  lines.push("")
  lines.push("WORK TYPES (use these ids):")
  lines.push(context.workTypes.map((w) => `- ${w.id} · ${w.name} · ${w.defaultMinutes}m`).join("\n"))
  lines.push("")
  lines.push(
    `EXISTING SCHEDULE (${context.scheduled.length} blocks, ${context.scheduled[0]?.date ?? context.today} to ${
      context.scheduled[context.scheduled.length - 1]?.date ?? context.today
    }; past days included so they can be marked done):`,
  )
  for (const t of context.scheduled) {
    lines.push(
      `- #${t.id} ${t.date} ${t.day} ${t.start}–${t.end} (${t.minutes}m) "${t.title}"${t.project ? ` · ${t.project}` : ""}${
        t.type ? ` · ${t.type}` : ""
      } · ${t.status} · ${t.area}`,
    )
  }
  if (context.backlog.length > 0) {
    lines.push("")
    lines.push("BACKLOG (unscheduled):")
    for (const t of context.backlog) {
      lines.push(`- #${t.id} "${t.title}" ${t.minutes}m${t.project ? ` · ${t.project}` : ""}`)
    }
  }
  lines.push("")
  lines.push("HOUSE RULES (enforced by the server; a plan that breaks one is rejected):")
  lines.push(context.rules.map((r) => `- ${r}`).join("\n"))
  lines.push("")
  lines.push(`Relative reference: ${context.today} is today, ${addDays(context.today, 1)} is tomorrow (${relativeDay(addDays(context.today, 1), context.today)}).`)
  return lines.join("\n")
}
