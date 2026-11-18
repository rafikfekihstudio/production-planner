"use server"

import { randomBytes } from "crypto"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { clients, sharingTokens } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { SHARE_FIELDS, parseShareFields, type ShareField } from "@/lib/sharing"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

export type CreateShareInput = {
  clientId: number
  expiresInDays?: number | null
  fields?: ShareField[]
}

export async function createShareLink(input: CreateShareInput) {
  await requireUser()

  const clientId = Number(input.clientId)
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error("Choose a client")

  const client = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).get()
  if (!client) throw new Error("Client no longer exists")

  const days = input.expiresInDays == null ? null : Number(input.expiresInDays)
  if (days != null && ![30, 60, 90].includes(days)) throw new Error("Invalid expiry")
  const expiresAt = days == null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const requested = Array.isArray(input.fields) ? input.fields : []
  const fields = requested.filter((f): f is ShareField => (SHARE_FIELDS as readonly string[]).includes(f))
  const visibleFields = fields.length > 0 ? fields : parseShareFields(null)

  const token = randomBytes(32).toString("base64url")
  const [row] = await db
    .insert(sharingTokens)
    .values({
      token,
      scope: "client",
      clientId,
      visibleFields: JSON.stringify(visibleFields),
      expiresAt,
      createdAt: new Date().toISOString(),
    })
    .returning({ id: sharingTokens.id })

  revalidatePath("/shared-views")
  return { id: row.id, token, clientId, expiresAt, fields: visibleFields }
}

export async function revokeShareLink(id: number) {
  await requireUser()
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid link")
  const updated = await db
    .update(sharingTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sharingTokens.id, id))
    .returning({ id: sharingTokens.id })
  if (updated.length === 0) throw new Error("Link no longer exists")
  revalidatePath("/shared-views")
}

export async function deleteShareLink(id: number) {
  await requireUser()
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid link")
  await db.delete(sharingTokens).where(eq(sharingTokens.id, id))
  revalidatePath("/shared-views")
}
