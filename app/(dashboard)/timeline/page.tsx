import { db } from "@/lib/db"
import { tasks, workTypes, clients, projects } from "@/lib/db/schema"
import { gte, lte, isNull, or } from "drizzle-orm"
import { TimelineClient } from "@/components/timeline/timeline-client"

function weekBounds(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  const day = d.getDay() // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day // Monday start
  const start = new Date(d)
  start.setDate(d.getDate() + diff)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`
  return { start: fmt(start), end: fmt(end) }
}

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const sp = await searchParams
  const _d = new Date(); const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`
  const date = sp.date || today
  const view = sp.view === "day" ? "day" : "week"
  const { start, end } = weekBounds(date)

  const [allTasks, allWorkTypes, allClients, allProjects] = await Promise.all([
    db.select().from(tasks).all(),
    db.select().from(workTypes).all(),
    db.select().from(clients).all(),
    db.select().from(projects).all(),
  ])

  // filter tasks to the visible window for scheduled, plus all backlog
  const visibleTasks = allTasks.filter((t) => {
    if (t.status === "backlog" || !t.scheduledDate) return true
    return t.scheduledDate >= start && t.scheduledDate <= end
  })

  return (
    <TimelineClient
      view={view}
      anchorDate={date}
      weekStart={start}
      weekEnd={end}
      tasks={visibleTasks}
      workTypes={allWorkTypes}
      clients={allClients}
      projects={allProjects}
    />
  )
}