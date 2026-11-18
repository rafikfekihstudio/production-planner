"use server"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { projects } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import type { ProjectStatus, ProjectArea } from "@/lib/project-constants"
import { statusAllowedInArea } from "@/lib/project-constants"

async function requireUser() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user
}

export type ProjectInput = {
  name: string
  area?: ProjectArea
  clientId?: number | null
  description?: string | null
  startDate?: string | null
  deadline?: string | null
  priority?: "low" | "medium" | "high" | "urgent"
  status?: ProjectStatus
  estimatedHours?: number
  internalNotes?: string | null
  clientVisibleProgress?: string | null
}

function revalidateAll(id?: number) {
  revalidatePath("/projects")
  revalidatePath("/")
  if (id) revalidatePath(`/projects/${id}`)
}

export async function createProject(input: ProjectInput) {
  await requireUser()
  const area = input.area ?? "work"
  const status = input.status && statusAllowedInArea(area, input.status) ? input.status : "inquiry"
  const [inserted] = await db
    .insert(projects)
    .values({
      name: input.name,
      area,
      clientId: area === "personal" ? null : input.clientId ?? null,
      description: input.description ?? null,
      startDate: input.startDate ?? null,
      deadline: input.deadline ?? null,
      priority: input.priority ?? "medium",
      status,
      estimatedHours: input.estimatedHours ?? 0,
      internalNotes: input.internalNotes ?? null,
      clientVisibleProgress: input.clientVisibleProgress ?? null,
    })
    .returning()
  revalidateAll(inserted?.id)
  return inserted
}

export async function updateProject(id: number, input: Partial<ProjectInput>) {
  await requireUser()
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (input.name !== undefined) patch.name = input.name
  if (input.area !== undefined) patch.area = input.area
  if (input.clientId !== undefined) patch.clientId = input.clientId
  if (input.description !== undefined) patch.description = input.description
  if (input.startDate !== undefined) patch.startDate = input.startDate
  if (input.deadline !== undefined) patch.deadline = input.deadline
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.status !== undefined) patch.status = input.status
  if (input.estimatedHours !== undefined) patch.estimatedHours = input.estimatedHours
  if (input.internalNotes !== undefined) patch.internalNotes = input.internalNotes
  if (input.clientVisibleProgress !== undefined) patch.clientVisibleProgress = input.clientVisibleProgress

  // if the project moves areas, keep its stage valid for the new area
  if (input.area !== undefined) {
    const current = await db.select().from(projects).where(eq(projects.id, id)).get()
    const nextStatus = (input.status ?? current?.status ?? "inquiry") as ProjectStatus
    if (!statusAllowedInArea(input.area, nextStatus)) patch.status = "inquiry"
    if (input.area === "personal") patch.clientId = null
  }

  await db.update(projects).set(patch).where(eq(projects.id, id)).run()
  revalidateAll(id)
}

export async function setProjectStatus(id: number, status: ProjectStatus) {
  await requireUser()
  const current = await db.select().from(projects).where(eq(projects.id, id)).get()
  if (!current) throw new Error("Project not found")
  const next = statusAllowedInArea(current.area, status) ? status : current.status
  await db
    .update(projects)
    .set({ status: next, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .run()
  revalidateAll(id)
}

export async function deleteProject(id: number) {
  await requireUser()
  await db.delete(projects).where(eq(projects.id, id)).run()
  // don't revalidate the detail route itself: it no longer exists and would 404
  // while the client is navigating back to the board
  revalidatePath("/projects")
  revalidatePath("/")
  // Redirect on the server so the navigation is not cancelled by the action's
  // automatic refresh of the deleted detail route.
  redirect("/projects")
}
