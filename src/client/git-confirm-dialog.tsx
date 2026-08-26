import { AlertTriangle } from 'lucide-react'

export interface GitConfirmDialogProps {
  title: string
  description: string
  command: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function GitConfirmDialog({
  title,
  description,
  command,
  busy,
  onCancel,
  onConfirm,
}: GitConfirmDialogProps) {
  return (
    <div className="ymc-confirm-backdrop absolute inset-0 z-20 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ymc-confirm-dialog w-full max-w-[280px] rounded-lg border border-[var(--dsw-alias-border-l2)] bg-[var(--dsw-specific-sidebar-fill)] p-3 shadow-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 flex-none text-[var(--dsw-alias-state-warn-primary)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-semibold text-[var(--dsw-alias-label-primary)]">{title}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--dsw-alias-label-secondary)]">{description}</p>
            <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded bg-[var(--dsw-alias-bg-layer-1)] px-2 py-1 font-mono text-[10px] text-[var(--dsw-alias-label-secondary)]">
              {command}
            </code>
          </div>
        </div>
        {busy && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--dsw-alias-label-tertiary)]">
            <span className="ymc-spinner" />
            <span>正在执行…</span>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-1.5">
          <button
            type="button"
            className="ymc-header-button rounded-md px-2.5 py-1 text-[11px] text-[var(--dsw-alias-label-secondary)]"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="ymc-header-button rounded-md border border-[var(--dsw-alias-state-error-primary)] px-2.5 py-1 text-[11px] text-[var(--dsw-alias-state-error-primary)]"
            disabled={busy}
            onClick={onConfirm}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}
