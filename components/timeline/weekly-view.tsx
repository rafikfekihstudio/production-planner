"use client"

import { useRef, useState, useEffect } from "react"
import { Check, X } from "lucide-react"
import { TIMELINE as T } from "@/lib/timeline-constants"
import type { Task, WorkType } from "./timeline-client"
import {
  addDays,
  clamp,
  dayIndex,
  formatDuration,
  minutesToTime,
  timeToMinutes,
  type MoveItem,
} from "@/lib/timeline-utils"

const { SLOT_MINUTES, SLOT_HEIGHT, DAY_START_MIN, DAY_END_MIN } = T
const SLOTS = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES
const HEADER_H = 32

function minsToTop(min: number) {
  return ((min - DAY_START_MIN) / SLOT_MINUTES) * SLOT_HEIGHT
}
function minsToHeight(min: number) {
  return (min / SLOT_MINUTES) * SLOT_HEIGHT
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function weekDays(start: string) {
  const out: string[] = []
  const d = new Date(start + "T00:00:00")
  for (let i = 0; i < 7; i++) {
    const x = new Date(d)
    x.setDate(d.getDate() + i)
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`)
  }
  return out
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
  mode: "move" | "resize" | "copy" | "group"
  task: Task
  el: HTMLElement
  startDayIdx: number
  startTimeMin: number
  origTop: number
  offsetY: number
  colWidth: number
  containerTop: number
  targetDay: string
  targetTime: string
  startClientY: number
  origHeight: number
  targetMinutes: number
  group?: Task[]
  deltaDays?: number
  deltaMin?: number
}

export function WeeklyView({
  weekStart,
  tasks,
  workTypes,
  selectedIds,
  onToggleSelection,
  onSelectRange,
  onClearSelection,
  onMoveMany,
  onMove,
  onResize,
  onSelect,
  onCreateAt,
  onDelete,
  onDuplicateAt,
  onToggleDone,
}: {
  weekStart: string
  tasks: Task[]
  workTypes: WorkType[]
  selectedIds: number[]
  onToggleSelection: (id: number) => void
  onSelectRange: (id: number, orderedIds: number[]) => void
  onClearSelection: () => void
  onMoveMany: (moves: MoveItem[]) => void
  onMove: (id: number, date: string, startTime: string) => void
  onResize: (id: number, minutes: number) => void
  onSelect: (t: Task) => void
  onCreateAt: (date: string, time: string) => void
  onDelete: (t: Task) => void
  onDuplicateAt: (id: number, date: string, startTime: string) => void
  onToggleDone: (t: Task) => void
}) {
  const days = weekDays(weekStart)
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  })()
  const totalHeight = SLOTS * SLOT_HEIGHT
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const onMoveRef = useRef(onMove)
  const onResizeRef = useRef(onResize)
  const onDuplicateAtRef = useRef(onDuplicateAt)
  const onMoveManyRef = useRef(onMoveMany)
  const tasksRef = useRef(tasks)
  const daysRef = useRef(days)
  const selectedIdsRef = useRef(selectedIds)
  useEffect(() => { onMoveRef.current = onMove }, [onMove])
  useEffect(() => { onResizeRef.current = onResize }, [onResize])
  useEffect(() => { onDuplicateAtRef.current = onDuplicateAt }, [onDuplicateAt])
  useEffect(() => { onMoveManyRef.current = onMoveMany }, [onMoveMany])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => { daysRef.current = days }, [days])
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  const justDragged = useRef(false)

  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const [dragTime, setDragTime] = useState<string | null>(null)
  const [dragTitle, setDragTitle] = useState<string | null>(null)
  const [resizeInfo, setResizeInfo] = useState<{ title: string; minutes: number } | null>(null)
  const [nowMin, setNowMin] = useState<number | null>(null)
  const selectedSet = new Set(selectedIds)
  const orderedIds = [...tasks]
    .filter((task) => task.startTime && task.scheduledDate && days.includes(task.scheduledDate))
    .sort((a, b) => `${a.scheduledDate} ${a.startTime}`.localeCompare(`${b.scheduledDate} ${b.startTime}`))
    .map((task) => task.id)

  // live current-time marker (client only, so no hydration mismatch)
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }
    tick()
    const id = window.setInterval(tick, 60_000)
    return () => window.clearInterval(id)
  }, [])

  // when the week view opens, center today's column and bring the current hour into view
  const centeredFor = useRef<string | null>(null)
  useEffect(() => {
    const scroller = scrollRef.current
    const container = containerRef.current
    if (!scroller || !container) return
    if (centeredFor.current === weekStart) return
    const todayIdx = daysRef.current.indexOf(today)
    if (todayIdx < 0) return
    centeredFor.current = weekStart
    const colWidth = container.getBoundingClientRect().width / 7
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    const left = todayIdx * colWidth + colWidth / 2 - scroller.clientWidth / 2
    scroller.scrollLeft = Math.max(0, Math.min(left, maxLeft))
    const d = new Date()
    const min = d.getHours() * 60 + d.getMinutes()
    if (min >= DAY_START_MIN && min <= DAY_END_MIN) {
      const box = scroller.getBoundingClientRect()
      const target = box.top + HEADER_H + minsToTop(min) - window.innerHeight * 0.45
      window.scrollTo({ top: Math.max(0, target), behavior: "auto" })
    }
  }, [weekStart, today])

  useEffect(() => {
    function getTaskBlock(target: EventTarget | null): HTMLElement | null {
      let el = target as HTMLElement | null
      while (el) {
        if (el.dataset && el.dataset.resizeId) return el
        el = el.parentElement
      }
      return null
    }

    function getResizeHandle(target: EventTarget | null): HTMLElement | null {
      let el = target as HTMLElement | null
      while (el) {
        if (el.dataset && el.dataset.resizeHandle) return el
        el = el.parentElement
      }
      return null
    }

    function blockFor(id: number): HTMLElement | null {
      return document.querySelector(`[data-resize-id="${id}"]`) as HTMLElement | null
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      const src = e.target as HTMLElement | null
      // ignore the delete button (and anything else opted out of dragging)
      if (src && src.closest && src.closest("[data-no-drag]")) return

      // --- resize: grabbed the block's bottom edge ---
      const handle = getResizeHandle(e.target)
      if (handle) {
        const block = handle.closest("[data-resize-id]") as HTMLElement | null
        if (!block) return
        const taskId = Number(block.dataset.resizeId)
        const task = tasksRef.current.find((t) => t.id === taskId)
        if (!task) return
        const [h, m] = (task.startTime || "09:00").split(":").map(Number)
        dragRef.current = {
          mode: "resize",
          task,
          el: block,
          startDayIdx: 0,
          startTimeMin: h * 60 + m,
          origTop: 0,
          offsetY: 0,
          colWidth: 1,
          containerTop: 0,
          targetDay: task.scheduledDate || "",
          targetTime: task.startTime || "09:00",
          startClientY: e.clientY,
          origHeight: block.getBoundingClientRect().height,
          targetMinutes: task.estimatedMinutes,
        }
        block.style.zIndex = "30"
        block.style.opacity = "0.9"
        justDragged.current = false
        setResizeInfo({ title: task.title, minutes: task.estimatedMinutes })
        e.preventDefault()
        return
      }

      // --- move (or move a multi-selection) ---
      const block = getTaskBlock(e.target)
      if (!block) return
      const container = containerRef.current
      if (!container) return
      const taskId = Number(block.dataset.resizeId)
      const task = tasksRef.current.find((t) => t.id === taskId)
      if (!task || !task.startTime) return

      const [h, m] = task.startTime.split(":").map(Number)
      const startMin = h * 60 + m
      const origTop = minsToTop(startMin)
      const rect = container.getBoundingClientRect()
      const colWidth = rect.width / 7
      const dayIdx = daysRef.current.indexOf(task.scheduledDate || daysRef.current[0])
      const actualDayIdx = dayIdx >= 0 ? dayIdx : 0
      const group =
        selectedIdsRef.current.length > 1 && selectedIdsRef.current.includes(task.id)
          ? tasksRef.current.filter(
              (item) =>
                selectedIdsRef.current.includes(item.id) &&
                item.startTime &&
                item.scheduledDate &&
                daysRef.current.includes(item.scheduledDate),
            )
          : undefined

      dragRef.current = {
        mode: group ? "group" : e.altKey ? "copy" : "move",
        task,
        el: block,
        startDayIdx: actualDayIdx,
        startTimeMin: startMin,
        origTop,
        offsetY: e.clientY - (rect.top + HEADER_H + origTop),
        colWidth,
        containerTop: rect.top + HEADER_H,
        targetDay: task.scheduledDate || daysRef.current[actualDayIdx],
        targetTime: task.startTime,
        startClientY: e.clientY,
        origHeight: block.getBoundingClientRect().height,
        targetMinutes: task.estimatedMinutes,
        group,
        deltaDays: 0,
        deltaMin: 0,
      }
      block.style.opacity = group ? "0.85" : e.altKey ? "0.5" : "0.6"
      if (e.altKey && !group) block.style.outline = "2px dashed #c9a961"
      if (group) {
        group.forEach((item) => {
          const el = blockFor(item.id)
          if (el) el.style.zIndex = "30"
        })
      }
      justDragged.current = false
      e.preventDefault()
    }

    function onPointerMove(e: PointerEvent) {
      const st = dragRef.current
      if (!st) return
      const container = containerRef.current
      if (!container) return

      if (st.mode === "resize") {
        const delta = e.clientY - st.startClientY
        const raw = st.origHeight + delta
        const maxSlots = Math.max(1, Math.floor((DAY_END_MIN - st.startTimeMin) / SLOT_MINUTES))
        const slots = Math.max(1, Math.min(maxSlots, Math.round(raw / SLOT_HEIGHT)))
        st.el.style.height = `${slots * SLOT_HEIGHT}px`
        st.targetMinutes = slots * SLOT_MINUTES
        setResizeInfo({ title: st.task.title, minutes: slots * SLOT_MINUTES })
        return
      }

      if (st.mode === "group" && st.group) {
        const rect = container.getBoundingClientRect()
        const x = e.clientX - rect.left
        const clampedIdx = Math.max(0, Math.min(6, Math.floor(x / st.colWidth)))
        const y = e.clientY - st.containerTop - st.offsetY
        const newTop = Math.max(0, Math.min(totalHeight - SLOT_HEIGHT, y))
        const slotIdx = Math.round(newTop / SLOT_HEIGHT)
        const newMin = DAY_START_MIN + Math.max(0, Math.min(SLOTS - 1, slotIdx)) * SLOT_MINUTES

        const rawDayDelta = clampedIdx - st.startDayIdx
        const rawMinDelta = Math.round((newMin - st.startTimeMin) / SLOT_MINUTES) * SLOT_MINUTES
        const dayIdxs = st.group.map((item) => dayIndex(item.scheduledDate || daysRef.current[0], daysRef.current))
        const minDayDelta = -Math.min(...dayIdxs)
        const maxDayDelta = 6 - Math.max(...dayIdxs)
        const minTimeDelta = Math.max(
          ...st.group.map(
            (item) =>
              Math.ceil((DAY_START_MIN - timeToMinutes(item.startTime!)) / SLOT_MINUTES) * SLOT_MINUTES,
          ),
        )
        const maxTimeDelta = Math.min(
          ...st.group.map(
            (item) =>
              Math.floor(
                (DAY_END_MIN - (timeToMinutes(item.startTime!) + item.estimatedMinutes)) / SLOT_MINUTES,
              ) * SLOT_MINUTES,
          ),
        )
        const deltaDays = clamp(rawDayDelta, minDayDelta, maxDayDelta)
        const deltaMin = clamp(rawMinDelta, minTimeDelta, maxTimeDelta)
        st.deltaDays = deltaDays
        st.deltaMin = deltaMin

        const dx = deltaDays * st.colWidth
        const dy = (deltaMin / SLOT_MINUTES) * SLOT_HEIGHT
        st.group.forEach((item) => {
          const el = blockFor(item.id)
          if (el) {
            el.style.transform = `translate(${dx}px, ${dy}px)`
            el.style.zIndex = "30"
            el.style.opacity = "0.85"
          }
        })

        const targetDay = daysRef.current[st.startDayIdx + deltaDays]
        const targetTime = minutesToTime(st.startTimeMin + deltaMin)
        st.targetDay = targetDay
        st.targetTime = targetTime
        setDragOverDay(targetDay)
        setDragTime(targetTime)
        setDragTitle(`Move ${st.group.length} slots`)
        return
      }

      const rect = container.getBoundingClientRect()

      const x = e.clientX - rect.left
      const idx = Math.floor(x / st.colWidth)
      const clampedIdx = Math.max(0, Math.min(6, idx))
      const targetDay = daysRef.current[clampedIdx]

      const y = e.clientY - st.containerTop - st.offsetY
      const newTop = Math.max(0, Math.min(totalHeight - SLOT_HEIGHT, y))
      const slotIdx = Math.round(newTop / SLOT_HEIGHT)
      const newMin = DAY_START_MIN + Math.max(0, Math.min(SLOTS - 1, slotIdx)) * SLOT_MINUTES
      const hh = String(Math.floor(newMin / 60)).padStart(2, "0")
      const mm = String(newMin % 60).padStart(2, "0")
      const newTime = `${hh}:${mm}`

      const dx = (clampedIdx - st.startDayIdx) * st.colWidth
      const dy = newTop - st.origTop
      st.el.style.transform = `translate(${dx}px, ${dy}px)`
      st.el.style.zIndex = "30"
      st.el.style.opacity = st.mode === "copy" ? "0.5" : "0.6"
      st.targetDay = targetDay
      st.targetTime = newTime
      setDragOverDay(targetDay)
      setDragTime(newTime)
      setDragTitle(`${st.mode === "copy" ? "Copy · " : ""}${st.task.title}`)
    }

    function onPointerUp() {
      const st = dragRef.current
      if (st && st.mode === "resize") {
        if (st.targetMinutes !== st.task.estimatedMinutes) {
          onResizeRef.current(st.task.id, st.targetMinutes)
          justDragged.current = true
        }
        st.el.style.height = ""
        st.el.style.zIndex = ""
        st.el.style.opacity = ""
        st.el.style.outline = ""
        dragRef.current = null
        setResizeInfo(null)
        return
      }
      if (st && st.mode === "group" && st.group) {
        const group = st.group
        const deltaDays = st.deltaDays ?? 0
        const deltaMin = st.deltaMin ?? 0
        const moves: MoveItem[] = group.map((item) => ({
          id: item.id,
          date: addDays(item.scheduledDate || daysRef.current[0], deltaDays),
          time: minutesToTime(timeToMinutes(item.startTime!) + deltaMin),
        }))
        const changed = moves.some((move) => {
          const item = group.find((t) => t.id === move.id)
          return item?.scheduledDate !== move.date || item?.startTime !== move.time
        })
        if (changed) {
          onMoveManyRef.current(moves)
          justDragged.current = true
        }
        group.forEach((item) => {
          const el = blockFor(item.id)
          if (el) {
            el.style.transform = ""
            el.style.zIndex = ""
            el.style.opacity = ""
            el.style.outline = ""
          }
        })
        dragRef.current = null
        setDragOverDay(null)
        setDragTime(null)
        setDragTitle(null)
        setResizeInfo(null)
        return
      }
      if (st) {
        const moved =
          !!st.targetDay &&
          !!st.targetTime &&
          (st.targetDay !== st.task.scheduledDate || st.targetTime !== st.task.startTime)
        if (moved) {
          if (st.mode === "copy") {
            onDuplicateAtRef.current(st.task.id, st.targetDay, st.targetTime)
          } else {
            onMoveRef.current(st.task.id, st.targetDay, st.targetTime)
          }
          justDragged.current = true
        }
        st.el.style.transform = ""
        st.el.style.zIndex = ""
        st.el.style.opacity = ""
        st.el.style.outline = ""
      }
      dragRef.current = null
      setDragOverDay(null)
      setDragTime(null)
      setDragTitle(null)
      setResizeInfo(null)
    }

    // pointerdown on the grid; move/up on document so dragging past the grid edge keeps working
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointermove", onPointerMove, true)
    document.addEventListener("pointerup", onPointerUp, true)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointermove", onPointerMove, true)
      document.removeEventListener("pointerup", onPointerUp, true)
    }
  }, [totalHeight])

  return (
    <div ref={scrollRef} className="rounded-lg border border-border bg-surface overflow-x-auto">
      <div className="flex min-w-[880px]" ref={containerRef}>
        <div className="w-12 shrink-0 border-r border-border bg-surface-2 relative" style={{ height: totalHeight + HEADER_H }}>
          <div className="h-8" />
          {Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }).map((_, i) => {
            const min = DAY_START_MIN + i * 60
            const top = minsToTop(min) + HEADER_H
            return (
              <div key={i} className="absolute right-2 mono text-[9px] text-muted" style={{ top: top - 6 }}>
                {String(Math.floor(min / 60)).padStart(2, "0")}:00
              </div>
            )
          })}
        </div>
        {days.map((day, di) => {
          const dayTasks = tasks.filter((t) => t.scheduledDate === day)
          const totalMin = dayTasks.reduce((s, t) => s + t.estimatedMinutes, 0)
          const { placed } = layoutTasks(dayTasks)
          const isOver = dragOverDay === day
          return (
            <div
              key={day}
              className={`flex-1 min-w-[90px] border-r border-border last:border-r-0 ${isOver ? "bg-gold/10" : ""}`}
            >
              <div className={`h-8 flex items-center justify-center border-b border-border ${day === today ? "bg-gold/10" : "bg-surface-2"}`}>
                <div className="text-center">
                  <div className="mono text-[10px] text-muted">{DAY_LABELS[di]}</div>
                  <div className="mono text-[9px] text-muted/70">{day.slice(5)}</div>
                </div>
              </div>
              <div
                className="relative"
                style={{ height: totalHeight, touchAction: "none", userSelect: "none" }}
                onClick={(e) => {
                  // only empty clicks create; blocks stop propagation, drags never target "bg"
                  const target = e.target as HTMLElement
                  if (target.dataset.timeline !== "bg") return
                  if (justDragged.current) { justDragged.current = false; return }
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const y = e.clientY - rect.top
                  const slot = Math.round(y / SLOT_HEIGHT)
                  const min = DAY_START_MIN + Math.max(0, Math.min(SLOTS - 1, slot)) * SLOT_MINUTES
                  const hh = String(Math.floor(min / 60)).padStart(2, "0")
                  const mm = String(min % 60).padStart(2, "0")
                  onCreateAt(day, `${hh}:${mm}`)
                }}
              >
                {Array.from({ length: (DAY_END_MIN - DAY_START_MIN) / 60 + 1 }).map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                    style={{ top: minsToTop(DAY_START_MIN + i * 60) }}
                  />
                ))}

                {/* background layer FIRST so task blocks sit above it and receive the pointerdown */}
                <div data-timeline="bg" className="absolute inset-0 cursor-pointer" />

                {day === today && nowMin !== null && nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: minsToTop(nowMin) }}
                  >
                    <div className="relative border-t border-danger/70">
                      <span className="absolute -left-0.5 -top-[3px] h-1.5 w-1.5 rounded-full bg-danger" />
                    </div>
                  </div>
                )}

                {placed.map(({ task: t, column, columns }) => {
                  if (!t.startTime) return null
                  const [h, m] = t.startTime.split(":").map(Number)
                  const startMin = h * 60 + m
                  const top = minsToTop(startMin)
                  const height = minsToHeight(t.estimatedMinutes)
                  const wt = workTypes.find((w) => w.id === t.workTypeId)
                  const widthPct = 100 / columns
                  const leftPct = column * widthPct
                  const done = t.status === "completed"
                  const accent = done ? "var(--teal)" : wt?.color || "#c9a961"
                  const doneTitle = done ? `Mark ${t.title} as not done` : `Mark ${t.title} as done`
                  return (
                    <div
                      key={t.id}
                      data-resize-id={t.id}
                      data-done={done ? "true" : undefined}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (justDragged.current) { justDragged.current = false; return }
                        if (e.ctrlKey || e.metaKey) { onToggleSelection(t.id); return }
                        if (e.shiftKey) { onSelectRange(t.id, orderedIds); return }
                        if (selectedIds.length > 0) onClearSelection()
                        onSelect(t)
                      }}
                      className={`group absolute rounded border px-1 py-0.5 cursor-grab active:cursor-grabbing overflow-hidden text-[10px] select-none ${
                        done ? "border-teal/60 bg-teal/20" : "border-border/60"
                      } ${selectedSet.has(t.id) ? "z-10 ring-2 ring-gold" : ""}`}
                      style={{
                        top,
                        height: Math.max(16, height),
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        backgroundColor: done ? undefined : (wt?.color || "#c9a961") + "22",
                        borderLeft: `2px solid ${accent}`,
                        touchAction: "none",
                        userSelect: "none",
                      }}
                      title={`${t.title} ${t.startTime}–${t.endTime} · ${formatDuration(t.estimatedMinutes)} · drag to move · Alt+drag to copy · drag the bottom edge to resize`}
                    >
                      <button
                        data-no-drag
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleDone(t)
                        }}
                        className={`absolute left-0.5 top-0.5 z-10 rounded-full border p-px transition-colors ${
                          done
                            ? "border-teal bg-teal text-background"
                            : "border-border bg-surface/80 text-muted hover:border-teal hover:text-teal"
                        }`}
                        title={doneTitle}
                        aria-label={doneTitle}
                        aria-pressed={done}
                      >
                        <Check className="h-2.5 w-2.5" />
                      </button>
                      <button
                        data-no-drag
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(t)
                        }}
                        className="absolute right-0.5 top-0.5 z-10 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-danger/15 hover:text-danger transition-opacity"
                        title={`Delete ${t.title}`}
                        aria-label={`Delete ${t.title}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className={`font-medium truncate pointer-events-none pl-3.5 pr-3 ${done ? "text-teal line-through" : "text-foreground"}`}>
                        {t.title}
                      </div>
                      <div className={`mono truncate pointer-events-none pl-3.5 ${done ? "text-teal/70" : "text-muted"}`}>
                        {t.startTime}
                        {height >= 42 ? `–${t.endTime}` : ""} · {formatDuration(t.estimatedMinutes)}
                      </div>
                      <div
                        data-resize-handle={t.id}
                        className="absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize flex items-end justify-center"
                        title="Drag to resize"
                      >
                        <div className="h-[3px] w-8 mb-[1px] rounded-full bg-foreground/25 opacity-60 group-hover:opacity-100 group-hover:bg-foreground/60 transition-all" />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="h-6 flex items-center justify-center border-t border-border bg-surface-2">
                <span className="mono text-[9px] text-muted">{(totalMin / 60).toFixed(1)}h</span>
              </div>
            </div>
          )
        })}
      </div>
      {dragTime && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-1.5 mono text-xs text-foreground shadow-lg z-50">
          {dragTitle} → {dragOverDay} at {dragTime}
        </div>
      )}
      {resizeInfo && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-1.5 mono text-xs text-foreground shadow-lg z-50">
          {resizeInfo.title} → {formatDuration(resizeInfo.minutes)}
        </div>
      )}
    </div>
  )
}
