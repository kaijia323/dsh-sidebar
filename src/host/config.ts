import Schema from '@deepseek-ai/schemastery'

export interface Config {
  maxTextBytes: number
  maxImageBytes: number
  maxEntriesPerDirectory: number
  maxTreeRows: number
}

export const Config: Schema<Config> = Schema.object({
  maxTextBytes: Schema.number().min(16 * 1024).max(16 * 1024 * 1024).default(2 * 1024 * 1024),
  maxImageBytes: Schema.number().min(16 * 1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024),
  maxEntriesPerDirectory: Schema.number().min(10).max(100000).default(2000),
  maxTreeRows: Schema.number().min(100).max(1000000).default(100000),
})
