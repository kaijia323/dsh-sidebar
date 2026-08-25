import { GitBranch } from 'lucide-react'

export function GitPanel() {
  return (
    <div className="ymc-panel flex h-full min-h-0 flex-col bg-transparent text-[var(--dsw-alias-label-primary)]">
      <div className="ymc-panel-header flex flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
        <GitBranch className="ymc-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className="ymc-panel-title font-semibold whitespace-nowrap">Git 追踪</span>
      </div>
      <div className="ymc-panel-message flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--dsw-alias-label-tertiary)]">
        <GitBranch size={28} strokeWidth={1.5} aria-hidden="true" />
        <p className="font-medium text-[var(--dsw-alias-label-secondary)]">Git 追踪视图暂为占位</p>
        <p className="max-w-[220px] text-[11px]">后续可以在这里展示当前工作区改动、暂存区和未跟踪文件。</p>
      </div>
    </div>
  )
}
