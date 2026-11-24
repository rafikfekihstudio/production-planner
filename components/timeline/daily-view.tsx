"use client"

import { useRef, useState, useEffect } from "react"
import { Check, X } from "lucide-react"
import type { Task, WorkType } from "./timeline-client"
import { TIMELINE as T } from "@/lib/timeline-constants"
import {
  clamp,
  formatDuration,
  minutesToTime,
  timeToMinutes,
  type MoveItem,
} from "@/lib/timeline-utils"

const { SLOT_MINUTES, SLOT_HEIGHT, DAY_START_MIN, DAY_END_MIN } = T
const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES

function minsToTop(min: number) {
  return ((min - DAY_START_MIN) / SLOT_MINUTES) * SLOT_HEIGHT
}
function minsToHeight(min: number) {
  return (min / SLOT_MINUTES) * SLOT_HEIGHT
}
function topToMin(top: number) {
  const slot = Math.round(top / SLOT_HEIGHT)
  return DAY_START_MIN + Math.max(0, Math.min(SLOTS, slot)) * SLOT_MINUTES
}
function snapMin(min: number) {
  const slot = Math.round((min - DAY_START_MIN) / SLOT_MINUTES)
  return DAY_START_MIN + Math.max(0, Math.min(SLOTS - 1, slot)) * SLOT_MINUTES
}

function layoutTasks(tasks: Task[]) {
  const sorted = [...tasks]
    .filter((t) => t.startTime)
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))

  type Entry = { task: Task; start: number; end: number; column: number }
  const placed: { task: Task; column: number; columns: number }[] = []
  let cluster: Entry[] = []
  let clusterEnd = -1

  function flush() {
    if (cluster.length === 0) return
    const columns = Math.max(...cluster.map((c) => c.column)) + 1
    for (const c of cluster) placed.push({ task: c.task, column: c.column, columns })
    cluster = []
    clusterEnd = -1
  }

  for (const t of sorted) {
    const [h, m] = t.startTime!.split(":").map(Number)
    const start = h * 60 + m
    const end = start + t.estimatedMinutes
    // a cluster is a run of tasks chained by overlap; starts at/after its end begin a new one
    if (cluster.length > 0 && start >= clusterEnd) flush()
    let column = 0
    while (cluster.some((c) => c.column === column && c.end > start)) column++
    cluster.push({ task: t, start, end, column })
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return { placed }
}

type DragState = {
  mode: "move" | "copy" | "group"
  id: number
  offsetY: number
  originalTop: number
  el: HTMLElement
  group?: Task[]
  deltaMin: number
}

export function DailyView({
  date,
  tasks,
  workTypes,
  selectedIds,
  onToggleSelection,
  onSelectRange,
  onClearSelection,
  onMoveMany,
  onMove,
  onScheduleDrop,
  onCreateAt,
  onSelect,
  onDelete,
  onDuplicateAt,
  onToggleDone,
}: {
  date: string
  tasks: Task[]
  workTypes: WorkType[]
  selectedIds: number[]
  onToggleSelection: (id: number) => void
  onSelectRange: (id: number, orderedIds: number[]) => void
  onClearSelection: () => void
  onMoveMany: (moves: MoveItem[]) => void
  onMove: (id: number, date: string, startTime: string) => void
  onScheduleDrop: (id: number, date: string, startTime: string) => void
  onCreateAt: (time: string) => void
  onSelect: (t: Task) => void
  onDelete: (t: Task) => void
  onDuplicateAt: (id: number, date: string, startTime: string) => void
  onToggleDone: (t: Task) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragTopRef = useRef<number>(0)
  const justDragged = useRef(false)
  const onMoveRef = useRef(onMove)
  const onDuplicateAtRef = useRef(onDuplicateAt)
  const onMoveManyRef = useRef(onMoveMany)
  useEffect(() => { onMoveRef.current = onMove }, [onMove])
  useEffect(() => { onDuplicateAtRef.current = onDuplicateAt }, [onDuplicateAt])
  useEffect(() => { onMoveManyRef.current = onMoveMany }, [onMoveMany])

  const [dragOver, setDragOver] = useState(false)
  const [nowMin, setNowMin] = useState<number | null>(null)
  const [groupDragTime, setGroupDragTime] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])

  const { placed } = layoutTasks(tasks)
  const totalHeight = SLOTS * SLOT_HEIGHT
  const selectedSet = new Set(selectedIds)
  const orderedIds = [...tasks]
    .filter((task) => task.startTime)
    .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
    .map((task) => task.id)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function getTaskBlock(target: EventTarget | null): HTMLElement | null {
      let el = target as HTMLElement | null
      while (el && el !== container) {
        if (el.dataset && el.dataset.resizeId) return el
        el = el.parentElement
      }
      return null
    }

    function blockFor(id: number): HTMLElement | null {
      return containerRef.current?.querySelector(`[data-resize-id="${id}"]`) as HTMLElement | null
    }

    function onMouseDown(e: MouseEvent) {
      const src = e.target as HTMLElement | null
      if (src && src.closest && src.closest("[data-no-drag]")) return
      const block = getTaskBlock(e.target)
      if (!block) return
      const taskId = Number(block.dataset.resizeId)
      const task = tasks.find((t) => t.id === taskId)
      if (!task || !task.startTime) return
      const [h, m] = task.startTime.split(":").map(Number)
      const startMin = h * 60 + m
      const top = minsToTop(startMin)
      const rect = block.getBoundingClientRect()
      const isGroup = selectedIds.length > 1 && selectedIds.includes(task.id)
      const group = isGroup ? tasks.filter((t) => selectedIds.includes(t.id) && t.startTime) : undefined
      dragRef.current = {
        mode: isGroup ? "group" : e.altKey ? "copy" : "move",
        id: task.id,
        offsetY: e.clientY - rect.top,
        originalTop: top,
        el: block,
        group,
        deltaMin: 0,
      }
      dragTopRef.current = top
      block.style.opacity = isGroup ? "0.85" : e.altKey ? "0.5" : "0.85"
      if (e.altKey && !isGroup) block.style.outline = "2px dashed #c9a961"
      if (isGroup) {
        group?.forEach((item) => {
          const el = blockFor(item.id)
          if (el) el.style.zIndex = "25"
        })
      }
      justDragged.current = false
      e.preventDefault()
    }

    function onMouseMove(e: MouseEvent) {
      const st = dragRef.current
      if (!st) return
      const rect = container!.getBoundingClientRect()
      const y = e.clientY - rect.top - st.offsetY
      const clamped = Math.max(0, Math.min(totalHeight - SLOT_HEIGHT, y))
      dragTopRef.current = clamped

      if (st.mode === "group" && st.group) {
        const original = tasks.find((t) => t.id === st.id)
        if (!original?.startTime) return
        const originalStart = timeToMinutes(original.startTime)
        const rawDelta = snapMin(topToMin(clamped)) - originalStart
        const starts = st.group.map((t) => timeToMinutes(t.startTime!))
        const ends = st.group.map((t) => timeToMinutes(t.startTime!) + t.estimatedMinutes)
        const minDelta = Math.ceil((DAY_START_MIN - Math.min(...starts)) / SLOT_MINUTES) * SLOT_MINUTES
        const maxDelta = Math.floor((DAY_END_MIN - Math.max(...ends)) / SLOT_MINUTES) * SLOT_MINUTES
        const delta = clamp(rawDelta, minDelta, maxDelta)
        st.deltaMin = delta
        const dy = (delta / SLOT_MINUTES) * SLOT_HEIGHT
        st.group.forEach((item) => {
          const el = blockFor(item.id)
          if (el) el.style.transform = `translateY(${dy}px)`
        })
        setGroupDragTime(minutesToTime(originalStart + delta))
        return
      }

      st.el.style.transform = `translateY(${clamped - st.originalTop}px)`
    }

    function onMouseUp() {
      const st = dragRef.current
      if (!st) return

      if (st.mode === "group" && st.group) {
        const moves: MoveItem[] = st.group.map((item) => ({
          id: item.id,
          date,
          time: minutesToTime(timeToMinutes(item.startTime!) + st.deltaMin),
        }))
        const changed = moves.some((move) => {
          const item = st.group!.find((t) => t.id === move.id)
          return item?.startTime !== move.time
        })
        if (changed) {
          onMoveManyRef.current(moves)
          justDragged.current = true
        }
        st.group.forEach((item) => {
          const el = blockFor(item.id)
          if (el) {
            el.style.transform = ""
            el.style.opacity = ""
            el.style.zIndex = ""
          }
        })
        setGroupDragTime(null)
        dragRef.current = null
        return
      }

      const min = snapMin(topToMin(dragTopRef.current))
      const newTime = minutesToTime(min)
      const original = tasks.find((t) => t.id === st.id)
      if (!original || newTime !== original.startTime) {
        if (st.mode === "copy") onDuplicateAtRef.current(st.id, date, newTime)
        else onMoveRef.current(st.id, date, newTime)
        justDragged.current = true
      }
      st.el.style.transform = ""
      st.el.style.opacity = ""
      st.el.style.outline = ""
      dragRef.current = null
    }

    container.addEventListener("mousedown", onMouseDown, true)
    window.addEventListener("mousemove", onMouseMove, true)
    window.addEventListener("mouseup", onMouseUp, true)

    return () => {
      container.removeEventListener("mousedown", onMouseDown, true)
      window.removeEventListener("mousemove", onMouseMove, true)
      window.removeEventListener("mouseup", onMouseUp, true)
    }
  }, [tasks, date, selectedIds, totalHeight])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const idStr = e.dataTransfer.getData("text/task-id")
    if (!idStr) return
    const id = Number(idStr)
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const y = e.clientY - rect.top
    const min = snapMin(topToMin(y))
    const hh = String(Math.floor(min / 60)).padStart(2, "0")
    const mm = String(min % 60).padStart(2, "0")
    onScheduleDrop(id, date, `${hh}:${mm}`)
  }

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const isToday = date === todayStr
  const nowTop =
    nowMin !== null && isToday && nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN ? minsToTop(nowMin) : null

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex">
        <div className="w-14 shrink-0 border-r border-border bg-surface-2 relative" style={{ height: totalHeight }}>
          {Array.from({ length: SLOTS + 1 }).map((_, i) => {
            const min = DAY_START_MIN + i * SLOT_MINUTES
            const isHour = min % 60 === 0
            return (
              <div
                key={i}
                className="absolute left-0 right-0 text-right pr-2"
                style={{ top: i * SLOT_HEIGHT - 6, height: SLOT_HEIGHT }}
              >
                {isHour && (
                  <span className="mono text-[10px] text-muted">
                    {String(Math.floor(min / 60)).padStart(2, "0")}:00
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <div
          ref={containerRef}
          className={`relative flex-1 ${dragOver ? "bg-gold/5" : ""}`}
          style={{ height: totalHeight, touchAction: "none", userSelect: "none" }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.dataset.timeline !== "bg") return
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const y = e.clientY - rect.top
            const min = snapMin(topToMin(y))
            const hh = String(Math.floor(min / 60)).padStart(2, "0")
            const mm = String(min % 60).padStart(2, "0")
            onCreateAt(`${hh}:${mm}`)
          }}
        >
          {Array.from({ length: SLOTS + 1 }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
              style={{ top: i * SLOT_HEIGHT }}
            />
          ))}
          {Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }).map((_, i) => {
            const min = DAY_START_MIN + i * 60
            const top = minsToTop(min)
            return (
              <div
                key={`h-${i}`}
                className="absolute left-0 right-0 border-t border-border pointer-events-none"
                style={{ top }}
              />
            )
          })}
          <div data-timeline="bg" className="absolute inset-0" />

          {nowTop !== null && (
            <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
              <div className="relative border-t border-danger/70">
                <span className="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 rounded-full bg-danger" />
              </div>
            </div>
          )}

          {placed.map(({ task, column, columns }) => {
            const wt = workTypes.find((w) => w.id === task.workTypeId)
            const done = task.status === "completed"
            const [h, m] = (task.startTime || "09:00").split(":").map(Number)
            const startMin = h * 60 + m
            const top = minsToTop(startMin)
            const height = minsToHeight(task.estimatedMinutes)
            const widthPct = 100 / columns
            const leftPct = column * widthPct
            const accent = done ? "var(--teal)" : wt?.color || "#c9a961"
            const doneTitle = done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`
            return (
              <div
                key={task.id}
                data-resize-id={task.id}
                data-done={done ? "true" : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  if (justDragged.current) { justDragged.current = false; return }
                  if (e.ctrlKey || e.metaKey) { onToggleSelection(task.id); return }
                  if (e.shiftKey) { onSelectRange(task.id, orderedIds); return }
                  if (selectedIds.length > 0) onClearSelection()
                  onSelect(task)
                }}
                className={`absolute rounded-md border overflow-hidden cursor-grab active:cursor-grabbing select-none group ${
                  done ? "border-teal/60 bg-teal/20" : "border-border/60"
                } ${selectedSet.has(task.id) ? "z-10 ring-2 ring-gold" : ""}`}
                style={{
                  top,
                  height,
                  left: `calc(${leftPct}% + 4px)`,
                  width: `calc(${widthPct}% - 8px)`,
                  backgroundColor: done ? undefined : (wt?.color || "#c9a961") + "22",
                  borderLeft: `3px solid ${accent}`,
                  touchAction: "none",
                  userSelect: "none",
                }}
              >
                <div className="px-2 py-1 text-xs pointer-events-none">
                  <div className={`font-medium truncate pl-5 pr-4 ${done ? "text-teal line-through" : "text-foreground"}`}>{task.title}</div>
                  <div className={`mono text-[10px] truncate ${done ? "text-teal/70" : "text-muted"}`}>
                    {task.startTime}–{task.endTime} · {formatDuration(task.estimatedMinutes)}
                  </div>
                </div>
                <button
                  data-no-drag
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleDone(task)
                  }}
                  className={`absolute left-1 top-1 z-10 rounded-full border p-0.5 transition-colors ${
                    done
                      ? "border-teal bg-teal text-background"
                      : "border-border bg-surface/80 text-muted hover:border-teal hover:text-teal group-hover:opacity-100"
                  }`}
                  title={doneTitle}
                  aria-label={doneTitle}
                  aria-pressed={done}
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  data-no-drag
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(task)
                  }}
                  className="absolute right-1 top-1 z-10 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-danger/15 hover:text-danger transition-opacity"
                  title={`Delete ${task.title}`}
                  aria-label={`Delete ${task.title}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>
      </div>
      {groupDragTime && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-md border border-border bg-surface px-3 py-1.5 mono text-xs text-foreground shadow-lg">
          Move {selectedIds.length} slots → {date} at {groupDragTime}
        </div>
      )}
    </div>
  )
}