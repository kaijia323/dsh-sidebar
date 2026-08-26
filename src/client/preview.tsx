import { useEffect, useRef, useState, type ReactNode } from 'react'
import { formatBytes, isMarkdownPath } from '../client-model'
import { isDomainError } from './api'
import { CodeView } from './code-view'
import { MarkdownView } from './markdown-view'
import { TabsBar } from './tabs-bar'
import type { FsApi, Limits, ReadOk, ReadValue, SelectedFile } from './types'

interface PreviewPaneProps {
  api: FsApi
  tabs: SelectedFile[]
  activePath: string | undefined
  limits: Limits
  onCloseTab: (path: string) => void
  onSelectTab: (path: string) => void
}

export function PreviewPane({ api, tabs, activePath, limits, onCloseTab, onSelectTab }: PreviewPaneProps) {
  const file = tabs.find((tab) => tab.path === activePath) ?? null
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle')
  const [value, setValue] = useState<ReadValue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState(true)
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPhase('idle')
      setValue(null)
      setError(null)
      lastPathRef.current = null
      return
    }
    const pathChanged = lastPathRef.current !== file.path
    lastPathRef.current = file.path
    if (pathChanged) {
      // Switching to a different file: show a fresh loading state.
      setPhase('loading')
      setValue(null)
      setError(null)
      setMarkdown(true)
    }
    // Same-path re-reads (file changed on disk / watcher refresh) keep the
    // existing content mounted and only swap in the new value when it arrives,
    // so the preview does not blink through an empty loading state.
    const controller = new AbortController()
    api.read(file.path, controller.signal).then((response) => {
      if (controller.signal.aborted) return
      if (isDomainError(response)) {
        setError(response.message)
        setPhase('ready')
        return
      }
      setError(null)
      setValue(response)
      setPhase('ready')
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('ready')
    })
    return () => controller.abort()
  }, [api, file])

  let content: ReactNode
  if (!file) {
    content = <div className="kaijia-preview-empty flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]">点击文件查看内容</div>
  } else if (phase === 'loading') {
    content = <div className="kaijia-preview-empty flex h-full flex-col items-center justify-center text-[var(--dsw-alias-label-tertiary)]"><span className="kaijia-spinner" />正在读取…</div>
  } else if (error || (value && isDomainError(value))) {
    const message = error ?? (isDomainError(value!) ? value.message : '')
    content = <div className="kaijia-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">{message}</div>
  } else {
    const read = value as ReadOk | null
    if (!read) {
      content = <div className="kaijia-preview-empty">无内容</div>
    } else {
      const result = read.result
      if (result.kind === 'binary') {
        content = (
          <div className="kaijia-preview-message">
            <strong>{file.name}</strong>
            <p>二进制文件，无法预览。</p>
            <p className="kaijia-preview-meta">{formatBytes(read.size)}</p>
          </div>
        )
      } else if (result.kind === 'too-large') {
        content = (
          <div className="kaijia-preview-message">
            <strong>{file.name}</strong>
            <p>文件超过预览大小限制（{formatBytes(result.limit)}）。</p>
            <p className="kaijia-preview-meta">{formatBytes(read.size)}</p>
          </div>
        )
      } else if (result.kind === 'error') {
        content = (
          <div className="kaijia-preview-message">
            <strong>{file.name}</strong>
            <p>{result.message}</p>
          </div>
        )
      } else if (result.kind === 'image') {
        const source = `data:${result.mime};base64,${result.base64}`
        content = (
          <div className="kaijia-image-preview">
            <img className="kaijia-image" src={source} alt={file.name} />
          </div>
        )
      } else {
        const markdownFile = isMarkdownPath(file.path)
        content = (
          <div className="kaijia-text-preview flex min-h-0 flex-1 flex-col">
            {markdownFile && (
              <div className="kaijia-preview-toolbar flex h-[26px] flex-none items-center gap-0.5 border-b border-[var(--dsw-alias-border-l2)] px-1.5">
                <button
                  type="button"
                  className={`kaijia-toolbar-button inline-flex cursor-pointer items-center rounded-md px-1.5 py-1${markdown ? ' kaijia-toolbar-active' : ''}`}
                  onClick={() => setMarkdown(true)}
                >
                  预览
                </button>
                <button
                  type="button"
                  className={`kaijia-toolbar-button inline-flex cursor-pointer items-center rounded-md px-1.5 py-1${markdown ? '' : ' kaijia-toolbar-active'}`}
                  onClick={() => setMarkdown(false)}
                >
                  源码
                </button>
                <span className="kaijia-preview-meta ml-auto text-[11px] text-[var(--dsw-alias-label-tertiary)]">{formatBytes(read.size)}</span>
              </div>
            )}
            {markdownFile && markdown
              ? <div className="kaijia-markdown-scroll relative min-h-0 flex-1 overflow-auto"><MarkdownView text={result.content} /></div>
              : <CodeView text={result.content} />}
          </div>
        )
      }
    }
  }

  return (
    <div className="kaijia-preview-root flex min-h-0 flex-1 flex-col">
      {tabs.length > 0 && (
        <TabsBar
          tabs={tabs}
          activePath={activePath}
          onCloseTab={onCloseTab}
          onSelectTab={onSelectTab}
        />
      )}
      <div className="kaijia-preview-content relative flex min-h-0 flex-1 flex-col">
        {content}
      </div>
    </div>
  )
}
