"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { clients } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

export type ClientInput = {
  name: string
  company?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  active?: boolean
}

function revalidateAll() {
  revalidatePath("/clients")
  revalidatePath("/projects")
  revalidatePath("/timeline")
  revalidatePath("/")
}

function normalize(input: ClientInput) {
  const name = input.name.trim()
  if (!name) throw new Error("Client name is required")
  if (name.length > 120) throw new Error("Client name is too long")

  const email = input.email?.trim() || null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address")
  }

  return {
    name,
    company: input.company?.trim() || null,
    email,
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
    active: input.active !== false,
  }
}

export async function createClient(input: ClientInput) {
  await requireUser()
  const values = normalize(input)
  const [inserted] = await db.insert(clients).values(values).returning()
  revalidateAll()
  return inserted
}

export async function updateClient(id: number, input: ClientInput) {
  await requireUser()
  const values = normalize(input)
  const updated = await db
    .update(clients)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(clients.id, id))
    .returning({ id: clients.id })
  if (updated.length === 0) throw new Error("Client no longer exists")
  revalidateAll()
}

export async function setClientActive(id: number, active: boolean) {
  await requireUser()
  const updated = await db
    .update(clients)
    .set({ active, updatedAt: new Date().toISOString() })
    .where(eq(clients.id, id))
    .returning({ id: clients.id })
  if (updated.length === 0) throw new Error("Client no longer exists")
  revalidateAll()
}

/**
 * Deleting a client keeps its projects and tasks but clears their client link
 * (foreign keys use ON DELETE SET NULL). The UI shows the affected counts first.
 */
export async function deleteClient(id: number) {
  await requireUser()
  const deleted = await db.delete(clients).where(eq(clients.id, id)).returning({ id: clients.id })
  if (deleted.length === 0) throw new Error("Client no longer exists")
  revalidateAll()
}
