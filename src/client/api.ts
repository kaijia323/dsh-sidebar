import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import { CHANNEL } from './constants'
import type { DomainError, FsApi, Limits, ListValue, ReadValue } from './types'

export function isDomainError(value: unknown): value is DomainError {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'domain-error'
}

export function createFsApi(ctx: ClientContext): FsApi {
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
