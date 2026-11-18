"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Users } from "lucide-react"
import {
  AREA_STATUS_VALUES,
  PRIORITY_COLOR,
  PROJECT_AREAS,
  PROJECT_STATUS_MAP,
  fmtDate,
  fmtMins,
  isOverdue,
  statusLabel,
  type ProjectArea,
  type ProjectStatus,
} from "@/lib/project-constants"
import { createProject, setProjectStatus, updateProject, type ProjectInput } from "@/lib/actions/projects"
import { ProjectModal, type ProjectFormValue } from "./project-modal"

export type ProjectBoardItem = ProjectFormValue & {
  clientName: string | null
  tasksTotal: number
  tasksDone: number
  scheduledMinutes: number
  trackedMinutes: number
}

type ClientOption = { id: number; name: string; company: string | null }

export function ProjectsBoard({
  projects: initialProjects,
  clients,
}: {
  projects: ProjectBoardItem[]
  clients: ClientOption[]
}) {
  const router = useRouter()
  const [items, setItems] = useState<ProjectBoardItem[]>(initialProjects)
  const [area, setArea] = useState<ProjectArea>("work")
  const [query, setQuery] = useState("")
  const [clientFilter, setClientFilter] = useState<number | "all">("all")
  const [dragId, setDragId] = useState<number | null>(null)
  const [overStatus, setOverStatus] = useState<ProjectStatus | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectBoardItem | null>(null)
  const [defaultStatus, setDefaultStatus] = useState<ProjectStatus>("inquiry")
  const [warning, setWarning] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const draggedRef = useRef(false)

  useEffect(() => {
    setItems(initialProjects)
  }, [initialProjects])

  function showWarning(msg: string) {
    setWarning(msg)
    setTimeout(() => setWarning(null), 3000)
  }

  const areaItems = useMemo(() => items.filter((p) => p.area === area), [items, area])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return areaItems.filter((p) => {
      if (area === "work" && clientFilter !== "all" && p.clientId !== clientFilter) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.clientName || "").toLowerCase().includes(q)
    })
  }, [areaItems, area, query, clientFilter])

  const byStatus = useMemo(() => {
    const map = new Map<ProjectStatus, ProjectBoardItem[]>()
    for (const s of AREA_STATUS_VALUES[area]) map.set(s, [])
    for (const p of filtered) {
      const bucket = map.get(p.status)
      if (bucket) bucket.push(p)
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline)
        if (a.deadline) return -1
        if (b.deadline) return 1
        return a.name.localeCompare(b.name)
      })
    }
    return map
  }, [filtered, area])

  function switchArea(next: ProjectArea) {
    setArea(next)
    setClientFilter("all")
    setOverStatus(null)
  }

  function openCreate(status: ProjectStatus) {
    setDefaultStatus(status)
    setEditing(null)
    setModalOpen(true)
  }

  async function handleSave(input: ProjectInput) {
    try {
      if (editing) {
        await updateProject(editing.id, input)
        setItems((prev) =>
          prev.map((p) =>
            p.id === editing.id
              ? {
                  ...p,
                  ...input,
                  area: input.area ?? p.area,
                  clientName: clients.find((c) => c.id === input.clientId)?.name ?? null,
                  status: input.status ?? p.status,
                }
              : p,
          ),
        )
      } else {
        const created = await createProject(input)
        if (created) {
          setItems((prev) => [
            ...prev,
            {
              ...(created as unknown as ProjectFormValue),
              clientName: clients.find((c) => c.id === input.clientId)?.name ?? null,
              tasksTotal: 0,
              tasksDone: 0,
              scheduledMinutes: 0,
              trackedMinutes: 0,
            },
          ])
        }
      }
      setModalOpen(false)
      setEditing(null)
      router.refresh()
    } catch {
      showWarning("Could not save project.")
    }
  }

  function moveTo(id: number, status: ProjectStatus) {
    const current = items.find((p) => p.id === id)
    if (!current || current.status === status) return
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)))
    startTransition(async () => {
      try {
        await setProjectStatus(id, status)
      } catch {
        showWarning("Could not move project.")
        router.refresh()
      }
    })
  }

  function onDrop(e: React.DragEvent, status: ProjectStatus) {
    e.preventDefault()
    const raw = e.dataTransfer.getData("text/plain")
    const id = Number(raw) || dragId
    setOverStatus(null)
    setDragId(null)
    if (id) moveTo(id, status)
  }

  const columns = AREA_STATUS_VALUES[area].map((value) => ({
    value,
    label: statusLabel(area, value),
    color: PROJECT_STATUS_MAP[value].color,
  }))

  const activeCount = areaItems.filter((p) => p.status !== "archived" && p.status !== "completed").length
  const areaCounts = Object.fromEntries(
    PROJECT_AREAS.map((a) => [a.value, items.filter((p) => p.area === a.value).length]),
  ) as Record<ProjectArea, number>

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="serif text-4xl text-foreground">Projects</h1>
          <p className="mono text-xs text-muted mt-1 uppercase tracking-widest">
            {areaItems.length} total · {activeCount} active
          </p>
        </div>
        <button
          onClick={() => openCreate("inquiry")}
          className="flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-background hover:bg-gold-soft"
        >
          <Plus className="h-3.5 w-3.5" /> New {area === "personal" ? "personal" : ""} project
        </button>
      </header>

      {warning && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{warning}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          {PROJECT_AREAS.map((a) => (
            <button
              key={a.value}
              data-area-tab={a.value}
              onClick={() => switchArea(a.value)}
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                area === a.value ? "bg-gold text-background" : "text-muted hover:text-foreground"
              }`}
            >
              {a.label}
              <span className={`mono ml-1.5 text-[10px] ${area === a.value ? "text-background/70" : "text-muted/70"}`}>
                {areaCounts[a.value]}
              </span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={area === "personal" ? "Search personal projects" : "Search projects or clients"}
            className="w-56 rounded-md border border-border bg-surface px-2.5 py-1.5 pl-8 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:border-gold"
          />
        </div>

        {area === "work" && clients.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted" />
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-gold"
            >
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {(query || clientFilter !== "all") && (
          <button
            onClick={() => {
              setQuery("")
              setClientFilter("all")
            }}
            className="text-xs text-muted hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const cards = byStatus.get(col.value) || []
          const isOver = overStatus === col.value
          return (
            <section
              key={col.value}
              data-status={col.value}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                if (overStatus !== col.value) setOverStatus(col.value)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setOverStatus((s) => (s === col.value ? null : s))
                }
              }}
              onDrop={(e) => onDrop(e, col.value)}
              className={`flex w-[248px] shrink-0 flex-col rounded-lg border bg-surface transition-colors ${
                isOver ? "border-gold/70 bg-surface-2" : "border-border"
              } ${col.value === "archived" ? "opacity-80" : ""}`}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: col.color }} />
                  <span className="mono text-[10px] uppercase tracking-widest text-muted">{col.label}</span>
                </div>
                <span className="mono text-[10px] text-muted">{cards.length}</span>
              </div>

              <div className="flex min-h-[140px] flex-1 flex-col gap-2 p-2">
                {cards.map((p) => {
                  const status = PROJECT_STATUS_MAP[p.status]
                  const pct = p.tasksTotal ? Math.round((p.tasksDone / p.tasksTotal) * 100) : 0
                  const overdue = isOverdue(p.deadline) && p.status !== "completed" && p.status !== "archived"
                  return (
                    <article
                      key={p.id}
                      draggable
                      data-project-id={p.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(p.id))
                        e.dataTransfer.effectAllowed = "move"
                        draggedRef.current = true
                        setDragId(p.id)
                      }}
                      onDragEnd={() => {
                        setDragId(null)
                        setOverStatus(null)
                        setTimeout(() => {
                          draggedRef.current = false
                        }, 50)
                      }}
                      onClick={() => {
                        if (draggedRef.current) return
                        router.push(`/projects/${p.id}`)
                      }}
                      className={`group cursor-pointer rounded-md border border-border/70 bg-surface-2 p-2.5 transition-colors hover:border-gold/50 ${
                        dragId === p.id ? "opacity-50" : ""
                      }`}
                      style={{ borderLeft: `2px solid ${status.color}` }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-medium leading-tight text-foreground line-clamp-2">{p.name}</h3>
                        <span
                          className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: PRIORITY_COLOR[p.priority] }}
                          title={`${p.priority} priority`}
                        />
                      </div>
                      <div className="mono mt-0.5 truncate text-[10px] text-muted">
                        {p.clientName || (p.area === "personal" ? "Personal" : "No client")}
                      </div>

                      {p.description && (
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted/80">{p.description}</p>
                      )}

                      <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] text-muted">
                          <span>
                            {p.tasksDone}/{p.tasksTotal} tasks
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: status.color }}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px]">
                        <span className={overdue ? "text-danger" : "text-muted"}>
                          {p.deadline ? `${overdue ? "Overdue · " : "Due "}${fmtDate(p.deadline)}` : "No deadline"}
                        </span>
                        <span className="mono text-muted" title="scheduled / estimated">
                          {fmtMins(p.scheduledMinutes)} /{" "}
                          {p.estimatedHours > 0 ? fmtMins(Math.round(p.estimatedHours * 60)) : "—"}
                        </span>
                      </div>
                    </article>
                  )
                })}

                {cards.length === 0 && (
                  <button
                    onClick={() => openCreate(col.value)}
                    className={`flex flex-1 items-center justify-center rounded-md border border-dashed border-border/70 py-6 text-[11px] transition-colors ${
                      isOver ? "border-gold/60 text-gold" : "text-muted/70 hover:border-gold/40 hover:text-muted"
                    }`}
                  >
                    {isOver ? "Drop here" : "+ Add project"}
                  </button>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {modalOpen && (
        <ProjectModal
          project={editing}
          clients={clients}
          defaults={{ status: defaultStatus, area }}
          onSave={handleSave}
          onClose={() => {
            setModalOpen(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
