"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Clock, Loader2, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2 } from "lucide-react"
import {
  restoreDefaultPrefs,
  restoreDefaultRules,
  savePrefs,
  saveRules,
} from "@/lib/actions/settings"
import {
  KNOWN_MODELS,
  THINKING_OPTIONS,
  type AssistantPrefs,
  type ThinkingPreference,
} from "@/lib/assistant/preferences"
import { isTime, prettyDate, toMinutes } from "@/lib/assistant/time"
import type { UpcomingBlock } from "@/lib/assistant/simulate"
import {
  ruleViolations,
  summarizeRules,
  summarizeWorkDays,
  WEEKDAYS,
  WEEKDAY_LABELS,
  type ProtectedWindow,
  type ScheduleRules,
  type Weekday,
  type WorkDay,
} from "@/lib/schedule"

type Props = {
  initialRules: ScheduleRules
  initialPrefs: AssistantPrefs
  upcoming: UpcomingBlock[]
  today: string
}

const MAX_WINDOWS = 12

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function timeProblem(start: string, end: string): string | null {
  if (!isTime(start) || !isTime(end)) return "Use a 24h clock time like 09:00."
  if (toMinutes(end) <= toMinutes(start)) return "End time must be after start time."
  return null
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on ? "border-teal/60 bg-teal/30" : "border-border bg-surface-2"
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? "left-[18px] bg-teal" : "left-0.5 bg-muted"
        }`}
      />
    </button>
  )
}

function DayChip({
  day,
  active,
  onClick,
}: {
  day: Weekday
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`mono rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors ${
        active
          ? "border-gold/50 bg-gold/15 text-gold"
          : "border-border bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {WEEKDAY_LABELS[day].slice(0, 3)}
    </button>
  )
}

export function SettingsForm({ initialRules, initialPrefs, upcoming, today }: Props) {
  const router = useRouter()
  const [rules, setRules] = useState<ScheduleRules>(() => clone(initialRules))
  const [prefs, setPrefs] = useState<AssistantPrefs>(() => clone(initialPrefs))
  const [savedRules, setSavedRules] = useState(() => JSON.stringify(initialRules))
  const [savedPrefs, setSavedPrefs] = useState(() => JSON.stringify(initialPrefs))
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | null>(null)

  const rulesDirty = JSON.stringify(rules) !== savedRules
  const prefsDirty = JSON.stringify(prefs) !== savedPrefs
  const dirty = rulesDirty || prefsDirty

  const problems = useMemo(() => {
    const found: string[] = []
    for (const day of WEEKDAYS) {
      const workDay = rules.workDays[day]
      if (!workDay.enabled) continue
      const problem = timeProblem(workDay.start, workDay.end)
      if (problem) found.push(`${WEEKDAY_LABELS[day]}: ${problem}`)
    }
    for (const window of rules.protectedWindows) {
      if (window.label.trim().length < 2) {
        found.push(`A protected window needs a name.`)
        continue
      }
      const problem = timeProblem(window.start, window.end)
      if (problem) found.push(`${window.label}: ${problem}`)
      if (window.days.length === 0) found.push(`${window.label}: pick at least one day.`)
    }
    return found
  }, [rules])

  const summary = useMemo(() => summarizeWorkDays(rules), [rules])
  const promptLines = useMemo(() => summarizeRules(rules), [rules])

  // Existing blocks the edited rules would reject. Advisory only: saving the
  // rules never moves anything already on the calendar.
  const conflicts = useMemo(() => {
    const found: Array<{ block: UpcomingBlock; reason: string }> = []
    for (const block of upcoming) {
      const reasons = ruleViolations(rules, {
        title: block.title,
        date: block.date,
        start: toMinutes(block.start),
        end: toMinutes(block.end),
        area: block.area,
      })
      if (reasons.length > 0) found.push({ block, reason: reasons[0] })
    }
    return found
  }, [rules, upcoming])

  function updateDay(day: Weekday, patch: Partial<WorkDay>) {
    setRules((prev) => ({
      ...prev,
      workDays: { ...prev.workDays, [day]: { ...prev.workDays[day], ...patch } },
    }))
  }

  function updateWindow(id: string, patch: Partial<ProtectedWindow>) {
    setRules((prev) => ({
      ...prev,
      protectedWindows: prev.protectedWindows.map((window) =>
        window.id === id ? { ...window, ...patch } : window,
      ),
    }))
  }

  function toggleWindowDay(id: string, day: Weekday) {
    setRules((prev) => ({
      ...prev,
      protectedWindows: prev.protectedWindows.map((window) => {
        if (window.id !== id) return window
        const has = window.days.includes(day)
        return {
          ...window,
          days: has ? window.days.filter((d) => d !== day) : [...window.days, day],
        }
      }),
    }))
  }

  function addWindow() {
    if (rules.protectedWindows.length >= MAX_WINDOWS) return
    const window: ProtectedWindow = {
      id: crypto.randomUUID(),
      label: "New protected window",
      start: "12:00",
      end: "13:00",
      days: [...WEEKDAYS],
      allowWords: [],
    }
    setRules((prev) => ({ ...prev, protectedWindows: [...prev.protectedWindows, window] }))
  }

  function removeWindow(id: string) {
    setRules((prev) => ({
      ...prev,
      protectedWindows: prev.protectedWindows.filter((window) => window.id !== id),
    }))
  }

  async function save() {
    if (saving || problems.length > 0) return
    setSaving(true)
    setMessage(null)
    try {
      if (rulesDirty) {
        const next = await saveRules(rules)
        setRules(next)
        setSavedRules(JSON.stringify(next))
      }
      if (prefsDirty) {
        const next = await savePrefs(prefs)
        setPrefs(next)
        setSavedPrefs(JSON.stringify(next))
      }
      setMessage({ kind: "saved", text: "Saved. The assistant now uses these rules." })
      router.refresh()
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not save the settings.",
      })
    } finally {
      setSaving(false)
    }
  }

  async function restoreDefaults() {
    setResetting(true)
    setMessage(null)
    try {
      const [nextRules, nextPrefs] = await Promise.all([restoreDefaultRules(), restoreDefaultPrefs()])
      setRules(nextRules)
      setPrefs(nextPrefs)
      setSavedRules(JSON.stringify(nextRules))
      setSavedPrefs(JSON.stringify(nextPrefs))
      setConfirmReset(false)
      setMessage({ kind: "saved", text: "Restored the default rules and assistant settings." })
      router.refresh()
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not restore the defaults.",
      })
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="serif text-4xl text-foreground">Settings</h1>
          <p className="mono mt-1 text-xs uppercase tracking-widest text-muted">
            Scheduling rules the assistant must obey
          </p>
        </div>
        <div className="mono text-[10px] uppercase tracking-widest text-muted">
          {summary}
        </div>
      </header>

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            message.kind === "saved"
              ? "border-teal/40 bg-teal/10 text-teal"
              : "border-danger/40 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </div>
      )}

      {problems.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          <p className="font-medium">Fix these before saving:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Existing blocks vs edited rules -------------------------------- */}
      {conflicts.length > 0 && (
        <div className="rounded-md border border-gold/30 bg-gold/[0.06] px-3 py-2.5 text-xs text-muted">
          <p className="text-foreground">
            {conflicts.length} upcoming {conflicts.length === 1 ? "block falls" : "blocks fall"} outside
            these rules (from {prettyDate(today)} onward).
          </p>
          <ul className="mt-1.5 space-y-1">
            {conflicts.slice(0, 5).map(({ block, reason }) => (
              <li key={block.id} className="flex flex-wrap gap-x-2">
                <span className="mono whitespace-nowrap text-[10px] uppercase tracking-widest text-gold">
                  {prettyDate(block.date)} {block.start}
                </span>
                <span className="text-foreground">{block.title}</span>
                <span>— {reason}</span>
              </li>
            ))}
          </ul>
          {conflicts.length > 5 && (
            <p className="mt-1">…and {conflicts.length - 5} more.</p>
          )}
          <p className="mt-1.5">
            Saving does not move them. The assistant only enforces the rules on new proposals, so
            these existing blocks stay exactly where they are.
          </p>
        </div>
      )}

      {/* Working hours ------------------------------------------------- */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Clock className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Working hours</h2>
        </div>
        <div className="divide-y divide-border">
          {WEEKDAYS.map((day) => {
            const workDay = rules.workDays[day]
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <span className="w-24 text-sm text-foreground">{WEEKDAY_LABELS[day]}</span>
                <Toggle
                  on={workDay.enabled}
                  onChange={(enabled) => updateDay(day, { enabled })}
                  label={`${WEEKDAY_LABELS[day]} working day`}
                />
                <span
                  className={`mono w-16 text-[10px] uppercase tracking-widest ${
                    workDay.enabled ? "text-teal" : "text-muted"
                  }`}
                >
                  {workDay.enabled ? "Work" : "Off"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    value={workDay.start}
                    disabled={!workDay.enabled}
                    aria-label={`${WEEKDAY_LABELS[day]} start time`}
                    onChange={(e) => updateDay(day, { start: e.target.value })}
                    className="mono rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none disabled:opacity-40"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    step={900}
                    value={workDay.end}
                    disabled={!workDay.enabled}
                    aria-label={`${WEEKDAY_LABELS[day]} end time`}
                    onChange={(e) => updateDay(day, { end: e.target.value })}
                    className="mono rounded-md border border-border bg-surface-2 px-2 py-1 text-xs text-foreground focus:border-gold focus:outline-none disabled:opacity-40"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted">
          Switching a day off means no work block may be scheduled there. Personal blocks stay
          allowed — that is how the studio keeps a rhythm outside production hours.
        </p>
      </section>

      {/* Protected windows ---------------------------------------------- */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-gold" />
            <h2 className="mono text-[10px] uppercase tracking-widest text-muted">
              Protected windows
            </h2>
          </div>
          <button
            type="button"
            onClick={addWindow}
            disabled={rules.protectedWindows.length >= MAX_WINDOWS}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-gold/50 hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-3 w-3" /> Add window
          </button>
        </div>

        {rules.protectedWindows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted">
            No protected windows. The assistant may place any block anywhere inside working hours.
          </div>
        )}

        <div className="divide-y divide-border">
          {rules.protectedWindows.map((window) => (
            <div key={window.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={window.label}
                  onChange={(e) => updateWindow(window.id, { label: e.target.value })}
                  placeholder="e.g. Morning routine"
                  aria-label="Protected window name"
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:border-gold focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    value={window.start}
                    aria-label="Window start time"
                    onChange={(e) => updateWindow(window.id, { start: e.target.value })}
                    className="mono rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground focus:border-gold focus:outline-none"
                  />
                  <span className="text-muted">–</span>
                  <input
                    type="time"
                    step={900}
                    value={window.end}
                    aria-label="Window end time"
                    onChange={(e) => updateWindow(window.id, { end: e.target.value })}
                    className="mono rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-foreground focus:border-gold focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeWindow(window.id)}
                  className="rounded-md border border-border p-1.5 text-muted transition-colors hover:border-danger/50 hover:text-danger"
                  aria-label={`Remove ${window.label}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {WEEKDAYS.map((day) => (
                  <DayChip
                    key={day}
                    day={day}
                    active={window.days.includes(day)}
                    onClick={() => toggleWindowDay(window.id, day)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => updateWindow(window.id, { days: [...WEEKDAYS] })}
                  className="mono ml-1 text-[10px] uppercase tracking-widest text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  every day
                </button>
              </div>

              <div>
                <label className="mono mb-1 block text-[10px] uppercase tracking-widest text-muted">
                  Allowed titles
                </label>
                <input
                  value={window.allowWords.join(", ")}
                  onChange={(e) =>
                    updateWindow(window.id, {
                      allowWords: e.target.value
                        .split(",")
                        .map((word) => word.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="morning, priming, quiet, breakfast"
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-foreground focus:border-gold focus:outline-none placeholder:text-muted/60"
                />
                <p className="mt-1 text-[11px] text-muted">
                  A block may only sit inside this window when its title contains one of these words,
                  separated by commas. Leave it empty and nothing else may be placed there.
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Assistant ------------------------------------------------------ */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-3.5 w-3.5 text-gold" />
          <h2 className="mono text-[10px] uppercase tracking-widest text-muted">Assistant</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <div>
            <label className="mono mb-1 block text-[10px] uppercase tracking-widest text-muted">
              Preferred model
            </label>
            <select
              value={prefs.model ?? ""}
              onChange={(e) => setPrefs((prev) => ({ ...prev, model: e.target.value || null }))}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            >
              <option value="">Automatic (recommended)</option>
              {KNOWN_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              Automatic tries the models in order and moves on when one is busy or out of quota.
            </p>
          </div>
          <div>
            <label className="mono mb-1 block text-[10px] uppercase tracking-widest text-muted">
              Thinking
            </label>
            <select
              value={prefs.thinking ?? "default"}
              onChange={(e) =>
                setPrefs((prev) => ({
                  ...prev,
                  thinking: e.target.value === "default" ? null : (e.target.value as ThinkingPreference),
                }))
              }
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
            >
              {THINKING_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "default" ? "Default (fast)" : option}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              More thinking is slower and can cost more. Fast is best for normal scheduling requests.
            </p>
          </div>
        </div>
      </section>

      {/* What the assistant is told ------------------------------------- */}
      <section className="rounded-lg border border-dashed border-border bg-surface/60 p-4">
        <h2 className="mono text-[10px] uppercase tracking-widest text-muted">
          What the assistant is told
        </h2>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {promptLines.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="text-gold">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Sticky save bar ------------------------------------------------- */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur md:left-60">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 pr-40 sm:pr-44 md:pl-8 md:pr-44">
          <div className="mono text-[10px] uppercase tracking-widest text-muted">
            {dirty ? "Unsaved changes" : "Everything saved"}
          </div>
          <div className="flex items-center gap-2">
            {confirmReset ? (
              <>
                <span className="text-[11px] text-danger">Restore defaults?</span>
                <button
                  type="button"
                  onClick={restoreDefaults}
                  disabled={resetting}
                  className="rounded-md bg-danger/15 px-3 py-1.5 text-xs text-danger hover:bg-danger/25 disabled:opacity-50"
                >
                  {resetting ? "Restoring…" : "Yes, restore"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:border-danger/40 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" /> Restore defaults
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || problems.length > 0}
              className="flex items-center gap-1.5 rounded-md bg-gold px-4 py-1.5 text-xs font-medium text-background hover:bg-gold-soft disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
