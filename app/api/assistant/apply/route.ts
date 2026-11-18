import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { applyOperations } from "@/lib/assistant/execute"
import { AssistantError } from "@/lib/assistant/gemini"
import { applyRecordKey, readRecord, writeRecord } from "@/lib/assistant/records"
import { applyRequestSchema } from "@/lib/assistant/schema"
import { simulate } from "@/lib/assistant/simulate"
import { loadCalendarState } from "@/lib/assistant/state"
import { todayInTimezone } from "@/lib/assistant/time"
import { signUndoToken } from "@/lib/assistant/undo"
import { loadScheduleRules } from "@/lib/schedule-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CachedApply = {
  applied: { created: number; moved: number; resized: number; deleted: number; completed: number }
  undoToken: string
  expiresAt: number
  at: string
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => null)
  const parsed = applyRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid plan payload.", code: "bad_request", issues: parsed.error.issues.slice(0, 6) },
      { status: 400 },
    )
  }

  const { requestId, operations, confirmDelete } = parsed.data
  const recordKey = applyRecordKey(userId, requestId)

  // Retried request from the same client turn: return the first result instead
  // of applying the plan twice.
  const cached = await readRecord<CachedApply>(recordKey)
  if (cached) {
    return NextResponse.json({ ok: true, replayed: true, ...cached })
  }

  if (operations.some((op) => op.kind === "delete") && !confirmDelete) {
    return NextResponse.json(
      { error: "Deleting tasks needs explicit confirmation.", code: "confirmation_required" },
      { status: 400 },
    )
  }

  try {
    const [state, rules] = await Promise.all([loadCalendarState(), loadScheduleRules()])
    const simulation = simulate(operations, state, todayInTimezone(), rules)

    if (!simulation.ok) {
      return NextResponse.json(
        {
          error: "This plan is no longer valid against the current calendar. Nothing was changed.",
          code: "plan_invalid",
          issues: simulation.issues.slice(0, 12),
        },
        { status: 409 },
      )
    }

    const result = await applyOperations(simulation.steps, state)
    const { token, expiresAt } = signUndoToken(userId, result.undo)

    const payload: CachedApply = {
      applied: {
        created: result.created,
        moved: result.moved,
        resized: result.resized,
        deleted: result.deleted,
        completed: result.completed,
      },
      undoToken: token,
      expiresAt,
      at: new Date().toISOString(),
    }
    await writeRecord(recordKey, payload)

    return NextResponse.json({ ok: true, preview: simulation.steps, ...payload })
  } catch (error) {
    if (error instanceof AssistantError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[assistant/apply]", error)
    return NextResponse.json(
      {
        error: "Applying the plan failed. Anything already written was rolled back.",
        code: "apply_failed",
      },
      { status: 500 },
    )
  }
}
