"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarPlus,
  Check,
  Loader2,
  Mic,
  MicOff,
  Radio,
  Send,
  Sparkles,
  Timer,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
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
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  // Fast replies are instant. Natural Gemini voice takes ~4.5s and is capped at
  // 10 requests/day on the free tier, so it stays opt-in.
  const [voiceMode, setVoiceMode] = useState<"natural" | "fast">("fast")
  const [ttsSupported] = useState(() => {
    if (typeof window === "undefined") return false
    return !!window.speechSynthesis
  })
  const [micSupported] = useState(() => {
    if (typeof window === "undefined") return false
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined"
  })
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const meterRef = useRef<HTMLDivElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const ttsUrlRef = useRef<string | null>(null)
  const speakSeqRef = useRef(0)
  const speechResolveRef = useRef<(() => void) | null>(null)
  const speechTimerRef = useRef<number | null>(null)
  const recordingRef = useRef(false)
  const transcribingRef = useRef(false)
  const sendingRef = useRef(false)
  const handsFreeRef = useRef(false)
  const conversationGenRef = useRef(0)
  const discardNextRef = useRef(false)
  const resumeTimerRef = useRef<number | null>(null)
  const vadRafRef = useRef<number | null>(null)
  const vadCtxRef = useRef<{ ctx: AudioContext; source: MediaStreamAudioSourceNode } | null>(null)

  // Google tells us how long the free-tier window needs; count it down visibly
  // instead of letting the user hammer a request that will just 429 again.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  // Clean up mic / speech on unmount.
  useEffect(() => {
    return () => {
      handsFreeRef.current = false
      conversationGenRef.current += 1
      if (vadRafRef.current !== null) cancelAnimationFrame(vadRafRef.current)
      if (resumeTimerRef.current !== null) clearTimeout(resumeTimerRef.current)
      if (speechTimerRef.current !== null) clearTimeout(speechTimerRef.current)
      const vad = vadCtxRef.current
      vadCtxRef.current = null
      vad?.source.disconnect()
      void vad?.ctx.close().catch(() => {})
      streamRef.current?.getTracks().forEach((t) => t.stop())
      ttsAbortRef.current?.abort()
      audioRef.current?.pause()
      if (typeof window !== "undefined") window.speechSynthesis?.cancel?.()
    }
  }, [])

  // Chromium loads voices asynchronously; cache them so even the first reply
  // uses the best available voice instead of the default (usually the harshest).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return
    const load = () => {
      voicesRef.current = window.speechSynthesis.getVoices()
    }
    load()
    window.speechSynthesis.addEventListener("voiceschanged", load)
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load)
  }, [])

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

  // Prefer genuine natural/online voices when present, otherwise rank the
  // local ones: Zira/Aria-style voices are the least harsh, David the worst.
  function pickVoice(voices: SpeechSynthesisVoice[]) {
    const english = voices.filter((v) => /^en([-_]|$)/i.test(v.lang))
    const pool = english.length ? english : voices
    const score = (v: SpeechSynthesisVoice) => {
      const name = v.name.toLowerCase()
      let s = 0
      if (/natural|neural|premium|google|online/.test(name)) s += 100
      if (!v.localService) s += 40
      if (/zira|aria|jenny|samantha|karen|moira|tessa|victoria|female/.test(name)) s += 30
      if (/david/.test(name)) s -= 30
      if (v.default) s += 1
      return s
    }
    return [...pool].sort((a, b) => score(b) - score(a))[0]
  }

  // Resolves once the current utterance actually finishes. Hands-free mode uses
  // this to reopen the mic only after the assistant has stopped talking.
  function finishSpeech() {
    if (speechTimerRef.current !== null) {
      clearTimeout(speechTimerRef.current)
      speechTimerRef.current = null
    }
    const resolve = speechResolveRef.current
    speechResolveRef.current = null
    resolve?.()
  }

  // Stop whichever engine is talking so a new reply never overlaps the old one.
  function cancelSpeech() {
    speakSeqRef.current += 1
    conversationGenRef.current += 1
    ttsAbortRef.current?.abort()
    ttsAbortRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ""
      audioRef.current = null
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current)
      ttsUrlRef.current = null
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel?.()
    finishSpeech()
  }

  function speakBrowser(text: string, onDone?: () => void) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onDone?.()
      return
    }
    try {
      const utterance = new SpeechSynthesisUtterance(text)
      const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices()
      const preferred = pickVoice(voices)
      if (preferred) utterance.voice = preferred
      else utterance.lang = "en-US"
      utterance.rate = 0.95
      utterance.pitch = 1.0
      utterance.onend = () => onDone?.()
      utterance.onerror = () => onDone?.()
      window.speechSynthesis.speak(utterance)
    } catch {
      // Speech synthesis is best-effort; never block the UI on it.
      onDone?.()
    }
  }

  async function speak(text: string): Promise<void> {
    if (!voiceOut || typeof window === "undefined") return
    const cleaned = text.replace(/\s+/g, " ").trim()
    if (!cleaned) return

    cancelSpeech()
    const seq = speakSeqRef.current
    const done = new Promise<void>((resolve) => {
      speechResolveRef.current = resolve
    })
    // Some browsers never fire onend for long utterances. Never hang the loop.
    speechTimerRef.current = window.setTimeout(finishSpeech, 120_000)

    if (voiceMode === "fast" || !window.speechSynthesis) {
      speakBrowser(cleaned, finishSpeech)
      return done
    }

    const controller = new AbortController()
    ttsAbortRef.current = controller

    try {
      const response = await fetch("/api/assistant/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: cleaned }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error("natural voice unavailable")
      if (seq !== speakSeqRef.current) {
        finishSpeech()
        return done
      }

      const blob = await response.blob()
      if (seq !== speakSeqRef.current) {
        finishSpeech()
        return done
      }
      const objectUrl = URL.createObjectURL(blob)
      ttsUrlRef.current = objectUrl
      const audio = new Audio(objectUrl)
      audioRef.current = audio
      const release = () => {
        if (ttsUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl)
          ttsUrlRef.current = null
        }
        if (audioRef.current === audio) audioRef.current = null
      }
      audio.onended = () => {
        release()
        finishSpeech()
      }
      audio.onerror = () => {
        release()
        if (seq === speakSeqRef.current) speakBrowser(cleaned, finishSpeech)
        else finishSpeech()
      }
      await audio.play()
    } catch {
      if (seq === speakSeqRef.current) speakBrowser(cleaned, finishSpeech)
      else finishSpeech()
    } finally {
      if (ttsAbortRef.current === controller) ttsAbortRef.current = null
    }
    return done
  }

  // Reopen the mic after a reply, unless the user interrupted or turned the
  // conversation off while the assistant was speaking.
  function scheduleResume(delayMs = 400) {
    if (!handsFreeRef.current) return
    if (resumeTimerRef.current !== null) clearTimeout(resumeTimerRef.current)
    const generation = conversationGenRef.current
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null
      if (!handsFreeRef.current || generation !== conversationGenRef.current) return
      if (recordingRef.current || transcribingRef.current) return
      void startRecording()
    }, delayMs)
  }

  async function speakAndResume(text: string) {
    await speak(text)
    scheduleResume()
  }

  async function blobToWavBase64(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer()
    const w = window as {
      AudioContext?: new (options?: AudioContextOptions) => AudioContext
      webkitAudioContext?: new (options?: AudioContextOptions) => AudioContext
    }
    const AudioContextCtor = w.AudioContext || w.webkitAudioContext
    if (!AudioContextCtor) throw new Error("AudioContext not supported")
    const ctx = new AudioContextCtor()
    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await Promise.race([
        ctx.decodeAudioData(arrayBuffer.slice(0)),
        new Promise<AudioBuffer>((_, reject) =>
          setTimeout(() => reject(new Error("Audio decode timed out")), 15000),
        ),
      ])
    } catch (e) {
      await ctx.close().catch(() => {})
      throw e
    }
    await ctx.close().catch(() => {})

    if (!audioBuffer || !isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) {
      throw new Error("Could not read any audio from the recording.")
    }

    const targetRate = 16000
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(audioBuffer.duration * targetRate),
      targetRate,
    )
    const source = offline.createBufferSource()
    source.buffer = audioBuffer
    source.connect(offline.destination)
    source.start(0)
    const rendered = await Promise.race([
      offline.startRendering(),
      new Promise<AudioBuffer>((_, reject) =>
        setTimeout(() => reject(new Error("Audio render timed out")), 15000),
      ),
    ])

    const samples = rendered.getChannelData(0)
    const pcm = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }

    const wavBuffer = encodeWav(pcm, targetRate)
    return arrayBufferToBase64(wavBuffer)
  }

  function encodeWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
    const byteRate = sampleRate * 2
    const buffer = new ArrayBuffer(44 + pcm.length * 2)
    const view = new DataView(buffer)
    writeString(view, 0, "RIFF")
    view.setUint32(4, 36 + pcm.length * 2, true)
    writeString(view, 8, "WAVE")
    writeString(view, 12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(view, 36, "data")
    view.setUint32(40, pcm.length * 2, true)
    let offset = 44
    for (let i = 0; i < pcm.length; i++, offset += 2) {
      view.setInt16(offset, pcm[i], true)
    }
    return buffer
  }

  function writeString(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = ""
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  // Drive the little equalizer directly from the audio frame loop. Updating
  // five DOM nodes beats re-rendering React 60 times a second.
  function paintMeter(level: number, active: boolean) {
    const el = meterRef.current
    if (!el) return
    const now = performance.now()
    for (let i = 0; i < el.children.length; i++) {
      const bar = el.children[i] as HTMLElement
      const wave = 0.45 + 0.55 * Math.abs(Math.sin(now / 110 + i * 1.05))
      const scale = active ? 0.18 + Math.min(1, level * 5) * wave * 0.82 : 0.14
      bar.style.transform = `scaleY(${scale.toFixed(3)})`
    }
  }

  function stopVad() {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current)
      vadRafRef.current = null
    }
    setSpeaking(false)
    paintMeter(0, false)
    const vad = vadCtxRef.current
    vadCtxRef.current = null
    if (vad) {
      try {
        vad.source.disconnect()
      } catch {
        // already disconnected
      }
      void vad.ctx.close().catch(() => {})
    }
  }

  // Voice-activity detection from the live mic stream. The noise floor is only
  // learned while the user is NOT speaking — letting it rise during speech
  // pushes the threshold above the user's own voice and cuts them off mid-sentence.
  // With no onSpeechEnd, it just drives the meter (push-to-talk).
  function startVad(stream: MediaStream, onSpeechEnd: (() => void) | null) {
    stopVad()
    const w = window as {
      AudioContext?: new (options?: AudioContextOptions) => AudioContext
      webkitAudioContext?: new (options?: AudioContextOptions) => AudioContext
    }
    const AudioContextCtor = w.AudioContext || w.webkitAudioContext
    if (!AudioContextCtor) return
    try {
      const ctx = new AudioContextCtor()
      void ctx.resume().catch(() => {})
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.15
      source.connect(analyser)
      vadCtxRef.current = { ctx, source }

      const samples = new Uint8Array(analyser.fftSize)
      const generation = conversationGenRef.current
      const startedAt = performance.now()
      let speaking = false
      let speechStartedAt = 0
      let silenceAt = 0
      let noiseFloor = 0.012
      let lastPaintAt = 0

      const tick = () => {
        if (generation !== conversationGenRef.current || !recordingRef.current) {
          stopVad()
          return
        }
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (let i = 0; i < samples.length; i++) {
          const value = (samples[i] - 128) / 128
          sum += value * value
        }
        const rms = Math.sqrt(sum / samples.length)
        const now = performance.now()

        // Learn the room's floor only during quiet stretches, and clamp the
        // threshold so a loud room can never swallow normal speech.
        if (!speaking) {
          noiseFloor =
            rms < noiseFloor ? noiseFloor * 0.97 + rms * 0.03 : noiseFloor * 0.995 + rms * 0.005
        }
        const threshold = Math.max(0.016, Math.min(0.09, noiseFloor * 2.6))

        if (rms > threshold) {
          if (!speaking) {
            speaking = true
            speechStartedAt = now
            setSpeaking(true)
          }
          silenceAt = 0
        } else if (speaking) {
          if (!silenceAt) silenceAt = now
          // 1.2s hangover covers breaths and pauses between phrases.
          if (now - silenceAt > 1_200 && now - speechStartedAt > 500) {
            stopVad()
            onSpeechEnd?.()
            return
          }
        }
        if (onSpeechEnd) {
          if (speaking && now - speechStartedAt > 30_000) {
            stopVad()
            onSpeechEnd()
            return
          }
          if (!speaking && now - startedAt > 15_000) {
            stopVad()
            handleNoSpeech()
            return
          }
        }
        if (now - lastPaintAt > 33) {
          lastPaintAt = now
          paintMeter(voicedLevel(rms, threshold), speaking)
        }
        vadRafRef.current = requestAnimationFrame(tick)
      }
      vadRafRef.current = requestAnimationFrame(tick)
    } catch {
      // VAD is optional; push-to-talk still works without it.
    }
  }

  function voicedLevel(rms: number, threshold: number) {
    return Math.max(0, rms - threshold)
  }

  function handleNoSpeech() {
    stopRecording({ discard: true })
    handsFreeRef.current = false
    setHandsFree(false)
    conversationGenRef.current += 1
    setError("Stopped listening — I didn't hear anything. Tap Talk to start again.")
  }

  function setHandsFreeMode(next: boolean) {
    handsFreeRef.current = next
    setHandsFree(next)
    conversationGenRef.current += 1
    if (resumeTimerRef.current !== null) {
      clearTimeout(resumeTimerRef.current)
      resumeTimerRef.current = null
    }
    if (next) {
      setError(null)
      cancelSpeech()
      if (recordingRef.current && streamRef.current) {
        startVad(streamRef.current, () => stopRecording())
      } else {
        void startRecording()
      }
    } else {
      stopRecording({ discard: true })
      cancelSpeech()
    }
  }

  async function startRecording() {
    if (recordingRef.current || transcribingRef.current) return
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone isn't available in this browser.")
      return
    }
    setError(null)
    const generation = conversationGenRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      // Talk may have been switched off while the permission prompt was open.
      if (generation !== conversationGenRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      audioChunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stopVad()
        recordingRef.current = false
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" })
        audioChunksRef.current = []

        const shouldProcess = !discardNextRef.current
        discardNextRef.current = false
        setRecording(false)
        if (!shouldProcess) {
          scheduleResume(300)
          return
        }

        if (blob.size < (handsFreeRef.current ? 2500 : 4000)) {
          if (handsFreeRef.current) scheduleResume(600)
          else setError("Recording too short. Hold the mic a bit longer and try again.")
          return
        }

        setTranscribing(true)
        transcribingRef.current = true
        try {
          const base64 = await blobToWavBase64(blob)
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 60000)
          let response: Response
          try {
            response = await fetch("/api/assistant/transcribe", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ audio: base64, mimeType: "audio/wav" }),
              signal: controller.signal,
            })
          } finally {
            clearTimeout(timeoutId)
          }
          const data = (await response.json().catch(() => null)) as
            | { text?: string; error?: string }
            | null
          if (!response.ok || !data?.text) {
            setError(data?.error ?? "Could not transcribe the audio.")
            scheduleResume(1200)
            return
          }
          const transcript = data.text.trim()
          if (transcript && /[a-zA-Z]{2,}/.test(transcript)) {
            void send(transcript)
          } else {
            setError("I couldn't catch that. Try speaking a bit louder or closer to the mic.")
            scheduleResume(1200)
          }
        } catch (err) {
          console.error("[assistant/voice]", err)
          if (err instanceof DOMException && err.name === "AbortError") {
            setError("Transcription timed out. Try a shorter recording.")
          } else {
            setError(err instanceof Error ? err.message : "Network error transcribing audio.")
          }
          scheduleResume(1200)
        } finally {
          setTranscribing(false)
          transcribingRef.current = false
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      recordingRef.current = true
      setRecording(true)
      // Talk mode auto-ends on a pause; push-to-talk keeps the meter running
      // but waits for the user to press the mic again.
      startVad(stream, handsFreeRef.current ? () => stopRecording() : null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/permission|notallowed|denied/i.test(message)) {
        setError("Microphone permission denied. Allow it in the browser and try again.")
      } else {
        setError(`Could not start the microphone: ${message}`)
      }
      recordingRef.current = false
      setRecording(false)
      if (handsFreeRef.current) {
        handsFreeRef.current = false
        setHandsFree(false)
      }
    }
  }

  function stopRecording(options?: { discard?: boolean }) {
    stopVad()
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state === "recording") {
      if (options?.discard) discardNextRef.current = true
      try {
        recorder.stop()
      } catch {
        discardNextRef.current = false
      }
    }
    recordingRef.current = false
    setRecording(false)
  }

  async function send(textOverride?: string) {
    if (recordingRef.current) stopRecording()
    const text = (textOverride ?? input).trim()
    // A ref guard matters here: send() is called from MediaRecorder.onstop while
    // the `transcribing` state value is still true in that same render.
    if (!text || sendingRef.current) return
    sendingRef.current = true

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
            ? "Add your Gemini API key in Settings → Gemini API key to use the assistant."
            : response.status === 401
              ? "Your session expired. Sign in again."
              : "The assistant could not answer. Nothing was changed.")
        pushMessage({ role: "assistant", content: message, blocked: true })
        void speakAndResume(message)
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
      void speakAndResume(data.reply)

      if (data.operations.length > 0 && data.preview.length > 0) {
        setPlan({ ...data, requestId: newId() })
      }
    } catch {
      const message = "Network error reaching the assistant. Nothing was changed."
      pushMessage({ role: "assistant", content: message, blocked: true })
      void speakAndResume(message)
      setRetryPrompt(text)
    } finally {
      sendingRef.current = false
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

      const appliedMessage = `${data.replayed ? "Already applied:" : "Done."} ${parts.join(", ") || "No changes"} on the calendar. Undo is available for 30 minutes.`
      pushMessage({
        role: "assistant",
        content: appliedMessage,
      })
      void speakAndResume(appliedMessage)
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
      const undoMessage = data.alreadyUndone
        ? "That change was already undone."
        : `Reverted ${data.reverted} change${data.reverted === 1 ? "" : "s"}. The calendar is back to how it was.`
      pushMessage({
        role: "assistant",
        content: undoMessage,
      })
      void speakAndResume(undoMessage)
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
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHandsFreeMode(!handsFreeRef.current)}
            disabled={!micSupported}
            aria-label={handsFree ? "Turn off talk mode" : "Turn on talk mode"}
            title={
              !micSupported
                ? "Microphone isn't available in this browser"
                : handsFree
                  ? "Talk mode on — I listen, reply, then listen again. Click to stop"
                  : "Talk mode — keep speaking without pressing the mic each time"
            }
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors ${
              handsFree
                ? "border-gold/50 bg-gold/15 text-gold"
                : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <Radio className={`h-3.5 w-3.5 ${handsFree ? "animate-pulse" : ""}`} />
            Talk
          </button>
          <button
            type="button"
            onClick={() => {
              cancelSpeech()
              setVoiceOut((v) => !v)
            }}
            aria-label={voiceOut ? "Mute voice replies" : "Unmute voice replies"}
            title={voiceOut ? "Voice replies on" : "Voice replies off"}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {voiceOut ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() =>
              setVoiceMode((mode) => (mode === "fast" && ttsSupported ? "natural" : "fast"))
            }
            aria-label={
              voiceMode === "fast"
                ? "Fast browser voice on. Switch to natural Gemini voice"
                : "Natural Gemini voice on. Switch to fast browser voice"
            }
            title={
              voiceMode === "fast"
                ? ttsSupported
                  ? "Instant browser voice · click for natural Gemini voice (~4.5s, 10/day)"
                  : "Fast browser voice unavailable here"
                : "Natural Gemini voice · slow and limited on the free tier, click for instant browser voice"
            }
            className="rounded-md px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            {voiceMode === "natural" ? "AI" : "Fast"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (handsFreeRef.current) setHandsFreeMode(false)
              setOpen(false)
            }}
            aria-label="Close assistant"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
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
            placeholder={
              handsFree
                ? recording
                  ? "Listening… talk naturally, then pause"
                  : transcribing
                    ? "Transcribing…"
                    : "Speaking…"
                : recording
                  ? "Recording… click the mic to stop"
                  : transcribing
                    ? "Transcribing…"
                    : "Add 90 minutes of cold outreach tomorrow morning…"
            }
            className={`max-h-32 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-gold/50 ${
              recording ? "border-danger/60" : "border-border"
            }`}
            disabled={recording || transcribing}
          />
          {micSupported && (
            <button
              type="button"
              onClick={() => {
                if (handsFree) setHandsFreeMode(false)
                else if (recording) stopRecording()
                else void startRecording()
              }}
              disabled={!handsFree && (sending || transcribing)}
              aria-label={
                handsFree
                  ? "Stop talk mode"
                  : recording
                    ? "Stop recording"
                    : "Start voice input"
              }
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-30 ${
                recording || handsFree
                  ? "border-danger/60 bg-danger/15 text-danger animate-pulse"
                  : "border-border bg-surface-2 text-muted hover:text-gold hover:border-gold/40"
              }`}
            >
              {recording || handsFree ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            type="submit"
            disabled={sending || !input.trim() || recording || transcribing}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-gold/15 text-gold transition-colors hover:bg-gold/25 disabled:opacity-30"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div className={`mt-1 items-center gap-2 ${handsFree || recording ? "flex" : "hidden"}`}>
          <div ref={meterRef} className="flex h-3.5 shrink-0 items-end gap-[3px]" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span
                key={i}
                className={`h-3.5 w-1 origin-bottom rounded-sm transition-transform duration-75 ease-out ${
                  handsFree ? "bg-gold" : "bg-danger"
                }`}
                style={{ transform: "scaleY(0.14)" }}
              />
            ))}
          </div>
          {handsFree ? (
            <p className="mono text-[10px] uppercase tracking-[0.15em] text-gold">
              Talk mode · {speaking && recording ? "you're speaking" : recording ? "listening — speak, then pause" : transcribing ? "transcribing" : sending ? "thinking" : "speaking"}
            </p>
          ) : (
            <p className="mono text-[10px] uppercase tracking-[0.15em] text-danger">
              Recording… click the mic again when you&apos;re done.
            </p>
          )}
        </div>
        {transcribing && (
          <p className="mono mt-1 text-[10px] uppercase tracking-[0.15em] text-gold">
            Transcribing your voice…
          </p>
        )}
        <p className="mono mt-2 text-[10px] uppercase tracking-[0.15em] text-muted">
          {plan?.meta.model ?? "gemini"} · {plan?.meta.timezone ?? "Africa/Tunis"} · nothing is written without
          confirmation
        </p>
      </form>
    </section>
  )
}
