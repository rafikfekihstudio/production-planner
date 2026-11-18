import { db } from "@/lib/db"
import { clients, projects, tasks } from "@/lib/db/schema"
import { ClientsManager, type ClientRow } from "@/components/clients/clients-manager"

export default async function Page() {
  const [rows, projectRows, taskRows] = await Promise.all([
    db.select().from(clients).orderBy(clients.name),
    db.select({ clientId: projects.clientId }).from(projects),
    db.select({ clientId: tasks.clientId }).from(tasks),
  ])

  const projectCounts = new Map<number, number>()
  for (const p of projectRows) {
    if (p.clientId == null) continue
    projectCounts.set(p.clientId, (projectCounts.get(p.clientId) ?? 0) + 1)
  }
  const taskCounts = new Map<number, number>()
  for (const t of taskRows) {
    if (t.clientId == null) continue
    taskCounts.set(t.clientId, (taskCounts.get(t.clientId) ?? 0) + 1)
  }

  const items: ClientRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    company: c.company,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    active: c.active,
    projectCount: projectCounts.get(c.id) ?? 0,
    taskCount: taskCounts.get(c.id) ?? 0,
  }))

  return <ClientsManager clients={items} />
}
