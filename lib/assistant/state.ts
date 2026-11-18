import { db } from "@/lib/db"
import { clients, projects, tasks, workTypes } from "@/lib/db/schema"

export type CalendarArea = "work" | "personal"

export type AssistantTask = {
  id: number
  title: string
  description: string | null
  projectId: number | null
  clientId: number | null
  workTypeId: number | null
  estimatedMinutes: number
  scheduledDate: string | null
  startTime: string | null
  endTime: string | null
  deadline: string | null
  priority: "low" | "medium" | "high" | "urgent"
  status: "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled"
  clientVisibleNotes: string | null
  referenceUrl: string | null
}

export type AssistantClient = {
  id: number
  name: string
  company: string | null
  active: boolean
}

export type AssistantProject = {
  id: number
  name: string
  area: CalendarArea
  clientId: number | null
  status: string
  deadline: string | null
}

export type AssistantWorkType = {
  id: number
  name: string
  defaultDuration: number
}

export type CalendarState = {
  tasks: AssistantTask[]
  clients: AssistantClient[]
  projects: AssistantProject[]
  workTypes: AssistantWorkType[]
}

export async function loadCalendarState(): Promise<CalendarState> {
  const [taskRows, clientRows, projectRows, workTypeRows] = await Promise.all([
    db.select().from(tasks),
    db.select().from(clients),
    db.select().from(projects),
    db.select().from(workTypes),
  ])

  return {
    tasks: taskRows as AssistantTask[],
    clients: clientRows.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      active: c.active,
    })),
    projects: projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      area: (p.area === "personal" ? "personal" : "work") as CalendarArea,
      clientId: p.clientId,
      status: p.status,
      deadline: p.deadline,
    })),
    workTypes: workTypeRows.map((w) => ({ id: w.id, name: w.name, defaultDuration: w.defaultDuration })),
  }
}
