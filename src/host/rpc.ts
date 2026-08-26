import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { Config } from './config'
import {
  handleGitBranches,
  handleGitDiff,
  handleGitLog,
  handleGitPull,
  handleGitPush,
  handleGitShow,
  handleGitStatus,
  handleGitSwitch,
} from './git'
import { handleList, handleRead } from './handlers'
import { fail, ok } from './result'
import { errorMessage, readOptionalNumber, readString } from './utils'

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
        case 'git-log':
        case 'gitLog': {
          return ok(await handleGitLog(
            readString(payload, 'root'),
            readOptionalNumber(payload, 'limit') ?? 100,
            readOptionalNumber(payload, 'skip') ?? 0,
            signal,
          ))
        }
        case 'git-show':
        case 'gitShow': {
          return ok(await handleGitShow(
            readString(payload, 'root'),
            readString(payload, 'commit'),
            signal,
          ))
        }
        case 'git-branches':
        case 'gitBranches': {
          return ok(await handleGitBranches(readString(payload, 'root'), signal))
        }
        case 'git-switch':
        case 'gitSwitch': {
          return ok(await handleGitSwitch(
            readString(payload, 'root'),
            readString(payload, 'target'),
            signal,
          ))
        }
        case 'git-pull':
        case 'gitPull': {
          return ok(await handleGitPull(readString(payload, 'root'), signal))
        }
        case 'git-push':
        case 'gitPush': {
          return ok(await handleGitPush(readString(payload, 'root'), signal))
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
