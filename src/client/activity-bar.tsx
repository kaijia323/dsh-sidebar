import { Files, GitBranch } from 'lucide-react'

export type SidebarView = 'explorer' | 'git'

interface ActivityBarProps {
  view: SidebarView
  onSelect: (view: SidebarView) => void
}

export function ActivityBar({ view, onSelect }: ActivityBarProps) {
  return (
    <nav className="ymc-activity-bar" aria-label="侧栏视图切换">
      <button
        type="button"
        className={`ymc-activity-item${view === 'explorer' ? ' ymc-activity-item-active' : ''}`}
        aria-label="文件资源管理器"
        title="文件资源管理器"
        aria-current={view === 'explorer' ? 'page' : undefined}
        onClick={() => onSelect('explorer')}
      >
        <Files size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`ymc-activity-item${view === 'git' ? ' ymc-activity-item-active' : ''}`}
        aria-label="Git 追踪"
        title="Git 追踪"
        aria-current={view === 'git' ? 'page' : undefined}
        onClick={() => onSelect('git')}
      >
        <GitBranch size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </nav>
  )
}
