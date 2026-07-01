import { useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Mic, Paperclip, Send, X } from 'lucide-react'
import { supabase } from './supabase'

type TomatinhoExpression = 'pensativo' | 'surpreso' | 'feliz' | 'hell-yeah' | 'triste' | 'intrigado' | 'aliviado'
type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  expression?: TomatinhoExpression
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

const avatarByExpression: Record<TomatinhoExpression, string> = {
  pensativo: '/tomatinho/pensativo.webp',
  surpreso: '/tomatinho/surpreso.webp',
  feliz: '/tomatinho/feliz.webp',
  'hell-yeah': '/tomatinho/hell-yeah.webp',
  triste: '/tomatinho/triste.webp',
  intrigado: '/tomatinho/intrigado.webp',
  aliviado: '/tomatinho/aliviado.webp',
}

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

export function TomatinhoChat({ session, contextDealId, onReload }: Props) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const currentExpression = messages.findLast((message) => message.role === 'assistant')?.expression || 'pensativo'

  async function sendMessage() {
    const text = input.trim()
    if ((!text && !attachments.length) || busy) return
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text || `${attachments.length} arquivo(s) enviado(s)` }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setBusy(true)
    try {
      const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }))
      const { data, error } = await supabase.functions.invoke('tomatinho-chat', {
        body: { message: text, files: attachments, contextDealId: contextDealId || null, history },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      const expression = (data?.expression || 'pensativo') as TomatinhoExpression
      setMessages((current) => [...current, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: String(data?.reply || 'Não consegui responder agora.'),
        expression,
      }])
      setAttachments([])
      if (Array.isArray(data?.actions) && data.actions.some((action: { ok?: boolean }) => action.ok)) await onReload?.()
    } catch (error) {
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

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop()
      setRecording(false)
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessages((current) => [...current, { id: `mic-${Date.now()}`, role: 'assistant', content: 'Este navegador não liberou gravação de áudio.', expression: 'triste' }])
      return
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    audioChunksRef.current = []
    const recorder = new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size) audioChunksRef.current.push(event.data)
    }
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      const file = new File([blob], `audio-agente-vmarket-${Date.now()}.webm`, { type: blob.type })
      const payload = await fileToPayload(file)
      setAttachments((current) => [...current, payload].slice(0, 6))
    }
    mediaRecorderRef.current = recorder
    recorder.start()
    setRecording(true)
  }

  return <>
    <button type="button" onClick={() => setOpen(true)} className="fixed bottom-20 right-4 z-50 flex items-center gap-3 rounded-full bg-[#211746] px-4 py-3 text-sm font-black text-white shadow-2xl ring-4 ring-white/70 transition hover:-translate-y-0.5 hover:bg-[#6f5cf6] md:bottom-6" title="Falar com o agente">
      <img src={avatarByExpression[currentExpression]} alt="Agente Vmarket BPO" className="h-10 w-10 rounded-full object-cover ring-2 ring-white" />
      <span className="hidden sm:inline">Agente</span>
    </button>

    {open && <div className="fixed inset-0 z-[70] flex justify-end bg-slate-950/20 p-0">
      <section className="flex h-full w-full max-w-[430px] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl sm:my-4 sm:mr-4 sm:h-[calc(100vh-2rem)] sm:rounded-2xl sm:border">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-[#211746] px-4 py-3 text-white">
          <img src={avatarByExpression[currentExpression]} alt="Agente Vmarket BPO" className="h-14 w-14 rounded-full object-cover ring-2 ring-white" />
          <div className="min-w-0 flex-1">
            <h2 className="font-black leading-tight">Agente</h2>
            <p className="text-xs text-white/75">Agente Vmarket BPO</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Fechar"><X size={18}/></button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          {messages.map((message) => <div key={message.id} className={cn('flex gap-2', message.role === 'user' ? 'justify-end' : 'justify-start')}>
            {message.role === 'assistant' && <img src={avatarByExpression[message.expression || 'pensativo']} alt="Agente Vmarket BPO" className="mt-1 h-8 w-8 rounded-full object-cover" />}
            <div className={cn('max-w-[82%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm', message.role === 'user' ? 'bg-[#6f5cf6] text-white' : 'border border-slate-200 bg-white text-slate-700')}>{message.content}</div>
          </div>)}
          {busy && <div className="flex items-center gap-2 text-sm font-semibold text-slate-500"><img src={avatarByExpression.pensativo} alt="Agente processando" className="h-8 w-8 rounded-full object-cover" />Processando...</div>}
        </div>

        {attachments.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-white px-4 py-2">
          {attachments.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {file.name}
            <button type="button" onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))} className="text-slate-400 hover:text-rose-600">×</button>
          </span>)}
        </div>}

        <footer className="border-t border-slate-200 bg-white p-3">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => void attachFiles(event.target.files)} />
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50" title="Enviar arquivo"><Paperclip size={18}/></button>
            <button type="button" onClick={() => void toggleRecording()} className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-full border text-slate-600 hover:bg-slate-50', recording ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-200')} title={recording ? 'Parar gravação' : 'Enviar áudio'}><Mic size={18}/></button>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} rows={2} className="min-h-11 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#6f5cf6] focus:ring-4 focus:ring-violet-100" placeholder="Pergunte ou peça uma ação objetiva..." />
            <button type="button" disabled={busy || (!input.trim() && !attachments.length)} onClick={() => void sendMessage()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#238847] text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-50" title="Enviar"><Send size={18}/></button>
          </div>
        </footer>
      </section>
    </div>}
  </>
}
