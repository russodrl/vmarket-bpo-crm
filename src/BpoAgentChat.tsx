import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Mic, Paperclip, Send, X } from 'lucide-react'
import { supabase } from './supabase'

type BpoAgentExpression = 'pensativo' | 'surpreso' | 'feliz' | 'hell-yeah' | 'triste' | 'intrigado' | 'aliviado'
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  expression?: BpoAgentExpression
}
type ChatAttachment = {
  name: string
  type: string
  content: string
}

type Props = {
  session: Session
  contextDealId?: string | null
  onReload?: () => Promise<void> | void
}

const avatarByExpression: Record<BpoAgentExpression, string> = {
  pensativo: '/bpo-agent/pensativo.webp',
  surpreso: '/bpo-agent/surpreso.webp',
  feliz: '/bpo-agent/feliz.webp',
  'hell-yeah': '/bpo-agent/hell-yeah.webp',
  triste: '/bpo-agent/triste.webp',
  intrigado: '/bpo-agent/intrigado.webp',
  aliviado: '/bpo-agent/aliviado.webp',
}

const helpPhrases = ['Tem alguma dúvida?', 'Precisa de ajuda?', 'O que você quer fazer?']

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function fileToPayload(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', content: String(reader.result || '') })
    reader.onerror = () => reject(reader.error || new Error('Não consegui ler o arquivo.'))
    reader.readAsDataURL(file)
  })
}

export function BpoAgentChat({ session, contextDealId, onReload }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [speechTranscript, setSpeechTranscript] = useState('')
  const [speechSupported, setSpeechSupported] = useState(true)
  const [helpBubbleVisible, setHelpBubbleVisible] = useState(false)
  const [helpPhraseIndex, setHelpPhraseIndex] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const speechRecognitionRef = useRef<{
    start: () => void
    stop: () => void
    abort: () => void
    continuous: boolean
    interimResults: boolean
    lang: string
    onresult: ((event: unknown) => void) | null
    onerror: (() => void) | null
    onend: (() => void) | null
  } | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const inputRef = useRef(input)
  const attachmentsRef = useRef(attachments)
  const speechTranscriptRef = useRef(speechTranscript)
  const busyRef = useRef(busy)

  const currentExpression = messages.findLast((message) => message.role === 'assistant')?.expression || 'pensativo'

  useEffect(() => { inputRef.current = input }, [input])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => { speechTranscriptRef.current = speechTranscript }, [speechTranscript])
  useEffect(() => { busyRef.current = busy }, [busy])

  useEffect(() => {
    if (open) {
      setHelpBubbleVisible(false)
      return
    }
    const timer = window.setTimeout(() => {
      setHelpPhraseIndex((current) => (current + 1) % helpPhrases.length)
      setHelpBubbleVisible(true)
    }, messages.length ? 45000 : 18000)
    return () => window.clearTimeout(timer)
  }, [open, messages.length])

  useEffect(() => () => stopAudioMeter(), [])

  async function sendMessage(textOverride?: string, filesOverride?: ChatAttachment[]) {
    const text = (textOverride ?? inputRef.current).trim()
    const files = filesOverride ?? attachmentsRef.current
    if ((!text && !files.length) || busyRef.current) return
    const hasAudio = files.some((file) => file.type.startsWith('audio/'))
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text || (hasAudio ? 'Áudio enviado para interpretação' : `${files.length} arquivo(s) enviado(s)`),
    }
    setMessages((current) => [...current, userMessage])
    setInput('')
    if (!filesOverride) setAttachments([])
    setBusy(true)
    try {
      const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }))
      const { data, error } = await supabase.functions.invoke('bpo-agent', {
        body: { message: text, files, contextDealId: contextDealId || null, history },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      const expression = (data?.expression || 'pensativo') as BpoAgentExpression
      setMessages((current) => [...current, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: String(data?.reply || 'Não consegui responder agora.'),
        expression,
      }])
      setAttachments([])
      if (Array.isArray(data?.actions) && data.actions.some((action: { ok?: boolean }) => action.ok)) await onReload?.()
    } catch (error) {
      setHelpPhraseIndex(1)
      setHelpBubbleVisible(true)
      setMessages((current) => [...current, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : String(error),
        expression: 'triste',
      }])
    } finally {
      setBusy(false)
    }
  }

  async function attachFiles(files: FileList | null) {
    if (!files?.length) return
    const selected = Array.from(files).slice(0, 4)
    const payloads = await Promise.all(selected.map(fileToPayload))
    setAttachments((current) => [...current, ...payloads].slice(0, 6))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function startAudioMeter(stream: MediaStream) {
    stopAudioMeter()
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    audioContextRef.current = context
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const average = data.reduce((sum, value) => sum + value, 0) / data.length
      setAudioLevel(Math.min(100, Math.round((average / 128) * 100)))
      animationFrameRef.current = window.requestAnimationFrame(tick)
    }
    tick()
  }

  function stopAudioMeter() {
    if (animationFrameRef.current) window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    analyserRef.current = null
    void audioContextRef.current?.close().catch(() => null)
    audioContextRef.current = null
    setAudioLevel(0)
  }

  function startSpeechRecognition() {
    const SpeechRecognitionClass = (window as unknown as {
      SpeechRecognition?: new () => NonNullable<typeof speechRecognitionRef.current>
      webkitSpeechRecognition?: new () => NonNullable<typeof speechRecognitionRef.current>
    }).SpeechRecognition || (window as unknown as {
      webkitSpeechRecognition?: new () => NonNullable<typeof speechRecognitionRef.current>
    }).webkitSpeechRecognition
    if (!SpeechRecognitionClass) {
      setSpeechSupported(false)
      return
    }
    const recognition = new SpeechRecognitionClass()
    recognition.lang = 'pt-BR'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: unknown) => {
      const results = (event as { results?: ArrayLike<{ 0?: { transcript?: string } }> }).results
      if (!results) return
      const text = Array.from(results).map((result) => result[0]?.transcript || '').join(' ').trim()
      setSpeechTranscript(text)
      speechTranscriptRef.current = text
    }
    recognition.onerror = () => setSpeechSupported(false)
    recognition.onend = null
    speechRecognitionRef.current = recognition
    try { recognition.start() } catch { /* already started */ }
  }

  function stopSpeechRecognition() {
    try { speechRecognitionRef.current?.stop() } catch { /* ignore */ }
    speechRecognitionRef.current = null
  }

  async function toggleRecording() {
    if (recording) {
      stopSpeechRecognition()
      mediaRecorderRef.current?.stop()
      setRecording(false)
      stopAudioMeter()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessages((current) => [...current, { id: `mic-${Date.now()}`, role: 'assistant', content: 'Este navegador não liberou gravação de áudio.', expression: 'triste' }])
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStreamRef.current = stream
    audioChunksRef.current = []
    setSpeechTranscript('')
    speechTranscriptRef.current = ''
    startAudioMeter(stream)
    startSpeechRecognition()
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size) audioChunksRef.current.push(event.data)
    }
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      stopAudioMeter()
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      if (!blob.size) return
      const file = new File([blob], `audio-tomatinho-${Date.now()}.webm`, { type: blob.type })
      const payload = await fileToPayload(file)
      const files = [...attachmentsRef.current, payload].slice(0, 6)
      const transcribed = speechTranscriptRef.current.trim()
      const text = [inputRef.current.trim(), transcribed ? `Áudio transcrito: ${transcribed}` : ''].filter(Boolean).join('\n\n')
      setAttachments([])
      setSpeechTranscript('')
      speechTranscriptRef.current = ''
      await sendMessage(text, files)
    }
    mediaRecorderRef.current = recorder
    recorder.start()
    setRecording(true)
    setHelpBubbleVisible(false)
  }

  function openChat() {
    setOpen(true)
    setHelpBubbleVisible(false)
  }

  return <>
    <div className="fixed bottom-20 right-4 z-50 md:bottom-6">
      {!open && helpBubbleVisible && <button type="button" onClick={openChat} className="absolute bottom-20 right-0 w-44 rounded-2xl rounded-br-sm border border-violet-100 bg-white px-4 py-3 text-left text-sm font-bold text-[#211746] shadow-2xl">
        {helpPhrases[helpPhraseIndex]}
      </button>}
      <button type="button" onClick={openChat} className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-[#211746] text-2xl font-black text-white shadow-2xl ring-4 ring-white/70 transition hover:-translate-y-0.5 hover:bg-[#6f5cf6]" title="Falar com o Tomatinho">
        <img src={avatarByExpression.pensativo} alt="Tomatinho" className="h-full w-full object-cover" />
      </button>
    </div>

    {open && <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/20 p-0">
      <section className="flex h-full w-full max-w-[430px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:my-4 sm:mr-4 sm:h-[calc(100vh-2rem)] sm:rounded-2xl sm:border">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-[#211746] px-4 py-3 text-white">
          <img src={avatarByExpression[currentExpression]} alt="Tomatinho" className="h-14 w-14 rounded-full object-cover ring-2 ring-white" />
          <div className="min-w-0 flex-1">
            <h2 className="font-black leading-tight">Agente Vmarket BPO</h2>
            <p className="text-xs text-white/75">tomatinho</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Fechar"><X size={18}/></button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {messages.map((message) => <div key={message.id} className={cn('flex gap-2', message.role === 'user' ? 'justify-end' : 'justify-start')}>
            {message.role === 'assistant' && <img src={avatarByExpression[message.expression || 'pensativo']} alt="Tomatinho" className="mt-1 h-8 w-8 rounded-full object-cover" />}
            <div className={cn('max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm', message.role === 'user' ? 'bg-[#6f5cf6] text-white' : 'border border-slate-200 bg-white text-slate-700')}>{message.content}</div>
          </div>)}
          {busy && <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><img src={avatarByExpression.pensativo} alt="Tomatinho processando" className="h-8 w-8 rounded-full object-cover" />Processando...</div>}
        </div>

        {attachments.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-2">
          {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {file.name}
            <button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-rose-600">×</button>
          </span>)}
        </div>}

        <footer className="border-t border-slate-200 bg-white p-3">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void attachFiles(event.target.files)} />
          {recording && <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2">
            <div className="mb-2 flex items-center text-xs font-black uppercase tracking-wide text-rose-600">
              <span>Gravando áudio</span>
            </div>
            <div className="flex h-8 items-end gap-1">
              {Array.from({ length: 22 }).map((_, index) => {
                const height = Math.max(10, Math.min(100, audioLevel + Math.sin(index * 1.7) * 24))
                return <span key={index} className="flex-1 rounded-full bg-rose-500 transition-all" style={{ height: `${height}%`, opacity: 0.35 + Math.min(0.65, audioLevel / 100) }} />
              })}
            </div>
            <p className="mt-2 text-xs font-semibold text-rose-700">Aperte o microfone de novo para soltar e enviar.</p>
            {speechTranscript && <p className="mt-2 line-clamp-2 rounded-xl bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">Entendi até agora: {speechTranscript}</p>}
            {!speechSupported && <p className="mt-2 text-xs font-semibold text-amber-700">Seu navegador não liberou transcrição ao vivo. Vou enviar o áudio para o agente mesmo assim.</p>}
          </div>}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50" title="Enviar arquivo"><Paperclip size={18}/></button>
            <button type="button" onClick={() => void toggleRecording()} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full border text-slate-600 transition hover:bg-slate-50', recording ? 'translate-y-0.5 border-rose-500 bg-rose-600 text-white shadow-inner ring-4 ring-rose-100' : 'border-slate-200')} title={recording ? 'Soltar e enviar áudio' : 'Gravar áudio'}><Mic size={18}/></button>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} rows={2} className="min-h-11 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#6f5cf6] focus:ring-4 focus:ring-violet-100" placeholder="Pergunte ou peça uma ação objetiva..." />
            <button type="button" disabled={busy || (!input.trim() && !attachments.length)} onClick={() => void sendMessage()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#238847] text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-50" title="Enviar"><Send size={18}/></button>
          </div>
        </footer>
      </section>
    </div>}
  </>
}
