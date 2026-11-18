"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock } from "lucide-react"
import { createBooking } from "@/lib/actions/booking"
import { HOURS, hourLabel, type DayView } from "@/lib/booking"
import { prettyDate } from "@/lib/assistant/time"

type Selected = { date: string; hour: number }
type Result = Selected & { ok: boolean; status?: "confirmed" | "pending"; error?: string }
type CellState = "open" | "busy" | "taken" | "free"
type DragState = {
  startKey: string
  pointerId: number
  moved: boolean
  lastKey: string
  startX: number
  startY: number
}
type SelectionGroup = { key: string; date: string; start: number; end: number; hours: number[] }

const CELL_STYLE: Record<CellState, string> = {
  open: "bg-teal/90 text-background hover:bg-teal",
  busy: "bg-gold/20 text-gold hover:bg-gold/35",
  taken: "bg-danger/25 text-danger hover:bg-danger/40",
  free: "bg-surface-2 text-muted ring-1 ring-border/60 hover:text-foreground",
}

const CELL_LABEL: Record<CellState, string> = {
  open: "Open",
  busy: "Busy",
  taken: "Taken",
  free: "Free",
}

// A solid fill is visible even on the edge columns, where an outline gets
// clipped by the sticky day column and the scroll container.
const PICKED_STYLE = "bg-foreground text-background hover:bg-foreground"

const LEGEND_STYLE: Record<CellState, string> = {
  open: "bg-teal/90",
  busy: "bg-gold/30",
  taken: "bg-danger/30",
  free: "bg-surface-2 ring-1 ring-border",
}

function cellState(view: DayView, hour: number): CellState {
  if (view.openHour === hour && !view.full) return "open"
  if (view.bookedHours.includes(hour)) return "taken"
  if (view.busyHours.includes(hour)) return "busy"
  return "free"
}

function slotKey(slot: { date: string; hour: number }) {
  return `${slot.date}:${slot.hour}`
}

// Collapse selected hours into contiguous run chips so the bar stays one line.
function groupSelection(selected: Selected[]): SelectionGroup[] {
  const buckets = new Map<string, { date: string; hours: number[] }>()
  for (const s of selected) {
    let bucket = buckets.get(s.date)
    if (!bucket) {
      bucket = { date: s.date, hours: [] }
      buckets.set(s.date, bucket)
    }
    bucket.hours.push(s.hour)
  }

  const groups: SelectionGroup[] = []
  for (const bucket of buckets.values()) {
    const hours = bucket.hours.sort((a, b) => a - b)
    let run = [hours[0]]
    const flush = () => {
      const start = run[0]
      const end = run[run.length - 1]
      groups.push({
        key: `${bucket.date}:${start}`,
        date: bucket.date,
        start,
        end,
        hours: [...run],
      })
    }
    for (let i = 1; i < hours.length; i++) {
      if (hours[i] === hours[i - 1] + 1) run.push(hours[i])
      else {
        flush()
        run = [hours[i]]
      }
    }
    flush()
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
}

type SlotCellProps = {
  date: string
  hour: number
  state: CellState
  picked: boolean
  onDown: (date: string, hour: number, e: React.PointerEvent<HTMLElement>) => void
  onKey: (date: string, hour: number) => void
}

const SlotCell = memo(function SlotCell({ date, hour, state, picked, onDown, onKey }: SlotCellProps) {
  const label = CELL_LABEL[state]
  return (
    // The whole cell is the hit target — including the outer edges of the 07:00
    // and 22:00 columns, which sit next to the sticky day column and scrollbar.
    <td className="p-0 text-center" onPointerDown={(e) => onDown(date, hour, e)}>
      <button
        type="button"
        data-slot={slotKey({ date, hour })}
        aria-pressed={picked}
        onClick={(e) => {
          // Pointer clicks are resolved once on pointerup; only keyboard
          // activation (detail 0) reaches here.
          if (e.detail === 0) onKey(date, hour)
        }}
        title={`${prettyDate(date)} · ${hourLabel(hour)}–${hourLabel(hour + 1)} — ${label}, book this hour${
          picked ? " (selected — click to remove)" : " (click or drag to select)"
        }`}
        aria-label={`${prettyDate(date)} at ${hourLabel(hour)} — ${label}, book this hour${
          picked ? ", selected" : ""
        }`}
        className={`block h-11 w-full cursor-crosshair touch-none select-none rounded-sm text-[9px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
          picked ? PICKED_STYLE : CELL_STYLE[state]
        }`}
      >
        {label}
      </button>
    </td>
  )
})

export function BookingPanel({ token, views, mode }: { token: string; views: DayView[]; mode: string }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Selected[]>([])
  const selectedRef = useRef<Selected[]>([])
  const dragRef = useRef<DragState | null>(null)
  const [step, setStep] = useState<"pick" | "form" | "done">("pick")
  const [form, setForm] = useState({ name: "", email: "", note: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])

  const selectedKeys = useMemo(() => new Set(selected.map(slotKey)), [selected])
  const groups = useMemo(() => groupSelection(selected), [selected])

  const commitSelection = useCallback((next: Selected[]) => {
    selectedRef.current = next
    setSelected(next)
  }, [])

  // One state commit per pointer move keeps the drag in sync with the pointer.
  const addSlots = useCallback(
    (slots: { date: string; hour: number }[]) => {
      const current = selectedRef.current
      const seen = new Set(current.map(slotKey))
      const additions: Selected[] = []
      for (const { date, hour } of slots) {
        const key = `${date}:${hour}`
        if (seen.has(key)) continue
        seen.add(key)
        additions.push({ date, hour })
      }
      if (additions.length === 0) return
      commitSelection([...current, ...additions])
      setError(null)
    },
    [commitSelection],
  )

  const removeSlots = useCallback(
    (slots: { date: string; hour: number }[]) => {
      const keys = new Set(slots.map(slotKey))
      commitSelection(selectedRef.current.filter((s) => !keys.has(slotKey(s))))
    },
    [commitSelection],
  )

  const removeSlot = useCallback(
    (date: string, hour: number) => removeSlots([{ date, hour }]),
    [removeSlots],
  )

  const toggleSlot = useCallback(
    (date: string, hour: number) => {
      if (selectedRef.current.some((s) => s.date === date && s.hour === hour)) removeSlot(date, hour)
      else addSlots([{ date, hour }])
    },
    [addSlots, removeSlot],
  )

  const fillDrag = useCallback(
    (fromKey: string, toKey: string) => {
      const point = (key: string) => {
        const [date, hour] = key.split(":")
        return { row: views.findIndex((v) => v.date === date), col: HOURS.indexOf(Number(hour)) }
      }
      const a = point(fromKey)
      const b = point(toKey)
      if (a.row < 0 || b.row < 0 || a.col < 0 || b.col < 0) return
      const start = a.row * HOURS.length + a.col
      const end = b.row * HOURS.length + b.col
      const step = start <= end ? 1 : -1
      const slots: { date: string; hour: number }[] = []
      for (let i = start; ; i += step) {
        const view = views[Math.floor(i / HOURS.length)]
        const hour = HOURS[i % HOURS.length]
        if (view && hour !== undefined) slots.push({ date: view.date, hour })
        if (i === end) break
      }
      addSlots(slots)
    },
    [views, addSlots],
  )

  const dragCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => dragCleanupRef.current?.(), [])

  // Drag tracking lives on window so crossing cells is reliable, and a plain
  // click is resolved once on pointerup. A small movement threshold keeps a
  // single click from picking up a neighbouring hour.
  const onCellPointerDown = useCallback(
    (date: string, hour: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      dragCleanupRef.current?.()
      const key = slotKey({ date, hour })
      dragRef.current = {
        startKey: key,
        pointerId: e.pointerId,
        moved: false,
        lastKey: key,
        startX: e.clientX,
        startY: e.clientY,
      }

      const cellKeyAt = (x: number, y: number) => {
        const under = document.elementFromPoint(x, y) as HTMLElement | null
        return under?.closest<HTMLElement>("[data-slot]")?.dataset.slot
      }

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag || ev.pointerId !== drag.pointerId) return
        if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 4) return
        if (!drag.moved) {
          drag.moved = true
          // Add the origin as soon as a real drag starts; otherwise a short
          // drag can cross into the next hour without ever selecting hour 07.
          fillDrag(drag.startKey, drag.startKey)
        }
        const cellKey = cellKeyAt(ev.clientX, ev.clientY)
        if (!cellKey || cellKey === drag.lastKey) return
        fillDrag(drag.lastKey, cellKey)
        drag.lastKey = cellKey
      }

      const detach = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("blur", onBlur)
        dragRef.current = null
        dragCleanupRef.current = null
      }

      const onUp = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag || ev.pointerId !== drag.pointerId) return
        detach()
        if (!drag.moved) {
          const [d, h] = drag.startKey.split(":")
          toggleSlot(d, Number(h))
          return
        }
        // Release can land on a new cell without a following move event.
        // Close the range from the last seen cell to the released cell so the
        // final hour (for example 22) is never dropped.
        const cellKey = cellKeyAt(ev.clientX, ev.clientY)
        if (cellKey && cellKey !== drag.lastKey) fillDrag(drag.lastKey, cellKey)
      }

      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId === dragRef.current?.pointerId) detach()
      }
      const onBlur = () => detach()

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
      window.addEventListener("blur", onBlur)
      dragCleanupRef.current = detach
    },
    [fillDrag, toggleSlot],
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (selected.length === 0 || busy) return
    setBusy(true)
    setError(null)

    const outcomes: Result[] = []
    for (const slot of selected) {
      try {
        const result = await createBooking({
          token,
          date: slot.date,
          hour: slot.hour,
          name: form.name,
          email: form.email,
          note: form.note,
        })
        if (!result.ok || !result.status) {
          outcomes.push({ ...slot, ok: false, error: result.error ?? "Could not save this hour." })
        } else {
          outcomes.push({ ...slot, ok: true, status: result.status })
        }
      } catch (err) {
        outcomes.push({
          ...slot,
          ok: false,
          error: err instanceof Error ? err.message : "Could not save this hour.",
        })
      }
    }

    setResults(outcomes)
    setBusy(false)
    if (outcomes.some((r) => r.ok)) {
      setStep("done")
      router.refresh()
    } else {
      setError(outcomes[0]?.error ?? "Could not save your selection. Please try again.")
    }
  }

  function reset() {
    commitSelection([])
    setStep("pick")
    setResults([])
    setForm({ name: "", email: "", note: "" })
    setError(null)
    router.refresh()
  }

  if (step === "done") {
    const pending = results.filter((r) => r.ok && r.status === "pending").length
    const failed = results.filter((r) => !r.ok).length
    const heading = failed > 0
      ? "Some hours could not be saved"
      : pending > 0
        ? "Requests received"
        : "Bookings confirmed"
    const message = failed > 0
      ? "The hours listed below with an error were not saved. Refresh and try them again."
      : pending > 0
        ? "I'll review these requests and confirm them shortly — nothing is on the calendar yet."
        : "These hours are in the calendar. See you then."

    return (
      <section className="mt-10 rounded-lg border border-teal/40 bg-teal/10 p-6">
        <div className="flex items-center gap-2 text-teal">
          <Check className="h-4 w-4" />
          <h2 className="mono text-[10px] uppercase tracking-widest">{heading}</h2>
        </div>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
          {results.map((r) => (
            <li key={slotKey(r)} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <span className="text-sm text-foreground">
                {prettyDate(r.date)} · {hourLabel(r.hour)}–{hourLabel(r.hour + 1)}
              </span>
              <span
                className={`mono ml-auto text-[10px] uppercase tracking-wider ${
                  !r.ok ? "text-danger" : r.status === "confirmed" ? "text-teal" : "text-gold"
                }`}
              >
                {!r.ok ? r.error : r.status === "confirmed" ? "Confirmed" : "Pending approval"}
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={reset}
          className="mono mt-5 rounded-md border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted hover:text-foreground"
        >
          Refresh availability
        </button>
      </section>
    )
  }

  if (step === "form" && selected.length > 0) {
    const submitLabel = busy
      ? "Sending…"
      : mode === "request"
        ? "Send requests"
        : "Confirm bookings"

    return (
      <section className="mt-10 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">
            Confirm {selected.length} {selected.length === 1 ? "hour" : "hours"}
          </h2>
        </div>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-2/40">
          {selected.map((s) => (
            <li key={slotKey(s)} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="text-sm text-foreground">
                {prettyDate(s.date)} · {hourLabel(s.hour)}–{hourLabel(s.hour + 1)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {mode === "request"
            ? "These hours will be sent for approval and added to the calendar once confirmed."
            : "These hours will be booked now and added to the calendar."}
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mono text-[10px] uppercase tracking-widest text-muted">Your name</span>
              <input
                required
                minLength={2}
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
                placeholder="Your name"
              />
            </label>
            <label className="block">
              <span className="mono text-[10px] uppercase tracking-widest text-muted">Email</span>
              <input
                required
                type="email"
                maxLength={160}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
                placeholder="you@company.com"
              />
            </label>
          </div>
          <label className="block">
            <span className="mono text-[10px] uppercase tracking-widest text-muted">
              Anything to prepare? <span className="normal-case tracking-normal">(optional)</span>
            </span>
            <textarea
              maxLength={500}
              rows={3}
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              className="mt-1 w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
              placeholder="A short note about what you'd like to cover"
            />
          </label>
          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-gold px-4 py-2 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
            >
              {submitLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("pick")
                setError(null)
              }}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted hover:text-foreground"
            >
              Back
            </button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Pick your hours</h2>
        <span className="mono text-[10px] uppercase tracking-widest text-teal">
          {views.length} days available · pick any hours
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Drag across hours to select a range, then drag again to keep adding. A plain click selects or removes a single
        hour; the bar above groups your picks. Every hour can be booked — <span className="text-teal">Open</span>,{" "}
        <span className="text-gold">Busy</span>, <span className="text-danger">Taken</span> or{" "}
        <span className="text-foreground">Free</span>. One form covers all your picks.
      </p>

      {/* Reserve the bar's space so the grid never jumps when the first hour is picked. */}
      <div className="min-h-[66px] pt-4">
        {selected.length > 0 && (
          <div className="rounded-lg border border-teal/40 bg-surface p-2 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="mono shrink-0 text-[10px] uppercase tracking-widest text-teal">
                {selected.length}h
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-1 py-1">
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => removeSlots(g.hours.map((hour) => ({ date: g.date, hour })))}
                    title={`Remove ${prettyDate(g.date)} ${hourLabel(g.start)}–${hourLabel(g.end + 1)}`}
                    className="mono flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2 py-1 text-[9px] text-muted hover:border-danger/50 hover:text-danger"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                    {prettyDate(g.date)} {hourLabel(g.start)}
                    {g.end !== g.start ? `–${hourLabel(g.end)}` : ""} · {g.hours.length}h ×
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    commitSelection([])
                    setError(null)
                  }}
                  className="rounded-md border border-border px-2 py-1.5 text-[10px] text-muted hover:text-foreground"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("form")
                    setError(null)
                  }}
                  className="rounded-md bg-gold px-3 py-1.5 text-[10px] font-medium text-background hover:bg-gold-soft"
                >
                  Continue →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 max-h-[min(60vh,520px)] overflow-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[640px] table-fixed border-collapse select-none">
          <thead>
            <tr className="border-b border-border">
              <th className="mono sticky left-0 z-10 w-24 bg-surface px-3 py-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted">
                Day
              </th>
              {HOURS.map((h) => (
                <th
                  key={h}
                  className="mono px-1 py-2 text-center text-[9px] font-medium text-muted"
                  title={`${hourLabel(h)}–${hourLabel(h + 1)}`}
                >
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {views.map((view) => (
              <tr key={view.date} className="border-b border-border/60 last:border-0">
                <th className="mono sticky left-0 z-10 w-24 whitespace-nowrap bg-surface px-3 py-2 text-left text-[10px] font-normal text-foreground">
                  {prettyDate(view.date)}
                </th>
                {HOURS.map((h) => (
                  <SlotCell
                    key={h}
                    date={view.date}
                    hour={h}
                    state={cellState(view, h)}
                    picked={selectedKeys.has(`${view.date}:${h}`)}
                    onDown={onCellPointerDown}
                    onKey={toggleSlot}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
        {(Object.keys(CELL_LABEL) as CellState[]).map((state) => (
          <span key={state} className="flex items-center gap-1.5 text-[11px] text-muted">
            <span className={`h-3 w-5 rounded-sm ${LEGEND_STYLE[state]}`} />
            <span className="text-foreground">{CELL_LABEL[state]}</span>
            — bookable
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-3 w-5 rounded-sm bg-foreground" />
          <span className="text-foreground">Filled</span> — selected
        </span>
      </div>
      <p className="mono mt-3 text-[9px] uppercase tracking-wider text-muted">
        Times are 24-hour · 09 = 09:00–10:00 · drag to select a range of hours
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

    </section>
  )
}
