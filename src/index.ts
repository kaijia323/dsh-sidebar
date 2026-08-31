import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType } from './host/config'
import { registerFileWatchRoute } from './host/events'
import { registerLocalFileRoute } from './host/local-files'
import { createRpcHandler } from './host/rpc'

export const name = 'dsh-sidebar'
export const inject = ['fs', 'connection', 'webServer']

export type { Config } from './host/config'
export { Config } from './host/config'

export function apply(ctx: Context, config: ConfigType) {
  ctx.connection.rpc.handle('/dsh-sidebar', createRpcHandler(ctx, config))
  registerFileWatchRoute(ctx, config)
  registerLocalFileRoute(ctx)
}
