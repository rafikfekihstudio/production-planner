"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Archive,
  Check,
  Mail,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Trash2,
  Users,
  X,
} from "lucide-react"
import {
  createClient,
  deleteClient,
  setClientActive,
  updateClient,
  type ClientInput,
} from "@/lib/actions/clients"

export type ClientRow = {
  id: number
  name: string
  company: string | null
  email: string | null
  phone: string | null
  notes: string | null
  active: boolean
  projectCount: number
  taskCount: number
}

type Filter = "all" | "active" | "archived"

function emptyDraft(): ClientInput {
  return { name: "", company: "", email: "", phone: "", notes: "", active: true }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function ClientsManager({ clients: initialClients }: { clients: ClientRow[] }) {
  const router = useRouter()
  const [items, setItems] = useState<ClientRow[]>(initialClients)
  const [draft, setDraft] = useState<ClientInput>(emptyDraft)
  const [editId, setEditId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<ClientInput>(emptyDraft)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const activeCount = items.filter((c) => c.active).length

  const visible = useMemo(() => {
    if (filter === "active") return items.filter((c) => c.active)
    if (filter === "archived") return items.filter((c) => !c.active)
    return items
  }, [items, filter])

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "Something went wrong.")
  }

  async function add(input: ClientInput) {
    setError(null)
    setSaving(true)
    try {
      const created = await createClient(input)
      if (created) {
        setItems((prev) =>
          [
            ...prev,
            {
              id: created.id,
              name: created.name,
              company: created.company,
              email: created.email,
              phone: created.phone,
              notes: created.notes,
              active: created.active,
              projectCount: 0,
              taskCount: 0,
            },
          ].sort((a, b) => a.name.localeCompare(b.name)),
        )
      }
      setDraft(emptyDraft())
      router.refresh()
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || saving) return
    await add(draft)
  }

  function startEdit(item: ClientRow) {
    setError(null)
    setDeleteId(null)
    setEditId(item.id)
    setEditDraft({
      name: item.name,
      company: item.company ?? "",
      email: item.email ?? "",
      phone: item.phone ?? "",
      notes: item.notes ?? "",
      active: item.active,
    })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (editId == null || !editDraft.name.trim() || saving) return
    setError(null)
    setSaving(true)
    try {
      await updateClient(editId, editDraft)
      const current = editDraft
      setItems((prev) =>
        prev
          .map((c) =>
            c.id === editId
              ? {
                  ...c,
                  name: current.name.trim(),
                  company: current.company?.trim() || null,
                  email: current.email?.trim() || null,
                  phone: current.phone?.trim() || null,
                  notes: current.notes?.trim() || null,
                  active: current.active !== false,
                }
              : c,
          )
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
      setEditId(null)
      router.refresh()
    } catch (err) {
      fail(err)
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(item: ClientRow) {
    setError(null)
    try {
      await setClientActive(item.id, !item.active)
      setItems((prev) => prev.map((c) => (c.id === item.id ? { ...c, active: !item.active } : c)))
      router.refresh()
    } catch (err) {
      fail(err)
    }
  }

  async function remove(item: ClientRow) {
    setError(null)
    try {
      await deleteClient(item.id)
      setItems((prev) => prev.filter((c) => c.id !== item.id))
      setDeleteId(null)
      router.refresh()
    } catch (err) {
      fail(err)
    }
  }

  const renderFields = (value: ClientInput, patch: (p: Partial<ClientInput>) => void) => (
    <>
      <div className="md:col-span-3">
        <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Name</label>
        <input
          value={value.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="e.g. Acme Studio"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
        />
      </div>
      <div className="md:col-span-3">
        <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Company</label>
        <input
          value={value.company ?? ""}
          onChange={(e) => patch({ company: e.target.value })}
          placeholder="Optional"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
        />
      </div>
      <div className="md:col-span-3">
        <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Email</label>
        <input
          type="email"
          value={value.email ?? ""}
          onChange={(e) => patch({ email: e.target.value })}
          placeholder="Optional"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
        />
      </div>
      <div className="md:col-span-2">
        <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Phone</label>
        <input
          value={value.phone ?? ""}
          onChange={(e) => patch({ phone: e.target.value })}
          placeholder="Optional"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
        />
      </div>
      <div className="flex items-end md:col-span-1">
        <label className="flex h-[38px] items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={value.active !== false}
            onChange={(e) => patch({ active: e.target.checked })}
            className="h-3.5 w-3.5 accent-[var(--gold)]"
          />
          Active
        </label>
      </div>
      <div className="md:col-span-11">
        <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">
          Internal notes
        </label>
        <input
          value={value.notes ?? ""}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Contact preferences, retouching scope, anything worth remembering"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
        />
      </div>
    </>
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="serif text-4xl text-foreground">Clients</h1>
          <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
            {items.length} client{items.length === 1 ? "" : "s"} · {activeCount} active
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <Plus className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Add a client</h2>
        </div>
        <form onSubmit={submitAdd} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          {renderFields(draft, (patch) => setDraft((d) => ({ ...d, ...patch })))}
          <div className="flex items-end md:col-span-1">
            <button
              type="submit"
              disabled={saving || !draft.name.trim()}
              className="w-full rounded-md bg-gold px-3 py-2 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted" />
            <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Your list</h2>
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-surface-2 p-0.5">
            {(["all", "active", "archived"] as Filter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded px-2.5 py-1 text-[10px] uppercase tracking-widest transition-colors ${
                  filter === value ? "bg-gold/15 text-gold" : "text-muted hover:text-foreground"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="p-10 text-center text-sm text-muted">
            {items.length === 0
              ? "No clients yet. Add one above to start linking projects and tasks."
              : `No ${filter} clients.`}
          </div>
        )}

        <ul className="divide-y divide-border">
          {visible.map((item) => {
            const editing = editId === item.id
            const confirming = deleteId === item.id
            return (
              <li key={item.id} data-client-id={item.id}>
                {editing ? (
                  <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
                    {renderFields(editDraft, (patch) => setEditDraft((d) => ({ ...d, ...patch })))}
                    <div className="flex items-center gap-1.5 md:col-span-1">
                      <button
                        type="submit"
                        disabled={saving || !editDraft.name.trim()}
                        className="rounded-md bg-gold p-2 text-background hover:bg-gold-soft disabled:opacity-50"
                        aria-label={`Save ${item.name}`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditId(null)}
                        className="rounded-md border border-border p-2 text-muted hover:text-foreground"
                        aria-label="Cancel edit"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 mono text-[10px] text-gold">
                      {initials(item.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                        {!item.active && (
                          <span className="mono rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[9px] uppercase text-muted">
                            Archived
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                        {item.company && <span className="truncate">{item.company}</span>}
                        {item.email && (
                          <span className="flex items-center gap-1 truncate">
                            <Mail className="h-3 w-3 shrink-0" /> {item.email}
                          </span>
                        )}
                        {item.phone && (
                          <span className="flex items-center gap-1 truncate">
                            <Phone className="h-3 w-3 shrink-0" /> {item.phone}
                          </span>
                        )}
                      </div>
                      {item.notes && <p className="mt-1 truncate text-[11px] text-muted/80">{item.notes}</p>}
                    </div>
                    <span className="mono rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                      {item.projectCount} project{item.projectCount === 1 ? "" : "s"}
                    </span>
                    <span className="mono rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                      {item.taskCount} task{item.taskCount === 1 ? "" : "s"}
                    </span>
                    {confirming ? (
                      <div className="flex max-w-full flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-danger">
                          Delete {item.name}?
                          {item.projectCount + item.taskCount > 0 &&
                            " Its projects and tasks will lose their client link."}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          className="rounded-md bg-danger/15 px-2 py-1 text-[11px] text-danger hover:bg-danger/25"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteId(null)}
                          className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded-md border border-border p-1.5 text-muted hover:border-gold/50 hover:text-foreground"
                          aria-label={`Edit ${item.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(item)}
                          className="rounded-md border border-border p-1.5 text-muted hover:border-gold/50 hover:text-foreground"
                          aria-label={item.active ? `Archive ${item.name}` : `Restore ${item.name}`}
                          title={item.active ? "Archive client" : "Restore client"}
                        >
                          {item.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(null)
                            setDeleteId(item.id)
                          }}
                          className="rounded-md border border-border p-1.5 text-muted hover:border-danger/50 hover:text-danger"
                          aria-label={`Delete ${item.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-[11px] text-muted">
        Clients appear in the project selector and in the assistant&apos;s context. Archiving hides a client from
        new selections without touching its projects or tasks; deleting clears their client link. Notes are
        internal only.
      </p>
    </div>
  )
}
