"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { workTypes } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

export type WorkTypeInput = {
  name: string
  defaultDuration: number
  color: string
  description?: string | null
}

function revalidateAll() {
  revalidatePath("/work-types")
  revalidatePath("/timeline")
  revalidatePath("/projects")
  revalidatePath("/")
}

function normalize(input: WorkTypeInput) {
  const name = input.name.trim()
  if (!name) throw new Error("Name is required")
  const duration = Number(input.defaultDuration)
  return {
    name,
    defaultDuration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 60,
    color: /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : "#c9a961",
    description: input.description?.trim() || null,
  }
}

export async function createWorkType(input: WorkTypeInput) {
  await requireUser()
  const values = normalize(input)
  const existing = await db
    .select({ id: workTypes.id })
    .from(workTypes)
    .where(eq(workTypes.name, values.name))
    .get()
  if (existing) throw new Error(`"${values.name}" already exists`)
  const [inserted] = await db.insert(workTypes).values(values).returning()
  revalidateAll()
  return inserted
}

export async function updateWorkType(id: number, input: WorkTypeInput) {
  await requireUser()
  const values = normalize(input)
  const existing = await db
    .select({ id: workTypes.id })
    .from(workTypes)
    .where(eq(workTypes.name, values.name))
    .get()
  if (existing && existing.id !== id) throw new Error(`"${values.name}" already exists`)
  await db.update(workTypes).set(values).where(eq(workTypes.id, id)).run()
  revalidateAll()
}

export async function deleteWorkType(id: number) {
  await requireUser()
  await db.delete(workTypes).where(eq(workTypes.id, id)).run()
  revalidateAll()
}
