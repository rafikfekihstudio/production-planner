import { DAY_END_MIN, DAY_START_MIN } from "@/lib/timeline-constants"
import {
  DEFAULT_RULES,
  ruleViolations,
  type ScheduleRules,
} from "@/lib/schedule"
import type { Operation } from "./schema"
import type { CalendarArea, CalendarState } from "./state"
import { endClock, prettyDate, relativeDay, toClock, toMinutes } from "./time"

/** Grid bounds of the planner (07:00–23:00). */
const DAY_START = DAY_START_MIN
const DAY_END = DAY_END_MIN
const HORIZON_DAYS = 365

const PERSONAL_WORK_TYPE = /^(training|personal\s*&\s*social|personal|fitness|workout|rest|recovery)$/i

const ACTIVE_DELIVERY = new Set(["in_progress", "waiting_feedback", "revision"])

export type PreviewStep = {
  op: Operation
  kind: Operation["kind"]
  taskId: number | null
  title: string
  date: string | null
  start: string | null
  end: string | null
  minutes: number | null
  area: CalendarArea
  projectName: string | null
  workTypeName: string | null
  summary: string
  before: string | null
  destructive: boolean
}

export type Simulation = {
  ok: boolean
  issues: string[]
  steps: PreviewStep[]
}

type Block = {
  key: string
  taskId: number | null
  date: string
  start: number
  end: number
  title: string
  area: CalendarArea
  projectId: number | null
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/\(copy\)/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd
}

function clockRange(block: Block) {
  return `${toClock(block.start)}–${toClock(block.end)}`
}

function areaOfProject(state: CalendarState, projectId: number | null): CalendarArea | null {
  if (!projectId) return null
  return state.projects.find((p) => p.id === projectId)?.area ?? null
}

function areaOfWorkType(state: CalendarState, workTypeId: number | null): CalendarArea | null {
  if (!workTypeId) return null
  const type = state.workTypes.find((t) => t.id === workTypeId)
  if (!type) return null
  return PERSONAL_WORK_TYPE.test(type.name.trim()) ? "personal" : "work"
}

function resolveArea(
  state: CalendarState,
  projectId: number | null | undefined,
  workTypeId: number | null | undefined,
  hint: CalendarArea | undefined,
): CalendarArea {
  // A project's area is authoritative; a declared area beats a work-type guess.
  return areaOfProject(state, projectId ?? null) ?? hint ?? areaOfWorkType(state, workTypeId ?? null) ?? "work"
}

function taskArea(state: CalendarState, task: { projectId: number | null; workTypeId: number | null }) {
  return resolveArea(state, task.projectId, task.workTypeId, undefined)
}

function blockFromTask(
  state: CalendarState,
  task: {
    id: number
    title: string
    scheduledDate: string | null
    startTime: string | null
    endTime: string | null
    estimatedMinutes: number
    projectId: number | null
    workTypeId: number | null
    status: string
  },
): Block | null {
  if (!task.scheduledDate || !task.startTime) return null
  if (task.status === "completed" || task.status === "cancelled") return null
  const start = toMinutes(task.startTime)
  const end = task.endTime ? toMinutes(task.endTime) : start + task.estimatedMinutes
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return {
    key: `task-${task.id}`,
    taskId: task.id,
    date: task.scheduledDate,
    start,
    end,
    title: task.title,
    area: taskArea(state, task),
    projectId: task.projectId,
  }
}

export type UpcomingBlock = {
  id: number
  title: string
  date: string
  start: string
  end: string
  area: CalendarArea
}

/**
 * Blocks already on the calendar from today onward. /settings uses this to show
 * which existing blocks the edited hours would no longer allow — editing rules
 * never moves them, so the warning has to be visible before saving.
 */
export function upcomingBlocks(state: CalendarState, today: string): UpcomingBlock[] {
  const out: UpcomingBlock[] = []
  for (const task of state.tasks) {
    const block = blockFromTask(state, task)
    if (!block || block.date < today) continue
    out.push({
      id: task.id,
      title: task.title,
      date: block.date,
      start: toClock(block.start),
      end: toClock(block.end),
      area: block.area,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
}

function slotIssues(args: {
  rules: ScheduleRules
  state: CalendarState
  blocks: Block[]
  date: string
  start: number
  end: number
  title: string
  area: CalendarArea
  excludeTaskIds: number[]
  ignoreDuplicateOfTaskId?: number | null
  today: string
  what: string
}): string[] {
  const { rules, state, blocks, date, start, end, title, area, excludeTaskIds, today, what } = args
  const issues: string[] = []

  if (start < DAY_START || end > DAY_END) {
    issues.push(
      `${what}: ${toClock(start)}–${toClock(end)} falls outside the planner grid (${toClock(DAY_START)}–${toClock(DAY_END)}).`,
    )
  }

  if (date < today) {
    issues.push(`${what}: ${prettyDate(date)} is in the past.`)
  } else {
    const limit = new Date(`${today}T12:00:00Z`)
    limit.setUTCDate(limit.getUTCDate() + HORIZON_DAYS)
    if (date > limit.toISOString().slice(0, 10)) {
      issues.push(`${what}: ${prettyDate(date)} is more than a year away.`)
    }
  }

  for (const violation of ruleViolations(rules, { title, date, start, end, area })) {
    issues.push(`${what}: ${violation}`)
  }

  for (const block of blocks) {
    if (block.date !== date) continue
    if (block.taskId !== null && excludeTaskIds.includes(block.taskId)) continue
    if (!overlaps(start, end, block.start, block.end)) continue
    const clash = `"${block.title}" ${clockRange(block)}`
    if (area === "work" && block.area === "personal") {
      issues.push(
        `${what}: overlaps ${clash}. Client/work commitments outrank personal blocks, so propose a move for that personal task in the same plan instead of overwriting it.`,
      )
    } else if (area === "personal" && block.area === "work") {
      issues.push(`${what}: overlaps ${clash}. Work takes priority over personal blocks — pick another slot.`)
    } else {
      issues.push(`${what}: overlaps ${clash}.`)
    }
  }

  if (what.startsWith("Create")) {
    const target = normalizeTitle(title)
    const existing = state.tasks.find(
      (t) =>
        t.scheduledDate === date &&
        t.status !== "cancelled" &&
        normalizeTitle(t.title) === target &&
        t.id !== args.ignoreDuplicateOfTaskId,
    )
    if (existing) {
      issues.push(
        `${what}: "${existing.title}" already exists on ${prettyDate(date)}. Do not duplicate recurring blocks.`,
      )
    }
  }

  return issues
}

function describeCreate(args: {
  title: string
  date: string
  start: string
  end: string
  minutes: number
  projectName: string | null
  workTypeName: string | null
  today: string
}) {
  const bits = [`Create "${args.title}"`, `${prettyDate(args.date)} (${relativeDay(args.date, args.today)})`, `${args.start}–${args.end} (${args.minutes}m)`]
  if (args.projectName) bits.push(args.projectName)
  if (args.workTypeName) bits.push(args.workTypeName)
  return bits.join(" · ")
}

/**
 * Applies every proposed operation to an in-memory copy of the calendar and
 * reports rule violations. Nothing is written here — the route calls this
 * before showing a preview and again immediately before the real write.
 */
export function simulate(
  operations: Operation[],
  state: CalendarState,
  today: string,
  rules: ScheduleRules = DEFAULT_RULES,
): Simulation {
  const issues: string[] = []
  const steps: PreviewStep[] = []
  const blocks: Block[] = []

  for (const task of state.tasks) {
    const block = blockFromTask(state, task)
    if (block) blocks.push(block)
  }

  const taskById = new Map(state.tasks.map((t) => [t.id, t]))
  const blockByTaskId = new Map(blocks.filter((b) => b.taskId !== null).map((b) => [b.taskId as number, b]))
  const createdInPlan = new Set<string>()
  let syntheticId = -1

  for (const op of operations) {
    if (op.kind === "create") {
      const project = op.projectId ? state.projects.find((p) => p.id === op.projectId) : null
      const workType = op.workTypeId ? state.workTypes.find((w) => w.id === op.workTypeId) : null
      if (op.projectId && !project) {
        issues.push(`Create "${op.title}": project ${op.projectId} does not exist.`)
        continue
      }
      if (op.workTypeId && !workType) {
        issues.push(`Create "${op.title}": work type ${op.workTypeId} does not exist.`)
        continue
      }

      const start = toMinutes(op.start)
      const end = start + op.minutes
      const area = resolveArea(state, op.projectId, op.workTypeId, op.area)
      const what = `Create "${op.title}"`

      const found = slotIssues({
        rules,
        state,
        blocks,
        date: op.date,
        start,
        end,
        title: op.title,
        area,
        excludeTaskIds: [],
        today,
        what,
      })
      issues.push(...found)

      const planKey = `${op.date}|${normalizeTitle(op.title)}`
      if (createdInPlan.has(planKey)) {
        issues.push(`${what}: appears twice in this plan for ${prettyDate(op.date)}.`)
      }
      if (found.length > 0 || createdInPlan.has(planKey)) continue
      createdInPlan.add(planKey)

      const key = `new-${Math.abs(syntheticId++)}`
      blocks.push({
        key,
        taskId: null,
        date: op.date,
        start,
        end,
        title: op.title,
        area,
        projectId: op.projectId ?? null,
      })
      steps.push({
        op,
        kind: "create",
        taskId: null,
        title: op.title,
        date: op.date,
        start: op.start,
        end: endClock(op.start, op.minutes),
        minutes: op.minutes,
        area,
        projectName: project?.name ?? null,
        workTypeName: workType?.name ?? null,
        summary: describeCreate({
          title: op.title,
          date: op.date,
          start: op.start,
          end: endClock(op.start, op.minutes),
          minutes: op.minutes,
          projectName: project?.name ?? null,
          workTypeName: workType?.name ?? null,
          today,
        }),
        before: null,
        destructive: false,
      })
      continue
    }

    const task = taskById.get(op.taskId)
    if (!task) {
      const label = op.kind === "delete" ? "Delete" : op.kind === "move" ? "Move" : op.kind === "resize" ? "Resize" : "Mark done"
      issues.push(`${label}: task ${op.taskId} does not exist.`)
      continue
    }

    if (op.kind === "done") {
      // Completing/reopening is a status change, not a scheduling change:
      // past dates are fine and none of the grid or working-hour rules apply.
      const reopen = op.done === false
      const targetStatus = reopen ? "scheduled" : "completed"
      if (task.status === targetStatus) continue

      const block = blockByTaskId.get(task.id)
      if (!reopen && block) {
        blocks.splice(blocks.indexOf(block), 1)
        blockByTaskId.delete(task.id)
      } else if (reopen) {
        const restored = blockFromTask(state, { ...task, status: "scheduled" })
        if (restored) {
          blocks.push(restored)
          blockByTaskId.set(task.id, restored)
        }
      }

      steps.push({
        op,
        kind: "done",
        taskId: task.id,
        title: task.title,
        date: task.scheduledDate,
        start: task.startTime,
        end: task.endTime,
        minutes: task.estimatedMinutes,
        area: taskArea(state, task),
        projectName: state.projects.find((p) => p.id === task.projectId)?.name ?? null,
        workTypeName: state.workTypes.find((w) => w.id === task.workTypeId)?.name ?? null,
        summary: `${reopen ? "Reopen" : "Mark"} "${task.title}"${
          task.scheduledDate ? ` on ${prettyDate(task.scheduledDate)}` : ""
        } as ${targetStatus}`,
        before: task.status,
        destructive: false,
      })
      continue
    }

    if (op.kind === "delete") {
      const project = task.projectId ? state.projects.find((p) => p.id === task.projectId) : null
      if (project && ACTIVE_DELIVERY.has(project.status)) {
        issues.push(
          `Delete "${task.title}": project "${project.name}" is in active delivery (${project.status}) and must not lose its scheduled work.`,
        )
        continue
      }
      const block = blockByTaskId.get(task.id)
      if (block) blocks.splice(blocks.indexOf(block), 1)
      blockByTaskId.delete(task.id)
      taskById.delete(task.id)
      steps.push({
        op,
        kind: "delete",
        taskId: task.id,
        title: task.title,
        date: task.scheduledDate,
        start: task.startTime,
        end: task.endTime,
        minutes: task.estimatedMinutes,
        area: taskArea(state, task),
        projectName: project?.name ?? null,
        workTypeName: state.workTypes.find((w) => w.id === task.workTypeId)?.name ?? null,
        summary: `Delete "${task.title}"${task.scheduledDate ? ` on ${prettyDate(task.scheduledDate)}` : ""}${
          task.startTime ? ` at ${task.startTime}` : ""
        }`,
        before: task.startTime ? `${task.startTime}${task.endTime ? `–${task.endTime}` : ""}` : null,
        destructive: true,
      })
      continue
    }

    if (op.kind === "resize") {
      const block = blockByTaskId.get(task.id)
      if (!block) {
        issues.push(`Resize "${task.title}": the task is not on the calendar.`)
        continue
      }
      const end = block.start + op.minutes
      const what = `Resize "${task.title}"`
      const found: string[] = []
      if (end > DAY_END) {
        found.push(`${what}: would end at ${toClock(end)}, past the ${toClock(DAY_END)} grid edge.`)
      }
      const workIssues = ruleViolations(rules, {
        title: task.title,
        date: block.date,
        start: block.start,
        end,
        area: block.area,
      })
      for (const issue of workIssues) found.push(`${what}: ${issue}`)
      for (const other of blocks) {
        if (other.key === block.key || other.date !== block.date) continue
        if (overlaps(block.start, end, other.start, other.end)) {
          found.push(`${what}: would overlap "${other.title}" ${clockRange(other)}.`)
        }
      }
      issues.push(...found)
      if (found.length > 0) continue

      blocks.splice(blocks.indexOf(block), 1)
      const updated: Block = { ...block, end }
      blocks.push(updated)
      blockByTaskId.set(task.id, updated)
      steps.push({
        op,
        kind: "resize",
        taskId: task.id,
        title: task.title,
        date: block.date,
        start: toClock(block.start),
        end: toClock(end),
        minutes: op.minutes,
        area: block.area,
        projectName: state.projects.find((p) => p.id === task.projectId)?.name ?? null,
        workTypeName: state.workTypes.find((w) => w.id === task.workTypeId)?.name ?? null,
        summary: `Resize "${task.title}" to ${op.minutes}m · ${prettyDate(block.date)}`,
        before: `${block.end - block.start}m (${clockRange(block)})`,
        destructive: false,
      })
      continue
    }

    // move
    const block = blockByTaskId.get(task.id)
    if (!block) {
      issues.push(`Move "${task.title}": the task is not on the calendar.`)
      continue
    }
    const start = toMinutes(op.start)
    const end = start + (block.end - block.start)
    const what = `Move "${task.title}"`
    const found = slotIssues({
      rules,
      state,
      blocks,
      date: op.date,
      start,
      end,
      title: task.title,
      area: block.area,
      excludeTaskIds: [task.id],
      today,
      what,
    })
    issues.push(...found)
    if (found.length > 0) continue

    blocks.splice(blocks.indexOf(block), 1)
    const updated: Block = { ...block, date: op.date, start, end }
    blocks.push(updated)
    blockByTaskId.set(task.id, updated)
    steps.push({
      op,
      kind: "move",
      taskId: task.id,
      title: task.title,
      date: op.date,
      start: op.start,
      end: toClock(end),
      minutes: block.end - block.start,
      area: block.area,
      projectName: state.projects.find((p) => p.id === task.projectId)?.name ?? null,
      workTypeName: state.workTypes.find((w) => w.id === task.workTypeId)?.name ?? null,
      summary: `Move "${task.title}" to ${prettyDate(op.date)} ${op.start}–${toClock(end)}`,
      before: `${prettyDate(block.date)} ${clockRange(block)}`,
      destructive: false,
    })
  }

  return { ok: issues.length === 0, issues, steps }
}
