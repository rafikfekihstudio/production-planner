import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { GoogleGenAI } from "@google/genai"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Per-model budget. A model stuck in high demand (503) can otherwise take ~2 minutes
// before the SDK surfaces the error; abort sooner so we rotate to the next candidate.
const MODEL_TIMEOUT_MS = 20_000

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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "The assistant is not configured yet. Add GEMINI_API_KEY to .env.local and restart the dev server.",
        code: "missing_api_key",
      },
      { status: 503 },
    )
  }

  try {
    const prefs = await loadAssistantPrefs().catch(() => null)
    const client = new GoogleGenAI({ apiKey })
    const configured = prefs?.model?.trim() || process.env.GEMINI_MODEL?.trim()
    // Keep the known-reliable lite model available but try the configured one first.
    const candidates = [
      configured,
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ].filter((m): m is string => !!m)

    let text = ""
    let lastError: unknown = null
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
                  text: "Transcribe the spoken audio verbatim. Return only the transcript text, no commentary, no quotes, no markdown.",
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
        lastError = error
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
      if (lastError) throw lastError
    }

    if (!text) {
      return NextResponse.json({ error: "Could not transcribe the audio.", code: "empty_transcript", model: usedModel }, { status: 502 })
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