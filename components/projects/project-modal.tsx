"use client"

import { useState } from "react"
import { X } from "lucide-react"
import type { ProjectInput } from "@/lib/actions/projects"
import {
  AREA_STATUS_VALUES,
  PRIORITIES,
  PROJECT_AREAS,
  statusAllowedInArea,
  statusLabel,
  type ProjectArea,
  type ProjectStatus,
} from "@/lib/project-constants"

export type ProjectFormValue = {
  id: number
  name: string
  area: ProjectArea
  clientId: number | null
  description: string | null
  startDate: string | null
  deadline: string | null
  priority: "low" | "medium" | "high" | "urgent"
  status: ProjectStatus
  estimatedHours: number
  internalNotes: string | null
  clientVisibleProgress: string | null
}

export function ProjectModal({
  project,
  clients,
  defaults,
  onSave,
  onClose,
}: {
  project?: ProjectFormValue | null
  clients: { id: number; name: string; company: string | null }[]
  defaults?: { status?: ProjectStatus; area?: ProjectArea }
  onSave: (input: ProjectInput) => Promise<void>
  onClose: () => void
}) {
  const initialArea = project?.area ?? defaults?.area ?? "work"
  const [area, setArea] = useState<ProjectArea>(initialArea)
  const [name, setName] = useState(project?.name ?? "")
  const [clientId, setClientId] = useState<number | null>(project?.clientId ?? null)
  const [description, setDescription] = useState(project?.description ?? "")
  const [startDate, setStartDate] = useState(project?.startDate ?? "")
  const [deadline, setDeadline] = useState(project?.deadline ?? "")
  const [priority, setPriority] = useState<ProjectInput["priority"]>(project?.priority ?? "medium")
  const [status, setStatus] = useState<ProjectStatus>(() => {
    const preferred = project?.status ?? defaults?.status ?? "inquiry"
    return statusAllowedInArea(initialArea, preferred) ? preferred : "inquiry"
  })
  const [estimatedHours, setEstimatedHours] = useState(project?.estimatedHours ?? 0)
  const [internalNotes, setInternalNotes] = useState(project?.internalNotes ?? "")
  const [clientVisibleProgress, setClientVisibleProgress] = useState(project?.clientVisibleProgress ?? "")
  const [saving, setSaving] = useState(false)

  function pickArea(next: ProjectArea) {
    setArea(next)
    if (next === "personal") setClientId(null)
    if (!statusAllowedInArea(next, status)) setStatus("inquiry")
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        area,
        clientId: area === "personal" ? null : clientId,
        description: description || null,
        startDate: startDate || null,
        deadline: deadline || null,
        priority,
        status,
        estimatedHours: Number(estimatedHours) || 0,
        internalNotes: internalNotes || null,
        clientVisibleProgress: area === "personal" ? null : clientVisibleProgress || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="serif text-xl text-foreground">{project ? "Edit project" : "New project"}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="flex rounded-md border border-border bg-surface-2 p-0.5">
            {PROJECT_AREAS.map((a) => (
              <button
                key={a.value}
                type="button"
                data-area={a.value}
                onClick={() => pickArea(a.value)}
                className={`flex-1 rounded px-3 py-1.5 text-xs transition-colors ${
                  area === a.value ? "bg-gold text-background" : "text-muted hover:text-foreground"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder={area === "personal" ? "e.g. Workout week, Deep clean, Date night" : ""}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {area === "work" && (
              <div>
                <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Client</label>
                <select
                  value={clientId ?? ""}
                  onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
                >
                  <option value="">— none —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` (${c.company})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={area === "work" ? "" : "col-span-2"}>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              >
                {AREA_STATUS_VALUES[area].map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(area, s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Estimate (h)</label>
              <input
                type="number"
                min={0}
                step={1}
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as ProjectInput["priority"])}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>

          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Notes</label>
            <textarea
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>

          {area === "work" && (
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">
                Client-visible progress
              </label>
              <textarea
                value={clientVisibleProgress}
                onChange={(e) => setClientVisibleProgress(e.target.value)}
                rows={2}
                placeholder="What the client sees on the shared view"
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold placeholder:text-muted/60"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
            >
              {saving ? "Saving…" : project ? "Save changes" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
