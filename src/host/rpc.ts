import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { Config } from './config'
import { handleList, handleRead } from './handlers'
import { fail, ok } from './result'
import { errorMessage } from './utils'

export function createRpcHandler(ctx: Context, config: Config): ConnectionRpcHandler {
  return async (endpoint, payload, signal) => {
    try {
      switch (endpoint) {
        case 'meta': {
          return ok({
            kind: 'meta',
            maxTextBytes: config.maxTextBytes,
            maxImageBytes: config.maxImageBytes,
            maxEntriesPerDirectory: config.maxEntriesPerDirectory,
            maxTreeRows: config.maxTreeRows,
          })
        }
        case 'list': {
          return ok(await handleList(ctx, config, payload, signal))
        }
        case 'read': {
          return ok(await handleRead(ctx, config, payload, signal))
        }
        default: {
          return fail(`unknown endpoint ${endpoint}`)
        }
      }
    } catch (error) {
      return fail(errorMessage(error))
    }
  }
}
