import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { CODE_ROW_HEIGHT, OVERSCAN } from './constants'

type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'context'

interface DiffLine {
  text: string
  kind: DiffLineKind
}

function classifyDiffLine(line: string): DiffLineKind {
  if (
    line.startsWith('diff ')
    || line.startsWith('index ')
    || line.startsWith('--- ')
    || line.startsWith('+++ ')
    || line.startsWith('new file')
    || line.startsWith('deleted file')
    || line.startsWith('similarity')
    || line.startsWith('rename ')
    || line.startsWith('copy ')
    || line.startsWith('\\')
  ) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'context'
}

function parseDiff(diff: string): DiffLine[] {
  return diff.split('\n').map((text) => ({ text, kind: classifyDiffLine(text) }))
}

export function DiffView({ diff }: { diff: string }) {
  const lines = useMemo(() => parseDiff(diff), [diff])
  const maxLineLength = useMemo(() => Math.max(0, ...lines.map((line) => line.text.length)), [lines])
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

  return (
    <div className="kaijia-diff-scroll relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      <div
        className="kaijia-diff-spacer relative min-w-full"
        style={{ height: lines.length * CODE_ROW_HEIGHT, minWidth: `max(100%, ${Math.max(maxLineLength, 1)}ch)` }}
      >
        {lines.slice(start, end).map((line, index) => {
          const top = (start + index) * CODE_ROW_HEIGHT
          const aliasClass = line.kind === 'add' ? 'kaijia-diff-add' : line.kind === 'del' ? 'kaijia-diff-del' : line.kind === 'hunk' ? 'kaijia-diff-hunk' : line.kind === 'meta' ? 'kaijia-diff-meta' : ''
          return (
            <div
              key={start + index}
              className={`kaijia-diff-line kaijia-diff-line-${line.kind}${aliasClass ? ` ${aliasClass}` : ''}`}
              style={{ top, height: CODE_ROW_HEIGHT } as CSSProperties}
            >
              <code className="kaijia-diff-text whitespace-pre">{line.text || ' '}</code>
            </div>
          )
        })}
      </div>
    </div>
  )
}
