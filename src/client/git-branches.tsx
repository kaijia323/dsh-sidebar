import { AlertCircle, Check, GitBranch, GitFork, GitPullRequest } from 'lucide-react'
import type { GitBranch as GitBranchModel, GitBranchesValue } from './types'

function isDomainError(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'domain-error'
}

function BranchRow({ branch, busy, onSwitch }: {
  branch: GitBranchModel
  busy: boolean
  onSwitch: (branch: GitBranchModel) => void
}) {
  const badges: string[] = []
  if (branch.ahead > 0) badges.push(`↑${branch.ahead}`)
  if (branch.behind > 0) badges.push(`↓${branch.behind}`)
  if (branch.upstreamGone) badges.push('上游已删除')
  const title = branch.isRemote
    ? `检出远端分支 ${branch.name} 为本地追踪分支`
    : branch.upstream
      ? `${branch.name} → ${branch.upstream}`
      : `切换到分支 ${branch.name}`

  return (
    <button
      type="button"
      className={`kaijia-git-row kaijia-branch-row relative flex h-[30px] items-center gap-2 border-0 border-l-2 bg-transparent px-2.5 text-left text-xs ${
        branch.isCurrent ? 'kaijia-git-row-selected' : 'border-l-transparent'
      }`}
      title={title}
      disabled={branch.isCurrent || busy}
      onClick={() => onSwitch(branch)}
    >
      {branch.isRemote ? (
        <GitPullRequest size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-label-tertiary)]" aria-hidden="true" />
      ) : (
        <GitBranch size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-label-tertiary)]" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[var(--dsw-alias-label-primary)]">{branch.name}</span>
      {branch.isCurrent && <Check size={13} strokeWidth={1.75} className="flex-none text-[var(--dsw-alias-brand-primary)]" aria-hidden="true" />}
      {badges.map((badge) => (
        <span key={badge} className="flex-none rounded border border-[var(--dsw-alias-border-l2)] px-1 text-[9px] text-[var(--dsw-alias-label-tertiary)]">
          {badge}
        </span>
      ))}
      {busy && <span className="kaijia-spinner" />}
    </button>
  )
}

export function GitBranchesList({ value, busyTarget, onSwitch }: {
  value: GitBranchesValue | null
  busyTarget: string | null
  onSwitch: (branch: GitBranchModel) => void
}) {
  if (!value) {
    return (
      <div className="kaijia-git-empty min-h-0 flex-1 overflow-hidden">
        <div className="kaijia-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
          <span className="kaijia-spinner" />
          <p className="text-[11px]">正在加载分支…</p>
        </div>
      </div>
    )
  }

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

  const local = value.branches.filter((branch) => !branch.isRemote)
  const remote = value.branches.filter((branch) => branch.isRemote)

  if (local.length === 0 && remote.length === 0) {
    return (
      <div className="kaijia-git-empty min-h-0 flex-1 overflow-hidden">
        <div className="kaijia-panel-message flex h-full flex-col items-center justify-center gap-2 text-[var(--dsw-alias-label-tertiary)]">
          <GitFork size={28} strokeWidth={1.5} aria-hidden="true" />
          <p className="font-medium text-[var(--dsw-alias-label-secondary)]">暂无分支</p>
        </div>
      </div>
    )
  }

  return (
    <div className="kaijia-git-branches min-h-0 flex-1 overflow-auto">
      {local.length > 0 && (
        <div className="kaijia-git-section-header sticky top-0 z-10 flex items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-specific-sidebar-fill)] px-2.5 text-[11px] font-medium text-[var(--dsw-alias-label-tertiary)]">
          <span>本地分支</span>
          <span className="ml-auto tabular-nums">{local.length}</span>
        </div>
      )}
      {local.map((branch) => (
        <BranchRow
          key={branch.name}
          branch={branch}
          busy={busyTarget === branch.name}
          onSwitch={onSwitch}
        />
      ))}
      {remote.length > 0 && (
        <div className="kaijia-git-section-header sticky top-0 z-10 mt-1 flex items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-specific-sidebar-fill)] px-2.5 text-[11px] font-medium text-[var(--dsw-alias-label-tertiary)]">
          <span>远端分支</span>
          <span className="ml-auto tabular-nums">{remote.length}</span>
        </div>
      )}
      {remote.map((branch) => (
        <BranchRow
          key={branch.name}
          branch={branch}
          busy={busyTarget === branch.name}
          onSwitch={onSwitch}
        />
      ))}
    </div>
  )
}
