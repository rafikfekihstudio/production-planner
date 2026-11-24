import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { MISSING_KEY_MESSAGE, resolveAssistantApiKey } from "@/lib/assistant/api-key"
import { GoogleGenAI } from "@google/genai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Natural voices are noticeably slower than the browser synthesizer. Bound the
// call so a busy Gemini endpoint falls back instead of leaving the UI silent.
const TTS_TIMEOUT_MS = 20_000
const FALLBACK_TIMEOUT_MS = 8_000
const MAX_TEXT_LENGTH = 2_000
// flash-lite is the primary: ~4.5s and a generous free-tier quota. flash-tts
// sounds a little better but is capped at 10 requests/day on the free tier, so
// trying it first stalls every reply once that cap is hit. Fallback only.
const MODELS = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"] as const
const VOICE = "Kore"

let cachedKey: string | null = null
let cachedClient: GoogleGenAI | null = null
function getClient(apiKey: string) {
  if (!cachedClient || cachedKey !== apiKey) {
    cachedKey = apiKey
    cachedClient = new GoogleGenAI({ apiKey })
  }
  return cachedClient
}

function isRawPcm(mimeType: string) {
  return /l16|pcm|raw/i.test(mimeType)
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number) {
  const bytesPerSample = 2
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  header.writeUInt16LE(channels * bytesPerSample, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : ""
  if (!text) {
    return NextResponse.json({ error: "Missing text to speak.", code: "bad_request" }, { status: 400 })
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `Voice replies are limited to ${MAX_TEXT_LENGTH} characters.`, code: "bad_request" },
      { status: 400 },
    )
  }

  const assistantKey = await resolveAssistantApiKey(session.user.id)
  if (!assistantKey) {
    return NextResponse.json(
      { error: MISSING_KEY_MESSAGE, code: "missing_api_key" },
      { status: 503 },
    )
  }

  const client = getClient(assistantKey.key)

  for (const [index, model] of MODELS.entries()) {
    const timeoutMs = index === 0 ? TTS_TIMEOUT_MS : FALLBACK_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const startedAt = Date.now()
    try {
      const result = await client.interactions.create(
        {
          model,
          api_version: "v1beta",
          input: text,
          response_format: { type: "audio" },
          generation_config: {
            speech_config: [{ voice: VOICE }],
          },
        },
        { signal: controller.signal, timeout_ms: timeoutMs },
      )

      const audio = result.output_audio
      if (!audio?.data) throw new Error("No audio returned by the model")

      const decoded = Buffer.from(audio.data, "base64")
      const rawMimeType = audio.mime_type ?? "audio/mp3"
      const pcm = isRawPcm(rawMimeType)
      const bytes = pcm
        ? pcmToWav(decoded, audio.sample_rate ?? 24_000, audio.channels ?? 1)
        : decoded
      const contentType = pcm ? "audio/wav" : rawMimeType

      console.log(
        `[assistant/tts] model=${model} ok ms=${Date.now() - startedAt} bytes=${bytes.length} mime=${contentType}`,
      )
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
        },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      const message = error instanceof Error ? error.message : String(error)
      console.log(
        `[assistant/tts] model=${model} fail ms=${Date.now() - startedAt} timeout=${timedOut} err=${message.slice(0, 120)}`,
      )
      if (
        timedOut ||
        /not found|not_found|does not exist|404|unavailable|high demand|overloaded|503|429|quota|rate limit|abort/i.test(
          message,
        )
      ) {
        continue
      }
      break
    } finally {
      clearTimeout(timer)
    }
  }

  return NextResponse.json(
    { error: "The natural voice is temporarily busy.", code: "model_busy" },
    { status: 503 },
  )
}
