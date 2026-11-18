import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { availabilityRanges, bookings, clients, sharingTokens } from "@/lib/db/schema"
import { and, desc, eq, gte } from "drizzle-orm"
import { todayInTimezone } from "@/lib/assistant/time"
import {
  SharedViewsManager,
  type BookingRow,
  type RangeRow,
  type ShareLinkRow,
} from "@/components/shared-views/shared-views-manager"

export default async function Page() {
  const session = await auth()
  const userId = Number(session!.user.id)
  const today = todayInTimezone()

  const [clientRows, rangeRows, linkRows, bookingRows] = await Promise.all([
    db
      .select({ id: clients.id, name: clients.name, company: clients.company, active: clients.active })
      .from(clients)
      .orderBy(clients.name),
    db
      .select({
        id: availabilityRanges.id,
        date: availabilityRanges.date,
        startHour: availabilityRanges.startHour,
        endHour: availabilityRanges.endHour,
        status: availabilityRanges.status,
      })
      .from(availabilityRanges)
      .where(and(eq(availabilityRanges.userId, userId), gte(availabilityRanges.date, today)))
      .orderBy(availabilityRanges.date),
    db
      .select({ link: sharingTokens, clientName: clients.name })
      .from(sharingTokens)
      .leftJoin(clients, eq(sharingTokens.clientId, clients.id))
      .orderBy(desc(sharingTokens.createdAt)),
    db
      .select({
        id: bookings.id,
        date: bookings.date,
        hour: bookings.hour,
        name: bookings.name,
        email: bookings.email,
        note: bookings.note,
        status: bookings.status,
        rush: bookings.rush,
        tokenId: bookings.tokenId,
        clientName: clients.name,
      })
      .from(bookings)
      .leftJoin(clients, eq(bookings.clientId, clients.id))
      .orderBy(desc(bookings.date), desc(bookings.createdAt))
      .limit(50),
  ])

  const ranges: RangeRow[] = rangeRows.map((r) => ({
    id: r.id,
    date: r.date,
    startHour: r.startHour,
    endHour: r.endHour,
    status: r.status,
  }))

  const links: ShareLinkRow[] = linkRows.map(({ link, clientName }) => ({
    id: link.id,
    token: link.token,
    clientId: link.clientId,
    clientName,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    fields: link.visibleFields,
    bookingMode: link.bookingMode,
    slotsPerWeek: link.slotsPerWeek,
    capacityPerDay: link.capacityPerDay,
  }))

  const bookingsForView: BookingRow[] = bookingRows.map((b) => ({
    id: b.id,
    date: b.date,
    hour: b.hour,
    name: b.name,
    email: b.email,
    note: b.note,
    status: b.status,
    rush: b.rush,
    tokenId: b.tokenId,
    clientName: b.clientName,
  }))

  return (
    <SharedViewsManager
      clients={clientRows}
      ranges={ranges}
      links={links}
      bookings={bookingsForView}
      today={today}
      now={new Date().toISOString()}
    />
  )
}
