import { db } from "@/lib/db"
import { availabilityRanges, bookings, sharingTokens, tasks, users } from "@/lib/db/schema"
import { and, gte, inArray, lte, ne, eq } from "drizzle-orm"
import { addDays, todayInTimezone } from "@/lib/assistant/time"
import { buildDayViews, type DayView, type HourRange } from "@/lib/booking"

export async function loadSharedCalendar(link: typeof sharingTokens.$inferSelect, windowDays = 14) {
  const today = todayInTimezone()
  const days = Array.from({ length: windowDays }, (_, i) => addDays(today, i))
  const to = days[days.length - 1]

  const [openRows, busyRows, bookedRows, taskRows] = await Promise.all([
    db
      .select({ date: availabilityRanges.date, startHour: availabilityRanges.startHour, endHour: availabilityRanges.endHour })
      .from(availabilityRanges)
      .innerJoin(users, eq(availabilityRanges.userId, users.id))
      .where(and(eq(users.role, "admin"), eq(availabilityRanges.status, "open"), gte(availabilityRanges.date, today), lte(availabilityRanges.date, to))),
    db
      .select({ date: availabilityRanges.date, startHour: availabilityRanges.startHour, endHour: availabilityRanges.endHour })
      .from(availabilityRanges)
      .innerJoin(users, eq(availabilityRanges.userId, users.id))
      .where(and(eq(users.role, "admin"), eq(availabilityRanges.status, "busy"), gte(availabilityRanges.date, today), lte(availabilityRanges.date, to))),
    db
      .select({ date: bookings.date, hour: bookings.hour, tokenId: bookings.tokenId })
      .from(bookings)
      .where(and(gte(bookings.date, today), lte(bookings.date, to), ne(bookings.status, "cancelled"))),
    db
      .select({ date: tasks.scheduledDate, start: tasks.startTime, end: tasks.endTime })
      .from(tasks)
      .where(and(gte(tasks.scheduledDate, today), lte(tasks.scheduledDate, to), inArray(tasks.status, ["scheduled", "in_progress"]))),
  ])

  const taskBusy: HourRange[] = []
  for (const t of taskRows) {
    if (!t.date || !t.start || !t.end) continue
    const startHour = Number(t.start.slice(0, 2))
    const [endHour, endMinute] = t.end.slice(0, 5).split(":").map(Number)
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) continue
    taskBusy.push({ date: t.date, startHour, endHour: endMinute > 0 ? endHour + 1 : endHour })
  }

  const views: DayView[] = buildDayViews({
    days,
    openRanges: openRows,
    busyRanges: [...busyRows, ...taskBusy],
    booked: bookedRows,
    linkId: link.id,
    slotsPerWeek: link.slotsPerWeek,
    capacityPerDay: link.capacityPerDay,
  })

  return { days, views }
}
