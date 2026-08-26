import { useLayoutEffect, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { DiffView } from './diff-view'
import type { DomainError, GitLogCommit, GitShowValue } from './types'

export const GIT_COMMIT_PAGE_SIZE = 100
const GIT_COMMIT_ROW_HEIGHT = 42
const GIT_COMMIT_OVERSCAN = 8

export function formatCommitDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isDomainError(value: unknown): value is DomainError {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'domain-error'
}

function refChip(label: string): string {
  return label
}

function CommitRow({ commit, selected, onSelect, styleTop }: {
  commit: GitLogCommit
  selected: boolean
  onSelect: (commit: GitLogCommit) => void
  styleTop: number
}) {
  const refs = commit.refs.slice(0, 3)
  return (
    <button
      type="button"
      className={`ymc-git-row ymc-git-commit-row absolute left-0 right-0 flex-col items-stretch gap-0.5 border-0 border-l-2 bg-transparent px-2.5 text-left text-xs ${
        selected ? 'ymc-git-row-selected' : 'border-l-transparent'
      }`}
      style={{ top: styleTop, height: GIT_COMMIT_ROW_HEIGHT } as CSSProperties}
      title={`${commit.subject}\n${commit.authorName} <${commit.authorEmail}>\n${commit.hash}`}
      onClick={() => onSelect(commit)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="flex-none font-mono text-[10px] text-[var(--dsw-alias-label-tertiary)]">{commit.shortHash}</span>
        {refs.map((ref) => (
          <span key={ref} className="max-w-[110px] truncate rounded border border-[var(--dsw-alias-border-l2)] px-1 text-[9px] text-[var(--dsw-alias-label-tertiary)]">
            {refChip(ref)}
          </span>
        ))}
        <span className="ml-auto flex-none text-[10px] text-[var(--dsw-alias-label-tertiary)]">
          {formatCommitDate(commit.authorDate)}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[var(--dsw-alias-label-primary)]">{commit.subject}</span>
        <span className="max-w-[90px] flex-none truncate text-[10px] text-[var(--dsw-alias-label-tertiary)]">{commit.authorName}</span>
      </span>
    </button>
  )
}

interface GitHistoryListProps {
  commits: GitLogCommit[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  selectedHash: string | null
  canLoadMore: boolean
  onSelect: (commit: GitLogCommit) => void
  onLoadMore: () => void
}

export function GitHistoryList({
  commits,
  loading,
  loadingMore,
  error,
  selectedHash,
  canLoadMore,
  onSelect,
  onLoadMore,
}: GitHistoryListProps) {
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

  const start = Math.max(0, Math.floor(viewport.top / GIT_COMMIT_ROW_HEIGHT) - GIT_COMMIT_OVERSCAN)
  const end = Math.min(commits.length, Math.ceil((viewport.top + viewport.height) / GIT_COMMIT_ROW_HEIGHT) + GIT_COMMIT_OVERSCAN)

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setViewport((prev) => (Math.abs(prev.top - top) < GIT_COMMIT_ROW_HEIGHT ? prev : { ...prev, top }))
  }

  if (loading && commits.length === 0) {
    return (
      <div className="ymc-git-empty min-h-0 flex-1 overflow-hidden">
        <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
          <span className="ymc-spinner" />
          <p className="text-[11px]">正在加载提交历史…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">
        <div className="flex items-center gap-1.5">
          <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="ymc-git-empty min-h-0 flex-1 overflow-hidden">
        <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
          <GitCommitHorizontal size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className="font-medium text-[var(--dsw-alias-label-secondary)]">暂无提交记录</p>
        </div>
      </div>
    )
  }

  return (
    <div className="ymc-git-history flex min-h-0 flex-1 flex-col">
      <div className="ymc-git-list relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
        <div className="ymc-git-spacer relative min-w-full" style={{ height: commits.length * GIT_COMMIT_ROW_HEIGHT }}>
          {commits.slice(start, end).map((commit, index) => {
            const top = (start + index) * GIT_COMMIT_ROW_HEIGHT
            return (
              <CommitRow
                key={commit.hash}
                commit={commit}
                selected={selectedHash === commit.hash}
                onSelect={onSelect}
                styleTop={top}
              />
            )
          })}
        </div>
      </div>
      {canLoadMore && (
        <button
          type="button"
          className="ymc-load-more-button flex h-[30px] flex-none items-center justify-center gap-1.5 border-t border-[var(--dsw-alias-border-l2)] text-[11px] text-[var(--dsw-alias-label-secondary)]"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? <span className="ymc-spinner" /> : <span>加载更多提交</span>}
        </button>
      )}
    </div>
  )
}

export function CommitDetail({ detail, loading }: { detail: GitShowValue | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
        <span className="ymc-spinner" />
        <span>正在读取提交详情…</span>
      </div>
    )
  }
  if (!detail) return <div className="p-3 text-[var(--dsw-alias-label-tertiary)]">未选择提交。</div>
  if (isDomainError(detail)) {
    return <div className="p-3 text-[var(--dsw-alias-state-error-primary)]">{detail.message}</div>
  }

  const commit = detail.commit
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ymc-commit-meta border-b border-[var(--dsw-alias-border-l2)] px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-[var(--dsw-alias-label-tertiary)]">{commit.shortHash}</span>
          <span className="min-w-0 truncate text-xs font-medium text-[var(--dsw-alias-label-primary)]">{commit.subject}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--dsw-alias-label-tertiary)]">
          <span>{commit.authorName}</span>
          <span>{formatCommitDate(commit.authorDate)}</span>
          {commit.refs.length > 0 && <span>{commit.refs.join(', ')}</span>}
        </div>
        {commit.body && (
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--dsw-alias-label-secondary)]">
            {commit.body}
          </pre>
        )}
      </div>
      <div className="ymc-git-diff-content flex min-h-0 flex-1 flex-col overflow-hidden">
        {detail.diff ? <DiffView diff={detail.diff} /> : <div className="p-3 text-[var(--dsw-alias-label-tertiary)]">该提交没有可展示的文件差异。</div>}
      </div>
    </div>
  )
}
