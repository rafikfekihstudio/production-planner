import { addDays, endClock, isDate } from "./time"

/**
 * A day view is a read-only answer. We render it from the calendar state that
 * was already loaded for the prompt instead of trusting a small model to copy
 * a dozen blocks out of a long context — that produced empty replies and
 * invented totals.
 */

const VIEW_INTENT =
  /\b(show|see|list|review|display|view|read|walk me through|what'?s on|what is on|what'?s my|what is my|tell me about|give me|plan for|schedule for|agenda for)\b/i
const DAY_WORD = /\b(plan|schedule|calendar|blocks?|tasks?|agenda|day)\b/i
// "Can you show me..." is still a day view; change requests are filtered by
// MUTATION_INTENT in the plan route before this shortcut is taken.
const NOT_A_VIEW = /\b(how (do|can|to)|help me|teach me)\b/i

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function nearestMonthDay(text: string, today: string): string | null {
  const match = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  )
  if (!match) return null
  const month = MONTHS[match[1].slice(0, 3).toLowerCase()]
  if (month === undefined) return null
  const day = Number(match[2])
  const year = Number(today.slice(0, 4))
  const now = new Date(`${today}T12:00:00Z`).getTime()
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidateYear of [year - 1, year, year + 1]) {
    const candidate = `${candidateYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    if (!isDate(candidate)) continue
    const distance = Math.abs(new Date(`${candidate}T12:00:00Z`).getTime() - now)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/** Returns the date a read-only day-view request refers to, or null if it is not one. */
export function resolvePlanDisplayDate(text: string, today: string): string | null {
  if (NOT_A_VIEW.test(text) || !VIEW_INTENT.test(text) || !DAY_WORD.test(text)) return null

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso && isDate(iso[1])) return iso[1]

  if (/\bday after tomorrow\b/i.test(text)) return addDays(today, 2)
  if (/\btomorrow\b/i.test(text)) return addDays(today, 1)
  if (/\btoday\b|\btonight\b/i.test(text)) return today
  if (/\byesterday\b/i.test(text)) return addDays(today, -1)

  const monthDay = nearestMonthDay(text, today)
  if (monthDay) return monthDay

  const weekday = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[1].toLowerCase())
    const current = new Date(`${today}T12:00:00Z`).getUTCDay()
    let distance = (target - current + 7) % 7
    if (/\bnext\b/i.test(text)) distance += 7
    else if (distance === 0 && /\bthis\b/i.test(text)) distance = 0
    return addDays(today, distance)
  }

  return null
}

type DayBlock = {
  date: string
  start: string
  end: string
  minutes: number
  title: string
  status: string
}

function formatTotal(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours} hours ${remainder} minutes`
  if (hours) return `${hours} hours`
  return `${remainder} minutes`
}

/** Build a reply that lists every scheduled block for one date, in time order. */
export function renderPlanDisplay(date: string, blocks: DayBlock[], today: string): string {
  const dayBlocks = blocks
    .filter((block) => block.date === date)
    .sort((a, b) => a.start.localeCompare(b.start))

  const fullDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`))

  if (dayBlocks.length === 0) {
    return `Nothing is scheduled for that day (${fullDate}).`
  }

  const label = date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : ` ${fullDate}`
  const lines = dayBlocks.map((block) => {
    const end = block.end || endClock(block.start, block.minutes)
    const status = block.status === "scheduled" ? "" : ` [${block.status}]`
    return `${block.start}–${end} ${block.title}${status}`
  })
  const totalMinutes = dayBlocks.reduce((sum, block) => sum + block.minutes, 0)
  const count = dayBlocks.length
  lines.push(
    `Total: ${formatTotal(totalMinutes)} across ${count} block${count === 1 ? "" : "s"}.`,
  )
  return `Here is your plan for ${label}:\n${lines.join("\n")}`
}
