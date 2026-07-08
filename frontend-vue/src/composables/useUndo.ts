import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { useUndoStore } from '@/stores/undo'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { apiService } from '@/services/api'
import type { ExtendedMessage } from '@/types'

/**
 * Undo support for delete operations.
 *
 * Deleted messages are kept on an in-memory stack (see the undo store). Undoing
 * pops the most recent deletion and re-creates it on the server through the
 * existing messages API — no backend changes and no per-session persistence.
 *
 * Caveat: re-created messages get a fresh id/timestamp (so they appear as the
 * newest message), and attachments can't be recovered because the messages API
 * only takes text content and the uploaded file is gone once deleted server-side.
 */
export function useUndo() {
  const appStore = useAppStore()
  const toastStore = useToastStore()
  const undoStore = useUndoStore()
  const { announce } = useAnnouncer()

  const hasAttachment = (m: ExtendedMessage) => Boolean(m.file_id ?? m.fileId)

  // Trim long content for the visual toast (the announced version reads it in full).
  const preview = (text: string, max = 60) =>
    text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

  // Record a deletion so it can later be undone. Call this AFTER the server
  // delete succeeds, so a failed/rolled-back delete never lands on the stack.
  const recordMessageDeletion = (message: ExtendedMessage, channelId: number) => {
    undoStore.recordDeletedMessage(message, channelId)
  }

  // Re-add the most recently deleted message. Repeated calls walk back down the
  // stack, one deletion at a time.
  const undoLastDelete = async (): Promise<boolean> => {
    const entry = undoStore.popDeletedMessage()
    if (!entry) {
      announce('Nothing to undo')
      toastStore.info('Nothing to undo')
      return false
    }

    const content = entry.message.content?.trim() ?? ''
    if (!content) {
      // Attachment-only messages have no text to re-create and the file is gone,
      // so there's nothing the messages API can restore. Drop it and move on.
      announce("Can't undo. Attachment-only messages can't be restored")
      toastStore.error("Can't undo — attachment-only messages can't be restored")
      return false
    }

    try {
      // Backend returns camelCase ({ id, channelId, content, createdAt }); normalise
      // it to our snake_case shape the same way the WebSocket handler does, so the
      // restored message lands in the right channel even without a live socket.
      const response: any = await apiService.createMessage(entry.channelId, entry.message.content)
      const restored: ExtendedMessage = {
        id: response.id,
        channel_id: entry.channelId,
        content: response.content ?? entry.message.content,
        created_at: response.createdAt || new Date().toISOString(),
        checked: null
      }
      appStore.addMessage(restored)

      // Re-apply the checked state if the original had one.
      if (entry.message.checked != null) {
        try {
          await apiService.setMessageChecked(entry.channelId, restored.id, entry.message.checked)
          appStore.setMessageChecked(restored.id, entry.message.checked)
        } catch (err) {
          console.warn('Undo: failed to restore checked state', err)
        }
      }

      await appStore.saveState()

      if (hasAttachment(entry.message)) {
        announce(`Restored message: ${restored.content}. Attachment could not be recovered`)
        toastStore.info(`Restored: ${preview(restored.content)} (attachment not recovered)`)
      } else {
        announce(`Restored message: ${restored.content}`)
        toastStore.success(`Restored: ${preview(restored.content)}`)
      }
      return true
    } catch (error) {
      console.error('Failed to undo delete:', error)
      // Put it back so the user can retry after a transient failure.
      undoStore.recordDeletedMessage(entry.message, entry.channelId)
      announce('Failed to undo delete')
      toastStore.error('Failed to undo delete')
      return false
    }
  }

  return {
    recordMessageDeletion,
    undoLastDelete
  }
}
