import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { buildPlannerContext, renderContext } from "@/lib/assistant/context"
import { AssistantError, runPlanner } from "@/lib/assistant/gemini"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"
import { repairPrompt } from "@/lib/assistant/prompt"
import { planRequestSchema } from "@/lib/assistant/schema"
import { simulate, type PreviewStep } from "@/lib/assistant/simulate"
import { loadCalendarState } from "@/lib/assistant/state"
import { TIMEZONE } from "@/lib/assistant/time"
import { loadScheduleRules } from "@/lib/schedule-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMPTY: PreviewStep[] = []

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = planRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", code: "bad_request" }, { status: 400 })
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      {
        error: "The assistant is not configured yet. Add GEMINI_API_KEY to .env.local and restart the dev server.",
        code: "missing_api_key",
      },
      { status: 503 },
    )
  }

  const startedAt = Date.now()

  try {
    // Rules and prefs come from /settings so the planner enforces the user's own
    // working hours rather than values compiled into the app.
    const [state, rules, prefs] = await Promise.all([
      loadCalendarState(),
      loadScheduleRules(),
      loadAssistantPrefs(),
    ])
    const context = buildPlannerContext(state, new Date(), rules)
    const rendered = renderContext(context)
    const transcript = parsed.data.messages

    let run = await runPlanner({ transcript, context: rendered, rules, prefs })
    let plan = run.plan
    let simulation = plan
      ? simulate(plan.operations, state, context.today, rules)
      : { ok: true, issues: [], steps: EMPTY }
    let issues = [...run.issues, ...simulation.issues]
    let repaired = false

    // One transparent repair pass. The model's first draft is checked against
    // real calendar state; violations are handed back once, and whatever comes
    // out is validated again. No silent retry loops beyond this.
    if ((!plan || !simulation.ok) && issues.length > 0) {
      const retry = await runPlanner({
        transcript,
        context: rendered,
        repair: repairPrompt(issues),
        rules,
        prefs,
      })
      if (retry.plan) {
        const retrySimulation = simulate(retry.plan.operations, state, context.today, rules)
        plan = retry.plan
        simulation = retrySimulation
        issues = [...retry.issues, ...retrySimulation.issues]
        run = retry
        repaired = true
      }
    }

    if (!plan) {
      return NextResponse.json(
        {
          error: "The assistant could not produce a usable plan. Try rephrasing your request.",
          code: "invalid_plan",
          issues: issues.slice(0, 8),
        },
        { status: 502 },
      )
    }

    const blocked = !simulation.ok
    const operations = blocked ? [] : simulation.steps.map((step) => step.op)

    return NextResponse.json({
      ok: !blocked,
      blocked,
      reply: plan.reply,
      mode: plan.mode,
      notes: plan.notes,
      operations,
      preview: simulation.steps,
      issues: blocked ? issues.slice(0, 12) : [],
      repaired,
      meta: {
        model: run.model,
        today: context.today,
        timezone: TIMEZONE,
        latencyMs: Date.now() - startedAt,
        existingBlocks: context.scheduled.length,
      },
    })
  } catch (error) {
    if (error instanceof AssistantError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
        },
        { status: error.status },
      )
    }
    console.error("[assistant/plan]", error)
    return NextResponse.json(
      { error: "The assistant failed unexpectedly. Nothing was changed.", code: "internal_error" },
      { status: 500 },
    )
  }
}
