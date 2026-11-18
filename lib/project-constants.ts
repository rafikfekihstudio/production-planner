export const PROJECT_STATUSES = [
  { value: "inquiry", label: "Inquiry", color: "#8a877f" },
  { value: "waiting_files", label: "Waiting files", color: "#c9a961" },
  { value: "ready", label: "Ready", color: "#4a9b8e" },
  { value: "scheduled", label: "Scheduled", color: "#3a7d72" },
  { value: "in_progress", label: "In progress", color: "#c9a961" },
  { value: "waiting_feedback", label: "Waiting feedback", color: "#c96161" },
  { value: "revision", label: "Revision", color: "#c96161" },
  { value: "completed", label: "Completed", color: "#4a9b8e" },
  { value: "archived", label: "Archived", color: "#8a877f" },
] as const

export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"]

export const PROJECT_STATUS_MAP = Object.fromEntries(
  PROJECT_STATUSES.map((s) => [s.value, s]),
) as Record<ProjectStatus, (typeof PROJECT_STATUSES)[number]>

export const BOARD_STATUSES = PROJECT_STATUSES.filter((s) => s.value !== "archived")

export const PROJECT_AREAS = [
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
] as const

export type ProjectArea = (typeof PROJECT_AREAS)[number]["value"]

export const AREA_STATUS_VALUES: Record<ProjectArea, ProjectStatus[]> = {
  work: [
    "inquiry",
    "waiting_files",
    "ready",
    "scheduled",
    "in_progress",
    "waiting_feedback",
    "revision",
    "completed",
    "archived",
  ],
  personal: ["inquiry", "ready", "scheduled", "in_progress", "completed", "archived"],
}

// Personal stage names reuse the same stored statuses with plainer labels.
const AREA_LABEL_OVERRIDES: Record<ProjectArea, Partial<Record<ProjectStatus, string>>> = {
  work: {},
  personal: {
    inquiry: "Idea",
    ready: "Planned",
    completed: "Done",
    in_progress: "In progress",
  },
}

export function statusLabel(area: ProjectArea, status: ProjectStatus): string {
  return AREA_LABEL_OVERRIDES[area][status] ?? PROJECT_STATUS_MAP[status]?.label ?? status
}

export function statusAllowedInArea(area: ProjectArea, status: ProjectStatus): boolean {
  return AREA_STATUS_VALUES[area].includes(status)
}


export const PRIORITIES = ["low", "medium", "high", "urgent"] as const

export const PRIORITY_COLOR: Record<string, string> = {
  low: "#8a877f",
  medium: "#4a9b8e",
  high: "#c9a961",
  urgent: "#c96161",
}

export function fmtMins(minutes: number): string {
  if (!minutes || minutes <= 0) return "0m"
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export function fmtHours(hours: number): string {
  return fmtMins(Math.round((hours || 0) * 60))
}

export function fmtDate(date?: string | null): string {
  if (!date) return "—"
  const d = new Date(date + "T00:00:00")
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export function isOverdue(date?: string | null): boolean {
  if (!date) return false
  const d = new Date(date + "T00:00:00")
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}
