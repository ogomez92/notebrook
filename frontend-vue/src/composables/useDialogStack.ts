/**
 * Tracks which dialogs are open, innermost last.
 *
 * Dialogs nest — opening a message from the search dialog puts one on top of
 * the other — and both of them listen for Escape on `document`. Without a
 * shared stack every open dialog answers the same keypress, so one Escape
 * collapses the whole pile, and the first dialog to close hands page scrolling
 * back while another one is still covering the screen.
 *
 * This lives in its own module on purpose: top-level code inside `<script
 * setup>` runs once per component *instance*, so a stack declared there would
 * give every dialog its own private copy and quietly do nothing.
 */
const openDialogs: symbol[] = []

export function useDialogStack() {
  const key = Symbol('dialog')

  /** Whether this dialog is the one a keypress should be delivered to. */
  const isTopmost = () => openDialogs[openDialogs.length - 1] === key

  /** Become the topmost dialog and lock page scrolling behind it. */
  const enter = () => {
    if (!openDialogs.includes(key)) openDialogs.push(key)
    document.body.style.overflow = 'hidden'
  }

  /** Step off the stack; scrolling comes back only once nothing is left on it. */
  const leave = () => {
    const index = openDialogs.indexOf(key)
    if (index !== -1) openDialogs.splice(index, 1)
    if (openDialogs.length === 0) document.body.style.overflow = ''
  }

  return { isTopmost, enter, leave }
}
