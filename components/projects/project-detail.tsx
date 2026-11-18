"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CalendarRange, Clock, Pencil, Plus, Trash2, ExternalLink } from "lucide-react"
import {
  PRIORITY_COLOR,
  PROJECT_STATUS_MAP,
  fmtDate,
  fmtMins,
  isOverdue,
  statusLabel,
  type ProjectStatus,
} from "@/lib/project-constants"
import { deleteProject, updateProject, type ProjectInput } from "@/lib/actions/projects"
import { createTask, deleteTask, duplicateTask, updateTask, type TaskInput } from "@/lib/actions/tasks"
import type { Client, Project, Task, WorkType } from "@/components/timeline/timeline-client"
import { TaskModal } from "@/components/timeline/task-modal"
import { ProjectModal, type ProjectFormValue } from "./project-modal"

export type ProjectDetailData = ProjectFormValue & {
  clientName: string | null
  clientCompany: string | null
  clientEmail: string | null
}

export type ProjectTaskRow = Task & {
  workTypeName: string | null
  workTypeColor: string | null
}

function addMin(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function ProjectDetail({
  project: initialProject,
  tasks: initialTasks,
  clients,
  projects,
  workTypes,
}: {
  project: ProjectDetailData
  tasks: ProjectTaskRow[]
  clients: Client[]
  projects: Project[]
  workTypes: WorkType[]
}) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectDetailData>(initialProject)
  const [items, setItems] = useState<ProjectTaskRow[]>(initialTasks)
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<ProjectTaskRow | null>(null)
  const [taskDeleteTarget, setTaskDeleteTarget] = useState<ProjectTaskRow | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    setProject(initialProject)
  }, [initialProject])

  useEffect(() => {
    setItems(initialTasks)
  }, [initialTasks])

  const status = PROJECT_STATUS_MAP[project.status] ?? PROJECT_STATUS_MAP.inquiry
  const done = items.filter((t) => t.status === "completed").length
  const pct = items.length ? Math.round((done / items.length) * 100) : 0
  const quotedMinutes = Math.round(project.estimatedHours * 60)
  const scheduledMinutes = items.filter((t) => t.scheduledDate).reduce((s, t) => s + t.estimatedMinutes, 0)
  const trackedMinutes = items.reduce((s, t) => s + t.actualMinutes, 0)
  const usedPct = quotedMinutes > 0 ? Math.round((trackedMinutes / quotedMinutes) * 100) : 0
  const overdue = isOverdue(project.deadline) && project.status !== "completed" && project.status !== "archived"

  function workTypeMeta(id: number | null) {
    const wt = id == null ? null : workTypes.find((w) => w.id === id) ?? null
    return { workTypeName: wt?.name ?? null, workTypeColor: wt?.color ?? null }
  }

  async function handleSave(input: ProjectInput) {
    try {
      await updateProject(project.id, input)
      setProject((p) => ({
        ...p,
        ...input,
        clientName: clients.find((c) => c.id === input.clientId)?.name ?? null,
      }))
      setModalOpen(false)
      router.refresh()
    } catch {
      setWarning("Could not save project.")
    }
  }

  function handleDelete() {
    setConfirmDelete(false)
    startTransition(async () => {
      try {
        // The action redirects to the board on the server.
        await deleteProject(project.id)
      } catch (err) {
        const digest =
          typeof err === "object" && err && "digest" in err
            ? String((err as { digest?: unknown }).digest)
            : ""
        if (digest.startsWith("NEXT_REDIRECT")) throw err
        setWarning("Could not delete project.")
      }
    })
  }

  function openNewTask() {
    setEditingTask(null)
    setTaskModalOpen(true)
  }

  function openTask(task: ProjectTaskRow) {
    setEditingTask(task)
    setTaskModalOpen(true)
  }

  async function saveTask(input: TaskInput) {
    try {
      if (editingTask) {
        await updateTask(editingTask.id, input)
        const meta = workTypeMeta(input.workTypeId ?? null)
        setItems((prev) =>
          prev.map((t) =>
            t.id === editingTask.id
              ? {
                  ...t,
                  ...input,
                  scheduledDate: input.scheduledDate ?? null,
                  startTime: input.startTime ?? null,
                  endTime: input.startTime ? addMin(input.startTime, input.estimatedMinutes) : null,
                  status: input.status ?? t.status,
                  ...meta,
                }
              : t,
          ),
        )
      } else {
        const created = await createTask(input)
        if (created) {
          setItems((prev) => [
            ...prev,
            { ...(created as unknown as Task), ...workTypeMeta(input.workTypeId ?? null) },
          ])
        }
      }
      setTaskModalOpen(false)
      setEditingTask(null)
      router.refresh()
    } catch {
      setWarning("Could not save task.")
    }
  }

  async function requestTaskDelete(id: number) {
    setTaskModalOpen(false)
    const task = items.find((t) => t.id === id) ?? null
    if (task) setTaskDeleteTarget(task)
  }

  async function confirmTaskDelete() {
    const task = taskDeleteTarget
    if (!task) return
    setTaskDeleteTarget(null)
    setItems((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await deleteTask(task.id)
    } catch {
      setWarning("Could not delete task.")
    }
    router.refresh()
  }

  async function duplicateTaskInProject(id: number) {
    const created = await duplicateTask(id)
    if (created) {
      setItems((prev) => [
        ...prev,
        { ...(created as unknown as Task), ...workTypeMeta((created as Task).workTypeId) },
      ])
    }
    setTaskModalOpen(false)
    setEditingTask(null)
    router.refresh()
  }

  const taskDefaults = {
    date: project.deadline || todayStr(),
    time: "09:00",
    projectId: project.id,
    clientId: project.clientId,
    area: project.area,
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Projects
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted"
            >
              {project.area === "personal" ? "Personal" : "Work"}
            </span>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
              style={{
                borderColor: status.color + "66",
                backgroundColor: status.color + "1f",
                color: status.color,
              }}
            >
              {statusLabel(project.area, project.status)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PRIORITY_COLOR[project.priority] }} />
              {project.priority} priority
            </span>
          </div>
          <h1 className="serif mt-1.5 truncate text-4xl text-foreground">{project.name}</h1>
          <p className="mono mt-1 text-xs uppercase tracking-widest text-muted">
            {project.area === "personal" ? "Personal project" : project.clientName || "No client"}
            {project.area === "work" && project.clientCompany ? ` · ${project.clientCompany}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={openNewTask}
            className="flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-soft"
          >
            <Plus className="h-3.5 w-3.5" /> Add task
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/15"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </header>

      {warning && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{warning}</div>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Meta label="Start" value={fmtDate(project.startDate)} />
        <Meta label="Deadline" value={fmtDate(project.deadline)} danger={overdue} />
        <Meta label="Estimate" value={quotedMinutes ? fmtMins(quotedMinutes) : "—"} />
        <Meta label="Scheduled" value={fmtMins(scheduledMinutes)} />
        <Meta label="Tracked" value={fmtMins(trackedMinutes)} danger={quotedMinutes > 0 && trackedMinutes > quotedMinutes} />
        <Meta label="Tasks" value={`${done}/${items.length}`} />
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Task progress</span>
          <span className="mono">
            {done}/{items.length} · {pct}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: status.color }} />
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span>Hours used vs estimate</span>
          <span className={`mono ${quotedMinutes > 0 && trackedMinutes > quotedMinutes ? "text-danger" : ""}`}>
            {fmtMins(trackedMinutes)} of {quotedMinutes ? fmtMins(quotedMinutes) : "—"}
            {quotedMinutes > 0 ? ` · ${usedPct}%` : ""}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full ${quotedMinutes > 0 && trackedMinutes > quotedMinutes ? "bg-danger" : "bg-teal"}`}
            style={{ width: `${Math.min(100, usedPct)}%` }}
          />
        </div>
      </section>

      {(project.description || project.internalNotes || (project.area === "work" && project.clientVisibleProgress)) && (
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {project.description && <TextCard title="Description" body={project.description} />}
          {project.internalNotes && <TextCard title="Notes" body={project.internalNotes} />}
          {project.area === "work" && project.clientVisibleProgress && (
            <TextCard title="Client-visible progress" body={project.clientVisibleProgress} accent />
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="serif text-xl text-foreground">Tasks</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={openNewTask}
              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
            <Link
              href={project.deadline ? `/timeline?date=${project.deadline}&view=week` : "/timeline?view=week"}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
            >
              Open timeline <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-muted">No tasks yet for this project.</p>
            <button
              onClick={openNewTask}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              Add the first task
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((t) => (
              <div
                key={t.id}
                onClick={() => openTask(t)}
                className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: t.workTypeColor || "#8a877f" }}
                  title={t.workTypeName || "No work type"}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{t.title}</div>
                  <div className="mono text-[10px] text-muted">
                    {t.workTypeName || "No work type"} · {fmtMins(t.estimatedMinutes)}
                    {t.actualMinutes ? ` · ${fmtMins(t.actualMinutes)} tracked` : ""}
                  </div>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] capitalize ${
                    t.status === "completed"
                      ? "border-teal/40 bg-teal/10 text-teal"
                      : t.status === "cancelled"
                        ? "border-danger/40 bg-danger/10 text-danger"
                        : "border-border bg-surface-2 text-muted"
                  }`}
                >
                  {t.status.replace("_", " ")}
                </span>
                {t.scheduledDate ? (
                  <Link
                    href={`/timeline?date=${t.scheduledDate}&view=day`}
                    onClick={(e) => e.stopPropagation()}
                    className="mono flex items-center gap-1 text-[10px] text-muted hover:text-gold"
                  >
                    <CalendarRange className="h-3 w-3" />
                    {fmtDate(t.scheduledDate)}
                    {t.startTime ? ` ${t.startTime}` : ""}
                  </Link>
                ) : (
                  <span className="mono flex items-center gap-1 text-[10px] text-muted/60">
                    <Clock className="h-3 w-3" /> unscheduled
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {modalOpen && (
        <ProjectModal
          project={project}
          clients={clients}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}

      {taskModalOpen && (
        <TaskModal
          task={editingTask}
          workTypes={workTypes}
          clients={clients}
          projects={projects}
          defaults={taskDefaults}
          onSave={saveTask}
          onDelete={requestTaskDelete}
          onDuplicate={duplicateTaskInProject}
          onClose={() => {
            setTaskModalOpen(false)
            setEditingTask(null)
          }}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirmDelete(false)}>
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-danger/40 bg-danger/10 p-1.5">
                <Trash2 className="h-4 w-4 text-danger" />
              </div>
              <div>
                <h2 className="serif text-xl text-foreground">Delete this project?</h2>
                <p className="mt-1 text-sm text-muted">&ldquo;{project.name}&rdquo;</p>
                <p className="mt-1 text-xs text-muted">Its tasks will be deleted too. This cannot be undone.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {taskDeleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setTaskDeleteTarget(null)}>
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border border-danger/40 bg-danger/10 p-1.5">
                <Trash2 className="h-4 w-4 text-danger" />
              </div>
              <div>
                <h2 className="serif text-xl text-foreground">Delete this task?</h2>
                <p className="mt-1 text-sm text-muted">&ldquo;{taskDeleteTarget.title}&rdquo;</p>
                <p className="mt-1 text-xs text-muted">This cannot be undone.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setTaskDeleteTarget(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={confirmTaskDelete}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Meta({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mono text-[10px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`mt-1 text-sm ${danger ? "text-danger" : "text-foreground"}`}>{value}</div>
    </div>
  )
}

function TextCard({ title, body, accent }: { title: string; body: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border bg-surface p-4 ${accent ? "border-teal/30" : "border-border"}`}>
      <div className="mono text-[10px] uppercase tracking-widest text-muted">{title}</div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/90">{body}</p>
    </div>
  )
}
