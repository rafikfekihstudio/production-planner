"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarPlus,
  Check,
  Loader2,
  Send,
  Sparkles,
  Timer,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import type { PreviewStep } from "@/lib/assistant/simulate"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  blocked?: boolean
  issues?: string[]
}

type PlanResponse = {
  ok: boolean
  blocked: boolean
  reply: string
  mode: "propose" | "answer" | "clarify"
  notes: string[]
  operations: unknown[]
  preview: PreviewStep[]
  issues: string[]
  repaired: boolean
  meta: { model: string; today: string; timezone: string; latencyMs: number; existingBlocks: number }
}

type AppliedResponse = {
  applied: { created: number; moved: number; resized: number; deleted: number; completed: number }
  undoToken: string
  expiresAt: number
  replayed?: boolean
}

const SUGGESTIONS = [
  "Plan my next week",
  "Add one hour of AI video learning every weekday",
  "Make Wednesday a client-work day",
  "Move Monday's SEO review to Thursday",
]

function newId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `m-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  }
}

function kindIcon(kind: PreviewStep["kind"]) {
  if (kind === "create") return <CalendarPlus className="h-3.5 w-3.5" />
  if (kind === "move") return <ArrowRightLeft className="h-3.5 w-3.5" />
  if (kind === "resize") return <Timer className="h-3.5 w-3.5" />
  if (kind === "done") return <Check className="h-3.5 w-3.5" />
  return <Trash2 className="h-3.5 w-3.5" />
}

export function AssistantPanel() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<(PlanResponse & { requestId: string }) | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<AppliedResponse | null>(null)
  const [undoState, setUndoState] = useState<"idle" | "busy" | "done" | "error">("idle")
  const [retryPrompt, setRetryPrompt] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Google tells us how long the free-tier window needs; count it down visibly
  // instead of letting the user hammer a request that will just 429 again.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  const destructiveCount = useMemo(
    () => (plan ? plan.preview.filter((step) => step.destructive).length : 0),
    [plan],
  )

  useEffect(() => {
    if (!open) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, plan, open, applied, sending])

  const pushMessage = useCallback((message: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { ...message, id: newId() }])
  }, [])

  async function send(textOverride?: string) {
    const text = (textOverride ?? input).trim()
    if (!text || sending) return

    const history: ChatMessage[] = [...messages, { id: newId(), role: "user", content: text }]
    setMessages(history)
    setInput("")
    setSending(true)
    setError(null)
    setPlan(null)
    setApplied(null)
    setUndoState("idle")
    setConfirmDelete(false)
    setRetryPrompt(null)
    setCooldown(0)

    try {
      const response = await fetch("/api/assistant/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (PlanResponse & { error?: string; code?: string; retryAfterMs?: number })
        | null

      if (!response.ok || !data) {
        const message =
          data?.error ??
          (response.status === 503
            ? "The assistant is not configured yet. Add GEMINI_API_KEY to .env.local and restart."
            : response.status === 401
              ? "Your session expired. Sign in again."
              : "The assistant could not answer. Nothing was changed.")
        pushMessage({ role: "assistant", content: message, blocked: true })
        if (response.status !== 401) {
          setRetryPrompt(text)
          setCooldown(data?.retryAfterMs ? Math.ceil(data.retryAfterMs / 1000) : 0)
        }
        return
      }

      pushMessage({
        role: "assistant",
        content: data.reply,
        blocked: data.blocked,
        issues: data.blocked ? data.issues : undefined,
      })

      if (data.operations.length > 0 && data.preview.length > 0) {
        setPlan({ ...data, requestId: newId() })
      }
    } catch {
      const message = "Network error reaching the assistant. Nothing was changed."
      pushMessage({ role: "assistant", content: message, blocked: true })
      setRetryPrompt(text)
    } finally {
      setSending(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  async function applyPlan() {
    if (!plan || applying) return
    if (destructiveCount > 0 && !confirmDelete) return

    setApplying(true)
    setError(null)
    try {
      const response = await fetch("/api/assistant/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: plan.requestId,
          operations: plan.operations,
          confirmDelete,
        }),
      })
      const data = (await response.json().catch(() => null)) as
        | (AppliedResponse & { error?: string; issues?: string[] })
        | null

      if (!response.ok || !data) {
        const detail = data?.issues?.length ? ` ${data.issues.slice(0, 3).join(" ")}` : ""
        setError(`${data?.error ?? "Could not apply the plan."}${detail}`)
        return
      }

      setApplied(data)
      setPlan(null)
      setConfirmDelete(false)
      setUndoState("idle")

      const parts = [
        data.applied.created ? `${data.applied.created} created` : null,
        data.applied.moved ? `${data.applied.moved} moved` : null,
        data.applied.resized ? `${data.applied.resized} resized` : null,
        data.applied.deleted ? `${data.applied.deleted} deleted` : null,
        data.applied.completed ? `${data.applied.completed} marked done` : null,
      ].filter(Boolean)

      pushMessage({
        role: "assistant",
        content: `${data.replayed ? "Already applied:" : "Done."} ${parts.join(", ") || "No changes"} on the calendar. Undo is available for 30 minutes.`,
      })
      router.refresh()
    } catch {
      setError("Network error while applying. Check the timeline before retrying.")
    } finally {
      setApplying(false)
    }
  }

  async function undo() {
    if (!applied || undoState === "busy") return
    setUndoState("busy")
    setError(null)
    try {
      const response = await fetch("/api/assistant/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: applied.undoToken }),
      })
      const data = (await response.json().catch(() => null)) as
        | { ok: boolean; reverted: number; failures?: string[]; error?: string; alreadyUndone?: boolean }
        | null

      if (!response.ok || !data) {
        setUndoState("error")
        setError(data?.error ?? "Undo failed.")
        return
      }

      setUndoState("done")
      pushMessage({
        role: "assistant",
        content: data.alreadyUndone
          ? "That change was already undone."
          : `Reverted ${data.reverted} change${data.reverted === 1 ? "" : "s"}. The calendar is back to how it was.`,
      })
      router.refresh()
    } catch {
      setUndoState("error")
      setError("Network error while undoing.")
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-gold/40 bg-surface px-4 py-3 text-sm text-gold shadow-lg transition-colors hover:bg-surface-2"
      >
        <Sparkles className="h-4 w-4" />
        Assistant
      </button>
    )
  }

  return (
    <section
      aria-label="Scheduling assistant"
      className="fixed bottom-4 right-4 z-40 flex h-[min(700px,calc(100vh-2rem))] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="serif text-lg leading-none text-foreground">Assistant</div>
          <div className="mono mt-1 text-[10px] uppercase tracking-[0.2em] text-muted">
            Gemini · proposes, you confirm
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Tell me what to change, or ask what the week looks like. I read your calendar, propose exact blocks,
              and only write after you confirm.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted transition-colors hover:text-gold"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[92%] rounded-lg border px-3 py-2 text-sm leading-relaxed ${
                message.role === "user"
                  ? "border-gold/30 bg-gold/10 text-foreground"
                  : message.blocked
                    ? "border-danger/40 bg-danger/5 text-foreground"
                    : "border-border bg-surface-2 text-foreground"
              }`}
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
              {message.issues && message.issues.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs text-muted">
                  {message.issues.slice(0, 4).map((issue) => (
                    <li key={issue} className="flex gap-1.5">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reading the calendar…
          </div>
        )}

        {plan && (
          <div className="rounded-lg border border-gold/30 bg-gold/5 p-3">
            <div className="mono mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-gold">
              <span>
                {plan.blocked ? "Blocked" : "Proposed changes"} · {plan.preview.length}
              </span>
              {plan.repaired && <span className="text-muted">adjusted</span>}
            </div>

            {plan.preview.length > 0 && (
              <ul className="space-y-2">
                {plan.preview.map((step, index) => (
                  <li key={`${step.kind}-${step.taskId ?? index}-${index}`} className="flex gap-2 text-xs">
                    <span
                      className={`mt-0.5 shrink-0 ${step.destructive ? "text-danger" : "text-gold"}`}
                      aria-hidden
                    >
                      {kindIcon(step.kind)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-foreground">{step.summary}</span>
                      {step.before && (
                        <span className="mono mt-0.5 block text-[10px] uppercase tracking-wide text-muted">
                          was {step.before}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.issues.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs text-muted">
                {plan.issues.slice(0, 5).map((issue) => (
                  <li key={issue} className="flex gap-1.5">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}

            {plan.notes.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-border/70 pt-2 text-xs text-muted">
                {plan.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            )}

            {plan.blocked ? (
              <p className="mono mt-3 text-[10px] uppercase tracking-[0.2em] text-muted">
                Nothing will be written — ask me to adjust it
              </p>
            ) : (
              <>
                {destructiveCount > 0 && (
                  <label className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={confirmDelete}
                      onChange={(event) => setConfirmDelete(event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--danger)]"
                    />
                    <span>
                      I understand {destructiveCount} task{destructiveCount === 1 ? "" : "s"} will be deleted. Undo
                      restores {destructiveCount === 1 ? "it" : "them"} for 30 minutes.
                    </span>
                  </label>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={applyPlan}
                    disabled={applying || (destructiveCount > 0 && !confirmDelete)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md border border-gold/40 bg-gold/15 px-3 py-2 text-xs text-gold transition-colors hover:bg-gold/25 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Apply {plan.preview.length} change{plan.preview.length === 1 ? "" : "s"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlan(null)
                      setConfirmDelete(false)
                    }}
                    className="rounded-md border border-border px-3 py-2 text-xs text-muted transition-colors hover:text-foreground"
                  >
                    Discard
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {applied && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2">
            <span className="mono text-[10px] uppercase tracking-[0.2em] text-teal">
              {undoState === "done" ? "Reverted" : "Applied"}
            </span>
            <button
              type="button"
              onClick={undo}
              disabled={undoState === "busy" || undoState === "done"}
              className="flex items-center gap-1.5 rounded-md border border-teal/40 px-2.5 py-1 text-xs text-teal transition-colors hover:bg-teal/15 disabled:opacity-40"
            >
              {undoState === "busy" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Undo2 className="h-3 w-3" />
              )}
              Undo
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-foreground">
            {error}
          </div>
        )}

        {retryPrompt && !sending && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs">
            <span className="text-muted">
              {cooldown > 0 ? `Free-tier throttle. Retry in ${cooldown}s.` : "Ready to try that again."}
            </span>
            <button
              type="button"
              onClick={() => {
                const prompt = retryPrompt
                setRetryPrompt(null)
                void send(prompt)
              }}
              disabled={cooldown > 0}
              className="rounded-md border border-gold/40 px-2.5 py-1 text-xs text-gold transition-colors hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {cooldown > 0 ? `Retry in ${cooldown}s` : "Retry"}
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        className="border-t border-border p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Add 90 minutes of cold outreach tomorrow morning…"
            className="max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-gold/50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-gold/15 text-gold transition-colors hover:bg-gold/25 disabled:opacity-30"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <p className="mono mt-2 text-[10px] uppercase tracking-[0.15em] text-muted">
          {plan?.meta.model ?? "gemini"} · {plan?.meta.timezone ?? "Africa/Tunis"} · nothing is written without
          confirmation
        </p>
      </form>
    </section>
  )
}
