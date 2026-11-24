import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai"
import { loadBusinessName } from "@/lib/business-name-store"
import { plannerSystemPrompt } from "./prompt"
import { modelPlanSchema, type ModelPlan } from "./schema"
import { DEFAULT_RULES, type ScheduleRules } from "@/lib/schedule"
import {
  DEFAULT_PREFS,
  normalizeThinking,
  type AssistantPrefs,
  type ThinkingPreference,
} from "./preferences"

export class AssistantError extends Error {
  status: number
  code: string
  /** Present on quota errors so the UI can count down instead of guessing. */
  retryAfterMs?: number
  constructor(message: string, status = 502, code = "assistant_error", retryAfterMs?: number) {
    super(message)
    this.name = "AssistantError"
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

const CREATE_SCHEMA = {
  type: Type.OBJECT,
  description: "Create a brand-new calendar block.",
  properties: {
    kind: { type: Type.STRING, enum: ["create"] },
    title: { type: Type.STRING, description: "Short, specific task title." },
    date: { type: Type.STRING, description: "Calendar date in YYYY-MM-DD." },
    start: { type: Type.STRING, description: "Start time on a 24h clock, HH:MM." },
    minutes: { type: Type.INTEGER, description: "Duration in minutes, 15 to 600, multiple of 15." },
    projectId: { type: Type.INTEGER, description: "Existing project id, or omit when none fits." },
    workTypeId: { type: Type.INTEGER, description: "Existing work type id, or omit." },
    priority: { type: Type.STRING, enum: ["low", "medium", "high", "urgent"] },
    area: { type: Type.STRING, enum: ["work", "personal"] },
    description: { type: Type.STRING, description: "One short line on the intended outcome." },
  },
  required: ["kind", "title", "date", "start", "minutes"],
  propertyOrdering: ["kind", "title", "date", "start", "minutes", "projectId", "workTypeId", "priority", "area", "description"],
}

const MOVE_SCHEMA = {
  type: Type.OBJECT,
  description: "Move an existing scheduled task to a new slot. date and start are the NEW slot.",
  properties: {
    kind: { type: Type.STRING, enum: ["move"] },
    taskId: { type: Type.INTEGER, description: "Task id from EXISTING SCHEDULE." },
    date: { type: Type.STRING, description: "New date, YYYY-MM-DD." },
    start: { type: Type.STRING, description: "New start time, HH:MM 24h." },
  },
  required: ["kind", "taskId", "date", "start"],
  propertyOrdering: ["kind", "taskId", "date", "start"],
}

const RESIZE_SCHEMA = {
  type: Type.OBJECT,
  description: "Change the duration of an existing scheduled task.",
  properties: {
    kind: { type: Type.STRING, enum: ["resize"] },
    taskId: { type: Type.INTEGER, description: "Task id from EXISTING SCHEDULE." },
    minutes: { type: Type.INTEGER, description: "New duration in minutes, 15 to 600, multiple of 15." },
  },
  required: ["kind", "taskId", "minutes"],
  propertyOrdering: ["kind", "taskId", "minutes"],
}

const DELETE_SCHEMA = {
  type: Type.OBJECT,
  description: "Delete an existing task. Destructive; the user must confirm.",
  properties: {
    kind: { type: Type.STRING, enum: ["delete"] },
    taskId: { type: Type.INTEGER, description: "Task id from EXISTING SCHEDULE." },
  },
  required: ["kind", "taskId"],
  propertyOrdering: ["kind", "taskId"],
}

const DONE_SCHEMA = {
  type: Type.OBJECT,
  description:
    "Mark an existing task done/complete, or reopen it with done:false. Never moves, resizes or deletes the block — past dates are allowed.",
  properties: {
    kind: { type: Type.STRING, enum: ["done"] },
    taskId: { type: Type.INTEGER, description: "Task id from EXISTING SCHEDULE." },
    done: {
      type: Type.BOOLEAN,
      description: "Omit or true to mark complete; false to reopen the task.",
    },
  },
  required: ["kind", "taskId"],
  propertyOrdering: ["kind", "taskId", "done"],
}

// anyOf keeps each operation complete: the model cannot emit a half-specified
// create because the variant's own required list is enforced by the API.
const OPERATION_SCHEMA = {
  anyOf: [CREATE_SCHEMA, MOVE_SCHEMA, RESIZE_SCHEMA, DELETE_SCHEMA, DONE_SCHEMA],
}

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING, description: "At most three sentences of plain prose." },
    mode: { type: Type.STRING, enum: ["propose", "answer", "clarify"] },
    notes: { type: Type.ARRAY, items: { type: Type.STRING } },
    operations: { type: Type.ARRAY, items: OPERATION_SCHEMA },
  },
  required: ["reply", "mode", "operations"],
  propertyOrdering: ["reply", "mode", "notes", "operations"],
}

/**
 * Ordered candidate list. The configured model wins; the rest are calm
 * fallbacks chosen for what this key can actually serve. Older ids such as
 * gemini-2.5-flash now return 404 for new projects, so they are not listed.
 *
 * The trailing lite model exists for quota reasons: free-tier limits are
 * metered per model, and lite carries a much larger allowance. It is slower to
 * reason but the rules engine validates whatever it proposes, so a weak draft
 * gets rejected rather than written.
 */
function modelCandidates(preferred?: string | null) {
  const configured = preferred?.trim() || process.env.GEMINI_MODEL?.trim()
  // Lite is fastest and carries the largest free-tier quota, so it leads the
  // default chain. The configured model (from /settings) still wins when set.
  const list = [
    configured,
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
  ].filter((m): m is string => !!m)
  return [...new Set(list)]
}

const REQUEST_TIMEOUT_MS = 120_000
// Each model gets a bounded slice of the chain's total time. A slow model must
// not consume the whole budget — the other candidates can still answer.
const MODEL_TIMEOUT_MS = 20_000
const CHAIN_BUDGET_MS = 60_000

/**
 * Thinking tokens are slow and count against the free-tier budget. The response
 * schema already constrains the output, so minimal thinking is plenty. Override
 * with GEMINI_THINKING=low|medium|high|default.
 */
const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
}

function thinkingConfig(model: string, preferred?: ThinkingPreference | null) {
  if (!/^gemini-3/i.test(model)) return {}
  const preference = (preferred ?? process.env.GEMINI_THINKING ?? "minimal").trim().toLowerCase()
  if (preference === "default" || preference === "off") return {}
  return { thinkingConfig: { thinkingLevel: THINKING_LEVELS[preference] ?? ThinkingLevel.MINIMAL } }
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Turns a Zod path into a sentence the model can act on ("operation 2 is missing date"). */
function formatSchemaIssue(issue: { path: PropertyKey[]; message: string }) {
  const [root, index, field] = issue.path
  if (root === "operations" && typeof index === "number") {
    const target = typeof field === "string" ? ` is missing or invalid: ${field}` : " is malformed"
    return `Operation ${index + 1}${target}. ${issue.message}`
  }
  return `${issue.path.join(".") || "plan"}: ${issue.message}`
}

/** Google tells us how long to wait; read it rather than making the user guess. */
function retryDelayMs(message: string): number {
  const fromField = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  if (fromField) return Math.ceil(Number(fromField[1]) * 1000)
  const fromProse = message.match(/retry in ([\d.]+)\s*s/i)
  if (fromProse) return Math.ceil(Number(fromProse[1]) * 1000)
  return 60_000
}

function classify(error: unknown): AssistantError {
  const message = messageOf(error)
  if (/api key|api_key|unauthenticated|permission_denied|invalid key/i.test(message)) {
    return new AssistantError(
      "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local and restart the dev server.",
      502,
      "gemini_auth",
    )
  }
  if (/429|resource_exhausted|quota|rate limit/i.test(message)) {
    return new AssistantError(
      "Gemini's free-tier limit was hit. Nothing was changed — retry once the timer clears.",
      429,
      "gemini_quota",
      retryDelayMs(message),
    )
  }
  if (/unavailable|high demand|overloaded|try again later|503/i.test(message)) {
    return new AssistantError(
      "Gemini is busy right now. Try again in a minute — nothing was changed.",
      503,
      "gemini_busy",
      30_000,
    )
  }
  if (/deadline expired|deadline_exceeded|timeout|timed out|etimedout|aborted/i.test(message)) {
    return new AssistantError(
      "Gemini took too long to answer. Try a smaller request — nothing was changed.",
      504,
      "gemini_timeout",
    )
  }
  if (/safety|blocked|recitation/i.test(message)) {
    return new AssistantError("Gemini blocked that request. Rephrase it and try again.", 422, "gemini_blocked")
  }
  return new AssistantError(`Gemini request failed: ${message.slice(0, 300)}`, 502, "gemini_error")
}

function isUnknownModel(error: unknown) {
  return /not found|not_found|does not exist|unsupported model|invalid model|no longer available|404/i.test(
    messageOf(error),
  )
}

/** Google returns 503 UNAVAILABLE under load; try the next model instead of failing. */
function isModelBusy(error: unknown) {
  return /unavailable|high demand|overloaded|try again later|503/i.test(messageOf(error))
}

/** Some models only accept HIGH or LOW; MINIMAL is rejected outright. */
function isThinkingUnsupported(error: unknown) {
  return /thinking level .* is not supported/i.test(messageOf(error))
}

/** A per-model timeout is transient — the next model may still respond. */
function isTimeoutError(error: unknown) {
  return /model timeout|deadline expired|deadline_exceeded|timeout|timed out|etimedout|aborted/i.test(
    messageOf(error),
  )
}

/**
 * Free-tier quota is metered per model. A 429 on one model does not mean the
 * others are out, so the chain should rotate rather than give up.
 */
function isQuotaError(error: unknown) {
  return /429|resource_exhausted|quota|rate limit/i.test(messageOf(error))
}

export type TranscriptMessage = { role: "user" | "assistant"; content: string }

export type PlannerRun = {
  model: string
  plan: ModelPlan | null
  issues: string[]
  text: string
}

function buildContents(transcript: TranscriptMessage[], context: string, repair?: string) {
  const history = transcript
    .slice(-16)
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content.slice(0, 2000)}`)
    .join("\n")

  const parts = [
    "CALENDAR CONTEXT",
    context,
    "",
    "CONVERSATION SO FAR",
    history || "(new conversation)",
  ]
  if (repair) {
    parts.push("", "CORRECTION REQUIRED", repair)
  }
  parts.push("", "Return the JSON plan for the latest USER message now.")
  return parts.join("\n")
}

export async function runPlanner(input: {
  transcript: TranscriptMessage[]
  context: string
  repair?: string
  rules?: ScheduleRules
  prefs?: AssistantPrefs
}): Promise<PlannerRun> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new AssistantError(
      "GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.",
      503,
      "missing_api_key",
    )
  }

  const rules = input.rules ?? DEFAULT_RULES
  const prefs = input.prefs ?? DEFAULT_PREFS
  const thinking = normalizeThinking(prefs.thinking)
  const businessName = await loadBusinessName()
  const systemInstruction = plannerSystemPrompt(rules, businessName)

  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS } })
  const contents = buildContents(input.transcript, input.context, input.repair)
  const chainDeadline = Date.now() + CHAIN_BUDGET_MS

  async function generate(model: string, useThinking: boolean) {
    const remaining = chainDeadline - Date.now()
    if (remaining <= 0) throw new Error("model timeout")
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: PLAN_SCHEMA,
            temperature: 0.25,
            topP: 0.9,
            maxOutputTokens: 8192,
            ...(useThinking ? thinkingConfig(model, thinking) : {}),
          },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("model timeout")),
            Math.min(MODEL_TIMEOUT_MS, remaining),
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  let lastError: unknown = null
  let quotaRetryMs: number | null = null
  let timedOut = false

  for (const model of modelCandidates(prefs.model)) {
    try {
      let response
      try {
        response = await generate(model, true)
      } catch (error) {
        // Not every flash build accepts a forced thinking level (3.7 and 3.8
        // reject MINIMAL). Retry once with the model's own default rather than
        // failing the whole request.
        if (!isThinkingUnsupported(error)) throw error
        response = await generate(model, false)
      }

      const text = response.text ?? ""
      if (!text.trim()) {
        return { model, plan: null, issues: ["Gemini returned an empty response."], text }
      }

      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        return { model, plan: null, issues: ["Gemini returned text that was not valid JSON."], text }
      }

      const parsed = modelPlanSchema.safeParse(json)
      if (!parsed.success) {
        return {
          model,
          plan: null,
          issues: parsed.error.issues.slice(0, 10).map(formatSchemaIssue),
          text,
        }
      }

      const plan = parsed.data
      if (plan.operations.length > 0 && plan.mode !== "propose") plan.mode = "propose"
      return { model, plan, issues: [], text }
    } catch (error) {
      lastError = error
      if (isQuotaError(error)) {
        const delay = retryDelayMs(messageOf(error))
        quotaRetryMs = quotaRetryMs === null ? delay : Math.min(quotaRetryMs, delay)
        continue
      }
      // A slow or overloaded model should hand off to the next candidate rather
      // than ending the whole request as a 504 after the first 20s slice.
      if (isTimeoutError(error)) {
        timedOut = true
        continue
      }
      if (isUnknownModel(error) || isModelBusy(error)) continue
      throw classify(error)
    }
  }

  if (quotaRetryMs !== null) {
    throw new AssistantError(
      "Every Gemini model is out of free-tier quota right now. Nothing was changed — retry when the timer clears.",
      429,
      "gemini_quota",
      quotaRetryMs,
    )
  }

  if (timedOut) {
    throw new AssistantError(
      "Gemini is taking too long to answer right now. Nothing was changed — please try again.",
      504,
      "gemini_timeout",
    )
  }

  throw classify(lastError)
}
