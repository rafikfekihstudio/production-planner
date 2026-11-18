import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { settings } from "@/lib/db/schema"

/**
 * The `settings` table is the app's internal key/value store. It holds small
 * JSON documents — schedule rules, assistant preferences, idempotency records —
 * so features can ship without a migration for every config shape.
 */
export async function readValue<T>(key: string): Promise<T | null> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get()
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export async function writeValue(key: string, value: unknown): Promise<void> {
  const now = new Date().toISOString()
  const encoded = JSON.stringify(value)
  await db
    .insert(settings)
    .values({ key, value: encoded, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: encoded, updatedAt: now } })
    .run()
}

export async function deleteValue(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key)).run()
}
