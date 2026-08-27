export const CHANNEL = '/dsh-sidebar'

export const TREE_ROW_HEIGHT = 24
export const CODE_ROW_HEIGHT = 20
export const OVERSCAN = 10

export const ACTIVITY_BAR_WIDTH = 40
export const SIDEBAR_MIN = 280
export const SIDEBAR_DEFAULT = 360
export const SIDEBAR_STORAGE_KEY = 'dsh-sidebar:v1'

export const COLLAPSE_MS = 240
export const ENTER_MS = 200
export const TOGGLE_THROTTLE_MS = Math.max(ENTER_MS, COLLAPSE_MS) + 50
export const ROOT_CACHE_FRESH_MS = 2000

export const DEFAULT_LIMITS = {
  maxTextBytes: 2 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxEntriesPerDirectory: 2000,
  maxTreeRows: 100000,
  watchEnabled: true,
}
