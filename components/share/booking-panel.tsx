"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock } from "lucide-react"
import { createBooking } from "@/lib/actions/booking"
import { HOURS, hourLabel, type DayView } from "@/lib/booking"
import { prettyDate } from "@/lib/assistant/time"

type Selected = { date: string; hour: number; rush: boolean }
type Done = { status: string; date: string; hour: number; rush: boolean }
type CellState = "open" | "busy" | "taken" | "free"

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

export function BookingPanel({ token, views, mode }: { token: string; views: DayView[]; mode: string }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Selected | null>(null)
  const [step, setStep] = useState<"pick" | "form" | "done">("pick")
  const [form, setForm] = useState({ name: "", email: "", note: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  const openCount = views.filter((v) => v.openHour !== null && !v.full).length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await createBooking({
        token,
        date: selected.date,
        hour: selected.hour,
        name: form.name,
        email: form.email,
        note: form.note,
        rush: selected.rush,
      })
      if (!result.ok || !result.status) {
        setError(result.error ?? "Could not book that slot. Please try again.")
        router.refresh()
        return
      }
      setDone({ status: result.status, date: selected.date, hour: selected.hour, rush: selected.rush })
      setStep("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book that slot. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (step === "done" && done) {
    const heading = done.rush
      ? "Rush request received"
      : done.status === "pending"
        ? "Request received"
        : "Booking confirmed"
    const message = done.rush
      ? "I'll review this rush request and confirm it shortly — it isn't on the calendar yet."
      : done.status === "pending"
        ? "I'll review your request and confirm it shortly."
        : "It's in the calendar. See you then."
    return (
      <section className="mt-10 rounded-lg border border-teal/40 bg-teal/10 p-6">
        <div className="flex items-center gap-2 text-teal">
          <Check className="h-4 w-4" />
          <h2 className="mono text-[10px] uppercase tracking-widest">{heading}</h2>
        </div>
        <p className="serif mt-3 text-2xl text-foreground">
          {prettyDate(done.date)} at {hourLabel(done.hour)}
        </p>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <button
          type="button"
          onClick={() => {
            setStep("pick")
            setDone(null)
            setSelected(null)
            setForm({ name: "", email: "", note: "" })
            router.refresh()
          }}
          className="mono mt-5 rounded-md border border-border px-3 py-2 text-[10px] uppercase tracking-widest text-muted hover:text-foreground"
        >
          Refresh availability
        </button>
      </section>
    )
  }

  if (step === "form" && selected) {
    return (
      <section className="mt-10 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">
            {selected.rush ? "Request a rush hour" : "Confirm your slot"}
          </h2>
        </div>
        <p className="serif mt-2 text-2xl text-foreground">
          {prettyDate(selected.date)} · {hourLabel(selected.hour)}–{hourLabel(selected.hour + 1)}
        </p>
        {selected.rush && (
          <p className="mt-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
            This hour isn&apos;t open for instant booking. It will be sent as a rush request and only added to the
            calendar if I confirm it.
          </p>
        )}
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
              {busy
                ? "Sending…"
                : selected.rush
                  ? "Send rush request"
                  : mode === "request"
                    ? "Send request"
                    : "Confirm booking"}
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
        <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Pick an hour</h2>
        <span className="mono text-[10px] uppercase tracking-widest text-teal">
          {openCount} open {openCount === 1 ? "slot" : "slots"} · rush available any hour
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        <span className="text-teal">Open</span> hours can be booked now. Every other hour —{" "}
        <span className="text-gold">Busy</span>, <span className="text-danger">Taken</span> or{" "}
        <span className="text-foreground">Free</span> — can be requested as a rush. I&apos;ll review rush requests
        before they go on the calendar.
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
                  return (
                    <td key={h} className="px-1 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setSelected({ date: view.date, hour: h, rush: !isOpen })
                          setStep("form")
                          setError(null)
                        }}
                        title={`${prettyDate(view.date)} · ${hourLabel(h)}–${hourLabel(h + 1)} — ${
                          isOpen ? "book now" : `${label} · request as rush`
                        }`}
                        aria-label={`${prettyDate(view.date)} at ${hourLabel(h)} — ${label}, ${
                          isOpen ? "book now" : "request as rush"
                        }`}
                        className={`h-8 w-full rounded-sm text-[9px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${CELL_STYLE[state]}`}
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
      </div>
      <p className="mono mt-3 text-[9px] uppercase tracking-wider text-muted">
        Times are 24-hour · 09 = 09:00–10:00
      </p>

      {openCount === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
          No hours are open for instant booking in the next two weeks — you can still request any hour as a rush.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}
    </section>
  )
}
