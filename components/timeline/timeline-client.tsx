"use client"

import { useState, useEffect, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, ChevronLeft, ChevronRight, CalendarDays, CalendarRange, Trash2, X } from "lucide-react"
import { DailyView } from "./daily-view"
import { WeeklyView } from "./weekly-view"
import { TaskModal } from "./task-modal"
import {
  createTask,
  deleteTask,
  updateTask,
  duplicateTask,
  duplicateTaskAt,
  moveTask,
  moveTasks,
  resizeTask,
  scheduleTask,
  type TaskInput,
} from "@/lib/actions/tasks"
import type { MoveItem } from "@/lib/timeline-utils"

export type Task = {
  id: number
  projectId: number | null
  clientId: number | null
  workTypeId: number | null
  title: string
  description: string | null
  estimatedMinutes: number
  actualMinutes: number
  scheduledDate: string | null
  startTime: string | null
  endTime: string | null
  deadline: string | null
  priority: "low" | "medium" | "high" | "urgent"
  status: "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled"
  clientVisibleNotes: string | null
  referenceUrl: string | null
}

export type WorkType = { id: number; name: string; defaultDuration: number; color: string; description: string | null }
export type Client = { id: number; name: string; company: string | null }
export type Project = { id: number; name: string; clientId: number | null; area: "work" | "personal" }

export { TIMELINE } from "@/lib/timeline-constants"

export function TimelineClient({
  view: initialView,
  anchorDate,
  weekStart,
  weekEnd,
  tasks: initialTasks,
  workTypes,
  clients,
  projects,
}: {
  view: "day" | "week"
  anchorDate: string
  weekStart: string
  weekEnd: string
  tasks: Task[]
  workTypes: WorkType[]
  clients: Client[]
  projects: Project[]
}) {
  const router = useRouter()
  const [view, setView] = useState<"day" | "week">(initialView)
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [anchor, setAnchor] = useState(anchorDate)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [defaults, setDefaults] = useState<{
    date?: string
    time?: string
    projectId?: number | null
    clientId?: number | null
    area?: "work" | "personal"
  }>({})
  const [warning, setWarning] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const selectionAnchor = useRef<number | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    // router.refresh() replaces the server snapshot; mirror it into the local optimistic state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(initialTasks)
  }, [initialTasks])

  useEffect(() => {
    // Drop selections whose tasks disappeared after a refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((prev) => prev.filter((id) => initialTasks.some((task) => task.id === id)))
  }, [initialTasks])

  function showWarning(msg: string) {
    setWarning(msg)
    setTimeout(() => setWarning(null), 3000)
  }

  function rangesOverlap(aStart: string, aDur: number, bStart: string, bDur: number) {
    const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m }
    const a0 = toMin(aStart), a1 = a0 + aDur
    const b0 = toMin(bStart), b1 = b0 + bDur
    return a0 < b1 && b0 < a1
  }

  function handleMove(id: number, date: string, startTime: string) {
    const _scrollY = window.scrollY
    const moving = tasks.find((t) => t.id === id)
    if (moving) {
      const clash = tasks.find(
        (t) => t.id !== id && t.scheduledDate === date && t.startTime && rangesOverlap(startTime, moving.estimatedMinutes, t.startTime, t.estimatedMinutes),
      )
      if (clash) showWarning(`Overlaps with "${clash.title}".`)
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, scheduledDate: date, startTime, endTime: addMinStr(startTime, t.estimatedMinutes), status: "scheduled" }
          : t,
      ),
    )
    startTransition(async () => {
      try {
        await moveTask(id, date, startTime)
      } catch {
        showWarning("Could not move task.")
        router.refresh()
      }
      requestAnimationFrame(() => window.scrollTo(0, _scrollY))
    })
  }

  function clearSelection() {
    setSelectedIds([])
    selectionAnchor.current = null
  }

  function toggleSelection(id: number) {
    selectionAnchor.current = id
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function selectRange(id: number, orderedIds: number[]) {
    const anchor = selectionAnchor.current ?? orderedIds[0] ?? id
    const a = orderedIds.indexOf(anchor)
    const b = orderedIds.indexOf(id)
    if (a < 0 || b < 0) {
      toggleSelection(id)
      return
    }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const range = orderedIds.slice(lo, hi + 1)
    setSelectedIds((prev) => [...new Set([...prev, ...range])])
  }

  function handleMoveMany(moves: MoveItem[]) {
    if (moves.length === 0) return
    const scrollY = window.scrollY
    const moveById = new Map(moves.map((move) => [move.id, move]))
    const movedIds = new Set(moves.map((move) => move.id))
    for (const move of moves) {
      const moving = tasks.find((t) => t.id === move.id)
      if (!moving) continue
      const clash = tasks.find(
        (t) =>
          !movedIds.has(t.id) &&
          t.scheduledDate === move.date &&
          t.startTime &&
          rangesOverlap(move.time, moving.estimatedMinutes, t.startTime, t.estimatedMinutes),
      )
      if (clash) {
        showWarning(`Overlaps with "${clash.title}".`)
        break
      }
    }
    setTasks((prev) =>
      prev.map((task) => {
        const move = moveById.get(task.id)
        if (!move) return task
        return {
          ...task,
          scheduledDate: move.date,
          startTime: move.time,
          endTime: addMinStr(move.time, task.estimatedMinutes),
          status: "scheduled",
        }
      }),
    )
    startTransition(async () => {
      try {
        await moveTasks(moves)
      } catch {
        showWarning("Could not move the selected slots.")
        router.refresh()
      }
      requestAnimationFrame(() => window.scrollTo(0, scrollY))
    })
  }

  function handleResize(id: number, minutes: number) {
    const resizing = tasks.find((t) => t.id === id)
    if (resizing && resizing.startTime) {
      const clash = tasks.find(
        (t) => t.id !== id && t.scheduledDate === resizing.scheduledDate && t.startTime && rangesOverlap(resizing.startTime!, minutes, t.startTime, t.estimatedMinutes),
      )
      if (clash) showWarning(`Overlaps with "${clash.title}".`)
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, estimatedMinutes: minutes, endTime: t.startTime ? addMinStr(t.startTime, minutes) : t.endTime }
          : t,
      ),
    )
    startTransition(async () => {
      try {
        await resizeTask(id, minutes)
      } catch {
        showWarning("Could not resize task.")
        router.refresh()
      }
    })
  }

  function handleToggleDone(task: Task) {
    const next: Task["status"] = task.status === "completed" ? "scheduled" : "completed"
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)))
    startTransition(async () => {
      try {
        await updateTask(task.id, { status: next })
      } catch {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)))
        showWarning("Could not update task status.")
        router.refresh()
      }
    })
  }

  function handleSchedule(id: number, date: string, startTime: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, scheduledDate: date, startTime, endTime: addMinStr(startTime, t.estimatedMinutes), status: "scheduled" }
          : t,
      ),
    )
    startTransition(async () => {
      try {
        await scheduleTask(id, date, startTime)
      } catch {
        showWarning("Could not schedule task.")
        router.refresh()
      }
    })
  }

  function openCreate(defaultsIn: { date?: string; time?: string }) {
    setEditing(null)
    const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` })()
    setDefaults({ date: defaultsIn.date ?? today, time: defaultsIn.time ?? "09:00" })
    setModalOpen(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setDefaults({})
    setModalOpen(true)
  }

  async function handleSave(input: TaskInput) {
    const scrollY = window.scrollY
    if (editing) {
      await updateTask(editing.id, input)
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== editing.id) return t
          const updated = { ...t }
          if (input.title !== undefined) updated.title = input.title
          if (input.estimatedMinutes !== undefined) updated.estimatedMinutes = input.estimatedMinutes
          if (input.scheduledDate !== undefined) updated.scheduledDate = input.scheduledDate ?? null
          if (input.startTime !== undefined) updated.startTime = input.startTime ?? null
          if (input.priority !== undefined) updated.priority = input.priority ?? "medium"
          if (input.status !== undefined) updated.status = input.status ?? t.status
          if (input.clientId !== undefined) updated.clientId = input.clientId ?? null
          if (input.projectId !== undefined) updated.projectId = input.projectId ?? null
          if (input.workTypeId !== undefined) updated.workTypeId = input.workTypeId ?? null
          if (input.deadline !== undefined) updated.deadline = input.deadline ?? null
          if (input.clientVisibleNotes !== undefined) updated.clientVisibleNotes = input.clientVisibleNotes ?? null
          if (input.referenceUrl !== undefined) updated.referenceUrl = input.referenceUrl ?? null
          if (input.description !== undefined) updated.description = input.description ?? null
          // recompute end time
          if (updated.scheduledDate && updated.startTime) {
            const [h, m] = updated.startTime.split(":").map(Number)
            const endMin = h * 60 + m + updated.estimatedMinutes
            updated.endTime = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`
            if (updated.status === "backlog") updated.status = "scheduled"
          } else {
            updated.endTime = null
          }
          return updated
        }),
      )
    } else {
      const created = await createTask(input)
      if (created) setTasks((prev) => [...prev, created as unknown as Task])
    }
    setModalOpen(false)
    setEditing(null)
    router.refresh()
    requestAnimationFrame(() => window.scrollTo(0, scrollY))
  }

  async function handleDelete(id: number) {
    const task = tasks.find((t) => t.id === id) ?? null
    setModalOpen(false)
    setEditing(null)
    if (task) setDeleteTarget(task)
  }

  async function confirmDelete() {
    const task = deleteTarget
    if (!task) return
    setDeleteTarget(null)
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    setSelectedIds((prev) => prev.filter((id) => id !== task.id))
    try {
      await deleteTask(task.id)
    } catch {
      showWarning("Could not delete task.")
    }
    router.refresh()
  }

  async function handleDuplicate(id: number) {
    const created = await duplicateTask(id)
    if (created) setTasks((prev) => [...prev, created as unknown as Task])
    setModalOpen(false)
    setEditing(null)
    router.refresh()
  }

  function handleDuplicateAt(id: number, date: string, startTime: string) {
    const source = tasks.find((t) => t.id === id)
    if (!source) return
    startTransition(async () => {
      try {
        const created = await duplicateTaskAt(id, date, startTime)
        if (created) setTasks((prev) => [...prev, created as unknown as Task])
      } catch {
        showWarning("Could not duplicate task.")
      }
      router.refresh()
    })
  }

  function requestDelete(task: Task) {
    setDeleteTarget(task)
  }

  // date navigation
  function shiftDays(n: number) {
    const d = new Date(anchor + "T00:00:00")
    d.setDate(d.getDate() + n)
    const next = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
    setAnchor(next)
    clearSelection()
    router.push(`/timeline?date=${next}&view=${view}`)
  }

  function changeView(v: "day" | "week") {
    setView(v)
    clearSelection()
    router.push(`/timeline?date=${anchor}&view=${v}`)
  }



  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="serif text-4xl text-foreground">Timeline</h1>
          <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
            {view === "day" ? anchor : `${weekStart} → ${weekEnd}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-surface overflow-hidden">
            <button
              onClick={() => changeView("day")}
              className={`px-3 py-1.5 text-xs font-medium ${view === "day" ? "bg-gold text-background" : "text-muted hover:text-foreground"}`}
            >
              Day
            </button>
            <button
              onClick={() => changeView("week")}
              className={`px-3 py-1.5 text-xs font-medium ${view === "week" ? "bg-gold text-background" : "text-muted hover:text-foreground"}`}
            >
              Week
            </button>
          </div>
          <button onClick={() => shiftDays(view === "day" ? -1 : -7)} className="rounded-md border border-border bg-surface p-2 text-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              const _td = new Date(); const t = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,"0")}-${String(_td.getDate()).padStart(2,"0")}`
              setAnchor(t)
              clearSelection()
              router.push(`/timeline?date=${t}&view=${view}`)
            }}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            Today
          </button>
          <button onClick={() => shiftDays(view === "day" ? 1 : 7)} className="rounded-md border border-border bg-surface p-2 text-muted hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => openCreate({ date: view === "day" ? anchor : undefined })}
            className="flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-soft"
          >
            <Plus className="h-3.5 w-3.5" /> New task
          </button>
        </div>
      </header>

      {warning && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{warning}</div>
      )}

      {selectedIds.length > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
            <span className="mono uppercase tracking-widest text-gold">
              {selectedIds.length} slots selected
            </span>
            <span className="text-muted">
              Drag any selected slot to move them together. Ctrl/Cmd-click adjusts, Shift-click selects a range.
            </span>
          </div>
          <button
            onClick={clearSelection}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <div className="min-w-0">
          {view === "day" ? (
            <DailyView
              date={anchor}
              tasks={tasks.filter((t) => t.scheduledDate === anchor)}
              workTypes={workTypes}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              onSelectRange={selectRange}
              onClearSelection={clearSelection}
              onMoveMany={handleMoveMany}
              onMove={handleMove}
              onScheduleDrop={handleSchedule}
              onCreateAt={(time) => openCreate({ date: anchor, time })}
              onSelect={openEdit}
              onDelete={requestDelete}
              onDuplicateAt={handleDuplicateAt}
              onToggleDone={handleToggleDone}
            />
          ) : (
            <WeeklyView
              weekStart={weekStart}
              tasks={tasks}
              workTypes={workTypes}
              selectedIds={selectedIds}
              onToggleSelection={toggleSelection}
              onSelectRange={selectRange}
              onClearSelection={clearSelection}
              onMoveMany={handleMoveMany}
              onMove={handleMove}
              onResize={handleResize}
              onSelect={openEdit}
              onCreateAt={(date, time) => openCreate({ date, time })}
              onDelete={requestDelete}
              onDuplicateAt={handleDuplicateAt}
              onToggleDone={handleToggleDone}
            />
          )}
        </div>
      </div>

      {modalOpen && (
        <TaskModal
          task={editing}
          workTypes={workTypes}
          clients={clients}
          projects={projects}
          defaults={defaults}
          onSave={handleSave}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onClose={() => {
            setModalOpen(false)
            setEditing(null)
          }}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-danger/40 bg-danger/10 p-1.5">
                <Trash2 className="h-4 w-4 text-danger" />
              </div>
              <div>
                <h2 className="serif text-xl text-foreground">Delete this slot?</h2>
                <p className="mt-1 text-sm text-muted">
                  &ldquo;{deleteTarget.title}&rdquo;
                  {deleteTarget.scheduledDate && (
                    <>
                      {" — "}
                      <span className="mono text-xs">
                        {deleteTarget.scheduledDate}
                        {deleteTarget.startTime ? ` ${deleteTarget.startTime}` : ""}
                        {deleteTarget.endTime ? `–${deleteTarget.endTime}` : ""}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">This cannot be undone.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function addMinStr(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

// avoid unused import
void CalendarDays
void CalendarRange