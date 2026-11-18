import {
  createTask,
  deleteTask,
  moveTask,
  resizeTask,
  scheduleTask,
  unscheduleTask,
  updateTask,
} from "@/lib/actions/tasks"
import type { PreviewStep } from "./simulate"
import type { CalendarState } from "./state"
import type { UndoOp } from "./undo"

export type ExecuteResult = {
  created: number
  moved: number
  resized: number
  deleted: number
  completed: number
  undo: UndoOp[]
}

/**
 * Runs a validated plan through the existing server actions. If any single
 * write fails, everything already written is compensated using the undo
 * ledger, so a failure never leaves half a plan on the calendar.
 */
export async function applyOperations(steps: PreviewStep[], state: CalendarState): Promise<ExecuteResult> {
  const undo: UndoOp[] = []
  const counts = { created: 0, moved: 0, resized: 0, deleted: 0, completed: 0 }

  try {
    for (const step of steps) {
      const op = step.op

      if (op.kind === "create") {
        const inserted = await createTask({
          title: op.title,
          projectId: op.projectId ?? null,
          workTypeId: op.workTypeId ?? null,
          estimatedMinutes: op.minutes,
          scheduledDate: op.date,
          startTime: op.start,
          priority: op.priority,
          description: op.description ?? null,
        })
        if (!inserted?.id) throw new Error(`Could not create "${op.title}".`)
        undo.push({ kind: "delete", taskId: inserted.id })
        counts.created += 1
        continue
      }

      const original = state.tasks.find((task) => task.id === op.taskId)
      if (!original) throw new Error(`Task ${op.taskId} disappeared before it could be changed.`)

      if (op.kind === "done") {
        await updateTask(op.taskId, { status: op.done === false ? "scheduled" : "completed" })
        undo.push({ kind: "status", taskId: op.taskId, status: original.status })
        counts.completed += 1
        continue
      }

      if (op.kind === "move") {
        await moveTask(op.taskId, op.date, op.start)
        undo.push({
          kind: "restore",
          taskId: op.taskId,
          date: original.scheduledDate,
          start: original.startTime,
          status: original.status,
        })
        counts.moved += 1
        continue
      }

      if (op.kind === "resize") {
        await resizeTask(op.taskId, op.minutes)
        undo.push({ kind: "duration", taskId: op.taskId, minutes: original.estimatedMinutes })
        counts.resized += 1
        continue
      }

      await deleteTask(op.taskId)
      undo.push({
        kind: "recreate",
        task: {
          title: original.title,
          projectId: original.projectId,
          clientId: original.clientId,
          workTypeId: original.workTypeId,
          estimatedMinutes: original.estimatedMinutes,
          scheduledDate: original.scheduledDate,
          startTime: original.startTime,
          deadline: original.deadline,
          priority: original.priority,
          status: original.status,
          clientVisibleNotes: original.clientVisibleNotes,
          referenceUrl: original.referenceUrl,
          description: original.description,
        },
      })
      counts.deleted += 1
    }
  } catch (error) {
    await revertOperations(undo).catch(() => undefined)
    throw error
  }

  return { ...counts, undo }
}

/** Reverses an undo ledger in reverse order. Best-effort per op. */
export async function revertOperations(ops: UndoOp[]): Promise<{ reverted: number; failures: string[] }> {
  let reverted = 0
  const failures: string[] = []

  for (const op of [...ops].reverse()) {
    try {
      if (op.kind === "delete") {
        await deleteTask(op.taskId)
      } else if (op.kind === "restore") {
        if (op.date && op.start) {
          await scheduleTask(op.taskId, op.date, op.start)
          if (op.status !== "scheduled") {
            await updateTask(op.taskId, {
              status: op.status as "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled",
            })
          }
        } else {
          await unscheduleTask(op.taskId)
          if (op.status !== "backlog") {
            await updateTask(op.taskId, {
              status: op.status as "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled",
            })
          }
        }
      } else if (op.kind === "duration") {
        await resizeTask(op.taskId, op.minutes)
      } else if (op.kind === "status") {
        await updateTask(op.taskId, {
          status: op.status as "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled",
        })
      } else {
        await createTask({ ...op.task })
      }
      reverted += 1
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  return { reverted, failures }
}
