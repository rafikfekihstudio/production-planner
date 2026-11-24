"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { tasks } from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"
import { revalidatePath } from "next/cache"

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + mins
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

export type TaskInput = {
  title: string
  projectId?: number | null
  clientId?: number | null
  workTypeId?: number | null
  estimatedMinutes: number
  scheduledDate?: string | null
  startTime?: string | null
  deadline?: string | null
  priority?: "low" | "medium" | "high" | "urgent"
  status?: "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled"
  clientVisibleNotes?: string | null
  referenceUrl?: string | null
  description?: string | null
}

export async function createTask(input: TaskInput) {
  await requireUser()
  const scheduled = !!input.scheduledDate && !!input.startTime
  const endTime = scheduled && input.startTime ? addMinutes(input.startTime, input.estimatedMinutes) : null
  const [inserted] = await db.insert(tasks).values({
    title: input.title,
    projectId: input.projectId ?? null,
    clientId: input.clientId ?? null,
    workTypeId: input.workTypeId ?? null,
    estimatedMinutes: input.estimatedMinutes,
    scheduledDate: input.scheduledDate ?? null,
    startTime: input.startTime ?? null,
    endTime,
    deadline: input.deadline ?? null,
    priority: input.priority ?? "medium",
    status: input.status ?? "scheduled",
    clientVisibleNotes: input.clientVisibleNotes ?? null,
    referenceUrl: input.referenceUrl ?? null,
    description: input.description ?? null,
  }).returning()
  revalidatePath("/timeline")
  revalidatePath("/")
  return inserted
}

export async function updateTask(id: number, input: Partial<TaskInput>) {
  await requireUser()
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (input.title !== undefined) patch.title = input.title
  if (input.projectId !== undefined) patch.projectId = input.projectId
  if (input.clientId !== undefined) patch.clientId = input.clientId
  if (input.workTypeId !== undefined) patch.workTypeId = input.workTypeId
  if (input.estimatedMinutes !== undefined) patch.estimatedMinutes = input.estimatedMinutes
  if (input.scheduledDate !== undefined) patch.scheduledDate = input.scheduledDate
  if (input.startTime !== undefined) patch.startTime = input.startTime
  if (input.deadline !== undefined) patch.deadline = input.deadline
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.status !== undefined) patch.status = input.status
  if (input.clientVisibleNotes !== undefined) patch.clientVisibleNotes = input.clientVisibleNotes
  if (input.referenceUrl !== undefined) patch.referenceUrl = input.referenceUrl
  if (input.description !== undefined) patch.description = input.description

  // recompute end time if schedule or duration changed
  const current = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!current) throw new Error("Task not found")
  const newDate = input.scheduledDate !== undefined ? input.scheduledDate : current.scheduledDate
  const newStart = input.startTime !== undefined ? input.startTime : current.startTime
  const newDur = input.estimatedMinutes !== undefined ? input.estimatedMinutes : current.estimatedMinutes
  if (newDate && newStart) {
    patch.endTime = addMinutes(newStart, newDur)
    if (input.status === undefined) patch.status = "scheduled"
  } else {
    patch.endTime = null
  }

  await db.update(tasks).set(patch).where(eq(tasks.id, id)).run()
  revalidatePath("/timeline")
  revalidatePath("/")
}

export async function deleteTask(id: number) {
  await requireUser()
  await db.delete(tasks).where(eq(tasks.id, id)).run()
  revalidatePath("/timeline")
  revalidatePath("/")
}

export async function scheduleTask(id: number, date: string, startTime: string) {
  await requireUser()
  const t = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!t) throw new Error("Task not found")
  const endTime = addMinutes(startTime, t.estimatedMinutes)
  await db.update(tasks).set({
    scheduledDate: date,
    startTime,
    endTime,
    status: "scheduled",
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, id)).run()
  revalidatePath("/timeline")
  revalidatePath("/")
}

export async function unscheduleTask(id: number) {
  await requireUser()
  await db.update(tasks).set({
    scheduledDate: null,
    startTime: null,
    endTime: null,
    status: "backlog",
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, id)).run()
  revalidatePath("/timeline")
  revalidatePath("/")
}

export async function resizeTask(id: number, minutes: number) {
  await requireUser()
  const t = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!t || !t.startTime) throw new Error("Task not scheduled")
  const endTime = addMinutes(t.startTime, minutes)
  await db.update(tasks).set({
    estimatedMinutes: minutes,
    endTime,
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, id)).run()
  revalidatePath("/timeline")
  revalidatePath("/")
}
export async function moveTask(id: number, date: string, startTime: string) {
  return scheduleTask(id, date, startTime)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function isValidDateKey(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return false
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}` === value
}

/** Move a whole selection atomically so a failed update cannot leave it half-moved. */
export async function moveTasks(moves: Array<{ id: number; date: string; time: string }>) {
  await requireUser()
  if (!Array.isArray(moves) || moves.length === 0) throw new Error("No slots selected")

  const ids = moves.map((move) => move.id)
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate task in selection")
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("Invalid task id")
  if (moves.some((move) => !isValidDateKey(move.date) || !TIME_PATTERN.test(move.time))) {
    throw new Error("Invalid date or time")
  }

  await db.transaction(async (tx) => {
    const rows = await tx.select().from(tasks).where(inArray(tasks.id, ids)).all()
    if (rows.length !== ids.length) throw new Error("One or more tasks no longer exist")
    const byId = new Map(rows.map((task) => [task.id, task]))

    for (const move of moves) {
      const task = byId.get(move.id)
      if (!task) continue
      await tx
        .update(tasks)
        .set({
          scheduledDate: move.date,
          startTime: move.time,
          endTime: addMinutes(move.time, task.estimatedMinutes),
          status: "scheduled",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, move.id))
        .run()
    }
  })

  revalidatePath("/timeline")
  revalidatePath("/")
  return moves.length
}

export async function duplicateTaskAt(id: number, date: string, startTime: string) {
  await requireUser()
  const t = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!t) throw new Error("Task not found")
  const [inserted] = await db.insert(tasks).values({
    title: t.title + " (copy)",
    projectId: t.projectId,
    clientId: t.clientId,
    workTypeId: t.workTypeId,
    estimatedMinutes: t.estimatedMinutes,
    scheduledDate: date,
    startTime,
    endTime: addMinutes(startTime, t.estimatedMinutes),
    deadline: t.deadline,
    priority: t.priority,
    status: "scheduled",
    clientVisibleNotes: t.clientVisibleNotes,
    referenceUrl: t.referenceUrl,
    description: t.description,
  }).returning()
  revalidatePath("/timeline")
  revalidatePath("/")
  return inserted
}

export async function duplicateTask(id: number) {
  await requireUser()
  const t = await db.select().from(tasks).where(eq(tasks.id, id)).get()
  if (!t) throw new Error("Task not found")
  const [inserted] = await db.insert(tasks).values({
    title: t.title + " (copy)",
    projectId: t.projectId,
    clientId: t.clientId,
    workTypeId: t.workTypeId,
    estimatedMinutes: t.estimatedMinutes,
    scheduledDate: t.scheduledDate,
    startTime: t.startTime,
    endTime: t.endTime,
    deadline: t.deadline,
    priority: t.priority,
    status: t.status,
    clientVisibleNotes: t.clientVisibleNotes,
    referenceUrl: t.referenceUrl,
    description: t.description,
  }).returning()
  revalidatePath("/timeline")
  revalidatePath("/")
  return inserted
}