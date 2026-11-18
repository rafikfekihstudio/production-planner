import { readValue, writeValue } from "@/lib/kv"

export { readValue as readRecord, writeValue as writeRecord }

export function applyRecordKey(userId: string, requestId: string) {
  return `assistant:apply:${userId}:${requestId}`
}

export function undoRecordKey(userId: string, tokenHash: string) {
  return `assistant:undo:${userId}:${tokenHash}`
}
