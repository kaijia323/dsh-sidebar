import * as React from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { basename, clamp, flattenTree, formatBytes, isImagePath, isMarkdownPath, resolveRoot } from './client-model'
import type { DirData, EntryType, FlatRow, SessionListLike, SidebarEntry, WorkspaceListLike } from './client-model'

declare const __DSH_YMC_CLIENT_CSS__: string

export const name = 'dsh-ymc-sidebar'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'layout']

const CHANNEL = '/dsh-ymc-sidebar'
const TREE_ROW_HEIGHT = 24
const CODE_ROW_HEIGHT = 20
const OVERSCAN = 10

const DEFAULT_LIMITS = {
  maxTextBytes: 2 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxEntriesPerDirectory: 2000,
  maxTreeRows: 100000,
}

interface Limits {
  maxTextBytes: number
  maxImageBytes: number
  maxEntriesPerDirectory: number
  maxTreeRows: number
}

interface ListOk {
  kind: 'list'
  path: string
  entries: SidebarEntry[]
  truncated: boolean
}

interface DomainError {
  kind: 'domain-error'
  code: string
  message: string
}

type ListValue = ListOk | DomainError

interface ReadOk {
  kind: 'read'
  path: string
  size: number
  result:
    | { kind: 'text'; content: string }
    | { kind: 'image'; mime: string; base64: string }
    | { kind: 'binary' }
    | { kind: 'too-large'; limit: number }
    | { kind: 'error'; code: string; message: string }
}

type ReadValue = ReadOk | DomainError

interface FsApi {
  list(path: string, signal?: AbortSignal): Promise<ListValue>
  read(path: string, signal?: AbortSignal): Promise<ReadValue>
  meta(signal?: AbortSignal): Promise<Limits>
}

function isDomainError(value: unknown): value is DomainError {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'domain-error'
}

function createFsApi(ctx: ClientContext): FsApi {
  async function callValue<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const response: RpcResult<unknown> = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, signal)
    if (!response.ok) throw new Error(response.error.message)
    return response.value as T
  }

  return {
    list(path, signal) {
      return callValue<ListValue>('list', { path }, signal)
    },
    read(path, signal) {
      return callValue<ReadValue>('read', { path }, signal)
    },
    async meta(signal) {
      const value = await callValue<{ kind: 'meta' } & Limits>('meta', {}, signal)
      return {
        maxTextBytes: value.maxTextBytes,
        maxImageBytes: value.maxImageBytes,
        maxEntriesPerDirectory: value.maxEntriesPerDirectory,
        maxTreeRows: value.maxTreeRows,
      }
    },
  }
}


const TEXT_RE = /(\/\/.*$)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g

const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
  'interface', 'let', 'new', 'null', 'of', 'package', 'private', 'protected', 'public',
  'readonly', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with', 'yield',
])

function highlightLine(line: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  TEXT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TEXT_RE.exec(line))) {
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index))
    const [token, comment, string, number, word] = match
    if (comment !== undefined) {
      nodes.push(<span key={`${key}-c${match.index}`} className="ymc-token-comment">{token}</span>)
    } else if (string !== undefined) {
      nodes.push(<span key={`${key}-s${match.index}`} className="ymc-token-string">{token}</span>)
    } else if (number !== undefined) {
      nodes.push(<span key={`${key}-n${match.index}`} className="ymc-token-number">{token}</span>)
    } else if (word !== undefined && KEYWORDS.has(word)) {
      nodes.push(<span key={`${key}-k${match.index}`} className="ymc-token-keyword">{token}</span>)
    } else {
      nodes.push(token)
    }
    cursor = match.index + token.length
  }
  if (cursor < line.length) nodes.push(line.slice(cursor))
  return nodes
}

function CodeView({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])
  const maxLineLength = useMemo(() => Math.max(0, ...lines.map((line) => line.length)), [lines])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setViewport((prev) => {
      const height = element.clientHeight
      return prev.height === height ? prev : { ...prev, height }
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const start = Math.max(0, Math.floor(viewport.top / CODE_ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(lines.length, Math.ceil((viewport.top + viewport.height) / CODE_ROW_HEIGHT) + OVERSCAN)

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setViewport((prev) => (Math.abs(prev.top - top) < CODE_ROW_HEIGHT ? prev : { ...prev, top }))
  }

  const visible: ReactNode[] = []
  for (let index = start; index < end; index += 1) {
    visible.push(
      <div className="ymc-code-row flex items-start font-mono text-xs leading-5" key={index} style={{ top: index * CODE_ROW_HEIGHT }}>
        <span className="ymc-code-gutter sticky left-0 z-10 select-none">{index + 1}</span>
        <code className="ymc-code-line whitespace-pre pr-4">{highlightLine(lines[index], String(index))}</code>
      </div>,
    )
  }

  return (
    <div className="ymc-code-scroll relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      <div
        className="ymc-code-spacer relative min-w-full"
        style={{ height: lines.length * CODE_ROW_HEIGHT, minWidth: `max(100%, ${Math.max(maxLineLength, 1)}ch)` }}
      >
        {visible}
      </div>
    </div>
  )
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g
  let cursor = 0
  let index = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const [token, code, bold, italic, link] = match
    const key = `${keyPrefix}-i${index++}`
    if (code !== undefined) {
      nodes.push(<code key={key} className="ymc-md-code">{code.slice(1, -1)}</code>)
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>)
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic.slice(1, -1)}</em>)
    } else if (link !== undefined) {
      const open = link.indexOf('](')
      const label = link.slice(1, open)
      const href = link.slice(open + 2, -1)
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer">{label}</a>,
      )
    } else {
      nodes.push(token)
    }
    cursor = match.index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function MarkdownView({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []

  function flushList(key: number) {
    if (listItems.length === 0) return
    if (listType === 'ol') blocks.push(<ol key={`list-${key}`}>{listItems}</ol>)
    else blocks.push(<ul key={`list-${key}`}>{listItems}</ul>)
    listItems = []
    listType = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^```/.test(line)) {
      flushList(index)
      const fence: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        fence.push(lines[index])
        index += 1
      }
      blocks.push(
        <pre key={`code-${index}`} className="ymc-md-pre"><code>{fence.join('\n')}</code></pre>,
      )
      continue
    }
    if (/^\s*$/.test(line)) {
      flushList(index)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList(index)
      const level = heading[1].length
      const content = renderInline(heading[2], `h${index}`)
      blocks.push(React.createElement(`h${level}`, { key: `h-${index}`, className: 'ymc-md-heading' }, content))
      continue
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushList(index)
      blocks.push(<hr key={`hr-${index}`} className="ymc-md-hr" />)
      continue
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      if (listType !== 'ul') {
        flushList(index)
        listType = 'ul'
      }
      listItems.push(<li key={`li-${index}`}>{renderInline(unordered[1], `u${index}`)}</li>)
      continue
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      if (listType !== 'ol') {
        flushList(index)
        listType = 'ol'
      }
      listItems.push(<li key={`li-${index}`}>{renderInline(ordered[1], `o${index}`)}</li>)
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      flushList(index)
      blocks.push(
        <blockquote key={`q-${index}`} className="ymc-md-quote">{renderInline(quote[1], `q${index}`)}</blockquote>,
      )
      continue
    }
    flushList(index)
    blocks.push(<p key={`p-${index}`} className="ymc-md-paragraph">{renderInline(line, `p${index}`)}</p>)
  }
  flushList(lines.length)
  return <div className="ymc-markdown mx-auto max-w-[760px] p-3 leading-relaxed">{blocks}</div>
}

interface SelectedFile {
  path: string
  name: string
}

interface InjectedDetails {
  api: FsApi
  closeDetails: () => void
}

type DetailsProps = PropsRuntime<'details'> & InjectedDetails

interface InjectedHeaderAction {
  openDetails: () => void
}

type HeaderActionProps = PropsRuntime<'conversation.session.header.actions'> & InjectedHeaderAction

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`ymc-chevron${open ? ' ymc-chevron-open' : ''}`} width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg className="ymc-icon ymc-icon-folder" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {open === true
        ? <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        : <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="currentColor" opacity="0.35" />}
    </svg>
  )
}

function FileIcon({ name }: { name: string }) {
  if (isImagePath(name)) {
    return (
      <svg className="ymc-icon ymc-icon-image" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2 2h12v12H2z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5.5" cy="5.5" r="1.3" fill="currentColor" />
        <path d="M2 11l3.5-3.5 2.5 2.5 3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  }
  if (isMarkdownPath(name)) {
    return (
      <svg className="ymc-icon ymc-icon-markdown" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 3.5h11v9h-11z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.5 11V6l2 2 2-2v5M11 6v5l2-2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg className="ymc-icon ymc-icon-file" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

interface TreeRowProps {
  row: FlatRow
  expanded: boolean
  loading: boolean
  selected: boolean
  style: CSSProperties
  onToggle: (row: FlatRow) => void
  onSelect: (row: FlatRow) => void
}

const TreeRow = React.memo(function TreeRow({ row, expanded, loading, selected, style, onToggle, onSelect }: TreeRowProps) {
  const padding = 8 + row.depth * 14
  const className = [
    'ymc-tree-row',
    'flex',
    'items-center',
    'gap-1',
    'select-none',
    'whitespace-nowrap',
    'cursor-pointer',
    row.type === 'directory' ? 'ymc-tree-dir' : row.type === 'file' ? 'ymc-tree-file' : 'ymc-tree-note',
    selected ? 'ymc-tree-row-selected' : '',
  ].filter(Boolean).join(' ')

  function handleChevron(event: React.MouseEvent) {
    event.stopPropagation()
    onToggle(row)
  }

  return (
    <div
      className={className}
      style={{ ...style, paddingLeft: padding }}
      title={row.path}
      onClick={() => {
        if (row.type === 'directory') onToggle(row)
        else if (row.type === 'file') onSelect(row)
      }}
    >
      <span className="ymc-tree-chevron-slot">
        {row.type === 'directory' && !loading && <span className="ymc-tree-chevron" onClick={handleChevron}><Chevron open={expanded} /></span>}
        {row.type === 'directory' && loading && <span className="ymc-tree-spinner" />}
      </span>
      {row.type === 'directory' ? <FolderIcon open={expanded} /> : <FileIcon name={row.name} />}
      <span className="ymc-tree-label">{row.name}</span>
    </div>
  )
})

interface TreeProps {
  root: string
  dirs: Record<string, DirData>
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
  selectedPath: string | undefined
  maxRows: number
  onToggle: (path: string) => void
  onSelectFile: (entry: SidebarEntry) => void
}

function Tree({ root, dirs, expanded, loading, selectedPath, maxRows, onToggle, onSelectFile }: TreeProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setViewport((prev) => {
      const height = element.clientHeight
      return prev.height === height ? prev : { ...prev, height }
    })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const flattened = useMemo(() => flattenTree(root, dirs, expanded, maxRows), [root, dirs, expanded, maxRows])
  const rows = flattened.rows
  const start = Math.max(0, Math.floor(viewport.top / TREE_ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / TREE_ROW_HEIGHT) + OVERSCAN)

  function onScroll(event: React.UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setViewport((prev) => (Math.abs(prev.top - top) < TREE_ROW_HEIGHT ? prev : { ...prev, top }))
  }

  function handleToggle(path: string) {
    onToggle(path)
  }

  const visible: ReactNode[] = []
  for (let index = start; index < end; index += 1) {
    const row = rows[index]
    visible.push(
      <TreeRow
        key={row.key}
        row={row}
        expanded={expanded.has(row.path)}
        loading={loading.has(row.path)}
        selected={selectedPath === row.path}
        onToggle={(target) => handleToggle(target.path)}
        onSelect={(target) => onSelectFile({ name: target.name, path: target.path, type: target.type })}
        style={{ top: index * TREE_ROW_HEIGHT } as CSSProperties}
      />,
    )
  }

  return (
    <div className="ymc-tree-scroll relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      {rows.length === 0
        ? <div className="ymc-tree-empty flex h-full flex-col items-center justify-center">空目录</div>
        : (
            <div className="ymc-tree-spacer relative min-w-full" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
              {visible}
            </div>
          )}
      {flattened.truncated && <div className="ymc-tree-truncated">树已截断（超过 {maxRows} 行）</div>}
    </div>
  )
}

interface PreviewPaneProps {
  api: FsApi
  file: SelectedFile | null
  limits: Limits
}

function PreviewPane({ api, file, limits }: PreviewPaneProps) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [value, setValue] = useState<ReadValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState(true)

  useEffect(() => {
    if (!file) {
      setPhase('idle')
      setValue(null)
      setError(null)
      return
    }
    setPhase('loading')
    setValue(null)
    setError(null)
    setMarkdown(true)
    const controller = new AbortController()
    api.read(file.path, controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (isDomainError(response)) {
        setError(response.message)
        setPhase('ready')
        return
      }
      setValue(response)
      setPhase('ready')
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('ready')
    })
    return () => controller.abort()
  }, [api, file])

  if (!file) {
    return <div className="ymc-preview-empty flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]">点击文件查看内容</div>
  }
  if (phase === 'loading') {
    return <div className="ymc-preview-empty flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]"><span className="ymc-spinner" />正在读取…</div>
  }
  if (error || (value && isDomainError(value))) {
    const message = error ?? (isDomainError(value!) ? value.message : '')
    return <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">{message}</div>
  }

  const read = value as ReadOk | null
  if (!read) return <div className="ymc-preview-empty">无内容</div>

  const result = read.result
  if (result.kind === 'binary') {
    return (
      <div className="ymc-preview-message">
        <strong>{file.name}</strong>
        <p>二进制文件，无法预览。</p>
        <p className="ymc-preview-meta">{formatBytes(read.size)}</p>
      </div>
    )
  }
  if (result.kind === 'too-large') {
    return (
      <div className="ymc-preview-message">
        <strong>{file.name}</strong>
        <p>文件超过预览大小限制（{formatBytes(result.limit)}）。</p>
        <p className="ymc-preview-meta">{formatBytes(read.size)}</p>
      </div>
    )
  }
  if (result.kind === 'error') {
    return (
      <div className="ymc-preview-message">
        <strong>{file.name}</strong>
        <p>{result.message}</p>
      </div>
    )
  }
  if (result.kind === 'image') {
    const source = `data:${result.mime};base64,${result.base64}`
    return (
      <div className="ymc-image-preview">
        <img className="ymc-image" src={source} alt={file.name} />
      </div>
    )
  }

  const markdownFile = isMarkdownPath(file.path)
  return (
    <div className="ymc-text-preview flex min-h-0 flex-1 flex-col">
      {markdownFile && (
        <div className="ymc-preview-toolbar flex h-[26px] flex-none items-center gap-0.5 border-b border-[var(--dsw-alias-border-l2)] px-1.5">
          <button
            type="button"
            className={`ymc-toolbar-button inline-flex cursor-pointer items-center rounded-md px-1.5 py-1${markdown ? ' ymc-toolbar-active' : ''}`}
            onClick={() => setMarkdown(true)}
          >
            预览
          </button>
          <button
            type="button"
            className={`ymc-toolbar-button inline-flex cursor-pointer items-center rounded-md px-1.5 py-1${markdown ? '' : ' ymc-toolbar-active'}`}
            onClick={() => setMarkdown(false)}
          >
            源码
          </button>
          <span className="ymc-preview-meta ml-auto text-[11px] text-[var(--dsw-alias-label-tertiary)]">{formatBytes(read.size)}</span>
        </div>
      )}
      {markdownFile && markdown
        ? <div className="ymc-markdown-scroll relative min-h-0 flex-1 overflow-auto"><MarkdownView text={result.content} /></div>
        : <CodeView text={result.content} />}
    </div>
  )
}

interface PanelHeaderProps {
  root: string | undefined
  loadingRoot: boolean
  onRefresh: () => void
  onClose: () => void
}

function PanelHeader({ root, loadingRoot, onRefresh, onClose }: PanelHeaderProps) {
  return (
    <div className="ymc-panel-header flex flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
      <span className="ymc-panel-title font-semibold whitespace-nowrap">文件树</span>
      {root && <span className="ymc-panel-root min-w-0 flex-1 truncate text-[var(--dsw-alias-label-tertiary)]" title={root}>{basename(root)}</span>}
      <div className="ymc-panel-actions ml-auto flex items-center gap-0.5">
        <button type="button" className="ymc-icon-button inline-flex cursor-pointer items-center rounded-md p-1.5" title="刷新" onClick={onRefresh}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="ymc-icon-button inline-flex cursor-pointer items-center rounded-md p-1.5" title="关闭右侧栏" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {loadingRoot && <span className="ymc-spinner" />}
    </div>
  )
}

function DetailsPanel({ api, closeDetails, sessionId, useSessions, useWorkspaces }: DetailsProps) {
  const sessions = useSessions((state) => state) as SessionListLike
  const workspaces = useWorkspaces((state) => state) as WorkspaceListLike
  const root = useMemo(() => resolveRoot(sessionId, sessions, workspaces), [sessionId, sessions, workspaces])

  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS)
  const [dirs, setDirs] = useState<Record<string, DirData>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set<string>())
  const [selected, setSelected] = useState<SelectedFile | null>(null)
  const [rootError, setRootError] = useState<string | null>(null)
  const [split, setSplit] = useState(0.55)

  const bodyRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startY: number; startSplit: number } | null>(null)
  const inflightRef = useRef(new Map<string, Promise<void>>())
  const controllersRef = useRef(new Map<string, AbortController>())
  const dirsRef = useRef(dirs)
  const expandedRef = useRef(expanded)
  const loadingRef = useRef(loading)

  useEffect(() => { dirsRef.current = dirs }, [dirs])
  useEffect(() => { expandedRef.current = expanded }, [expanded])
  useEffect(() => { loadingRef.current = loading }, [loading])

  useEffect(() => {
    const controller = new AbortController()
    api.meta(controller.signal).then((value) => {
      if (!controller.signal.aborted) setLimits(value)
    }).catch(() => {})
    return () => controller.abort()
  }, [api])

  useEffect(() => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    inflightRef.current.clear()
    setDirs({})
    setExpanded(new Set(root ? [root] : []))
    setSelected(null)
    setRootError(null)
    if (!root) setRootError('当前会话没有工作区目录（cwd）。请先打开一个工作区会话。')
  }, [root])

  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      const body = bodyRef.current
      if (!drag || !body) return
      const rect = body.getBoundingClientRect()
      setSplit(clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0.2, 0.8))
    }
    const handlePointerUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const loadDir = useCallback(async (path: string): Promise<void> => {
    if (!path) return
    if (dirsRef.current[path]) return
    const existing = inflightRef.current.get(path)
    if (existing) return existing
    setLoading((prev) => new Set(prev).add(path))

    const controller = new AbortController()
    controllersRef.current.set(path, controller)

    const task = (async () => {
      try {
        const response = await api.list(path, controller.signal)
        if (controller.signal.aborted) return
        if (isDomainError(response)) {
          setDirs((prev) => ({ ...prev, [path]: { entries: [], truncated: false, error: response.message } }))
          return
        }
        setDirs((prev) => {
          const previous = prev[path]
          if (previous && previous.entries.length > 0) return prev
          return {
            ...prev,
            [path]: {
              entries: response.entries,
              truncated: response.truncated,
              error: response.truncated ? `目录条目过多，仅显示前 ${limits.maxEntriesPerDirectory} 项` : undefined,
            },
          }
        })
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
        const message = error instanceof Error ? error.message : String(error)
        setDirs((prev) => ({ ...prev, [path]: { entries: [], truncated: false, error: message } }))
      } finally {
        controllersRef.current.delete(path)
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        inflightRef.current.delete(path)
      }
    })()

    inflightRef.current.set(path, task)
    return task
  }, [api, limits.maxEntriesPerDirectory])

  useEffect(() => {
    for (const path of expanded) {
      if (!dirs[path] && !inflightRef.current.has(path)) void loadDir(path)
    }
  }, [expanded, dirs, loadDir])

  function toggleDirectory(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function refresh() {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
    inflightRef.current.clear()
    setDirs({})
    setSelected(null)
    setExpanded(new Set(root ? [root] : []))
  }

  function onDividerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const body = bodyRef.current
    if (!body) return
    event.preventDefault()
    const rect = body.getBoundingClientRect()
    dragRef.current = { startY: event.clientY, startSplit: split }
    const next = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0.2, 0.8)
    setSplit(next)
  }

  if (!root) {
    return (
      <div className="ymc-panel flex h-full min-h-0 flex-col bg-[var(--dsw-alias-bg-layer-2)] text-[var(--dsw-alias-label-primary)]">
        <PanelHeader root={undefined} loadingRoot={false} onRefresh={() => {}} onClose={closeDetails} />
        <div className="ymc-panel-message flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]">{rootError ?? '没有可显示的工作区目录。'}</div>
      </div>
    )
  }

  const rootData = dirs[root]
  const rowLoading = loading.has(root)
  const hasRootError = rootData?.error && rootData.entries.length === 0

  return (
    <div className="ymc-panel flex h-full min-h-0 flex-col bg-[var(--dsw-alias-bg-layer-2)] text-[var(--dsw-alias-label-primary)]">
      <PanelHeader root={root} loadingRoot={rowLoading} onRefresh={refresh} onClose={closeDetails} />
      <div className="ymc-panel-body relative flex min-h-0 flex-1 flex-col" ref={bodyRef}>
        <div
          className="ymc-tree-pane relative min-h-[40px] shrink-0 overflow-hidden"
          style={{ flexBasis: `${Math.round(split * 100)}%`, flexGrow: 0, flexShrink: 0, minHeight: 40 }}
        >
          {hasRootError
            ? <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">{rootData!.error}</div>
            : (
                <Tree
                  root={root}
                  dirs={dirs}
                  expanded={expanded}
                  loading={loading}
                  selectedPath={selected?.path}
                  maxRows={limits.maxTreeRows}
                  onToggle={toggleDirectory}
                  onSelectFile={(entry) => setSelected({ path: entry.path, name: entry.name })}
                />
              )}
        </div>
        <div className="ymc-divider relative flex h-[7px] flex-none touch-none items-center justify-center" onPointerDown={onDividerPointerDown}>
          <span className="ymc-divider-grip h-[3px] w-[26px] rounded-sm bg-[var(--dsw-alias-border-l2)]" />
        </div>
        <div className="ymc-preview-pane relative flex min-h-[60px] flex-1 flex-col">
          <PreviewPane api={api} file={selected} limits={limits} />
        </div>
      </div>
    </div>
  )
}

function FileTreeButton({ openDetails }: HeaderActionProps) {
  return (
    <button type="button" className="ymc-header-button inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs whitespace-nowrap text-[var(--dsw-alias-label-secondary)] hover:bg-[var(--dsw-alias-interactive-bg-hover)]" title="文件树" onClick={openDetails}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.5 3.5h4l1.5 2h7.5v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 7.5h6M5 10h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span>文件树</span>
    </button>
  )
}

const STYLES = __DSH_YMC_CLIENT_CSS__

function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  // Always create a fresh style element per plugin fiber. This keeps hot
  // reload / unload clean: the disposer removes exactly the element this
  // instance created, and overlapping HMR generations do not steal or remove
  // each other's styles.
  const element = document.createElement('style')
  element.setAttribute('data-dsh-ymc-sidebar-style', '')
  element.textContent = STYLES
  document.head.appendChild(element)
  return () => element.remove()
}

export function apply(ctx: ClientContext) {
  const api = createFsApi(ctx)
  const closeDetails = () => ctx.layout.closeDetails()
  const openDetails = () => ctx.layout.openDetails()

  ctx.effect(() => installStyles())

  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: (): InjectedDetails => ({ api, closeDetails }),
  }, DetailsPanel))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'dsh-ymc-sidebar.open',
    order: 120,
    label: () => '文件树',
    inject: (): InjectedHeaderAction => ({ openDetails }),
  }, FileTreeButton))
}
