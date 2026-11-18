"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Trash2,
  X,
} from "lucide-react"
import { setDayAvailability } from "@/lib/actions/availability"
import { createShareLink, deleteShareLink, revokeShareLink } from "@/lib/actions/sharing"
import {
  SHARE_FIELDS,
  SHARE_FIELD_LABELS,
  type AvailabilityValue,
  type DayStatus,
  type ShareField,
} from "@/lib/sharing"

export type DayOverride = { date: string; status: AvailabilityValue }
export type ShareLinkRow = {
  id: number
  token: string
  clientId: number | null
  clientName: string | null
  createdAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  fields: string | null
}
type ClientOption = { id: number; name: string; company: string | null; active: boolean }

const STATUS_META: Record<DayStatus, { label: string; short: string; cell: string; text: string }> = {
  unset: { label: "Not set", short: "·", cell: "border-border bg-surface-2", text: "text-muted" },
  available: { label: "Available", short: "Open", cell: "border-teal/50 bg-teal/10", text: "text-teal" },
  tentative: { label: "Tentative", short: "Maybe", cell: "border-gold/50 bg-gold/10", text: "text-gold" },
  busy: { label: "Busy", short: "Busy", cell: "border-danger/50 bg-danger/10", text: "text-danger" },
  off: { label: "Off", short: "Off", cell: "border-border bg-surface-2", text: "text-muted" },
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function pad(n: number) {
  return String(n).padStart(2, "0")
}

function toISO(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function monthTitle(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function shortDate(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function linkStatus(link: ShareLinkRow) {
  if (link.revokedAt) return "Revoked"
  if (link.expiresAt && new Date(link.expiresAt).getTime() < Date.now()) return "Expired"
  return "Active"
}

export function SharedViewsManager({
  clients,
  overrides,
  links,
  today,
}: {
  clients: ClientOption[]
  overrides: DayOverride[]
  links: ShareLinkRow[]
  today: string
}) {
  const router = useRouter()
  const [todayYear, todayMonth] = today.split("-").map(Number)
  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth - 1 })
  const [days, setDays] = useState<Record<string, DayStatus>>(() =>
    Object.fromEntries(overrides.map((o) => [o.date, o.status])),
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [form, setForm] = useState({ clientId: "", expiresInDays: "30", fields: [...SHARE_FIELDS] as ShareField[] })

  const activeClients = clients.filter((c) => c.active)
  const openDays = useMemo(
    () => Object.entries(days).filter(([, status]) => status === "available" || status === "tentative").length,
    [days],
  )

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1))
    const offset = (first.getUTCDay() + 6) % 7
    const start = new Date(first)
    start.setUTCDate(first.getUTCDate() - offset)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setUTCDate(start.getUTCDate() + i)
      return {
        iso: toISO(d),
        day: d.getUTCDate(),
        inMonth: d.getUTCMonth() === cursor.month && d.getUTCFullYear() === cursor.year,
      }
    })
  }, [cursor])

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(cursor.year, cursor.month + delta, 1))
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() })
    setSelected(null)
  }

  async function chooseStatus(status: DayStatus) {
    if (!selected || busy) return
    setError(null)
    setBusy(true)
    try {
      await setDayAvailability(selected, status)
      setDays((prev) => {
        const next = { ...prev }
        if (status === "unset") delete next[selected]
        else next[selected] = status
        return next
      })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save availability.")
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
      })
      setCreatedUrl(`${window.location.origin}/share/${result.token}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the link.")
    } finally {
      setBusy(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* the readonly input below remains available for manual copying */
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

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-4">
        <h1 className="serif text-4xl text-foreground">Shared Views</h1>
        <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
          Whole-day availability · read-only client links
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
            <CalendarDays className="h-3.5 w-3.5 text-gold" />
            <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Your open days</h2>
          </div>
          <span className="mono rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-[10px] text-teal">
            {openDays} flagged in total
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="mono min-w-32 text-center text-xs text-foreground">{monthTitle(cursor.year, cursor.month)}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="mono pb-1 text-center text-[9px] uppercase tracking-widest text-muted">
              {w}
            </div>
          ))}
          {cells.map((cell) => {
            const status = days[cell.iso] ?? "unset"
            const meta = STATUS_META[status]
            const isSelected = selected === cell.iso
            const isToday = cell.iso === today
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => setSelected(cell.iso)}
                data-date={cell.iso}
                title={`${cell.iso} · ${meta.label}`}
                className={`flex min-h-12 flex-col items-center justify-center rounded-md border px-1 py-1 text-[10px] transition-colors ${
                  meta.cell
                } ${isSelected ? "ring-1 ring-gold" : ""} ${cell.inMonth ? "" : "opacity-30"}`}
              >
                <span className={`mono text-xs ${isToday ? "text-gold" : "text-foreground"}`}>{cell.day}</span>
                <span className={`${meta.text} leading-none`}>{meta.short}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mono text-[10px] uppercase tracking-widest text-muted">
            {selected ? `Set ${selected}` : "Pick a day above"}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(Object.keys(STATUS_META) as DayStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                disabled={!selected || busy}
                onClick={() => chooseStatus(status)}
                className={`rounded-md border border-border px-2 py-1 text-[10px] disabled:opacity-40 ${STATUS_META[status].text} hover:bg-surface-2`}
              >
                {STATUS_META[status].label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Only <span className="text-teal">Available</span> and <span className="text-gold">Tentative</span> days appear on
          client links. Busy, Off and Not set stay private. Whole-day overrides do not change your timeline tasks.
        </p>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Create a client link</h2>
        </div>
        <form onSubmit={submitLink} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-5">
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
          <div className="md:col-span-3">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Expires</label>
            <select
              value={form.expiresInDays}
              onChange={(e) => setForm((f) => ({ ...f, expiresInDays: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              <option value="30">In 30 days</option>
              <option value="60">In 60 days</option>
              <option value="90">In 90 days</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <span className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Include</span>
            <div className="flex flex-wrap gap-2 pt-1.5">
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
          </div>
          <div className="flex items-end md:col-span-1">
            <button
              type="submit"
              disabled={busy || !form.clientId || form.fields.length === 0}
              className="w-full rounded-md bg-gold px-3 py-2 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </form>
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
                onClick={() => copy(createdUrl)}
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
            {links.map((link) => {
              const status = linkStatus(link)
              const url = `${typeof window === "undefined" ? "" : window.location.origin}/share/${link.token}`
              let fields: string[] = []
              try {
                const parsed: unknown = JSON.parse(link.fields ?? "[]")
                if (Array.isArray(parsed)) fields = parsed.filter((v): v is string => typeof v === "string")
              } catch {
                fields = []
              }
              return (
                <li key={link.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                    </div>
                    <p className="mono mt-1 truncate text-[10px] text-muted">
                      Created {shortDate(link.createdAt)} · Expires {shortDate(link.expiresAt)} ·{" "}
                      {fields.map((f) => SHARE_FIELD_LABELS[f as ShareField] ?? f).join(", ") || "no sections"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copy(url)}
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
                          onClick={() => revoke(link)}
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
                      onClick={() => remove(link)}
                      className="rounded-md border border-border p-1.5 text-muted hover:border-danger/50 hover:text-danger"
                      aria-label="Delete link"
                      title="Delete link"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-muted">
        Each link is unique to one client, can expire, and can be revoked at any time. The public page never shows
        internal notes, personal work, or other clients &mdash; only the sections you include above.
      </p>
    </div>
  )
}
