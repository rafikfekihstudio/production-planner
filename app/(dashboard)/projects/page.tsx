import { db } from "@/lib/db"
import { projects, clients, tasks } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { ProjectsBoard, type ProjectBoardItem } from "@/components/projects/projects-board"
import { PROJECT_STATUS_MAP, type ProjectStatus } from "@/lib/project-constants"

export default async function ProjectsPage() {
  const [rows, clientRows, taskRows] = await Promise.all([
    db
      .select({
        project: projects,
        clientName: clients.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .orderBy(projects.createdAt),
    db
      .select({ id: clients.id, name: clients.name, company: clients.company })
      .from(clients)
      .orderBy(clients.name),
    db
      .select({
        projectId: tasks.projectId,
        status: tasks.status,
        estimatedMinutes: tasks.estimatedMinutes,
        actualMinutes: tasks.actualMinutes,
        scheduledDate: tasks.scheduledDate,
      })
      .from(tasks),
  ])

  const agg = new Map<
    number,
    { total: number; done: number; scheduledMinutes: number; trackedMinutes: number }
  >()
  for (const t of taskRows) {
    if (t.projectId == null) continue
    const current = agg.get(t.projectId) ?? {
      total: 0,
      done: 0,
      scheduledMinutes: 0,
      trackedMinutes: 0,
    }
    current.total += 1
    if (t.status === "completed") current.done += 1
    if (t.scheduledDate) current.scheduledMinutes += t.estimatedMinutes
    current.trackedMinutes += t.actualMinutes
    agg.set(t.projectId, current)
  }

  const items: ProjectBoardItem[] = rows.map(({ project, clientName }) => {
    const a = agg.get(project.id)
    return {
      id: project.id,
      name: project.name,
      area: project.area,
      clientId: project.clientId,
      description: project.description,
      startDate: project.startDate,
      deadline: project.deadline,
      priority: project.priority,
      status: (PROJECT_STATUS_MAP[project.status as ProjectStatus] ? project.status : "inquiry") as ProjectStatus,
      estimatedHours: project.estimatedHours,
      internalNotes: project.internalNotes,
      clientVisibleProgress: project.clientVisibleProgress,
      clientName: clientName ?? null,
      tasksTotal: a?.total ?? 0,
      tasksDone: a?.done ?? 0,
      scheduledMinutes: a?.scheduledMinutes ?? 0,
      trackedMinutes: a?.trackedMinutes ?? 0,
    }
  })

  return <ProjectsBoard projects={items} clients={clientRows} />
}
