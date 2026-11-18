import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { revertOperations } from "@/lib/assistant/execute"
import { AssistantError } from "@/lib/assistant/gemini"
import { readRecord, undoRecordKey, writeRecord } from "@/lib/assistant/records"
import { undoRequestSchema } from "@/lib/assistant/schema"
import { hashToken, verifyUndoToken } from "@/lib/assistant/undo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = await request.json().catch(() => null)
  const parsed = undoRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid undo request.", code: "bad_request" }, { status: 400 })
  }

  try {
    const ops = verifyUndoToken(parsed.data.token, userId)
    const recordKey = undoRecordKey(userId, hashToken(parsed.data.token))

    const already = await readRecord<{ at: string }>(recordKey)
    if (already) {
      return NextResponse.json({ ok: true, alreadyUndone: true, reverted: 0, failures: [], at: already.at })
    }

    const { reverted, failures } = await revertOperations(ops)
    const at = new Date().toISOString()
    await writeRecord(recordKey, { at, reverted })

    return NextResponse.json({
      ok: failures.length === 0,
      reverted,
      failures,
      at,
    })
  } catch (error) {
    if (error instanceof AssistantError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[assistant/undo]", error)
    return NextResponse.json({ error: "Undo failed.", code: "undo_failed" }, { status: 500 })
  }
}
