import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { availability, clients, projects, settings, sharingTokens, tasks, users } from "@/lib/db/schema"
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm"
import { addDays, prettyDate, todayInTimezone, weekdayOf } from "@/lib/assistant/time"
import { parseShareFields, type ShareField } from "@/lib/sharing"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Open Days & Updates",
}

export default async function SharedAvailabilityPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length > 200) notFound()

  const [link] = await db.select().from(sharingTokens).where(eq(sharingTokens.token, token)).limit(1)
  if (!link || link.scope !== "client" || !link.clientId) notFound()
  if (link.revokedAt) notFound()
  const now = new Date().toISOString()
  if (link.expiresAt && link.expiresAt < now) notFound()

  const client = await db.select({ name: clients.name, company: clients.company }).from(clients).where(eq(clients.id, link.clientId)).get()
  if (!client) notFound()

  const fields = parseShareFields(link.visibleFields)
  const has = (field: ShareField) => fields.includes(field)
  const today = todayInTimezone()
  const to = addDays(today, 60)

  const [settingRow, availabilityRows, projectRows, taskRows] = await Promise.all([
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "businessName")).get(),
    has("availability")
      ? db
          .select({ date: availability.date, status: availability.status })
          .from(availability)
          .innerJoin(users, eq(availability.userId, users.id))
          .where(
            and(
              eq(users.role, "admin"),
              inArray(availability.status, ["available", "tentative"]),
              gte(availability.date, today),
              lte(availability.date, to),
            ),
          )
      : Promise.resolve([]),
    has("progress")
      ? db
          .select({ id: projects.id, name: projects.name, progress: projects.clientVisibleProgress })
          .from(projects)
          .where(eq(projects.clientId, link.clientId))
          .orderBy(projects.name)
      : Promise.resolve([]),
    has("tasks")
      ? db
          .select({ id: tasks.id, title: tasks.title, date: tasks.scheduledDate, notes: tasks.clientVisibleNotes })
          .from(tasks)
          .where(and(eq(tasks.clientId, link.clientId), isNotNull(tasks.clientVisibleNotes)))
          .orderBy(tasks.scheduledDate)
      : Promise.resolve([]),
  ])

  let businessName = "Studio"
  try {
    const parsed = settingRow ? JSON.parse(settingRow.value) : null
    if (typeof parsed === "string" && parsed.trim()) businessName = parsed.trim()
  } catch {
    /* keep the fallback */
  }

  const byDate = new Map<string, "available" | "tentative">()
  for (const row of availabilityRows) {
    if (row.status === "available") byDate.set(row.date, "available")
    else if (!byDate.has(row.date)) byDate.set(row.date, "tentative")
  }
  const openDays = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  const updates = projectRows.filter((p) => p.progress && p.progress.trim())

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-16">
      <header className="border-b border-border pb-6">
        <p className="mono text-[10px] uppercase tracking-[0.25em] text-gold">{businessName}</p>
        <h1 className="serif mt-3 text-4xl text-foreground md:text-5xl">
          Open days for {client.company || client.name}
        </h1>
        <p className="mono mt-3 text-xs uppercase tracking-widest text-muted">
          Shared privately with {client.name} · read only
        </p>
      </header>

      {fields.length === 0 && (
        <p className="mt-8 rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing has been shared on this link yet.
        </p>
      )}

      {has("availability") && (
        <section className="mt-10">
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Days I&apos;m open to new work</h2>
          {openDays.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
              No open days in the next 60 days yet. Check back soon.
            </p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {openDays.map(([date, status]) => (
                <li
                  key={date}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                    status === "available" ? "border-teal/40 bg-teal/10" : "border-gold/40 bg-gold/10"
                  }`}
                >
                  <div>
                    <p className="text-sm text-foreground">{prettyDate(date)}</p>
                    <p className="mono mt-0.5 text-[10px] uppercase tracking-widest text-muted">{weekdayOf(date)}</p>
                  </div>
                  <span
                    className={`mono text-[10px] uppercase tracking-widest ${
                      status === "available" ? "text-teal" : "text-gold"
                    }`}
                  >
                    {status === "available" ? "Available" : "Tentative"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-muted">
            These are full days, not specific times. Get in touch to arrange a time that suits you.
          </p>
        </section>
      )}

      {has("progress") && updates.length > 0 && (
        <section className="mt-10">
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Project updates</h2>
          <div className="mt-4 space-y-3">
            {updates.map((project) => (
              <article key={project.id} className="rounded-lg border border-border bg-surface p-4">
                <h3 className="serif text-xl text-foreground">{project.name}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{project.progress}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {has("tasks") && taskRows.length > 0 && (
        <section className="mt-10">
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Your work</h2>
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {taskRows.map((task) => (
              <li key={task.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-foreground">{task.title}</span>
                  {task.date && <span className="mono text-[10px] text-muted">{prettyDate(task.date)}</span>}
                </div>
                {task.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{task.notes}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-14 border-t border-border pt-6 text-[11px] text-muted">
        This page is private to you. Please do not forward the link.
      </footer>
    </main>
  )
}
