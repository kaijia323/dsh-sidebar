import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createFsApi } from './client/api'
import { SidebarShell } from './client/sidebar-shell'
import { installStyles } from './client/styles'

export const name = 'dsh-ymc-sidebar'
export const inject = ['sessions', 'workspaces', 'connection']

export function apply(ctx: ClientContext) {
  const api = createFsApi(ctx)

  ctx.effect(() => installStyles())

  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-ymc-sidebar-root', '')
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(<SidebarShell ctx={ctx} api={api} />)
    return () => {
      root.unmount()
      host.remove()
    }
  })
}
