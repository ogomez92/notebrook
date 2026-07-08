import { ref } from 'vue'

/**
 * Screen-reader announcements via ARIA live regions.
 *
 * This intentionally does NOT use the Web Speech API / speechSynthesis — the
 * assistive technology voices the live region itself. The live-region elements
 * are rendered once in App.vue and bound to the module-level refs below, so any
 * caller shares the same regions.
 */

// Module-level singletons so every caller and the live-region host share state.
const politeMessage = ref('')
const assertiveMessage = ref('')

let politeTimer: ReturnType<typeof setTimeout> | null = null
let assertiveTimer: ReturnType<typeof setTimeout> | null = null

export function useAnnouncer() {
  /**
   * Announce `message` to assistive technology.
   * @param assertive when true, interrupts the screen reader (aria-live="assertive").
   */
  const announce = (message: string, assertive = false) => {
    const text = (message ?? '').trim()
    if (!text) return

    // Clear first, then set on a later tick, so an identical message repeated
    // back-to-back is still detected as a change and re-announced.
    if (assertive) {
      assertiveMessage.value = ''
      if (assertiveTimer) clearTimeout(assertiveTimer)
      assertiveTimer = setTimeout(() => { assertiveMessage.value = text }, 60)
    } else {
      politeMessage.value = ''
      if (politeTimer) clearTimeout(politeTimer)
      politeTimer = setTimeout(() => { politeMessage.value = text }, 60)
    }
  }

  return { politeMessage, assertiveMessage, announce }
}
