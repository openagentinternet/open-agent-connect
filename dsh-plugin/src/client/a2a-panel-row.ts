/**
 * Panellist-row click interception for the A2A Chat overlay (client half).
 *
 * The sidebar's PanelRow calls `ctx.layout.selectPanel(id)` on click — a
 * global main panel selection that would unmount the official right Sidebar.
 * The A2A Chat surface is a `shell.overlay` entry instead, so the row's
 * click is intercepted in the capture phase (the same mechanism the
 * transcript link interceptor uses) and toggles the overlay store;
 * PanelRow's onClick never fires. The row keeps rendering (glyph, label,
 * unread dot) because the panellist entry list is independent of the `main`
 * panel registry.
 */

/** DOM marker the A2APanelGlyph carries so the interceptor can name its row. */
export const A2A_PANEL_ROW_MARK = 'data-oac-a2a-panellist'

/** Intercept clicks on the A2A panellist row; returns the stop function. */
export function startA2APanelRowInterceptor(toggle: () => void): () => void {
  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (button === null) return
    if (button.querySelector(`[${A2A_PANEL_ROW_MARK}]`) === null) return
    event.preventDefault()
    event.stopPropagation()
    toggle()
  }
  document.addEventListener('click', onClick, true)
  return () => { document.removeEventListener('click', onClick, true) }
}
