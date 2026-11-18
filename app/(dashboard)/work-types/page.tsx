import { db } from "@/lib/db"
import { tasks, workTypes } from "@/lib/db/schema"
import { WorkTypesManager } from "@/components/work-types/work-types-manager"

export default async function Page() {
  const [rows, taskRows] = await Promise.all([
    db.select().from(workTypes).orderBy(workTypes.name),
    db.select({ workTypeId: tasks.workTypeId }).from(tasks),
  ])

  const usage: Record<number, number> = {}
  for (const t of taskRows) {
    if (t.workTypeId == null) continue
    usage[t.workTypeId] = (usage[t.workTypeId] ?? 0) + 1
  }

  return (
    <WorkTypesManager
      workTypes={rows.map((w) => ({
        id: w.id,
        name: w.name,
        defaultDuration: w.defaultDuration,
        color: w.color,
        description: w.description,
      }))}
      usage={usage}
    />
  )
}
