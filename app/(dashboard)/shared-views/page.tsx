import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { availability, clients, sharingTokens } from "@/lib/db/schema"
import { eq, desc } from "drizzle-orm"
import { todayInTimezone } from "@/lib/assistant/time"
import {
  SharedViewsManager,
  type ShareLinkRow,
  type DayOverride,
} from "@/components/shared-views/shared-views-manager"

export default async function Page() {
  const session = await auth()
  const userId = Number(session!.user.id)

  const [clientRows, availabilityRows, linkRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.name, company: clients.company, active: clients.active }).from(clients).orderBy(clients.name),
    db.select({ date: availability.date, status: availability.status }).from(availability).where(eq(availability.userId, userId)),
    db
      .select({ link: sharingTokens, clientName: clients.name })
      .from(sharingTokens)
      .leftJoin(clients, eq(sharingTokens.clientId, clients.id))
      .orderBy(desc(sharingTokens.createdAt)),
  ])

  const overrides: DayOverride[] = availabilityRows.map((r) => ({ date: r.date, status: r.status }))
  const links: ShareLinkRow[] = linkRows.map(({ link, clientName }) => ({
    id: link.id,
    token: link.token,
    clientId: link.clientId,
    clientName,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    fields: link.visibleFields,
  }))

  return (
    <SharedViewsManager
      clients={clientRows}
      overrides={overrides}
      links={links}
      today={todayInTimezone()}
    />
  )
}
