export const TIMEZONE = "Africa/Tunis"

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

export function isTime(value: string): boolean {
  return TIME_RE.test(value)
}

/** Current calendar date in the studio timezone, as YYYY-MM-DD. */
export function todayInTimezone(now: Date = new Date()): string {
  // en-CA yields ISO-shaped YYYY-MM-DD; timeZone shifts to Africa/Tunis.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function clockInTimezone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now)
}

/** Weekday for a YYYY-MM-DD string without timezone drift (noon UTC). */
export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(d)
}

export function isSunday(date: string): boolean {
  return weekdayOf(date) === "Sunday"
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

export function toClock(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function endClock(start: string, minutes: number): string {
  return toClock(toMinutes(start) + minutes)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function relativeDay(date: string, today: string): string {
  if (date === today) return "today"
  if (date === addDays(today, 1)) return "tomorrow"
  if (date === addDays(today, -1)) return "yesterday"
  const diff = Math.round(
    (new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000,
  )
  if (diff > 1 && diff <= 7) return `in ${diff} days`
  if (diff < -1 && diff >= -7) return `${Math.abs(diff)} days ago`
  return date
}

export function prettyDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`))
}
