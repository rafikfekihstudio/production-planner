import { createHmac, timingSafeEqual } from "node:crypto"
import { AssistantError } from "./gemini"

export type UndoOp =
  | { kind: "delete"; taskId: number }
  | {
      kind: "restore"
      taskId: number
      date: string | null
      start: string | null
      status: string
    }
  | { kind: "duration"; taskId: number; minutes: number }
  | { kind: "status"; taskId: number; status: string }
  | {
      kind: "recreate"
      task: {
        title: string
        projectId: number | null
        clientId: number | null
        workTypeId: number | null
        estimatedMinutes: number
        scheduledDate: string | null
        startTime: string | null
        deadline: string | null
        priority: "low" | "medium" | "high" | "urgent"
        status: "backlog" | "scheduled" | "in_progress" | "paused" | "completed" | "cancelled"
        clientVisibleNotes: string | null
        referenceUrl: string | null
        description: string | null
      }
    }

type UndoPayload = {
  v: 1
  iat: number
  uid: string
  ops: UndoOp[]
}

export const UNDO_TTL_MS = 30 * 60 * 1000

function secret() {
  const value = process.env.AUTH_SECRET
  if (!value) throw new AssistantError("AUTH_SECRET is not configured.", 500, "missing_secret")
  return value
}

function encode(payload: UndoPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url")
}

/**
 * The undo token is an HMAC-signed record of how to reverse an applied plan.
 * Client-side tampering cannot widen it into an arbitrary delete, and it
 * expires so a stale tab cannot revert work days later.
 */
export function signUndoToken(userId: string, ops: UndoOp[]): { token: string; expiresAt: number } {
  const iat = Date.now()
  const payload: UndoPayload = { v: 1, iat, uid: userId, ops }
  const body = encode(payload)
  return { token: `${body}.${sign(body)}`, expiresAt: iat + UNDO_TTL_MS }
}

export function verifyUndoToken(token: string, userId: string): UndoOp[] {
  const [body, signature] = token.split(".")
  if (!body || !signature) throw new AssistantError("Malformed undo token.", 400, "bad_undo_token")

  const expected = sign(body)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AssistantError("Undo token signature is invalid.", 403, "bad_undo_token")
  }

  let payload: UndoPayload
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UndoPayload
  } catch {
    throw new AssistantError("Undo token could not be read.", 400, "bad_undo_token")
  }

  if (payload.v !== 1 || !Array.isArray(payload.ops)) {
    throw new AssistantError("Undo token has an unsupported shape.", 400, "bad_undo_token")
  }
  if (payload.uid !== userId) {
    throw new AssistantError("This undo token belongs to another session.", 403, "bad_undo_token")
  }
  if (Date.now() - payload.iat > UNDO_TTL_MS) {
    throw new AssistantError("Undo window has expired (30 minutes).", 410, "undo_expired")
  }

  return payload.ops
}

export function hashToken(token: string) {
  return createHmac("sha256", secret()).update(token).digest("hex").slice(0, 32)
}
