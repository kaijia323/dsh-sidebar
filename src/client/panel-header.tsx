import { FolderTree } from 'lucide-react'
import { basename } from '../client-model'

interface PanelHeaderProps {
  root: string | undefined
  loadingRoot: boolean
}

export function PanelHeader({ root, loadingRoot }: PanelHeaderProps) {
  return (
    <div className="kaijia-panel-header flex flex-none items-center gap-1.5 border-b border-[var(--dsw-alias-border-l2)] px-2.5">
      <FolderTree className="kaijia-panel-title-icon" size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="kaijia-panel-title font-semibold whitespace-nowrap">文件树</span>
      {root && <span className="kaijia-panel-root min-w-0 flex-1 truncate text-[var(--dsw-alias-label-tertiary)]" title={root}>{basename(root)}</span>}
      {loadingRoot && <span className="kaijia-spinner" />}
    </div>
  )
}
