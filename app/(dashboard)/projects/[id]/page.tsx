import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { projects, clients, tasks, workTypes } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { ProjectDetail, type ProjectDetailData, type ProjectTaskRow } from "@/components/projects/project-detail"
import { PROJECT_STATUS_MAP, type ProjectStatus } from "@/lib/project-constants"
import type { Task, WorkType, Client, Project } from "@/components/timeline/timeline-client"

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const projectId = Number(id)
  if (!Number.isInteger(projectId) || projectId <= 0) notFound()

  const [row] = await db
    .select({
      project: projects,
      clientName: clients.name,
      clientCompany: clients.company,
      clientEmail: clients.email,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, projectId))

  if (!row) notFound()

  const [taskRows, clientRows, projectRows, workTypeRows] = await Promise.all([
    db
      .select({
        task: tasks,
        workTypeName: workTypes.name,
        workTypeColor: workTypes.color,
      })
      .from(tasks)
      .leftJoin(workTypes, eq(tasks.workTypeId, workTypes.id))
      .where(eq(tasks.projectId, projectId)),
    db.select().from(clients).orderBy(clients.name),
    db.select().from(projects).orderBy(projects.name),
    db.select().from(workTypes).orderBy(workTypes.name),
  ])

  const p = row.project
  const project: ProjectDetailData = {
    id: p.id,
    name: p.name,
    area: p.area,
    clientId: p.clientId,
    description: p.description,
    startDate: p.startDate,
    deadline: p.deadline,
    priority: p.priority,
    status: (PROJECT_STATUS_MAP[p.status as ProjectStatus] ? p.status : "inquiry") as ProjectStatus,
    estimatedHours: p.estimatedHours,
    internalNotes: p.internalNotes,
    clientVisibleProgress: p.clientVisibleProgress,
    clientName: row.clientName,
    clientCompany: row.clientCompany,
    clientEmail: row.clientEmail,
  }

  const projectTasks: ProjectTaskRow[] = taskRows
    .map((r) => {
      const t = r.task
      const task: Task = {
        id: t.id,
        projectId: t.projectId,
        clientId: t.clientId,
        workTypeId: t.workTypeId,
        title: t.title,
        description: t.description,
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes,
        scheduledDate: t.scheduledDate,
        startTime: t.startTime,
        endTime: t.endTime,
        deadline: t.deadline,
        priority: t.priority,
        status: t.status,
        clientVisibleNotes: t.clientVisibleNotes,
        referenceUrl: t.referenceUrl,
      }
      return { ...task, workTypeName: r.workTypeName, workTypeColor: r.workTypeColor }
    })
    .sort((a, b) => {
      if (a.scheduledDate && b.scheduledDate) {
        return (a.scheduledDate + (a.startTime || "")).localeCompare(b.scheduledDate + (b.startTime || ""))
      }
      if (a.scheduledDate) return -1
      if (b.scheduledDate) return 1
      return a.title.localeCompare(b.title)
    })

  const clientOptions: Client[] = clientRows.map((c) => ({ id: c.id, name: c.name, company: c.company }))
  const projectOptions: Project[] = projectRows.map((pr) => ({
    id: pr.id,
    name: pr.name,
    clientId: pr.clientId,
    area: pr.area,
  }))
  const workTypeOptions: WorkType[] = workTypeRows.map((w) => ({
    id: w.id,
    name: w.name,
    defaultDuration: w.defaultDuration,
    color: w.color,
    description: w.description,
  }))

  return (
    <ProjectDetail
      project={project}
      tasks={projectTasks}
      clients={clientOptions}
      projects={projectOptions}
      workTypes={workTypeOptions}
    />
  )
}
