"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock } from "lucide-react"
import { createBooking } from "@/lib/actions/booking"
import { HOURS, hourLabel, type DayView } from "@/lib/booking"
import { prettyDate } from "@/lib/assistant/time"

type Selected = { date: string; hour: number; rush: boolean }
type Result = Selected & { ok: boolean; status?: "confirmed" | "pending"; error?: string }
type CellState = "open" | "busy" | "taken" | "free"

const MAX_SELECTION = 8

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

export function BookingPanel({ token, views, mode }: { token: string; views: DayView[]; mode: string }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Selected[]>([])
  const [step, setStep] = useState<"pick" | "form" | "done">("pick")
  const [form, setForm] = useState({ name: "", email: "", note: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])

  const openCount = views.filter((v) => v.openHour !== null && !v.full).length
  const openSelected = selected.filter((s) => !s.rush).length
  const rushSelected = selected.length - openSelected

  function isSelected(date: string, hour: number) {
    return selected.some((s) => s.date === date && s.hour === hour)
  }

  function toggleSlot(date: string, hour: number, rush: boolean) {
    setError(null)
    const exists = selected.some((s) => s.date === date && s.hour === hour)
    if (exists) {
      setSelected(selected.filter((s) => !(s.date === date && s.hour === hour)))
      return
    }
    if (selected.length >= MAX_SELECTION) {
      setError(`You can select up to ${MAX_SELECTION} hours at a time. Remove one to add another.`)
      return
    }
    setSelected([...selected, { date, hour, rush }])
  }

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
          rush: slot.rush,
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
    setStep("pick")
    setResults([])
    setSelected([])
    setForm({ name: "", email: "", note: "" })
    setError(null)
    router.refresh()
  }

  if (step === "done") {
    const confirmed = results.filter((r) => r.ok && r.status === "confirmed").length
    const pending = results.filter((r) => r.ok && r.status === "pending").length
    const failed = results.filter((r) => !r.ok).length
    const heading = failed > 0
      ? "Some hours could not be saved"
      : confirmed > 0 && pending > 0
        ? "Bookings & requests received"
        : pending > 0
          ? "Requests received"
          : "Bookings confirmed"
    const message = failed > 0
      ? "The hours listed below with an error were not saved. Refresh and try them again."
      : confirmed > 0 && pending > 0
        ? "Open hours are in the calendar. Rush requests are waiting for your approval."
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
                className={`mono rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${
                  r.rush ? "border-gold/40 bg-gold/10 text-gold" : "border-teal/40 bg-teal/10 text-teal"
                }`}
              >
                {r.rush ? "Rush" : "Book now"}
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
      : rushSelected === 0
        ? mode === "request"
          ? "Send requests"
          : "Confirm bookings"
        : openSelected === 0
          ? "Send rush requests"
          : "Submit selection"

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
              <span
                className={`mono ml-auto rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${
                  s.rush ? "border-gold/40 bg-gold/10 text-gold" : "border-teal/40 bg-teal/10 text-teal"
                }`}
              >
                {s.rush ? "Rush request" : "Book now"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {openSelected > 0 && rushSelected > 0
            ? "Open hours will be booked now. The other hours will be sent as rush requests for my approval."
            : rushSelected > 0
              ? "These hours aren't open for instant booking. They'll be sent as rush requests and only added to the calendar if I confirm them."
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
          {openCount} open {openCount === 1 ? "slot" : "slots"} · rush available any hour
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Click as many hours as you need. <span className="text-teal">Open</span> hours can be booked now; every other
        hour — <span className="text-gold">Busy</span>, <span className="text-danger">Taken</span> or{" "}
        <span className="text-foreground">Free</span> — can be requested as a rush. One form covers all your picks.
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="mono sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[9px] font-medium uppercase tracking-wider text-muted">
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
                <th className="mono sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-2 text-left text-[10px] font-normal text-foreground">
                  {prettyDate(view.date)}
                </th>
                {HOURS.map((h) => {
                  const state = cellState(view, h)
                  const label = CELL_LABEL[state]
                  const isOpen = state === "open"
                  const picked = isSelected(view.date, h)
                  return (
                    <td key={h} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        aria-pressed={picked}
                        onClick={() => toggleSlot(view.date, h, !isOpen)}
                        title={`${prettyDate(view.date)} · ${hourLabel(h)}–${hourLabel(h + 1)} — ${
                          isOpen ? "book now" : `${label} · request as rush`
                        }${picked ? " (selected — click to remove)" : " (click to add)"}`}
                        aria-label={`${prettyDate(view.date)} at ${hourLabel(h)} — ${label}, ${
                          isOpen ? "book now" : "request as rush"
                        }${picked ? ", selected" : ""}`}
                        className={`h-8 w-full rounded-sm text-[9px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${
                          CELL_STYLE[state]
                        } ${picked ? "relative z-10 outline outline-2 outline-offset-1 outline-foreground" : ""}`}
                      >
                        {label}
                      </button>
                    </td>
                  )
                })}
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
            {state === "open" ? "— book now" : state === "free" ? "— request anytime" : "— request as rush"}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-3 w-5 rounded-sm outline outline-2 outline-offset-1 outline-foreground" />
          <span className="text-foreground">Outlined</span> — selected
        </span>
      </div>
      <p className="mono mt-3 text-[9px] uppercase tracking-wider text-muted">
        Times are 24-hour · 09 = 09:00–10:00 · up to {MAX_SELECTION} hours per request
      </p>

      {openCount === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
          No hours are open for instant booking in the next two weeks — you can still select any hours as a rush.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {selected.length > 0 && (
        <div className="sticky bottom-3 z-20 mt-5 rounded-lg border border-teal/40 bg-surface p-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-[10px] uppercase tracking-widest text-teal">
              {selected.length} selected · {openSelected} book now · {rushSelected} rush
            </span>
            <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:flex-1">
              {selected.map((s) => (
                <button
                  key={slotKey(s)}
                  type="button"
                  onClick={() => toggleSlot(s.date, s.hour, s.rush)}
                  title="Remove from selection"
                  className="mono rounded-full border border-border bg-surface-2 px-2 py-1 text-[9px] text-muted hover:border-danger/50 hover:text-danger"
                >
                  {prettyDate(s.date)} {hourLabel(s.hour)} {s.rush ? "· rush" : "· open"} ×
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelected([])
                  setError(null)
                }}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("form")
                  setError(null)
                }}
                className="rounded-md bg-gold px-4 py-2 text-xs font-medium text-background hover:bg-gold-soft"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
