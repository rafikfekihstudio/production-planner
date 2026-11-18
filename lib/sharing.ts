export const AVAILABILITY_STATUSES = ["available", "busy", "tentative", "off"] as const

export type AvailabilityValue = (typeof AVAILABILITY_STATUSES)[number]
export type DayStatus = AvailabilityValue | "unset"

export const SHARE_FIELDS = ["availability", "progress", "tasks"] as const
export type ShareField = (typeof SHARE_FIELDS)[number]

export const DEFAULT_SHARE_FIELDS: ShareField[] = [...SHARE_FIELDS]

export const SHARE_FIELD_LABELS: Record<ShareField, string> = {
  availability: "Open days",
  progress: "Project progress",
  tasks: "Task notes",
}

export function parseShareFields(raw: string | null): ShareField[] {
  if (!raw) return DEFAULT_SHARE_FIELDS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_SHARE_FIELDS
    const valid = parsed.filter((v): v is ShareField => SHARE_FIELDS.includes(v as ShareField))
    return valid.length > 0 ? valid : DEFAULT_SHARE_FIELDS
  } catch {
    return DEFAULT_SHARE_FIELDS
  }
}

export function isAvailabilityValue(value: unknown): value is AvailabilityValue {
  return typeof value === "string" && (AVAILABILITY_STATUSES as readonly string[]).includes(value)
}
