"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import type { Task, WorkType, Client, Project } from "./timeline-client"
import type { TaskInput } from "@/lib/actions/tasks"
import { PROJECT_AREAS, type ProjectArea } from "@/lib/project-constants"

const PRIORITIES = ["low", "medium", "high", "urgent"] as const
const STATUSES = ["scheduled", "in_progress", "paused", "completed", "cancelled"] as const

export function TaskModal({
  task,
  workTypes,
  clients,
  projects,
  defaults,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}: {
  task: Task | null
  workTypes: WorkType[]
  clients: Client[]
  projects: Project[]
  defaults: { date?: string; time?: string; projectId?: number | null; clientId?: number | null; area?: ProjectArea }
  onSave: (input: TaskInput) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onDuplicate?: (id: number) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(task?.title || "")
  const [workTypeId, setWorkTypeId] = useState<number | null>(task?.workTypeId ?? null)
  const [area, setArea] = useState<ProjectArea>(() => {
    const projectIdForArea = task?.projectId ?? defaults.projectId ?? null
    const project = projects.find((p) => p.id === projectIdForArea)
    return project?.area ?? defaults.area ?? "work"
  })
  const [clientId, setClientId] = useState<number | null>(task?.clientId ?? defaults.clientId ?? null)
  const [projectId, setProjectId] = useState<number | null>(task?.projectId ?? defaults.projectId ?? null)
  const [estimated, setEstimated] = useState(task?.estimatedMinutes ?? 60)
  const [date, setDate] = useState(task?.scheduledDate ?? defaults.date ?? "")
  const [time, setTime] = useState(task?.startTime ?? defaults.time ?? "")
  const [deadline, setDeadline] = useState(task?.deadline ?? "")
  const [priority, setPriority] = useState<TaskInput["priority"]>(task?.priority ?? "medium")
  const [status, setStatus] = useState<TaskInput["status"]>(task?.status ?? "scheduled")
  const [notes, setNotes] = useState(task?.clientVisibleNotes ?? "")
  const [refUrl, setRefUrl] = useState(task?.referenceUrl ?? "")
  const [desc, setDesc] = useState(task?.description ?? "")
  const [saving, setSaving] = useState(false)

  // auto-fill duration when work type changes (only if not editing existing)
  useEffect(() => {
    if (!task && workTypeId) {
      const wt = workTypes.find((w) => w.id === workTypeId)
      if (wt) setEstimated(wt.defaultDuration)
    }
  }, [workTypeId, task, workTypes])

  // auto-set status based on schedule
  useEffect(() => {
    if (date && time) setStatus((s: TaskInput["status"]) => (s === "backlog" ? "scheduled" : s))
  }, [date, time])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    await onSave({
      title: title.trim(),
      projectId,
      clientId: area === "personal" ? null : clientId,
      workTypeId,
      estimatedMinutes: estimated,
      scheduledDate: date || null,
      startTime: time || null,
      deadline: deadline || null,
      priority,
      status,
      clientVisibleNotes: notes || null,
      referenceUrl: refUrl || null,
      description: desc || null,
    })
    setSaving(false)
  }

  function pickArea(next: ProjectArea) {
    setArea(next)
    if (next === "personal") setClientId(null)
    const selected = projects.find((p) => p.id === projectId)
    if (selected && selected.area !== next) setProjectId(null)
  }

  const areaProjects = projects.filter((p) => p.area === area)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="serif text-xl text-foreground">{task ? "Edit task" : "New task"}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="flex rounded-md border border-border bg-surface-2 p-0.5">
            {PROJECT_AREAS.map((a) => (
              <button
                key={a.value}
                type="button"
                data-task-area={a.value}
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
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Work type</label>
              <select
                value={workTypeId ?? ""}
                onChange={(e) => setWorkTypeId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              >
                <option value="">— none —</option>
                {workTypes.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Estimated (min)</label>
              <input
                type="number"
                min={15}
                step={15}
                value={estimated}
                onChange={(e) => setEstimated(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              />
            </div>
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
                    <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div className={area === "work" ? "" : "col-span-2"}>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Project</label>
              <select
                value={projectId ?? ""}
                onChange={(e) => {
                  const nextId = e.target.value ? Number(e.target.value) : null
                  setProjectId(nextId)
                  const nextProject = projects.find((p) => p.id === nextId)
                  if (nextProject?.clientId) setClientId(nextProject.clientId)
                }}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              >
                <option value="">— none —</option>
                {areaProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              />
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Start</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskInput["priority"])}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskInput["status"])}
                className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">
              {area === "personal" ? "Notes" : "Client-visible notes"}
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Reference URL</label>
            <input
              type="url"
              value={refUrl}
              onChange={(e) => setRefUrl(e.target.value)}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div>
            <label className="mono text-[10px] uppercase tracking-widest text-muted block mb-1">Internal description</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:outline-none focus:border-gold"
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            {task && (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => onDelete(task.id)}
                  className="text-xs text-danger hover:underline"
                >
                  Delete
                </button>
                {onDuplicate && (
                  <button
                    type="button"
                    onClick={() => onDuplicate(task.id)}
                    className="text-xs text-muted hover:text-foreground hover:underline"
                  >
                    Duplicate
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}