"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock } from "lucide-react"
import { createBooking } from "@/lib/actions/booking"
import { HOURS, hourLabel, type DayView } from "@/lib/booking"
import { prettyDate } from "@/lib/assistant/time"

type Selected = { date: string; hour: number }
type Done = { status: string; date: string; hour: number }

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
      })
      if (!result.ok || !result.status) {
        setError(result.error ?? "Could not book that slot. Please try again.")
        router.refresh()
        return
      }
      setDone({ status: result.status, date: selected.date, hour: selected.hour })
      setStep("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not book that slot. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (step === "done" && done) {
    return (
      <section className="mt-10 rounded-lg border border-teal/40 bg-teal/10 p-6">
        <div className="flex items-center gap-2 text-teal">
          <Check className="h-4 w-4" />
          <h2 className="mono text-[10px] uppercase tracking-widest">
            {done.status === "pending" ? "Request received" : "Booking confirmed"}
          </h2>
        </div>
        <p className="serif mt-3 text-2xl text-foreground">
          {prettyDate(done.date)} at {hourLabel(done.hour)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {done.status === "pending"
            ? "I'll review your request and confirm it shortly."
            : "It's in the calendar. See you then."}
        </p>
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
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Confirm your slot</h2>
        </div>
        <p className="serif mt-2 text-2xl text-foreground">
          {prettyDate(selected.date)} · {hourLabel(selected.hour)}–{hourLabel(selected.hour + 1)}
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
              {busy ? "Booking…" : mode === "request" ? "Send request" : "Confirm booking"}
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
          {openCount} open {openCount === 1 ? "slot" : "slots"}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Filled blocks are already taken. Only the open hour on each day can be booked through this link.
      </p>

      <div className="mt-4 space-y-2">
        {views.map((view) => {
          const open = view.openHour !== null && !view.full
          return (
            <div key={view.date} className="rounded-lg border border-border bg-surface px-3 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-foreground">{prettyDate(view.date)}</span>
                <span
                  className={`mono text-[10px] uppercase tracking-widest ${
                    open ? "text-teal" : view.full ? "text-danger" : "text-muted"
                  }`}
                >
                  {open ? `${hourLabel(view.openHour!)} open` : view.full ? "Fully booked" : "—"}
                </span>
              </div>
              <div className="mt-2 flex gap-[2px]" aria-label={`Hourly view for ${prettyDate(view.date)}`}>
                {HOURS.map((h) => {
                  const isBusy = view.busyHours.includes(h)
                  const isOpen = open && view.openHour === h
                  if (isOpen) {
                    return (
                      <button
                        key={h}
                        type="button"
                        onClick={() => {
                          setSelected({ date: view.date, hour: h })
                          setStep("form")
                          setError(null)
                        }}
                        title={`Book ${hourLabel(h)}`}
                        aria-label={`Book ${prettyDate(view.date)} at ${hourLabel(h)}`}
                        className="h-5 min-w-0 flex-1 rounded-sm bg-teal/80 ring-1 ring-teal hover:bg-teal"
                      />
                    )
                  }
                  return (
                    <span
                      key={h}
                      title={isBusy ? `${hourLabel(h)} — busy` : hourLabel(h)}
                      aria-label={isBusy ? `${hourLabel(h)} busy` : undefined}
                      className={`h-5 min-w-0 flex-1 rounded-sm ${
                        isBusy ? "bg-danger/25" : "bg-surface-2"
                      }`}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {openCount === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No open hours in the next two weeks. Please check back soon.
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}
    </section>
  )
}
