"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { availabilityRanges } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { isDate } from "@/lib/assistant/time"
import { HOUR_END, HOUR_START } from "@/lib/booking"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const userId = Number(session.user.id)
  if (!Number.isInteger(userId)) throw new Error("Unauthorized")
  return userId
}

function validateRange(date: string, status: string, startHour: number, endHour: number) {
  if (!isDate(date)) throw new Error("Invalid date")
  if (status !== "open" && status !== "busy") throw new Error("Invalid block type")
  const start = Number(startHour)
  const end = Number(endHour)
  if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error("Invalid hours")
  if (start < HOUR_START || end > HOUR_END || end <= start) throw new Error("Invalid hour range")
  return { startHour: start, endHour: end }
}

/** Add or replace one hourly block for a day. */
export async function setDayRange(date: string, status: "open" | "busy", startHour: number, endHour: number) {
  const userId = await requireUser()
  const range = validateRange(date, status, startHour, endHour)
  const updatedAt = new Date().toISOString()
  await db
    .insert(availabilityRanges)
    .values({ userId, date, status, ...range, updatedAt })
    .onConflictDoUpdate({
      target: [availabilityRanges.userId, availabilityRanges.date, availabilityRanges.status],
      set: { ...range, updatedAt },
    })
  revalidatePath("/shared-views")
  revalidatePath("/share")
}

export async function clearDayRange(date: string, status: "open" | "busy") {
  const userId = await requireUser()
  if (!isDate(date)) throw new Error("Invalid date")
  if (status !== "open" && status !== "busy") throw new Error("Invalid block type")
  await db
    .delete(availabilityRanges)
    .where(
      and(
        eq(availabilityRanges.userId, userId),
        eq(availabilityRanges.date, date),
        eq(availabilityRanges.status, status),
      ),
    )
  revalidatePath("/shared-views")
  revalidatePath("/share")
}
