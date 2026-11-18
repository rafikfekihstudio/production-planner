export const HOUR_START = 7
export const HOUR_END = 23
export const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i)

export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`
}

export function hashString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

export type HourRange = { date: string; startHour: number; endHour: number }
export type BookedSlot = { date: string; hour: number; tokenId: number }

/** Monday of the week containing `date`, so curation stays stable as the rolling window moves. */
export function weekKey(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

export type DayView = {
  date: string
  /** Real commitments (marked-busy blocks and scheduled work). */
  busyHours: number[]
  /** Hours another booking has already taken. */
  bookedHours: number[]
  /** The one curated hour this link may book normally, if any. */
  openHour: number | null
  /** Whether this date has reached its booking capacity. */
  full: boolean
}

/**
 * Builds the calendar one client sees. Busy hours come from real marked-busy
 * blocks and real scheduled work — never invented. Booked hours are tracked
 * separately so the table can distinguish "Busy" from "Taken". Open hours are
 * a small, stable subset of your genuine openings, at most one per day and
 * capped per week, so each client sees a different but consistent
 * "busy yet reachable" picture.
 */
export function buildDayViews({
  days,
  openRanges,
  busyRanges,
  booked,
  linkId,
  slotsPerWeek,
  capacityPerDay,
}: {
  days: string[]
  openRanges: HourRange[]
  busyRanges: HourRange[]
  booked: BookedSlot[]
  linkId: number
  slotsPerWeek: number
  capacityPerDay: number
}): DayView[] {
  const bookedCount = new Map<string, number>()
  const bookedByDate = new Map<string, Set<number>>()
  for (const b of booked) {
    bookedCount.set(b.date, (bookedCount.get(b.date) ?? 0) + 1)
    const set = bookedByDate.get(b.date) ?? new Set<number>()
    set.add(b.hour)
    bookedByDate.set(b.date, set)
  }

  const busyByDate = new Map<string, Set<number>>()
  for (const range of busyRanges) {
    const set = busyByDate.get(range.date) ?? new Set<number>()
    for (let h = Math.max(HOUR_START, range.startHour); h < Math.min(HOUR_END, range.endHour); h++) set.add(h)
    busyByDate.set(range.date, set)
  }

  const candidatesByDate = new Map<string, number[]>()
  for (const range of openRanges) {
    const busy = busyByDate.get(range.date) ?? new Set<number>()
    const taken = bookedByDate.get(range.date) ?? new Set<number>()
    const list = candidatesByDate.get(range.date) ?? []
    for (let h = Math.max(HOUR_START, range.startHour); h < Math.min(HOUR_END, range.endHour); h++) {
      if (!busy.has(h) && !taken.has(h) && !list.includes(h)) list.push(h)
    }
    candidatesByDate.set(range.date, list)
  }

  const views: DayView[] = days.map((date) => ({
    date,
    busyHours: Array.from(busyByDate.get(date) ?? []).sort((a, b) => a - b),
    bookedHours: Array.from(bookedByDate.get(date) ?? []).sort((a, b) => a - b),
    openHour: null,
    full: (bookedCount.get(date) ?? 0) >= capacityPerDay,
  }))

  const byDate = new Map(views.map((v) => [v.date, v]))
  const weeks = new Map<string, string[]>()
  for (const date of days) {
    const key = weekKey(date)
    weeks.set(key, [...(weeks.get(key) ?? []), date])
  }
  for (const week of weeks.values()) {
    const ranked = week
      .filter((date) => !byDate.get(date)!.full && (candidatesByDate.get(date)?.length ?? 0) > 0)
      .sort((a, b) => hashString(`${linkId}:${a}`) - hashString(`${linkId}:${b}`))
      .slice(0, slotsPerWeek)

    for (const date of ranked) {
      const options = candidatesByDate.get(date) ?? []
      const hour = options[hashString(`${linkId}:${date}:hour`) % options.length]
      byDate.get(date)!.openHour = hour
    }
  }

  return views
}
