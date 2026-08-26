import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileDiff,
  FolderGit2,
  GitBranch as GitBranchIcon,
  History,
  ListTree,
} from 'lucide-react'
import { isMarkdownPath } from '../client-model'
import { isDomainError } from './api'
import { CodeView } from './code-view'
import { DiffView } from './diff-view'
import { GitBranchesList } from './git-branches'
import { GitConfirmDialog, type GitConfirmDialogProps } from './git-confirm-dialog'
import { CommitDetail, GIT_COMMIT_PAGE_SIZE, GitHistoryList } from './git-history'
import { MarkdownView } from './markdown-view'
import type {
  FsApi,
  GitAction,
  GitBranch,
  GitBranchesValue,
  GitDiffValue,
  GitLogCommit,
  GitLogValue,
  GitOperationValue,
  GitShowValue,
  GitStatusEntry,
  GitStatusValue,
  ReadOk,
  ReadValue,
} from './types'

interface GitPanelProps {
  api: FsApi
  root: string | undefined
  active?: boolean
}

type GitSubView = 'changes' | 'history' | 'branches'
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

interface PendingAction {
  action: GitAction
  branch?: GitBranch
  command: string
  title: string
  description: string
  running: boolean
}

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
    <div className="kaijia-git-list relative min-h-0 flex-1 overflow-auto" ref={scrollRef} onScroll={onScroll}>
      <div className="kaijia-git-spacer relative min-w-full" style={{ height: rows.length * GIT_ROW_HEIGHT }}>
        {rows.slice(start, end).map((row, index) => {
          const top = (start + index) * GIT_ROW_HEIGHT
          if (row.kind === 'header') {
            return (
              <div
                key={row.id}
                className="kaijia-git-section-header absolute left-0 right-0 flex items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5 text-[11px] font-medium text-[var(--dsw-alias-label-tertiary)]"
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
              className={`kaijia-git-row absolute left-0 right-0 flex items-center gap-2 border-0 border-l-2 bg-transparent px-2.5 text-left text-xs ${
                selectedRow ? 'kaijia-git-row-selected' : 'border-l-transparent'
              }`}
              style={{ top, height: GIT_ROW_HEIGHT } as CSSProperties}
              title={`${statusLabel(row.entry)} ${row.entry.path}${row.entry.originalPath ? ` (来源: ${row.entry.originalPath})` : ''}`}
              onClick={() => onSelect(row.entry, row.group)}
            >
              <span className={`kaijia-git-status flex-none text-[10px] font-medium ${statusClass(row.entry)}`}>
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
      <div className="kaijia-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">
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
      <div className="kaijia-preview-message">
        <p>二进制文件，无法预览。</p>
      </div>
    )
  }
  if (result.kind === 'too-large') {
    return (
      <div className="kaijia-preview-message">
        <p>文件超过预览大小限制（{result.limit} 字节）。</p>
      </div>
    )
  }
  if (result.kind === 'error') {
    return (
      <div className="kaijia-preview-message">
        <p>{result.message}</p>
      </div>
    )
  }
  if (result.kind === 'image') {
    const source = `data:${result.mime};base64,${result.base64}`
    return (
      <div className="kaijia-image-preview">
        <img className="kaijia-image" src={source} alt={read.path} />
      </div>
    )
  }
  if (isMarkdownPath(read.path)) {
    return (
      <div className="kaijia-markdown-scroll relative min-h-0 flex-1 overflow-auto">
        <MarkdownView text={result.content} />
      </div>
    )
  }
  return (
    <div className="kaijia-text-preview flex min-h-0 flex-1 flex-col">
      <CodeView text={result.content} />
    </div>
  )
}

function ChangeDetail({ selection, loading, diff, preview }: {
  selection: ChangeSelection
  loading: boolean
  diff: GitDiffValue | null
  preview: ReadValue | null
}) {
  return (
    <>
      <div className="kaijia-divider relative flex h-[7px] flex-none touch-none items-center justify-center">
        <span className="kaijia-divider-grip h-[3px] w-[26px] rounded-sm bg-[var(--dsw-alias-border-l2)]" />
      </div>
      <div className="kaijia-git-diff flex min-h-[60px] flex-1 flex-col">
        <div className="kaijia-git-diff-header flex h-[30px] flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
          <FileDiff size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-label-tertiary)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono text-[var(--dsw-alias-label-primary)]">
            {selection.entry.path}
          </span>
          <span className="flex-none text-[10px] text-[var(--dsw-alias-label-tertiary)]">
            {selection.group === 'staged' ? '已暂存' : selection.group === 'unstaged' ? '工作区' : '未跟踪'}
          </span>
        </div>
        <div className="kaijia-git-diff-content flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
              <span className="kaijia-spinner" />
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
  )
}

function NoRootMessage() {
  return (
    <div className="kaijia-git-empty min-h-0 flex-1 overflow-hidden">
      <div className="kaijia-panel-message flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--dsw-alias-label-tertiary)]">
        <GitBranchIcon size={28} strokeWidth={1.5} aria-hidden="true" />
        <p className="font-medium text-[var(--dsw-alias-label-secondary)]">当前会话没有工作区目录</p>
        <p className="max-w-[220px] text-[11px]">打开带 cwd 的工作区会话后，这里会展示 Git 改动、提交历史、分支和同步操作。</p>
      </div>
    </div>
  )
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function GitPanel({ api, root, active = true }: GitPanelProps) {
  const [subView, setSubView] = useState<GitSubView>('changes')
  const [value, setValue] = useState<GitStatusValue | null>(null)
  const [branchesValue, setBranchesValue] = useState<GitBranchesValue | null>(null)
  const [logValue, setLogValue] = useState<GitLogValue | null>(null)
  const [logHasMore, setLogHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [logLoading, setLogLoading] = useState(false)
  const [logLoadingMore, setLogLoadingMore] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [changeSelection, setChangeSelection] = useState<ChangeSelection | null>(null)
  const [diff, setDiff] = useState<GitDiffValue | null>(null)
  const [preview, setPreview] = useState<ReadValue | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<GitLogCommit | null>(null)
  const [commitDetail, setCommitDetail] = useState<GitShowValue | null>(null)
  const [commitDetailLoading, setCommitDetailLoading] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [operationMessage, setOperationMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null)
  const rootRef = useRef<string | undefined>(undefined)
  const statusCacheRef = useRef(new Map<string, GitStatusValue>())

  useEffect(() => {
    const rootChanged = rootRef.current !== root
    rootRef.current = root
    if (!root) {
      setValue(null)
      setBranchesValue(null)
      setLogValue(null)
      setLogHasMore(false)
      setChangeSelection(null)
      setSelectedCommit(null)
      setDiff(null)
      setPreview(null)
      setCommitDetail(null)
      setOperationMessage(null)
      setPending(null)
      setRunningAction(null)
      setLoading(false)
      setBranchesLoading(false)
      setLogLoading(false)
      setDetailLoading(false)
      setCommitDetailLoading(false)
      return
    }
    if (!active) {
      if (rootChanged) {
        setValue(null)
        setBranchesValue(null)
        setLogValue(null)
        setChangeSelection(null)
        setSelectedCommit(null)
        setDiff(null)
        setPreview(null)
        setCommitDetail(null)
        setLoading(false)
        setBranchesLoading(false)
        setLogLoading(false)
        setDetailLoading(false)
        setCommitDetailLoading(false)
      }
      return
    }

    const controller = new AbortController()
    setLoading(true)
    if (rootChanged) {
      setChangeSelection(null)
      setSelectedCommit(null)
      setDiff(null)
      setPreview(null)
      setCommitDetail(null)
      setBranchesValue(null)
      setLogValue(null)
      setLogHasMore(false)
      setOperationMessage(null)
      setPending(null)
      setRunningAction(null)
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
        const raw = errorText(error)
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
    const controller = new AbortController()
    setBranchesLoading(true)
    api.gitBranches(root, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        setBranchesValue(next)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const raw = errorText(error)
        setBranchesValue({
          kind: 'domain-error',
          code: 'internal',
          message: /unknown endpoint/i.test(raw)
            ? '宿主插件尚未加载分支 RPC，请重启 dsh web 后再试。'
            : raw,
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setBranchesLoading(false)
      })
    return () => controller.abort()
  }, [api, root, active, reloadToken])

  useEffect(() => {
    if (!root || !active) return
    const controller = new AbortController()
    setLogLoading(true)
    api.gitLog(root, GIT_COMMIT_PAGE_SIZE, 0, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return
        if (isDomainError(next)) {
          setLogValue(next)
          setLogHasMore(false)
        } else {
          setLogValue(next)
          setLogHasMore(next.commits.length >= GIT_COMMIT_PAGE_SIZE)
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const raw = errorText(error)
        setLogValue({
          kind: 'domain-error',
          code: 'internal',
          message: /unknown endpoint/i.test(raw)
            ? '宿主插件尚未加载历史 RPC，请重启 dsh web 后再试。'
            : raw,
        })
        setLogHasMore(false)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLogLoading(false)
      })
    return () => controller.abort()
  }, [api, root, active, reloadToken])

  useEffect(() => {
    if (!root || !active) return
    const source = new EventSource(`/dsh-sidebar/events?root=${encodeURIComponent(root)}`)
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
    if (!root || !active || !changeSelection) {
      setDiff(null)
      setPreview(null)
      setDetailLoading(false)
      return
    }

    const { entry, group } = changeSelection
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
          const raw = errorText(error)
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
          const raw = errorText(error)
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
  }, [api, root, active, changeSelection, reloadToken])

  useEffect(() => {
    if (!root || !active || !selectedCommit) {
      setCommitDetail(null)
      setCommitDetailLoading(false)
      return
    }
    const controller = new AbortController()
    setCommitDetail(null)
    setCommitDetailLoading(true)
    api.gitShow(root, selectedCommit.hash.trim(), controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setCommitDetail(next)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const raw = errorText(error)
        setCommitDetail({
          kind: 'domain-error',
          code: 'internal',
          message: /unknown endpoint/i.test(raw)
            ? '宿主插件尚未加载提交详情 RPC，请重启 dsh web 后再试。'
            : raw,
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) setCommitDetailLoading(false)
      })
    return () => controller.abort()
  }, [api, root, active, selectedCommit, reloadToken])

  useEffect(() => {
    if (!operationMessage) return
    const timer = window.setTimeout(() => setOperationMessage(null), 6000)
    return () => window.clearTimeout(timer)
  }, [operationMessage])

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
  const logOk = logValue && !isDomainError(logValue) ? logValue : null
  const logError = logValue && isDomainError(logValue) ? logValue.message : null
  const branchTotal = branchesValue && !isDomainError(branchesValue) ? branchesValue.branches.length : 0

  function selectChange(entry: GitStatusEntry, group: ChangeGroup) {
    setChangeSelection({ entry, group })
  }

  function selectCommit(commit: GitLogCommit) {
    setSelectedCommit({ ...commit, hash: commit.hash.trim() })
  }

  function requestPullPush(action: 'pull' | 'push') {
    if (!root) return
    if (action === 'pull') {
      setPending({
        action,
        command: 'git pull',
        title: '拉取远端更新？',
        description: '将当前分支的远端提交拉取到本地，可能会更新工作区文件。',
        running: false,
      })
    } else {
      setPending({
        action,
        command: 'git push',
        title: '推送到远端？',
        description: '将当前分支的本地提交推送到远端仓库。',
        running: false,
      })
    }
  }

  function requestSwitch(branch: GitBranch) {
    if (!root || branch.isCurrent) return
    const localName = branch.isRemote ? branch.name.slice(branch.name.indexOf('/') + 1) : branch.name
    const localExists = !branch.isRemote || Boolean(
      branchesValue && !isDomainError(branchesValue) && branchesValue.branches.some((item) => !item.isRemote && item.name === localName),
    )
    const command = branch.isRemote && !localExists
      ? `git switch -c ${localName} --track ${branch.name}`
      : `git switch ${localName}`
    setPending({
      action: 'switch',
      branch,
      command,
      title: `切换到分支 ${branch.name}？`,
      description: branch.isRemote && !localExists
        ? `将远端分支 ${branch.name} 检出为本地追踪分支 ${localName}。`
        : `准备切换到本地分支 ${localName}。`,
      running: false,
    })
  }

  async function executePending() {
    if (!root || !pending || pending.running) return
    const action = pending
    setPending({ ...action, running: true })
    setOperationMessage(null)
    setRunningAction(`${action.action}:${action.branch?.name ?? ''}`)
    try {
      let result: GitOperationValue
      if (action.action === 'switch' && action.branch) {
        result = await api.gitSwitch(root, action.branch.name)
      } else if (action.action === 'pull') {
        result = await api.gitPull(root)
      } else {
        result = await api.gitPush(root)
      }
      if (isDomainError(result)) {
        setOperationMessage({ tone: 'error', text: result.message })
      } else {
        setOperationMessage({ tone: 'info', text: result.output })
      }
      setReloadToken((token) => token + 1)
      if (action.action === 'switch') {
        setSelectedCommit(null)
        setChangeSelection(null)
        setDiff(null)
        setPreview(null)
        setCommitDetail(null)
      }
    } catch (error) {
      setOperationMessage({ tone: 'error', text: errorText(error) })
    } finally {
      setPending(null)
      setRunningAction(null)
    }
  }

  async function loadMoreCommits() {
    if (!root || !logOk || logLoadingMore) return
    setLogLoadingMore(true)
    try {
      const next = await api.gitLog(root, GIT_COMMIT_PAGE_SIZE, logOk.commits.length)
      if (isDomainError(next)) {
        setOperationMessage({ tone: 'error', text: next.message })
        return
      }
      setLogValue((prev) => {
        if (!prev || isDomainError(prev)) return next
        return { ...next, commits: [...prev.commits, ...next.commits] }
      })
      setLogHasMore(next.commits.length >= GIT_COMMIT_PAGE_SIZE)
    } catch (error) {
      setOperationMessage({ tone: 'error', text: errorText(error) })
    } finally {
      setLogLoadingMore(false)
    }
  }

  const runningKey = runningAction ?? ''
  const pendingDialog: GitConfirmDialogProps | null = pending ? {
    title: pending.title,
    description: pending.description,
    command: pending.command,
    busy: pending.running,
    onCancel: () => { if (!pending.running) setPending(null) },
    onConfirm: () => { void executePending() },
  } : null

  return (
    <div className="kaijia-panel flex h-full min-h-0 flex-col bg-transparent text-[var(--dsw-alias-label-primary)]">
      <div className="kaijia-panel-header flex flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
        <GitBranchIcon className="kaijia-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="kaijia-panel-title font-semibold whitespace-nowrap">Git</span>
        {statusOk?.branch && (
          <span className="kaijia-panel-root min-w-0 flex-1 truncate text-[var(--dsw-alias-label-tertiary)]" title={statusOk.branch}>
            {statusOk.branch}
          </span>
        )}
        <div className="kaijia-panel-actions ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="kaijia-icon-button"
            title="拉取（pull）"
            aria-label="拉取"
            disabled={!root || Boolean(runningKey) || !statusOk}
            onClick={() => requestPullPush('pull')}
          >
            <ArrowDownToLine size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="kaijia-icon-button"
            title="推送（push）"
            aria-label="推送"
            disabled={!root || Boolean(runningKey) || !statusOk}
            onClick={() => requestPullPush('push')}
          >
            <ArrowUpFromLine size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="kaijia-git-tabs flex flex-none items-stretch border-b border-[var(--dsw-alias-border-l2)]">
        <button
          type="button"
          className={`kaijia-git-tab flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 border-transparent text-[11px] ${
            subView === 'changes' ? 'kaijia-git-tab-active' : 'text-[var(--dsw-alias-label-secondary)]'
          }`}
          onClick={() => setSubView('changes')}
        >
          <ListTree size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>改动</span>
          <span className="tabular-nums">{total}</span>
        </button>
        <button
          type="button"
          className={`kaijia-git-tab flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 border-transparent text-[11px] ${
            subView === 'history' ? 'kaijia-git-tab-active' : 'text-[var(--dsw-alias-label-secondary)]'
          }`}
          onClick={() => setSubView('history')}
        >
          <History size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>历史</span>
        </button>
        <button
          type="button"
          className={`kaijia-git-tab flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1 border-b-2 border-transparent text-[11px] ${
            subView === 'branches' ? 'kaijia-git-tab-active' : 'text-[var(--dsw-alias-label-secondary)]'
          }`}
          onClick={() => setSubView('branches')}
        >
          <GitBranchIcon size={12} strokeWidth={1.75} aria-hidden="true" />
          <span>分支</span>
          <span className="tabular-nums">{branchTotal}</span>
        </button>
      </div>

      <div className="kaijia-git-body relative flex min-h-0 flex-1 flex-col">
        {operationMessage && (
          <div className={`kaijia-git-notice flex-none border-b border-[var(--dsw-alias-border-l2)] px-2.5 py-1.5 text-[11px] ${
            operationMessage.tone === 'error'
              ? 'text-[var(--dsw-alias-state-error-primary)]'
              : 'text-[var(--dsw-alias-label-secondary)]'
          }`}>
            {operationMessage.text}
          </div>
        )}

        <div className="kaijia-git-main flex min-h-0 flex-1 flex-col">
          {subView === 'changes' && (
            !root ? <NoRootMessage /> : (
              loading && !value ? (
              <div className="kaijia-git-empty min-h-0 flex-1 overflow-hidden">
                <div className="kaijia-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
                  <span className="kaijia-spinner" />
                  <p className="text-[11px]">正在读取 Git 状态…</p>
                </div>
              </div>
            ) : statusError ? (
              <div className="kaijia-preview-error overflow-auto text-[var(--dsw-alias-state-error-primary)]">
                <div className="flex items-center gap-1.5">
                  <AlertCircle size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{statusError}</span>
                </div>
              </div>
            ) : statusOk && total === 0 ? (
              <div className="kaijia-git-empty min-h-0 flex-1 overflow-hidden">
                <div className="kaijia-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
                  <FolderGit2 size={28} strokeWidth={1.5} aria-hidden="true" />
                  <p className="font-medium text-[var(--dsw-alias-label-secondary)]">工作区干净</p>
                  <p className="text-[11px]">没有未提交的改动。</p>
                </div>
              </div>
            ) : statusOk ? (
              <GitVirtualList rows={gitRows} selected={changeSelection} onSelect={selectChange} />
            ) : null
          ))}

          {subView === 'history' && (
            !root ? <NoRootMessage /> : (
              <GitHistoryList
                commits={logOk?.commits ?? []}
                loading={logLoading}
                loadingMore={logLoadingMore}
                error={logError}
                selectedHash={selectedCommit?.hash ?? null}
                canLoadMore={logHasMore}
                onSelect={selectCommit}
                onLoadMore={() => { void loadMoreCommits() }}
              />
            )
          )}

          {subView === 'branches' && (
            !root ? <NoRootMessage /> : (
              <GitBranchesList
                value={branchesValue}
                busyTarget={runningKey.startsWith('switch:') ? runningKey.slice('switch:'.length) : null}
                onSwitch={requestSwitch}
              />
            )
          )}
        </div>

        {subView === 'changes' && changeSelection && (
          <ChangeDetail
            selection={changeSelection}
            loading={detailLoading}
            diff={diff}
            preview={preview}
          />
        )}

        {subView === 'history' && selectedCommit && (
          <>
            <div className="kaijia-divider relative flex h-[7px] flex-none touch-none items-center justify-center">
              <span className="kaijia-divider-grip h-[3px] w-[26px] rounded-sm bg-[var(--dsw-alias-border-l2)]" />
            </div>
            <div className="kaijia-git-diff flex min-h-[60px] flex-1 flex-col">
              <div className="kaijia-git-diff-header flex h-[30px] flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
                <History size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-label-tertiary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-[var(--dsw-alias-label-primary)]">
                  {selectedCommit.shortHash} {selectedCommit.subject}
                </span>
              </div>
              <div className="kaijia-git-diff-content flex min-h-0 flex-1 flex-col overflow-hidden">
                <CommitDetail detail={commitDetail} loading={commitDetailLoading} />
              </div>
            </div>
          </>
        )}

        {pendingDialog && <GitConfirmDialog {...pendingDialog} />}
      </div>
    </div>
  )
}
