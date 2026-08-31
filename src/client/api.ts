import type { Context } from '@deepseek-ai/cordis'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { CHANNEL } from './constants'
import type {
  DomainError,
  FsApi,
  GitBranchesValue,
  GitDiffValue,
  GitLogValue,
  GitOperationValue,
  GitShowValue,
  GitStatusValue,
  HtmlFilesValue,
  Limits,
  ListValue,
  ReadValue,
} from './types'

export function isDomainError(value: unknown): value is DomainError {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'domain-error'
}

export function createFsApi(ctx: Context): FsApi {
  async function callValue<T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const response: RpcResult<unknown> = await ctx.connection.rpc.call(CHANNEL, endpoint, payload, signal)
    if (!response.ok) throw new Error(response.error.message)
    return response.value as T
  }

  return {
    list(path, signal) {
      return callValue<ListValue>('list', { path }, signal)
    },
    read(path, signal) {
      return callValue<ReadValue>('read', { path }, signal)
    },
    htmlFiles(root, signal) {
      return callValue<HtmlFilesValue>('html-files', { root }, signal)
    },
    gitStatus(root, signal) {
      return callValue<GitStatusValue>('git-status', { root }, signal)
    },
    gitDiff(root, path, staged, signal) {
      return callValue<GitDiffValue>('git-diff', { root, path, staged }, signal)
    },
    gitLog(root, limit, skip, signal) {
      return callValue<GitLogValue>('git-log', { root, limit, skip }, signal)
    },
    gitShow(root, commit, signal) {
      return callValue<GitShowValue>('git-show', { root, commit }, signal)
    },
    gitBranches(root, signal) {
      return callValue<GitBranchesValue>('git-branches', { root }, signal)
    },
    gitSwitch(root, target, signal) {
      return callValue<GitOperationValue>('git-switch', { root, target }, signal)
    },
    gitPull(root, signal) {
      return callValue<GitOperationValue>('git-pull', { root }, signal)
    },
    gitPush(root, signal) {
      return callValue<GitOperationValue>('git-push', { root }, signal)
    },
    async meta(signal) {
      const value = await callValue<{ kind: 'meta' } & Limits>('meta', {}, signal)
      return {
        maxTextBytes: value.maxTextBytes,
        maxImageBytes: value.maxImageBytes,
        maxEntriesPerDirectory: value.maxEntriesPerDirectory,
        maxTreeRows: value.maxTreeRows,
        watchEnabled: value.watchEnabled,
      }
    },
  }
}
