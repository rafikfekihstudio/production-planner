"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Palette, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react"
import {
  createWorkType,
  deleteWorkType,
  updateWorkType,
  type WorkTypeInput,
} from "@/lib/actions/work-types"

export type WorkTypeRow = {
  id: number
  name: string
  defaultDuration: number
  color: string
  description: string | null
}

const PERSONAL_PRESETS: WorkTypeInput[] = [
  { name: "Workout", defaultDuration: 60, color: "#4a9b8e", description: "Training session" },
  { name: "Cleaning", defaultDuration: 90, color: "#c9a961", description: "House cleaning" },
  { name: "Errands", defaultDuration: 60, color: "#8a9bb0", description: "Shopping, admin, appointments" },
  { name: "Date", defaultDuration: 120, color: "#b08aa8", description: "Date night" },
]

const FALLBACK_COLOR = "#c9a961"

function emptyDraft(): WorkTypeInput {
  return { name: "", defaultDuration: 60, color: FALLBACK_COLOR, description: "" }
}

export function WorkTypesManager({
  workTypes: initialWorkTypes,
  usage,
}: {
  workTypes: WorkTypeRow[]
  usage: Record<number, number>
}) {
  const router = useRouter()
  const [items, setItems] = useState<WorkTypeRow[]>(initialWorkTypes)
  const [draft, setDraft] = useState<WorkTypeInput>(emptyDraft)
  const [editId, setEditId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<WorkTypeInput>(emptyDraft)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [, startTransition] = useTransition()

  const existingNames = useMemo(
    () => new Set(items.map((w) => w.name.toLowerCase())),
    [items],
  )

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "Something went wrong.")
  }

  async function add(input: WorkTypeInput) {
    setError(null)
    setSaving(true)
    try {
      const created = await createWorkType(input)
      if (created) {
        setItems((prev) =>
          [...prev, created as WorkTypeRow].sort((a, b) => a.name.localeCompare(b.name)),
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
    await add({ ...draft, description: draft.description || null })
  }

  function startEdit(item: WorkTypeRow) {
    setDeleteId(null)
    setEditId(item.id)
    setEditDraft({
      name: item.name,
      defaultDuration: item.defaultDuration,
      color: item.color,
      description: item.description ?? "",
    })
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (editId == null || !editDraft.name.trim() || saving) return
    setError(null)
    setSaving(true)
    try {
      await updateWorkType(editId, { ...editDraft, description: editDraft.description || null })
      setItems((prev) =>
        prev
          .map((w) =>
            w.id === editId
              ? {
                  ...w,
                  name: editDraft.name.trim(),
                  defaultDuration: Number(editDraft.defaultDuration) || 60,
                  color: editDraft.color,
                  description: editDraft.description || null,
                }
              : w,
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

  function remove(id: number) {
    setError(null)
    startTransition(async () => {
      try {
        await deleteWorkType(id)
        setItems((prev) => prev.filter((w) => w.id !== id))
        setDeleteId(null)
        router.refresh()
      } catch (err) {
        fail(err)
      }
    })
  }

  const presetsToOffer = PERSONAL_PRESETS.filter(
    (p) => !existingNames.has(p.name.toLowerCase()),
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="serif text-4xl text-foreground">Work Types</h1>
          <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
            {items.length} types · tags and colours for scheduled tasks
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
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Add a work type</h2>
        </div>
        <form onSubmit={submitAdd} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Workout, Editing, Errands"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Minutes</label>
            <input
              type="number"
              min={15}
              step={15}
              value={draft.defaultDuration}
              onChange={(e) => setDraft((d) => ({ ...d, defaultDuration: Number(e.target.value) }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Colour</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-1">
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                aria-label="Work type colour"
              />
              <span className="mono text-[10px] uppercase text-muted">{draft.color}</span>
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Description</label>
            <input
              value={draft.description ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Optional"
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
            />
          </div>
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

        {presetsToOffer.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted">
              <Sparkles className="h-3 w-3 text-gold" /> Personal presets
            </span>
            {presetsToOffer.map((preset) => (
              <button
                key={preset.name}
                type="button"
                disabled={saving}
                onClick={() => add(preset)}
                className="group flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] text-muted transition-colors hover:border-gold/50 hover:text-foreground disabled:opacity-50"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: preset.color }} />
                {preset.name}
                <Plus className="h-3 w-3 opacity-60 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Palette className="h-3.5 w-3.5 text-muted" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Your list</h2>
        </div>

        {items.length === 0 && (
          <div className="p-10 text-center text-sm text-muted">
            No work types yet. Add one above or use a personal preset.
          </div>
        )}

        <ul className="divide-y divide-border">
          {items.map((item) => {
            const editing = editId === item.id
            const confirming = deleteId === item.id
            const count = usage[item.id] ?? 0
            return (
              <li key={item.id} data-work-type-id={item.id}>
                {editing ? (
                  <form onSubmit={saveEdit} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-12">
                    <div className="md:col-span-4">
                      <input
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <input
                        type="number"
                        min={15}
                        step={15}
                        value={editDraft.defaultDuration}
                        onChange={(e) =>
                          setEditDraft((d) => ({ ...d, defaultDuration: Number(e.target.value) }))
                        }
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <div className="flex h-[38px] items-center gap-2 rounded-md border border-border bg-surface-2 px-2">
                        <input
                          type="color"
                          value={editDraft.color}
                          onChange={(e) => setEditDraft((d) => ({ ...d, color: e.target.value }))}
                          className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                        />
                        <span className="mono text-[10px] uppercase text-muted">{editDraft.color}</span>
                      </div>
                    </div>
                    <div className="md:col-span-3">
                      <input
                        value={editDraft.description ?? ""}
                        onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                        placeholder="Optional"
                        className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 md:col-span-1">
                      <button
                        type="submit"
                        disabled={saving || !editDraft.name.trim()}
                        className="rounded-md bg-gold p-2 text-background hover:bg-gold-soft disabled:opacity-50"
                        aria-label="Save work type"
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
                    <span
                      className="h-8 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{item.name}</span>
                        <span className="mono rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                          {item.defaultDuration} min
                        </span>
                      </div>
                      {item.description && (
                        <p className="truncate text-[11px] text-muted">{item.description}</p>
                      )}
                    </div>
                    <span className="mono text-[10px] text-muted">
                      {count} {count === 1 ? "task" : "tasks"}
                    </span>
                    {confirming ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-danger">Delete?</span>
                        <button
                          type="button"
                          onClick={() => remove(item.id)}
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
        Work types tag tasks on the timeline and set their colour. Deleting a type keeps the tasks and
        clears their tag.
      </p>
    </div>
  )
}
