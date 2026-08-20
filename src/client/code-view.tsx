import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'
import { CODE_ROW_HEIGHT, OVERSCAN } from './constants'

const TEXT_RE = /(\/\/.*$)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g

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

export function CodeView({ text }: { text: string }) {
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

  function onScroll(event: UIEvent<HTMLDivElement>) {
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
