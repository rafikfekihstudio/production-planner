import Link from "next/link"
import { db } from "@/lib/db"
import { projects, tasks, clients } from "@/lib/db/schema"
import { fmtMins, fmtDate, isOverdue, PROJECT_STATUS_MAP, type ProjectStatus } from "@/lib/project-constants"

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysUntil(date: string): number {
  const target = new Date(date + "T00:00:00")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default async function OverviewPage() {
  const now = new Date()
  const today = fmtDay(now)
  const monday = new Date(now)
  const dow = monday.getDay()
  monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow))
  monday.setHours(0, 0, 0, 0)
  const weekStart = fmtDay(monday)
  const weekEndDate = new Date(monday)
  weekEndDate.setDate(monday.getDate() + 6)
  const weekEnd = fmtDay(weekEndDate)

  const [allTasks, allProjects, allClients] = await Promise.all([
    db.select().from(tasks).all(),
    db.select().from(projects).all(),
    db.select({ id: clients.id, name: clients.name }).from(clients).all(),
  ])

  const clientName = new Map(allClients.map((c) => [c.id, c.name]))
  const projectById = new Map(allProjects.map((p) => [p.id, p]))

  const isOpen = (s: string) => s !== "completed" && s !== "cancelled"
  const activeProjects = allProjects.filter((p) => p.status !== "completed" && p.status !== "archived")
  const openTasks = allTasks.filter((t) => isOpen(t.status))

  const todayTasks = allTasks
    .filter((t) => t.scheduledDate === today && isOpen(t.status))
    .sort((a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99"))

  const weekTasks = allTasks.filter(
    (t) => t.scheduledDate && t.scheduledDate >= weekStart && t.scheduledDate <= weekEnd,
  )
  const weekPlannedMinutes = weekTasks.reduce((s, t) => s + t.estimatedMinutes, 0)
  const weekTrackedMinutes = weekTasks.reduce((s, t) => s + t.actualMinutes, 0)
  const todayPlannedMinutes = todayTasks.reduce((s, t) => s + t.estimatedMinutes, 0)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const key = fmtDay(d)
    const dayTasks = weekTasks.filter((t) => t.scheduledDate === key)
    return {
      key,
      label: d.toLocaleDateString("en-GB", { weekday: "short" }),
      dayNum: d.getDate(),
      minutes: dayTasks.reduce((s, t) => s + t.estimatedMinutes, 0),
      count: dayTasks.length,
      isToday: key === today,
      isPast: key < today,
    }
  })
  const maxDayMinutes = Math.max(60, ...weekDays.map((d) => d.minutes))

  const deadlines = allProjects
    .filter((p) => p.deadline && p.status !== "completed" && p.status !== "archived")
    .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""))
    .slice(0, 6)

  const overdueCount = deadlines.filter((p) => isOverdue(p.deadline)).length

  const stats = [
    { label: "Active projects", value: activeProjects.length, href: "/projects" },
    { label: "Open tasks", value: openTasks.length, href: "/timeline" },
    { label: "Planned this week", value: fmtMins(weekPlannedMinutes), href: "/timeline" },
    { label: "Overdue deadlines", value: overdueCount, href: "/projects", danger: overdueCount > 0 },
  ]

  return (
    <div className="space-y-8">
      <header className="border-b border-border pb-4">
        <h1 className="serif text-4xl text-foreground">Overview</h1>
        <p className="mono mt-1 text-xs uppercase tracking-widest text-muted">
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-gold/50"
          >
            <div className="mono text-[10px] uppercase tracking-widest text-muted">{s.label}</div>
            <div className={`serif mt-2 text-3xl ${s.danger ? "text-danger" : "text-foreground"}`}>{s.value}</div>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="serif text-xl text-foreground">Today</h2>
            <span className="mono text-[10px] uppercase tracking-widest text-muted">
              {todayTasks.length} {todayTasks.length === 1 ? "task" : "tasks"} · {fmtMins(todayPlannedMinutes)}
            </span>
          </div>
          <Link
            href={`/timeline?date=${today}&view=day`}
            className="mono text-[10px] uppercase tracking-widest text-muted hover:text-gold"
          >
            Open day view →
          </Link>
        </div>

        {todayTasks.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted">
            Nothing scheduled today.{" "}
            <Link href="/timeline" className="text-gold hover:underline">
              Open the timeline
            </Link>{" "}
            to plan the day.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {todayTasks.map((t) => {
              const project = t.projectId ? projectById.get(t.projectId) : null
              const status = project ? PROJECT_STATUS_MAP[project.status as ProjectStatus] : null
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="mono w-24 shrink-0 text-xs text-muted">
                    {t.startTime || "—"}
                    {t.endTime ? ` – ${t.endTime}` : ""}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{t.title}</div>
                    <div className="mono text-[10px] text-muted">
                      {project ? project.name : "No project"}
                      {t.clientId ? ` · ${clientName.get(t.clientId) || "Client"}` : ""}
                    </div>
                  </div>
                  {status && (
                    <span
                      className="rounded-full border px-2 py-0.5 text-[10px]"
                      style={{
                        borderColor: status.color + "66",
                        backgroundColor: status.color + "1f",
                        color: status.color,
                      }}
                    >
                      {status.label}
                    </span>
                  )}
                  <span className="mono text-[10px] text-muted">{fmtMins(t.estimatedMinutes)}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-baseline gap-3">
            <h2 className="serif text-xl text-foreground">This week</h2>
            <span className="mono text-[10px] uppercase tracking-widest text-muted">
              {fmtMins(weekPlannedMinutes)} planned · {fmtMins(weekTrackedMinutes)} tracked
            </span>
          </div>
          <Link
            href={`/timeline?date=${today}&view=week`}
            className="mono text-[10px] uppercase tracking-widest text-muted hover:text-gold"
          >
            Open week view →
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-2 p-4">
          {weekDays.map((d) => (
            <Link
              key={d.key}
              href={`/timeline?date=${d.key}&view=day`}
              className={`group rounded-md border px-2 py-2 transition-colors ${
                d.isToday ? "border-gold/60 bg-gold/5" : "border-border/70 hover:border-gold/40"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="mono text-[10px] uppercase tracking-widest text-muted">{d.label}</span>
                <span className={`mono text-[10px] ${d.isToday ? "text-gold" : "text-muted"}`}>{d.dayNum}</span>
              </div>
              <div className="mt-2 flex h-14 items-end">
                <div
                  className={`w-full rounded-sm ${
                    d.isToday ? "bg-gold/70" : d.isPast ? "bg-muted/30" : "bg-teal/60"
                  }`}
                  style={{ height: `${Math.max(d.minutes > 0 ? 6 : 2, (d.minutes / maxDayMinutes) * 100)}%` }}
                />
              </div>
              <div className="mono mt-1 text-[10px] text-muted">{d.minutes ? fmtMins(d.minutes) : "—"}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="serif text-xl text-foreground">Deadlines</h2>
          <Link href="/projects" className="mono text-[10px] uppercase tracking-widest text-muted hover:text-gold">
            All projects →
          </Link>
        </div>

        {deadlines.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted">
            No deadlines set.{" "}
            <Link href="/projects" className="text-gold hover:underline">
              Add one to a project
            </Link>{" "}
            to see it here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {deadlines.map((p) => {
              const left = p.deadline ? daysUntil(p.deadline) : null
              const late = isOverdue(p.deadline)
              const soon = !late && left !== null && left <= 3
              const status = PROJECT_STATUS_MAP[p.status as ProjectStatus]
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span className={`mono w-16 shrink-0 text-xs ${late ? "text-danger" : "text-muted"}`}>
                    {fmtDate(p.deadline)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{p.name}</div>
                    <div className="mono text-[10px] text-muted">
                      {clientName.get(p.clientId ?? -1) || "No client"} · {status?.label || p.status}
                    </div>
                  </div>
                  <span
                    className={`mono text-[10px] ${
                      late ? "text-danger" : soon ? "text-gold" : "text-muted"
                    }`}
                  >
                    {late
                      ? `${Math.abs(left ?? 0)}d overdue`
                      : left === 0
                        ? "due today"
                        : `${left}d left`}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
