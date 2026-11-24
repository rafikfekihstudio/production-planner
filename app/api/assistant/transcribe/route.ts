import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { GoogleGenAI } from "@google/genai"
import { MISSING_KEY_MESSAGE, resolveAssistantApiKey } from "@/lib/assistant/api-key"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Per-model budget. A model stuck in high demand (503) can otherwise take ~2 minutes
// before the SDK surfaces the error; abort sooner so we rotate to the next candidate.
const MODEL_TIMEOUT_MS = 15_000

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const audio = typeof body?.audio === "string" ? body.audio : null
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "audio/wav"
  if (!audio) {
    return NextResponse.json({ error: "Missing audio payload.", code: "bad_request" }, { status: 400 })
  }

  const assistantKey = await resolveAssistantApiKey(session.user.id)
  if (!assistantKey) {
    return NextResponse.json(
      { error: MISSING_KEY_MESSAGE, code: "missing_api_key" },
      { status: 503 },
    )
  }

  try {
    const prefs = await loadAssistantPrefs().catch(() => null)
    const client = new GoogleGenAI({ apiKey: assistantKey.key })
    const configured = prefs?.model?.trim() || process.env.GEMINI_MODEL?.trim()
    const candidates = configured
      ? [configured, "gemini-3.5-flash-lite"]
      : ["gemini-3.5-flash-lite"]

    let text = ""
    let usedModel: string | null = null
    for (const model of [...new Set(candidates)]) {
      const t0 = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)
      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: audio,
                  },
                },
                {
                  text: "Transcribe the spoken audio verbatim. Return only the transcript text, no commentary, no quotes, no markdown. If there is no intelligible speech, return an empty string.",
                },
              ],
            },
          ],
          config: {
            temperature: 0,
            maxOutputTokens: 1024,
            abortSignal: controller.signal,
          },
        })
        text = (response.text ?? "").trim()
        usedModel = model
        console.log(`[assistant/transcribe] model=${model} ok ms=${Date.now() - t0} chars=${text.length}`)
        if (text) break
      } catch (error) {
        const timedOut = controller.signal.aborted
        const msg = error instanceof Error ? error.message : String(error)
        console.log(
          `[assistant/transcribe] model=${model} fail ms=${Date.now() - t0} timeout=${timedOut} err=${msg.slice(0, 120)}`,
        )
        // Aborts are retryable just like overload/rate-limit errors, so we rotate models.
        if (
          timedOut ||
          /not found|not_found|does not exist|404|unavailable|high demand|overloaded|503|429|quota|rate limit|abort/i.test(
            msg,
          )
        ) {
          continue
        }
        throw error
      } finally {
        clearTimeout(timer)
      }
    }

    if (!text) {
      // No candidate produced a transcript. When every model failed with an
      // overload/timeout (unexpected errors are thrown above), report a clean
      // "busy" message instead of leaking the raw "operation was aborted" text.
      if (!usedModel) {
        return NextResponse.json(
          {
            error: "Gemini is temporarily busy. Please try again in a moment.",
            code: "model_busy",
          },
          { status: 503 },
        )
      }
      return NextResponse.json(
        { error: "Could not transcribe the audio.", code: "empty_transcript", model: usedModel },
        { status: 502 },
      )
    }
    return NextResponse.json({ text, model: usedModel })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[assistant/transcribe]", message)
    return NextResponse.json(
      { error: `Transcription failed: ${message.slice(0, 200)}`, code: "transcribe_error" },
      { status: 502 },
    )
  }
}