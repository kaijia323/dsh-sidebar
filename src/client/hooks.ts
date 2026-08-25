import { useCallback, useSyncExternalStore } from 'react'
import { clamp } from '../client-model'
import type { SidebarView } from './activity-bar'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, SIDEBAR_STORAGE_KEY } from './constants'
import type { SnapshotStore } from './types'

export function useSnapshotStore<T>(store: SnapshotStore<T>): T {
  const subscribe = useCallback((callback: () => void) => store.subscribe(callback), [store])
  const getSnapshot = useCallback(() => store.getSnapshot(), [store])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function loadSidebarView(): SidebarView {
  try {
    return localStorage.getItem(`${SIDEBAR_STORAGE_KEY}:view`) === 'git' ? 'git' : 'explorer'
  } catch {
    return 'explorer'
  }
}

export function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(`${SIDEBAR_STORAGE_KEY}:open`) !== 'false'
  } catch {
    return true
  }
}

export function loadSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(`${SIDEBAR_STORAGE_KEY}:width`))
    return Number.isFinite(raw) ? clamp(raw, SIDEBAR_MIN, SIDEBAR_MAX) : SIDEBAR_DEFAULT
  } catch {
    return SIDEBAR_DEFAULT
  }
}
