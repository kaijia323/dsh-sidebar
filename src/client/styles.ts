declare const __DSH_YMC_CLIENT_CSS__: string

const STYLES = __DSH_YMC_CLIENT_CSS__

export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  // Always create a fresh style element per plugin fiber. This keeps hot
  // reload / unload clean: the disposer removes exactly the element this
  // instance created, and overlapping HMR generations do not steal or remove
  // each other's styles.
  const element = document.createElement('style')
  element.setAttribute('data-dsh-ymc-sidebar-style', '')
  element.textContent = STYLES
  document.head.appendChild(element)
  return () => element.remove()
}
