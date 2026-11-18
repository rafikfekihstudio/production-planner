import { z } from "zod"
import { isDate, isTime } from "./time"

const dateString = z.string().refine(isDate, "Expected a real calendar date as YYYY-MM-DD")
const timeString = z.string().refine(isTime, "Expected a 24h clock time as HH:MM")

const priority = z.enum(["low", "medium", "high", "urgent"])
const area = z.enum(["work", "personal"])

const id = z.number().int().positive()

/**
 * One calendar change the model proposes. Nothing here is written to the
 * database by the model — the server validates the whole set against current
 * state, the user confirms, and only then are the existing server actions
 * invoked.
 */
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    title: z.string().trim().min(2).max(140),
    date: dateString,
    start: timeString,
    minutes: z.number().int().min(15).max(600),
    projectId: id.nullish(),
    workTypeId: id.nullish(),
    priority: priority.optional(),
    area: area.optional(),
    description: z.string().trim().max(600).nullish(),
  }),
  z.object({
    kind: z.literal("move"),
    taskId: id,
    date: dateString,
    start: timeString,
  }),
  z.object({
    kind: z.literal("resize"),
    taskId: id,
    minutes: z.number().int().min(15).max(600),
  }),
  z.object({
    kind: z.literal("delete"),
    taskId: id,
  }),
  z.object({
    kind: z.literal("done"),
    taskId: id,
    /** true marks the task complete; false reopens it. Defaults to true. */
    done: z.boolean().default(true),
  }),
])

export type Operation = z.infer<typeof operationSchema>
export type OperationKind = Operation["kind"]

export const MAX_OPERATIONS = 120

/** Shape Gemini must return; `operations` is optional for plain answers. */
export const modelPlanSchema = z.object({
  reply: z.string().min(1).max(2000),
  mode: z.enum(["propose", "answer", "clarify"]),
  operations: z.array(operationSchema).max(MAX_OPERATIONS).default([]),
  notes: z.array(z.string().max(300)).max(15).default([]),
})

export type ModelPlan = z.infer<typeof modelPlanSchema>

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4000),
})

export const planRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(30),
})

export const applyRequestSchema = z.object({
  requestId: z.string().uuid(),
  operations: z.array(operationSchema).min(1).max(MAX_OPERATIONS),
  confirmDelete: z.boolean().default(false),
})

export const undoRequestSchema = z.object({
  token: z.string().min(20).max(120_000),
})
