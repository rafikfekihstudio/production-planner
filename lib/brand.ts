export const BUSINESS_NAME_KEY = "businessName"
export const DEFAULT_BUSINESS_NAME = "Production Planner"
export const MAX_BUSINESS_NAME_LENGTH = 60

/** Client-safe validation for the studio name shown across the app. */
export function businessNameProblem(value: string): string | null {
  const name = value.trim()
  if (!name) return "Enter a studio name."
  if (name.length > MAX_BUSINESS_NAME_LENGTH) {
    return `Use ${MAX_BUSINESS_NAME_LENGTH} characters or fewer.`
  }
  return null
}

export function normalizeBusinessName(input: unknown): string {
  if (typeof input !== "string") return DEFAULT_BUSINESS_NAME
  const name = input.trim().replace(/\s+/g, " ")
  if (!name || name.length > MAX_BUSINESS_NAME_LENGTH) return DEFAULT_BUSINESS_NAME
  return name
}
