import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { apiService } from '@/services/api'

interface UploadOptions {
  // Channel to upload into; defaults to the currently selected channel.
  channelId?: number
  // Called after each file settles, with its index and a percentage (100 on
  // success, 0 on failure). Lets callers drive a progress UI.
  onProgress?: (index: number, percent: number) => void
}

/**
 * Upload files as chat messages. The backend attaches a single file per message,
 * so each file becomes its own message (its filename is used as the content).
 *
 * Emits its own user feedback for every caller (the upload dialog, paste, etc.):
 * a persistent "Uploading…" toast while in flight, a success/failure toast at
 * the end, and matching aria-live announcements for screen readers.
 *
 * Returns the number of files that uploaded successfully.
 */
export function useFileUpload() {
  const appStore = useAppStore()
  const toastStore = useToastStore()
  const { announce } = useAnnouncer()

  const uploadFiles = async (files: File[], options: UploadOptions = {}): Promise<number> => {
    const channelId = options.channelId ?? appStore.currentChannelId
    if (!channelId || files.length === 0) return 0

    const total = files.length
    const label = total === 1 ? (files[0]?.name || 'file') : `${total} files`

    // Visible + screen-reader indication that the upload has started. The toast
    // uses duration 0 so it stays up until we explicitly remove it below.
    const pendingToastId = toastStore.info(`Uploading ${label}…`, 0)
    announce(`Uploading ${label}`)

    let successCount = 0

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file) continue

        try {
          // Create a message first, then attach the file to it.
          const message = await apiService.createMessage(channelId, file.name)
          const uploadedFile = await apiService.uploadFile(channelId, message.id, file)

          options.onProgress?.(i, 100)

          // Add the new message to the store immediately so it shows without
          // waiting for a resync. addMessage upserts by id, so this merges
          // cleanly if the websocket also delivers the same message. (updateMessage
          // alone was a no-op here — the message isn't in the store yet — which
          // left pasted/dropped uploads invisible until the next send/sync.)
          const newMessage = {
            id: message.id,
            channel_id: channelId,
            content: message.content ?? file.name,
            created_at: uploadedFile.created_at ?? new Date().toISOString(),
            checked: null,
            file_id: uploadedFile.id,
            fileId: uploadedFile.id,
            filePath: uploadedFile.file_path,
            fileType: uploadedFile.file_type,
            fileSize: uploadedFile.file_size,
            originalName: uploadedFile.original_name,
            fileCreatedAt: uploadedFile.created_at
          }
          appStore.addMessage(newMessage)

          successCount++
        } catch (fileError) {
          console.error(`Failed to upload ${file.name}:`, fileError)
          options.onProgress?.(i, 0)
        }
      }
    } finally {
      // Always clear the in-progress toast, even if something unexpected throws.
      toastStore.removeToast(pendingToastId)
    }

    if (successCount === total) {
      const msg = total === 1 ? `Uploaded ${label}` : `Uploaded ${total} files`
      toastStore.success(msg)
      announce(msg)
    } else if (successCount > 0) {
      const msg = `Uploaded ${successCount} of ${total} files`
      toastStore.success(msg)
      announce(msg, true)
    } else {
      const msg = total === 1 ? `Failed to upload ${label}` : 'Upload failed — please try again'
      toastStore.error(msg)
      announce(msg, true)
    }

    return successCount
  }

  return { uploadFiles }
}
