import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { Config } from './config'
import { handleGitDiff, handleGitStatus } from './git'
import { handleList, handleRead } from './handlers'
import { fail, ok } from './result'
import { errorMessage, readString } from './utils'

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
            watchEnabled: config.watchEnabled,
          })
        }
        case 'list': {
          return ok(await handleList(ctx, config, payload, signal))
        }
        case 'read': {
          return ok(await handleRead(ctx, config, payload, signal))
        }
        case 'git-status':
        case 'gitStatus': {
          return ok(await handleGitStatus(readString(payload, 'root'), signal))
        }
        case 'git-diff':
        case 'gitDiff': {
          return ok(await handleGitDiff(
            readString(payload, 'root'),
            readString(payload, 'path'),
            Boolean((payload as Record<string, unknown> | null)?.staged),
            signal,
          ))
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
