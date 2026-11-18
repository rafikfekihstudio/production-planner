"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  Trash2,
  X,
} from "lucide-react"
import { clearDayRange, setDayRange } from "@/lib/actions/availability"
import {
  createShareLink,
  deleteShareLink,
  revokeShareLink,
  updateShareLinkSettings,
} from "@/lib/actions/sharing"
import { cancelBooking, confirmBooking } from "@/lib/actions/booking"
import { HOUR_END, HOURS, hourLabel } from "@/lib/booking"
import { SHARE_FIELDS, SHARE_FIELD_LABELS, type ShareField } from "@/lib/sharing"

export type RangeRow = {
  id: number
  date: string
  startHour: number
  endHour: number
  status: "open" | "busy"
}

export type ShareLinkRow = {
  id: number
  token: string
  clientId: number | null
  clientName: string | null
  createdAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  fields: string | null
  bookingMode: string
  slotsPerWeek: number
  capacityPerDay: number
}

export type BookingRow = {
  id: number
  date: string
  hour: number
  name: string
  email: string
  note: string | null
  status: string
  tokenId: number
  clientName: string | null
}

type ClientOption = { id: number; name: string; company: string | null; active: boolean }

type Draft = { openStart: string; openEnd: string; busyStart: string; busyEnd: string }

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const EMPTY_DRAFT: Draft = { openStart: "", openEnd: "", busyStart: "", busyEnd: "" }

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function toISO(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function fromISO(date: string) {
  return new Date(`${date}T00:00:00Z`)
}

function addDays(date: string, days: number) {
  const d = fromISO(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toISO(d)
}

function mondayOf(date: string) {
  const d = fromISO(date)
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return toISO(d)
}

function prettyDay(date: string) {
  return fromISO(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
}

function weekTitle(start: string) {
  const end = addDays(start, 6)
  const a = fromISO(start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  const b = fromISO(end).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${a} – ${b}`
}

function shortStamp(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function linkStatus(link: ShareLinkRow, now: string) {
  if (link.revokedAt) return "Revoked"
  if (link.expiresAt && link.expiresAt < now) return "Expired"
  return "Active"
}

async function copyText(url: string) {
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    /* the readonly input remains available for manual copying */
  }
}

function statusBadge(status: string) {
  const style =
    status === "confirmed"
      ? "border-teal/40 bg-teal/10 text-teal"
      : status === "pending"
        ? "border-gold/40 bg-gold/10 text-gold"
        : status === "cancelled"
          ? "border-border bg-surface-2 text-muted"
          : "border-danger/40 bg-danger/10 text-danger"
  return (
    <span className={`mono rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${style}`}>
      {status}
    </span>
  )
}

export function SharedViewsManager({
  clients,
  ranges,
  links,
  bookings,
  today,
  now,
}: {
  clients: ClientOption[]
  ranges: RangeRow[]
  links: ShareLinkRow[]
  bookings: BookingRow[]
  today: string
  now: string
}) {
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => mondayOf(today))
  const [rangeRows, setRangeRows] = useState(ranges)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [form, setForm] = useState({
    clientId: "",
    expiresInDays: "30",
    bookingMode: "instant",
    slotsPerWeek: "3",
    capacityPerDay: "2",
    fields: [...SHARE_FIELDS] as ShareField[],
  })

  const activeClients = clients.filter((c) => c.active)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const rangesByDate = useMemo(() => {
    const map = new Map<string, RangeRow[]>()
    for (const row of rangeRows) map.set(row.date, [...(map.get(row.date) ?? []), row])
    return map
  }, [rangeRows])

  function draftFor(date: string): Draft {
    if (drafts[date]) return drafts[date]
    const saved = rangesByDate.get(date) ?? []
    const open = saved.find((r) => r.status === "open")
    const busyRow = saved.find((r) => r.status === "busy")
    return {
      openStart: open ? String(open.startHour) : "",
      openEnd: open ? String(open.endHour) : "",
      busyStart: busyRow ? String(busyRow.startHour) : "",
      busyEnd: busyRow ? String(busyRow.endHour) : "",
    }
  }

  function setField(date: string, key: keyof Draft, value: string) {
    setDrafts((prev) => {
      const next = { ...draftFor(date), [key]: value }
      if (key === "openStart" || key === "busyStart") {
        const prefix = key === "openStart" ? "open" : "busy"
        const start = Number(value)
        const endKey = `${prefix}End` as keyof Draft
        const end = Number(next[endKey])
        if (Number.isInteger(start) && (!Number.isInteger(end) || end <= start)) {
          next[endKey] = String(Math.min(start + 2, HOUR_END))
        }
      }
      return { ...prev, [date]: next }
    })
  }

  async function saveDay(date: string) {
    if (busy) return
    setError(null)
    setBusy(true)
    const draft = draftFor(date)
    try {
      const openStart = Number(draft.openStart)
      const openEnd = Number(draft.openEnd)
      const busyStart = Number(draft.busyStart)
      const busyEnd = Number(draft.busyEnd)
      if (Number.isInteger(openStart) && Number.isInteger(openEnd) && openEnd > openStart) {
        await setDayRange(date, "open", openStart, openEnd)
      } else {
        await clearDayRange(date, "open")
      }
      if (Number.isInteger(busyStart) && Number.isInteger(busyEnd) && busyEnd > busyStart) {
        await setDayRange(date, "busy", busyStart, busyEnd)
      } else {
        await clearDayRange(date, "busy")
      }
      setRangeRows((prev) => {
        const kept = prev.filter((r) => r.date !== date)
        const next: RangeRow[] = [...kept]
        if (Number.isInteger(openStart) && Number.isInteger(openEnd) && openEnd > openStart) {
          next.push({ id: -1, date, startHour: openStart, endHour: openEnd, status: "open" })
        }
        if (Number.isInteger(busyStart) && Number.isInteger(busyEnd) && busyEnd > busyStart) {
          next.push({ id: -2, date, startHour: busyStart, endHour: busyEnd, status: "busy" })
        }
        return next
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the ranges.")
    } finally {
      setBusy(false)
    }
  }

  async function clearDay(date: string) {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await clearDayRange(date, "open")
      await clearDayRange(date, "busy")
      setRangeRows((prev) => prev.filter((r) => r.date !== date))
      setDrafts((prev) => ({ ...prev, [date]: { ...EMPTY_DRAFT } }))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear the ranges.")
    } finally {
      setBusy(false)
    }
  }

  function toggleField(field: ShareField) {
    setForm((f) => ({
      ...f,
      fields: f.fields.includes(field) ? f.fields.filter((x) => x !== field) : [...f.fields, field],
    }))
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault()
    if (!form.clientId || busy) return
    setError(null)
    setCreatedUrl(null)
    setBusy(true)
    try {
      const result = await createShareLink({
        clientId: Number(form.clientId),
        expiresInDays: form.expiresInDays === "never" ? null : Number(form.expiresInDays),
        fields: form.fields,
        bookingMode: form.bookingMode === "request" ? "request" : "instant",
        slotsPerWeek: Number(form.slotsPerWeek),
        capacityPerDay: Number(form.capacityPerDay),
      })
      setCreatedUrl(`${window.location.origin}/share/${result.token}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(link: ShareLinkRow) {
    setError(null)
    try {
      await revokeShareLink(link.id)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the link.")
    }
  }

  async function remove(link: ShareLinkRow) {
    setError(null)
    try {
      await deleteShareLink(link.id)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the link.")
    }
  }

  async function bookingAction(id: number, action: "confirm" | "cancel") {
    setError(null)
    try {
      if (action === "confirm") await confirmBooking(id)
      else await cancelBooking(id)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the booking.")
    }
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-4">
        <h1 className="serif text-4xl text-foreground">Shared Views</h1>
        <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
          Hourly bookable slots · curated per client · instant or request
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-gold" />
            <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Your bookable hours</h2>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
              aria-label="Previous week"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="mono min-w-40 text-center text-xs text-foreground">{weekTitle(weekStart)}</span>
            <button
              type="button"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
              aria-label="Next week"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Mark an <span className="text-teal">Open</span> range for hours clients may book, and a{" "}
          <span className="text-danger">Busy</span> range for real commitments. Busy hours appear only as &ldquo;Busy&rdquo;
          — never with task names. Each client sees a curated few open hours, not your whole week.
        </p>

        <div className="mt-4 space-y-2">
          {days.map((date, index) => {
            const draft = draftFor(date)
            const draftSelect = (key: keyof Draft) => ({
              value: draft[key],
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setField(date, key, e.target.value),
            })
            const options = HOURS.map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))
            const endOptions = HOURS.slice(1).map((h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))
            const selectClass =
              "rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-gold"
            const isToday = date === today
            return (
              <div key={date} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <div className="mono w-28 shrink-0 text-[10px] uppercase tracking-wider">
                  <span className={isToday ? "text-gold" : "text-muted"}>{WEEKDAYS[index]}</span>{" "}
                  <span className="text-foreground">{date.slice(8)}</span>
                </div>
                <span className="mono text-[9px] uppercase tracking-wider text-teal">Open</span>
                <select {...draftSelect("openStart")} className={selectClass} aria-label={`Open start for ${date}`}>
                  <option value="">—</option>
                  {options}
                </select>
                <span className="text-[10px] text-muted">to</span>
                <select {...draftSelect("openEnd")} className={selectClass} aria-label={`Open end for ${date}`}>
                  <option value="">—</option>
                  {endOptions}
                  <option value={HOUR_END}>{hourLabel(HOUR_END)}</option>
                </select>
                <span className="mono ml-2 text-[9px] uppercase tracking-wider text-danger">Busy</span>
                <select {...draftSelect("busyStart")} className={selectClass} aria-label={`Busy start for ${date}`}>
                  <option value="">—</option>
                  {options}
                </select>
                <span className="text-[10px] text-muted">to</span>
                <select {...draftSelect("busyEnd")} className={selectClass} aria-label={`Busy end for ${date}`}>
                  <option value="">—</option>
                  {endOptions}
                  <option value={HOUR_END}>{hourLabel(HOUR_END)}</option>
                </select>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveDay(date)}
                    className="rounded-md border border-teal/40 px-2 py-1 text-[10px] text-teal hover:bg-teal/10 disabled:opacity-40"
                    aria-label={`Save ranges for ${date}`}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => clearDay(date)}
                    className="rounded-md border border-border p-1.5 text-muted hover:text-danger disabled:opacity-40"
                    aria-label={`Clear ranges for ${date}`}
                    title="Clear both ranges"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Create a client link</h2>
        </div>
        <form onSubmit={submitLink} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Client</label>
            <select
              value={form.clientId}
              onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              <option value="">Select a client…</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` · ${c.company}` : ""}
                </option>
              ))}
            </select>
            {activeClients.length === 0 && (
              <p className="mt-1 text-[11px] text-muted">Add a client on the Clients page first.</p>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Expires</label>
            <select
              value={form.expiresInDays}
              onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Booking</label>
            <select
              value={form.bookingMode}
              onChange={(e) => setForm((f) => ({ ...f, bookingMode: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              <option value="instant">Instant</option>
              <option value="request">Request</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Slots / week</label>
            <select
              value={form.slotsPerWeek}
              onChange={(e) => setForm((f) => ({ ...f, slotsPerWeek: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Per day</label>
            <select
              value={form.capacityPerDay}
              onChange={(e) => setForm((f) => ({ ...f, capacityPerDay: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-1 flex items-end">
            <button
              type="submit"
              disabled={busy || !form.clientId || form.fields.length === 0}
              className="w-full rounded-md bg-gold px-3 py-2 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
            >
              Create
            </button>
          </div>
          <div className="md:col-span-3 flex flex-wrap gap-2 pt-1.5">
            {SHARE_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-1 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={form.fields.includes(field)}
                  onChange={() => toggleField(field)}
                  className="h-3.5 w-3.5 accent-[var(--gold)]"
                />
                {SHARE_FIELD_LABELS[field]}
              </label>
            ))}
          </div>
        </form>
        <p className="mt-2 text-[11px] text-muted">
          Instant books the slot and creates a scheduled task immediately. Request puts it in your bookings list as
          pending until you confirm.
        </p>
        {createdUrl && (
          <div className="mt-3 rounded-md border border-teal/40 bg-teal/10 p-3">
            <p className="text-[11px] text-teal">Link ready — copy and send it to your client.</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={createdUrl}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] text-foreground"
              />
              <button
                type="button"
                onClick={() => copyText(createdUrl)}
                className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
                aria-label="Copy link"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Existing links</h2>
        </div>
        {links.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">No links yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-border">
            {links.map((link) => (
              <LinkItem
                key={link.id}
                link={link}
                now={now}
                onChanged={() => router.refresh()}
                onError={setError}
                onRevoke={revoke}
                onRemove={remove}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3">
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Bookings</h2>
        </div>
        {bookings.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted">No bookings yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {prettyDay(b.date)} · {hourLabel(b.hour)}
                    </span>
                    {statusBadge(b.status)}
                  </div>
                  <p className="mono mt-1 text-[10px] text-muted">
                    {b.clientName ?? "Client"} · {b.name} · {b.email}
                    {b.note ? ` · ${b.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {b.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => bookingAction(b.id, "confirm")}
                      className="rounded-md border border-teal/40 p-1.5 text-teal hover:bg-teal/10"
                      title="Confirm and schedule"
                      aria-label="Confirm booking"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {b.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() => bookingAction(b.id, "cancel")}
                      className="rounded-md border border-border p-1.5 text-muted hover:border-danger/50 hover:text-danger"
                      title="Cancel booking"
                      aria-label="Cancel booking"
                    >
                      <Ban className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted">
        Each link is unique to one client, can expire, and can be revoked at any time. Clients only see generic Busy
        blocks and a curated set of your real open hours — never task titles, internal notes, or other clients.
      </p>
    </div>
  )
}

function LinkItem({
  link,
  now,
  onChanged,
  onError,
  onRevoke,
  onRemove,
}: {
  link: ShareLinkRow
  now: string
  onChanged: () => void
  onError: (message: string | null) => void
  onRevoke: (link: ShareLinkRow) => void
  onRemove: (link: ShareLinkRow) => void
}) {
  const [mode, setMode] = useState(link.bookingMode)
  const [slots, setSlots] = useState(String(link.slotsPerWeek))
  const [capacity, setCapacity] = useState(String(link.capacityPerDay))
  const [saving, setSaving] = useState(false)
  const status = linkStatus(link, now)
  const url = `${typeof window === "undefined" ? "" : window.location.origin}/share/${link.token}`
  let fields: string[] = []
  try {
    const parsed: unknown = JSON.parse(link.fields ?? "[]")
    if (Array.isArray(parsed)) fields = parsed.filter((v): v is string => typeof v === "string")
  } catch {
    fields = []
  }

  const selectClass =
    "rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] text-foreground focus:outline-none focus:border-gold"

  async function saveSettings() {
    setSaving(true)
    onError(null)
    try {
      await updateShareLinkSettings(link.id, {
        bookingMode: mode,
        slotsPerWeek: Number(slots),
        capacityPerDay: Number(capacity),
      })
      onChanged()
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save link settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{link.clientName ?? "Deleted client"}</span>
          <span
            className={`mono rounded-full border px-1.5 py-0.5 text-[9px] uppercase ${
              status === "Active"
                ? "border-teal/40 bg-teal/10 text-teal"
                : status === "Revoked"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-surface-2 text-muted"
            }`}
          >
            {status}
          </span>
          <span className="mono text-[9px] uppercase tracking-wider text-muted">
            {link.bookingMode} · {link.slotsPerWeek}/wk · {link.capacityPerDay}/day
          </span>
        </div>
        <p className="mono mt-1 truncate text-[10px] text-muted">
          Created {shortStamp(link.createdAt)} · Expires {shortStamp(link.expiresAt)} ·{" "}
          {fields.map((f) => SHARE_FIELD_LABELS[f as ShareField] ?? f).join(", ") || "no sections"}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className={selectClass}
            aria-label={`Booking mode for ${link.clientName ?? "client"}`}
          >
            <option value="instant">Instant</option>
            <option value="request">Request</option>
          </select>
          <select
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            className={selectClass}
            aria-label={`Slots per week for ${link.clientName ?? "client"}`}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}/wk
              </option>
            ))}
          </select>
          <select
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={selectClass}
            aria-label={`Capacity per day for ${link.clientName ?? "client"}`}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}/day
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={saveSettings}
            className="rounded-md border border-gold/40 px-2 py-1 text-[10px] text-gold hover:bg-gold/10 disabled:opacity-40"
            aria-label={`Save settings for ${link.clientName ?? "client"}`}
          >
            Save
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => copyText(url)}
          className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
          aria-label="Copy link"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {status === "Active" && (
          <>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
              aria-label="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={() => onRevoke(link)}
              className="rounded-md border border-border p-1.5 text-muted hover:border-gold/50 hover:text-gold"
              aria-label={`Revoke link for ${link.clientName ?? "client"}`}
              title="Revoke link"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onRemove(link)}
          className="rounded-md border border-border p-1.5 text-muted hover:border-danger/50 hover:text-danger"
          aria-label="Delete link"
          title="Delete link"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  )
}
