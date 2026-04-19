import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Sparkles, AlertCircle, RefreshCw, Pencil, Eye, Mail, CheckCircle,
  Bold, Italic, Heading2, List, Undo2, Redo2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { supabase } from '@/lib/supabase'

interface Props {
  requestId: string
  subject?: string | null
}

type State =
  | { phase: 'checking' }
  | { phase: 'idle' }
  | { phase: 'streaming'; text: string }
  | { phase: 'done'; text: string }
  | { phase: 'error'; message: string }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

// ── Helpers ────────────────────────────────────────────────────────

function inlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}

// Convert AI-generated markdown to HTML for TipTap ingestion.
// Handles headings, tables, bullet lists, bold/italic, and paragraphs.
function markdownToHtml(md: string): string {
  const blocks = md.split(/\n\n+/)
  const parts: string[] = []

  for (const block of blocks) {
    const lines = block.trim().split('\n').filter((l) => l.trim())
    if (lines.length === 0) continue

    // Table: has pipe chars and a |---|---| separator row
    const hasSep = lines.some((l) => /^\|[\s\-:|]+\|$/.test(l.trim()))
    if (lines.some((l) => l.includes('|')) && hasSep) {
      const dataLines = lines.filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()))
      const cells = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim())
      const [headerLine, ...bodyLines] = dataLines
      const thead = `<thead><tr>${cells(headerLine).map((h) => `<th>${inlineMarkdown(h)}</th>`).join('')}</tr></thead>`
      const tbody = bodyLines.length
        ? `<tbody>${bodyLines.map((r) => `<tr>${cells(r).map((c) => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
        : ''
      parts.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    // All-bullet block
    if (lines.every((l) => /^[-*]\s/.test(l.trim()))) {
      const items = lines.map((l) =>
        `<li><p>${inlineMarkdown(l.replace(/^[-*]\s+/, '').trim())}</p></li>`
      )
      parts.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Mixed or heading/paragraph block — process line by line
    parts.push(
      lines.map((line) => {
        const t = line.trim()
        const h4 = t.match(/^####\s+(.+)$/); if (h4) return `<h4>${inlineMarkdown(h4[1])}</h4>`
        const h3 = t.match(/^###\s+(.+)$/);  if (h3) return `<h3>${inlineMarkdown(h3[1])}</h3>`
        const h2 = t.match(/^##\s+(.+)$/);   if (h2) return `<h2>${inlineMarkdown(h2[1])}</h2>`
        const h1 = t.match(/^#\s+(.+)$/);    if (h1) return `<h2>${inlineMarkdown(h1[1])}</h2>` // remap h1→h2
        const li = t.match(/^[-*]\s+(.+)$/); if (li) return `<li><p>${inlineMarkdown(li[1])}</p></li>`
        return `<p>${inlineMarkdown(t)}</p>`
      }).join('')
    )
  }

  return parts.join('')
}


const isHtml = (s: string) => s.trimStart().startsWith('<')

// ── Component ──────────────────────────────────────────────────────

export default function DraftPanel({ requestId, subject }: Props) {
  const [state, setState] = useState<State>({ phase: 'checking' })
  const [editedContent, setEditedContent] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [emailBtnState, setEmailBtnState] = useState<'idle' | 'opening'>('idle')
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch user email once on mount for email client detection (Change 2)
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
  }, [])

  // TipTap editor — always initialized, rendered only in edit mode
  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'outline-none' },
    },
  })

  // On requestId change: load or reset draft
  useEffect(() => {
    setState({ phase: 'checking' })
    setIsEditing(false)
    setEditedContent('')
    let cancelled = false

    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return
      try {
        const res = await fetch(`${API_BASE}/api/ai/draft/${requestId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (cancelled) return
        if (res.ok) {
          const json = await res.json() as { draft: string; tokens: number }
          setEditedContent(json.draft)
          setState({ phase: 'done', text: json.draft })
        } else {
          setState({ phase: 'idle' })
        }
      } catch {
        if (!cancelled) setState({ phase: 'idle' })
      }
    }

    check()
    return () => { cancelled = true }
  }, [requestId])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const generate = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const controller = new AbortController()
    abortRef.current = controller
    setIsEditing(false)
    setState({ phase: 'streaming', text: '' })

    try {
      const res = await fetch(`${API_BASE}/api/ai/draft/${requestId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setState({ phase: 'error', message: 'Server error — please try again.' })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const messages = buffer.split('\n\n')
        buffer = messages.pop() ?? ''

        for (const msg of messages) {
          const line = msg.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6)) as
              | { type: 'delta'; text: string }
              | { type: 'done'; tokens: number }
              | { type: 'error'; message: string }

            if (event.type === 'delta') {
              accumulated += event.text
              setState({ phase: 'streaming', text: accumulated })
            } else if (event.type === 'done') {
              setEditedContent(accumulated)
              setState({ phase: 'done', text: accumulated })
            } else if (event.type === 'error') {
              setState({ phase: 'error', message: event.message })
            }
          } catch { /* malformed SSE — skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState({ phase: 'error', message: 'Connection lost — please try again.' })
    }
  }

  // Enter edit mode: convert current content to HTML and load into TipTap
  const enterEditMode = () => {
    if (!editor) return
    const html = isHtml(editedContent) ? editedContent : markdownToHtml(editedContent)
    editor.commands.setContent(html)
    setIsEditing(true)
  }

  // Exit edit mode: snapshot TipTap HTML back to editedContent
  const exitEditMode = () => {
    if (editor) setEditedContent(editor.getHTML())
    setIsEditing(false)
  }

  const openInEmailClient = async () => {
    const raw = isEditing && editor ? editor.getHTML() : editedContent
    const htmlContent = isHtml(raw) ? raw : markdownToHtml(raw)
    const subjectStr = subject ? `Re: ${subject}` : 'Response to your request'

    try {
      const blob = new Blob([htmlContent], { type: 'text/html' })
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
    } catch { /* clipboard unavailable */ }

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)

    if (userEmail.endsWith('@gmail.com')) {
      // Show button feedback first — user reads it for 2s, then Gmail opens
      setEmailBtnState('opening')
      setToastVisible(true)
      setTimeout(() => {
        window.open(
          `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subjectStr)}`,
          '_blank'
        )
        toastTimerRef.current = setTimeout(() => {
          setEmailBtnState('idle')
          setToastVisible(false)
        }, 3000)
      }, 2000)
    } else {
      // mailto: — open immediately, Outlook takes time anyway
      setToastVisible(true)
      window.location.href = `mailto:?subject=${encodeURIComponent(subjectStr)}`
      toastTimerRef.current = setTimeout(() => setToastVisible(false), 3000)
    }
  }

  // ── Render states ──────────────────────────────────────────────

  if (state.phase === 'checking') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <p className="text-xs text-slate-400">Checking for existing draft…</p>
      </div>
    )
  }

  if (state.phase === 'idle') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <button
          onClick={generate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#0369A1] text-white hover:bg-[#0284C7] transition-colors duration-150 cursor-pointer"
        >
          <Sparkles className="w-4 h-4" />
          Draft Response
        </button>
        <p className="text-xs text-slate-400 mt-2">
          AI will generate a draft using your supplier profile. You review and send.
        </p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <div className="flex items-start gap-2 text-sm text-red-600 mb-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
        <button
          onClick={generate}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#0369A1] hover:underline cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" /> Try again
        </button>
      </div>
    )
  }

  const isStreaming = state.phase === 'streaming'
  const displayText = isStreaming ? state.text : editedContent

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#0369A1]" />
          <span className="text-xs font-semibold text-[#0F172A]">
            {isStreaming ? 'Drafting…' : 'AI Draft'}
          </span>
        </div>

        {!isStreaming && (
          <div className="flex items-center gap-2">
            <button
              onClick={isEditing ? exitEditMode : enterEditMode}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border border-[#0F172A] text-[#0F172A] bg-transparent hover:bg-slate-100 transition-colors duration-150 cursor-pointer"
            >
              {isEditing
                ? <><Eye className="w-3 h-3" /> Preview</>
                : <><Pencil className="w-3 h-3" /> Edit draft</>}
            </button>
            <button
              onClick={generate}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Regenerate
            </button>
            <button
              onClick={openInEmailClient}
              disabled={emailBtnState === 'opening'}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors duration-150 cursor-pointer ${
                emailBtnState === 'opening'
                  ? 'border-emerald-400 text-emerald-600 bg-emerald-50'
                  : 'border-slate-300 text-slate-600 bg-transparent hover:border-slate-400 hover:text-slate-700'
              }`}
            >
              {emailBtnState === 'opening'
                ? <><CheckCircle className="w-3 h-3" /> Opening Gmail...</>
                : <><Mail className="w-3 h-3" /> Open in email client</>}
            </button>
          </div>
        )}
      </div>

      {/* Edit mode — TipTap rich text editor */}
      {isEditing && (
        <div className="border border-slate-300 bg-slate-50 rounded-lg overflow-hidden focus-within:border-[#0F172A] focus-within:ring-1 focus-within:ring-[#0F172A] transition-colors duration-150">
          {/* Toolbar */}
          {editor && (
            <div className="flex items-center gap-0.5 px-3 py-2 border-b border-slate-200 bg-white">
              <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
                <Bold className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
                <Italic className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading">
                <Heading2 className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
                <List className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <div className="w-px h-4 bg-slate-200 mx-1" />
              <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">
                <Undo2 className="w-3.5 h-3.5" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">
                <Redo2 className="w-3.5 h-3.5" />
              </ToolbarBtn>
            </div>
          )}

          {/* Editor content area */}
          <div className="
            [&_.ProseMirror]:p-4 [&_.ProseMirror]:min-h-[400px] [&_.ProseMirror]:outline-none
            [&_.ProseMirror]:text-sm [&_.ProseMirror]:text-slate-800 [&_.ProseMirror]:leading-relaxed
            [&_.ProseMirror_p]:my-1
            [&_.ProseMirror_h2]:text-[1.1rem] [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:text-[#0F172A] [&_.ProseMirror_h2]:mt-4 [&_.ProseMirror_h2]:mb-1
            [&_.ProseMirror_h3]:text-[1rem] [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:text-[#0F172A] [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1
            [&_.ProseMirror_h4]:text-[0.9rem] [&_.ProseMirror_h4]:font-semibold [&_.ProseMirror_h4]:text-slate-600 [&_.ProseMirror_h4]:mt-2 [&_.ProseMirror_h4]:mb-0.5
            [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_li]:my-0.5
            [&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_strong]:text-[#0F172A]
            [&_.ProseMirror_em]:italic
            [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:text-sm [&_.ProseMirror_table]:my-2
            [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-slate-200 [&_.ProseMirror_th]:px-3 [&_.ProseMirror_th]:py-2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_th]:text-slate-600 [&_.ProseMirror_th]:bg-slate-100
            [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-slate-200 [&_.ProseMirror_td]:px-3 [&_.ProseMirror_td]:py-2 [&_.ProseMirror_td]:text-slate-700 [&_.ProseMirror_td]:align-top
          ">
            <EditorContent editor={editor} />
          </div>
        </div>
      )}

      {/* View mode — ReactMarkdown (markdown) or styled HTML (after TipTap edit) */}
      {!isEditing && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-[480px] overflow-y-auto">
          {isHtml(displayText) ? (
            <div
              className="
                prose prose-sm max-w-none
                prose-headings:text-[#0F172A] prose-headings:font-semibold
                prose-p:text-slate-700 prose-p:leading-relaxed
                prose-strong:text-[#0F172A] prose-strong:font-semibold
                prose-ul:text-slate-700 prose-li:my-0.5
                prose-table:w-full prose-table:text-sm prose-table:border-collapse
                prose-thead:bg-slate-100
                prose-th:border prose-th:border-slate-200 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-slate-600
                prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:align-top
                [&_tbody_tr:nth-child(even)]:bg-slate-50/70
              "
              dangerouslySetInnerHTML={{ __html: displayText }}
            />
          ) : (
            <div className="
              prose prose-sm max-w-none
              prose-headings:text-[#0F172A] prose-headings:font-semibold
              prose-h2:text-sm prose-h3:text-xs prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-slate-500
              prose-p:text-slate-700 prose-p:leading-relaxed
              prose-strong:text-[#0F172A] prose-strong:font-semibold
              prose-ul:text-slate-700 prose-li:my-0.5
              prose-table:w-full prose-table:text-sm prose-table:border-collapse
              prose-thead:bg-slate-100
              prose-th:border prose-th:border-slate-200 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-slate-600
              prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:align-top
              [&_tbody_tr:nth-child(even)]:bg-slate-50/70
            ">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: (props) => <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{props.children}</h2>,
                  h2: (props) => <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>{props.children}</h2>,
                  h3: (props) => <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{props.children}</h3>,
                  h4: (props) => <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>{props.children}</h4>,
                }}
              >
                {displayText}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-0.5 h-4 bg-[#0369A1] ml-0.5 animate-pulse align-text-bottom" />
              )}
            </div>
          )}
        </div>
      )}

      {!isStreaming && (
        <p className="text-xs text-slate-400 mt-2">
          {isEditing
            ? 'Editing draft — click Preview to see formatted output.'
            : 'Draft generated — review, edit, or open in your email client.'}
        </p>
      )}

      {/* Toast notification */}
      <div
        className={`
          fixed bottom-5 right-5 z-50
          bg-[#0F172A] text-white text-xs font-medium
          px-4 py-2.5 rounded-lg shadow-lg
          transition-opacity duration-300
          ${toastVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}
        `}
      >
        Draft copied — paste into email body to preserve formatting (Ctrl+V)
      </div>
    </div>
  )
}

// ── Toolbar button ─────────────────────────────────────────────────

function ToolbarBtn({
  onClick, active, title, children,
}: {
  onClick: () => void
  active: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors duration-150 cursor-pointer ${
        active
          ? 'bg-slate-200 text-[#0F172A]'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}
