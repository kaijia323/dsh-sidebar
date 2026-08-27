import { Files, GitBranch, Globe } from 'lucide-react'

export type SidebarView = 'explorer' | 'git' | 'browser'

interface ActivityBarProps {
  view: SidebarView
  onSelect: (view: SidebarView) => void
}

export function ActivityBar({ view, onSelect }: ActivityBarProps) {
  return (
    <nav className="kaijia-activity-bar" aria-label="侧栏视图切换">
      <button
        type="button"
        className={`kaijia-activity-item${view === 'explorer' ? ' kaijia-activity-item-active' : ''}`}
        aria-label="文件资源管理器"
        title="文件资源管理器"
        aria-current={view === 'explorer' ? 'page' : undefined}
        onClick={() => onSelect('explorer')}
      >
        <Files size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`kaijia-activity-item${view === 'git' ? ' kaijia-activity-item-active' : ''}`}
        aria-label="Git 追踪"
        title="Git 追踪"
        aria-current={view === 'git' ? 'page' : undefined}
        onClick={() => onSelect('git')}
      >
        <GitBranch size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`kaijia-activity-item${view === 'browser' ? ' kaijia-activity-item-active' : ''}`}
        aria-label="浏览器"
        title="浏览器"
        aria-current={view === 'browser' ? 'page' : undefined}
        onClick={() => onSelect('browser')}
      >
        <Globe size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </nav>
  )
}
