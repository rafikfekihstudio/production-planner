import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { clients, projects, settings, sharingTokens, tasks } from "@/lib/db/schema"
import { and, eq, isNotNull } from "drizzle-orm"
import { prettyDate } from "@/lib/assistant/time"
import { parseShareFields, type ShareField } from "@/lib/sharing"
import { loadSharedCalendar } from "@/lib/booking-data"
import { BookingPanel } from "@/components/share/booking-panel"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata = {
  title: "Book a time",
}

export default async function SharedBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length > 200) notFound()

  const [link] = await db.select().from(sharingTokens).where(eq(sharingTokens.token, token)).limit(1)
  if (!link || link.scope !== "client" || !link.clientId) notFound()
  if (link.revokedAt) notFound()
  const now = new Date().toISOString()
  if (link.expiresAt && link.expiresAt < now) notFound()

  const client = await db
    .select({ name: clients.name, company: clients.company })
    .from(clients)
    .where(eq(clients.id, link.clientId))
    .get()
  if (!client) notFound()

  const fields = parseShareFields(link.visibleFields)
  const has = (field: ShareField) => fields.includes(field)

  const [settingRow, calendar, projectRows, taskRows] = await Promise.all([
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "businessName")).get(),
    has("availability") ? loadSharedCalendar(link, 14) : Promise.resolve({ days: [], views: [] }),
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

  const updates = projectRows.filter((p) => p.progress && p.progress.trim())
  const offered = calendar.views.filter((v) => v.openHour !== null && !v.full).length

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:px-8 md:py-16">
      <header className="border-b border-border pb-6">
        <p className="mono text-[10px] uppercase tracking-[0.25em] text-gold">{businessName}</p>
        <h1 className="serif mt-3 text-4xl text-foreground md:text-5xl">Book a time with {client.name}</h1>
        <p className="mono mt-3 text-xs uppercase tracking-widest text-muted">
          Shared privately with {client.company || client.name} · {link.bookingMode === "request" ? "request a slot" : "book instantly"}
        </p>
      </header>

      {has("availability") && (
        <BookingPanel token={link.token} views={calendar.views} mode={link.bookingMode} />
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

      {!has("availability") && offered === 0 && (
        <p className="mt-8 rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing has been shared on this link yet.
        </p>
      )}

      <footer className="mt-14 border-t border-border pt-6 text-[11px] text-muted">
        This page is private to you. Please do not forward the link.
      </footer>
    </main>
  )
}
