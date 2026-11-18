"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { availability } from "@/lib/db/schema"
import { and, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { isDate } from "@/lib/assistant/time"
import { isAvailabilityValue, type DayStatus } from "@/lib/sharing"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

/** Set one whole day. "unset" removes the override so the day falls back to your normal schedule. */
export async function setDayAvailability(date: string, status: DayStatus) {
  const user = await requireUser()
  const userId = Number(user.id)
  if (!Number.isInteger(userId) || !isDate(date)) throw new Error("Invalid date")

  if (status === "unset") {
    await db
      .delete(availability)
      .where(and(eq(availability.userId, userId), eq(availability.date, date)))
  } else if (isAvailabilityValue(status)) {
    const updatedAt = new Date().toISOString()
    await db
      .insert(availability)
      .values({ userId, date, status, updatedAt })
      .onConflictDoUpdate({
        target: [availability.userId, availability.date],
        set: { status, updatedAt },
      })
  } else {
    throw new Error("Invalid availability status")
  }

  revalidatePath("/shared-views")
  revalidatePath("/share")
}
