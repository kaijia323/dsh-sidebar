import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandlerOptions } from '@deepseek-ai/dsh-client-connection'
import { Config, type Config as ConfigType } from './host/config'
import { registerFileWatchRoute } from './host/events'
import { registerLocalFileRoute } from './host/local-files'
import { createRpcHandler } from './host/rpc'

export const name = 'dsh-sidebar'
export const inject = ['fs', 'connection', 'webServer']

export type { Config } from './host/config'
export { Config } from './host/config'

export function apply(ctx: Context, config: ConfigType) {
  const options: ConnectionRpcHandlerOptions = { authority: 'loopback' }
  ctx.connection.rpc.handle('/dsh-sidebar', createRpcHandler(ctx, config), options)
  registerFileWatchRoute(ctx, config)
  registerLocalFileRoute(ctx)
}
