"use client"

import { TIMELINE, type Task, type WorkType } from "./timeline-client"

export function Backlog({
  tasks,
  workTypes,
  onSchedule,
  onSelect,
  onUnschedule,
  anchorDate,
  view,
}: {
  tasks: Task[]
  workTypes: WorkType[]
  onSchedule: (id: number, date: string, startTime: string) => void
  onSelect: (t: Task) => void
  onUnschedule: (id: number) => void
  anchorDate: string
  view: "day" | "week"
}) {
  const targetDate = anchorDate
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="mono text-[10px] uppercase tracking-widest text-muted">Backlog</span>
        <span className="mono text-[10px] text-muted">{tasks.length}</span>
      </div>
      <div className="max-h-[60vh] overflow-y-auto divide-y divide-border/50">
        {tasks.length === 0 && (
          <p className="p-4 text-xs text-muted text-center">No unscheduled tasks.</p>
        )}
        {tasks.map((t) => {
          const wt = workTypes.find((w) => w.id === t.workTypeId)
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/task-id", String(t.id))
                e.dataTransfer.effectAllowed = "move"
              }}
              className="px-3 py-2 hover:bg-surface-2 cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{t.title}</div>
                  <div className="mono text-[10px] text-muted truncate">
                    {wt?.name || "—"} · {t.estimatedMinutes}m
                    {t.deadline ? ` · due ${t.deadline}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => onSelect(t)}
                  className="text-[10px] text-muted hover:text-gold shrink-0"
                >
                  edit
                </button>
              </div>
              <button
                onClick={() => onSchedule(t.id, targetDate, "09:00")}
                className="mt-1.5 w-full rounded border border-border bg-surface-2 px-2 py-1 text-[10px] text-muted hover:text-foreground hover:border-gold/40"
              >
                Schedule on {view === "day" ? targetDate : "anchor day"}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}