import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import { AlertCircle, FileDiff, FolderGit2, GitBranch } from 'lucide-react'
import { isMarkdownPath } from '../client-model'
import { isDomainError } from './api'
import { CodeView } from './code-view'
import { DiffView } from './diff-view'
import { MarkdownView } from './markdown-view'
import type { FsApi, GitDiffValue, GitStatusEntry, GitStatusValue, ReadOk, ReadValue } from './types'

interface GitPanelProps {
  api: FsApi
  root: string | undefined
  active?: boolean
}

type ChangeGroup = 'staged' | 'unstaged' | 'untracked'

interface ChangeSelection {
  entry: GitStatusEntry
  group: ChangeGroup
}

interface GroupedChanges {
  staged: GitStatusEntry[]
  unstaged: GitStatusEntry[]
  untracked: GitStatusEntry[]
}

type GitRow =
  | { kind: 'header'; id: string; title: string; count: number }
  | { kind: 'entry'; id: string; group: ChangeGroup; entry: GitStatusEntry }

const GIT_ROW_HEIGHT = 26
const GIT_OVERSCAN = 8

function groupChanges(entries: GitStatusEntry[]): GroupedChanges {
  const grouped: GroupedChanges = { staged: [], unstaged: [], untracked: [] }
  for (const entry of entries) {
    if (entry.status === '??') {
      grouped.untracked.push(entry)
      continue
    }
    const [index, worktree] = entry.status
    if (index !== ' ' && index !== '?') grouped.staged.push(entry)
    if (worktree !== ' ' && worktree !== '?') grouped.unstaged.push(entry)
  }
  return grouped
}

function statusLabel(entry: GitStatusEntry): string {
  const [index, worktree] = entry.status
  const primary = worktree !== ' ' && worktree !== '?' ? worktree : index
  switch (primary) {
    case 'M': return '修改'
    case 'A': return '新增'
    case 'D': return '删除'
    case 'R': return '重命名'
    case 'C': return '复制'
    case 'U': return '冲突'
    case 'T': return '类型更改'
    case '?': return '未跟踪'
    default: return entry.status.trim() || '变更'
  }
}

function statusClass(entry: GitStatusEntry): string {
  const [index, worktree] = entry.status
  const primary = worktree !== ' ' && worktree !== '?' ? worktree : index
  switch (primary) {
    case 'M':
    case 'T':
      return 'text-[var(--dsw-alias-state-warn-primary)]'
    case 'A':
    case '?':
      return 'text-[var(--dsw-alias-state-success-primary)]'
    case 'D':
      return 'text-[var(--dsw-alias-state-error-primary)]'
    case 'R':
    case 'C':
      return 'text-[var(--dsw-alias-state-business-primary)]'
    default:
      return 'text-[var(--dsw-alias-label-secondary)]'
  }
}

function joinWorkspacePath(root: string, relative: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')
  const rel = relative.replace(/^[\\/]+/, '')
  return `${base}${separator}${rel}`
}

interface GitVirtualListProps {
  rows: GitRow[]
  selected: ChangeSelection | null
  onSelect: (entry: GitStatusEntry, group: ChangeGroup) => void
}

function GitVirtualList({ rows, selected, onSelect }: GitVirtualListProps) {
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

  const start = Math.max(0, Math.floor(viewport.top / GIT_ROW_HEIGHT) - GIT_OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / GIT_ROW_HEIGHT) + GIT_OVERSCAN)

  function onScroll(event: UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop
    setViewport((prev) => (Math.abs(prev.top - top) < GIT_ROW_HEIGHT ? prev : { ...prev, top }))
  }

  return (
    <div className="ymc-git-list relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      <div className="ymc-git-spacer relative min-w-full" style={{ height: rows.length * GIT_ROW_HEIGHT }}>
        {rows.slice(start, end).map((row, index) => {
          const top = (start + index) * GIT_ROW_HEIGHT
          if (row.kind === 'header') {
            return (
              <div
                key={row.id}
                className="ymc-git-section-header absolute left-0 right-0 flex items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5 text-[11px] font-medium text-[var(--dsw-alias-label-tertiary)]"
                style={{ top, height: GIT_ROW_HEIGHT } as CSSProperties}
              >
                <span>{row.title}</span>
                <span className="ml-auto tabular-nums">{row.count}</span>
              </div>
            )
          }
          const selectedRow = selected?.entry.path === row.entry.path && selected.group === row.group
          return (
            <button
              key={row.id}
              type="button"
              className={`ymc-git-row absolute left-0 right-0 flex items-center gap-2 border-0 border-l-2 bg-transparent px-2.5 text-left text-xs ${
                selectedRow ? 'ymc-git-row-selected' : 'border-l-transparent'
              }`}
              style={{ top, height: GIT_ROW_HEIGHT } as CSSProperties}
              title={`${statusLabel(row.entry)} ${row.entry.path}${row.entry.originalPath ? ` (来源: ${row.entry.originalPath})` : ''}`}
              onClick={() => onSelect(row.entry, row.group)}
            >
              <span className={`ymc-git-status flex-none text-[10px] font-medium ${statusClass(row.entry)}`}>
                {statusLabel(row.entry)}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[var(--dsw-alias-label-primary)]">
                {row.entry.path}
                {row.entry.originalPath ? (
                  <span className="ml-1 text-[var(--dsw-alias-label-tertiary)]">← {row.entry.originalPath}</span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function UntrackedFilePreview({ value }: { value: ReadValue }) {
  if (isDomainError(value)) {
    return (
      <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">
        <div className="flex items-center gap-1.5">
          <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{value.message}</span>
        </div>
      </div>
    )
  }

  const read = value as ReadOk
  const result = read.result
  if (result.kind === 'binary') {
    return (
      <div className="ymc-preview-message">
        <p>二进制文件，无法预览。</p>
      </div>
    )
  }
  if (result.kind === 'too-large') {
    return (
      <div className="ymc-preview-message">
        <p>文件超过预览大小限制（{result.limit} 字节）。</p>
      </div>
    )
  }
  if (result.kind === 'error') {
    return (
      <div className="ymc-preview-message">
        <p>{result.message}</p>
      </div>
    )
  }
  if (result.kind === 'image') {
    const source = `data:${result.mime};base64,${result.base64}`
    return (
      <div className="ymc-image-preview">
        <img className="ymc-image" src={source} alt={read.path} />
      </div>
    )
  }
  if (isMarkdownPath(read.path)) {
    return (
      <div className="ymc-markdown-scroll relative min-h-0 flex-1 overflow-auto">
        <MarkdownView text={result.content} />
      </div>
    )
  }
  return (
    <div className="ymc-text-preview flex min-h-0 flex-1 flex-col">
      <CodeView text={result.content} />
    </div>
  )
}

export function GitPanel({ api, root, active = true }: GitPanelProps) {
  const [value, setValue] = useState<GitStatusValue | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [selection, setSelection] = useState<ChangeSelection | null>(null)
  const [diff, setDiff] = useState<GitDiffValue | null>(null)
  const [preview, setPreview] = useState<ReadValue | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const rootRef = useRef<string | undefined>(undefined)
  const statusCacheRef = useRef(new Map<string, GitStatusValue>())

  useEffect(() => {
    const rootChanged = rootRef.current !== root
    rootRef.current = root
    if (!root) {
      setValue(null)
      setSelection(null)
      setDiff(null)
      setPreview(null)
      setLoading(false)
      setDetailLoading(false)
      return
    }
    if (!active) {
      if (rootChanged) {
        setValue(null)
        setSelection(null)
        setDiff(null)
        setPreview(null)
        setLoading(false)
        setDetailLoading(false)
      }
      return
    }

    const controller = new AbortController()
    setLoading(true)
    if (rootChanged) {
      setSelection(null)
      setDiff(null)
      setPreview(null)
      setValue(statusCacheRef.current.get(root) ?? null)
    }

    api.gitStatus(root, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        statusCacheRef.current.set(root, next)
        setValue(next)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const raw = error instanceof Error ? error.message : String(error)
        setValue({
          kind: 'domain-error',
          code: 'internal',
          message: /unknown endpoint/i.test(raw)
            ? '宿主插件尚未加载 Git RPC，请重启 dsh web 后再试。'
            : raw,
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [api, root, active, reloadToken])

  useEffect(() => {
    if (!root || !active) return
    const source = new EventSource(`/dsh-ymc-sidebar/events?root=${encodeURIComponent(root)}`)
    let timer: number | undefined
    const handleChange = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        setReloadToken((token) => token + 1)
      }, 500)
    }
    source.addEventListener('change', handleChange as EventListener)
    return () => {
      source.close()
      source.removeEventListener('change', handleChange as EventListener)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [root, active])

  useEffect(() => {
    if (!root || !active || !selection) {
      setDiff(null)
      setPreview(null)
      setDetailLoading(false)
      return
    }

    const { entry, group } = selection
    const controller = new AbortController()
    setDiff(null)
    setPreview(null)
    setDetailLoading(true)

    if (group === 'untracked') {
      const absolutePath = joinWorkspacePath(root, entry.path)
      api.read(absolutePath, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setPreview(next)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const raw = error instanceof Error ? error.message : String(error)
          setPreview({
            kind: 'domain-error',
            code: 'internal',
            message: /unknown endpoint/i.test(raw)
              ? '宿主插件尚未加载 Git RPC，请重启 dsh web 后再试。'
              : raw,
          })
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false)
        })
    } else {
      api.gitDiff(root, entry.path, group === 'staged', controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setDiff(next)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const raw = error instanceof Error ? error.message : String(error)
          setDiff({
            kind: 'domain-error',
            code: 'internal',
            message: /unknown endpoint/i.test(raw)
              ? '宿主插件尚未加载 Git RPC，请重启 dsh web 后再试。'
              : raw,
          })
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false)
        })
    }

    return () => controller.abort()
  }, [api, root, active, selection, reloadToken])

  const groups = useMemo<GroupedChanges>(() => {
    if (!value || isDomainError(value)) return { staged: [], unstaged: [], untracked: [] }
    return groupChanges(value.entries)
  }, [value])

  const gitRows = useMemo<GitRow[]>(() => {
    const rows: GitRow[] = []
    const sections = [
      { group: 'staged' as const, title: '暂存区', entries: groups.staged },
      { group: 'unstaged' as const, title: '变更', entries: groups.unstaged },
      { group: 'untracked' as const, title: '未跟踪', entries: groups.untracked },
    ]
    for (const section of sections) {
      if (section.entries.length === 0) continue
      rows.push({ kind: 'header', id: `header:${section.group}`, title: section.title, count: section.entries.length })
      for (const entry of section.entries) {
        rows.push({ kind: 'entry', id: `${section.group}:${entry.path}`, group: section.group, entry })
      }
    }
    return rows
  }, [groups])

  const statusOk = value && !isDomainError(value) ? value : null
  const statusError = value && isDomainError(value) ? value.message : null
  const total = statusOk ? statusOk.entries.length : 0

  function selectChange(entry: GitStatusEntry, group: ChangeGroup) {
    setSelection({ entry, group })
  }

  return (
    <div className="ymc-panel flex h-full min-h-0 flex-col bg-transparent text-[var(--dsw-alias-label-primary)]">
      <div className="ymc-panel-header flex flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
        <GitBranch className="ymc-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="ymc-panel-title font-semibold whitespace-nowrap">Git 追踪</span>
        {statusOk?.branch && (
          <span className="ymc-panel-root min-w-0 flex-1 truncate text-[var(--dsw-alias-label-tertiary)]" title={statusOk.branch}>
            {statusOk.branch}
          </span>
        )}
      </div>

      <div className="ymc-git-body relative flex min-h-0 flex-1 flex-col">
        {!root ? (
          <div className="ymc-git-empty min-h-0 flex-1 overflow-hidden">
            <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--dsw-alias-label-tertiary)]">
              <GitBranch size={28} strokeWidth={1.5} aria-hidden="true" />
              <p className="font-medium text-[var(--dsw-alias-label-secondary)]">当前会话没有工作区目录</p>
              <p className="max-w-[220px] text-[11px]">打开带 cwd 的工作区会话后，这里会展示 Git 改动、暂存区和未跟踪文件。</p>
            </div>
          </div>
        ) : loading && !value ? (
          <div className="ymc-git-empty min-h-0 flex-1 overflow-hidden">
            <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
              <span className="ymc-spinner" />
              <p className="text-[11px]">正在读取 Git 状态…</p>
            </div>
          </div>
        ) : statusError ? (
          <div className="ymc-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>{statusError}</span>
            </div>
          </div>
        ) : statusOk && total === 0 ? (
          <div className="ymc-git-empty min-h-0 flex-1 overflow-hidden">
            <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
              <FolderGit2 size={28} strokeWidth={1.5} aria-hidden="true" />
              <p className="font-medium text-[var(--dsw-alias-label-secondary)]">工作区干净</p>
              <p className="text-[11px]">没有未提交的改动。</p>
            </div>
          </div>
        ) : statusOk ? (
          <GitVirtualList rows={gitRows} selected={selection} onSelect={selectChange} />
        ) : null}

        {selection && (
          <>
            <div className="ymc-divider relative flex h-[7px] flex-none touch-none items-center justify-center">
              <span className="ymc-divider-grip h-[3px] w-[26px] rounded-sm bg-[var(--dsw-alias-border-l2)]" />
            </div>
            <div className="ymc-git-diff flex min-h-[60px] flex-1 flex-col">
              <div className="ymc-git-diff-header flex h-[30px] flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
                <FileDiff size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-label-tertiary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--dsw-alias-label-primary)]">
                  {selection.entry.path}
                </span>
                <span className="flex-none text-[10px] text-[var(--dsw-alias-label-tertiary)]">
                  {selection.group === 'staged' ? '已暂存' : selection.group === 'unstaged' ? '工作区' : '未跟踪'}
                </span>
              </div>
              <div className="ymc-git-diff-content flex min-h-0 flex-1 flex-col overflow-hidden">
                {detailLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
                    <span className="ymc-spinner" />
                    {selection.group === 'untracked' ? '正在读取文件…' : '正在读取 diff…'}
                  </div>
                ) : selection.group === 'untracked' ? (
                  preview ? <UntrackedFilePreview value={preview} /> : null
                ) : diff && isDomainError(diff) ? (
                  <div className="p-3 text-[var(--dsw-alias-label-tertiary)]">{diff.message}</div>
                ) : diff ? (
                  diff.diff ? <DiffView diff={diff.diff} /> : <div className="p-3 text-[var(--dsw-alias-label-tertiary)]">（没有差异）</div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
