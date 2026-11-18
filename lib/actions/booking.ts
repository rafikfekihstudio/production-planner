"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { bookings, clients, sharingTokens, tasks } from "@/lib/db/schema"
import { and, eq, ne } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { isDate } from "@/lib/assistant/time"
import { HOUR_END, HOUR_START } from "@/lib/booking"
import { loadSharedCalendar } from "@/lib/booking-data"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type CreateBookingInput = {
  token?: unknown
  date?: unknown
  hour?: unknown
  name?: unknown
  email?: unknown
  note?: unknown
}

export type CreateBookingResult = {
  ok: boolean
  error?: string
  status?: "confirmed" | "pending"
  date?: string
  hour?: number
  duplicate?: boolean
}

type TxResult = { status?: "confirmed" | "pending"; duplicate?: boolean; error?: string }

/**
 * Public booking endpoint. There is no session: the 256-bit link token is the
 * capability. Every date, hour and capacity rule is recomputed on the server
 * from the database before anything is written.
 *
 * Every hour in the rolling window is bookable. The link's booking mode decides
 * whether it is confirmed immediately or held for approval; there is no rush
 * path and no special offered-slot list.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const token = typeof input.token === "string" ? input.token : ""
  if (!token || token.length > 200) return { ok: false, error: "This link is invalid." }

  const date = typeof input.date === "string" ? input.date : ""
  if (!isDate(date)) return { ok: false, error: "Invalid date." }

  const hour = Number(input.hour)
  if (!Number.isInteger(hour) || hour < HOUR_START || hour >= HOUR_END) {
    return { ok: false, error: "Invalid hour." }
  }

  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Please enter your name (2–80 characters)." }

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : ""
  if (email.length > 160 || !EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." }

  const noteRaw = typeof input.note === "string" ? input.note.trim() : ""
  if (noteRaw.length > 500) return { ok: false, error: "Please keep your note under 500 characters." }
  const note = noteRaw || null

  const [link] = await db.select().from(sharingTokens).where(eq(sharingTokens.token, token)).limit(1)
  if (!link || link.scope !== "client" || !link.clientId) return { ok: false, error: "This link is no longer valid." }
  if (link.revokedAt) return { ok: false, error: "This link has been revoked." }
  const now = new Date().toISOString()
  if (link.expiresAt && link.expiresAt < now) return { ok: false, error: "This link has expired." }

  const client = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.id, link.clientId))
    .get()
  if (!client) return { ok: false, error: "This link is no longer valid." }

  const { views, days } = await loadSharedCalendar(link, 14)
  const view = views.find((v) => v.date === date)

  // Every hour in the rolling window is bookable; the Open/Busy/Taken/Free
  // labels are informational only. Only the date window and capacity are hard
  // rules.
  if (!view || !days.includes(date)) {
    return { ok: false, error: "Please choose a date within the next two weeks." }
  }
  if (view.full) return { ok: false, error: "That day is fully booked. Please pick another day." }

  const status: "confirmed" | "pending" = link.bookingMode === "request" ? "pending" : "confirmed"

  try {
    const result: TxResult = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: bookings.id, email: bookings.email, status: bookings.status })
        .from(bookings)
        .where(and(eq(bookings.tokenId, link.id), eq(bookings.date, date), eq(bookings.hour, hour)))
        .get()

      if (existing) {
        if (existing.email !== email) return { error: "That slot was just taken. Please refresh and choose another." }
        if (existing.status === "cancelled") return { error: "That slot was cancelled. Please refresh." }
        return { status: existing.status as "confirmed" | "pending", duplicate: true }
      }

      const dayBookings = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.date, date), ne(bookings.status, "cancelled")))
      if (dayBookings.length >= link.capacityPerDay) {
        return { error: "That day is fully booked. Please pick another day." }
      }

      const [created] = await tx
        .insert(bookings)
        .values({
          tokenId: link.id,
          clientId: link.clientId,
          date,
          hour,
          name,
          email,
          note,
          status,
          createdAt: now,
        })
        .returning({ id: bookings.id, status: bookings.status })

      if (status === "confirmed") {
        const [task] = await tx
          .insert(tasks)
          .values({
            title: `Client booking — ${client.name}`,
            description: note,
            clientId: link.clientId,
            estimatedMinutes: 60,
            scheduledDate: date,
            startTime: `${String(hour).padStart(2, "0")}:00`,
            endTime: `${String(Math.min(hour + 1, HOUR_END)).padStart(2, "0")}:00`,
            status: "scheduled",
            priority: "medium",
          })
          .returning({ id: tasks.id })
        await tx.update(bookings).set({ taskId: task.id }).where(eq(bookings.id, created.id))
      }

      return { status: created.status as "confirmed" | "pending" }
    })

    if (result.error) return { ok: false, error: result.error }
    if (!result.status) return { ok: false, error: "Could not save the booking. Please try again." }

    revalidatePath("/shared-views")
    revalidatePath("/timeline")
    revalidatePath("/")
    return { ok: true, status: result.status, date, hour, duplicate: result.duplicate }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the booking. Please try again." }
  }
}

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
}

function revalidateBookingPaths() {
  revalidatePath("/shared-views")
  revalidatePath("/timeline")
  revalidatePath("/")
}

/** Internal management. Confirming a request-mode booking creates its scheduled task. */
export async function setBookingStatus(id: number, status: "pending" | "confirmed" | "cancelled") {
  await requireUser()
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid booking")
  if (!["pending", "confirmed", "cancelled"].includes(status)) throw new Error("Invalid status")

  const booking = await db.select().from(bookings).where(eq(bookings.id, id)).get()
  if (!booking) throw new Error("Booking not found")

  if (status === "confirmed" && booking.status !== "confirmed") {
    const [link] = await db.select().from(sharingTokens).where(eq(sharingTokens.id, booking.tokenId)).limit(1)
    const client = booking.clientId
      ? await db.select({ name: clients.name }).from(clients).where(eq(clients.id, booking.clientId)).get()
      : null
    let clientName = client?.name
    if (!clientName && link?.clientId) {
      const row = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, link.clientId)).get()
      clientName = row?.name
    }
    clientName = clientName ?? "Client"

    const [task] = await db
      .insert(tasks)
      .values({
        title: `Client booking — ${clientName}`,
        description: booking.note,
        clientId: link?.clientId ?? booking.clientId ?? null,
        estimatedMinutes: 60,
        scheduledDate: booking.date,
        startTime: `${String(booking.hour).padStart(2, "0")}:00`,
        endTime: `${String(Math.min(booking.hour + 1, HOUR_END)).padStart(2, "0")}:00`,
        status: "scheduled",
        priority: "medium",
      })
      .returning({ id: tasks.id })
    await db.update(bookings).set({ status, taskId: task.id }).where(eq(bookings.id, id))
  } else if (status === "cancelled") {
    await db.update(bookings).set({ status }).where(eq(bookings.id, id))
    if (booking.taskId) {
      await db
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, booking.taskId))
    }
  } else {
    await db.update(bookings).set({ status }).where(eq(bookings.id, id))
    if (booking.taskId) {
      await db
        .update(tasks)
        .set({ status: "backlog", scheduledDate: null, startTime: null, endTime: null, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, booking.taskId))
    }
  }

  revalidateBookingPaths()
}

export async function confirmBooking(id: number) {
  await setBookingStatus(id, "confirmed")
}

export async function cancelBooking(id: number) {
  await setBookingStatus(id, "cancelled")
}
