import { useAppStore } from '@/stores/app'
import { useToastStore } from '@/stores/toast'
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
 * Returns the number of files that uploaded successfully.
 */
export function useFileUpload() {
  const appStore = useAppStore()
  const toastStore = useToastStore()

  const uploadFiles = async (files: File[], options: UploadOptions = {}): Promise<number> => {
    const channelId = options.channelId ?? appStore.currentChannelId
    if (!channelId || files.length === 0) return 0

    let successCount = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file) continue

      try {
        // Create a message first, then attach the file to it.
        const message = await apiService.createMessage(channelId, file.name)
        const uploadedFile = await apiService.uploadFile(channelId, message.id, file)

        options.onProgress?.(i, 100)

        // Immediately reflect the file metadata on the local message so it
        // renders without waiting for a round-trip / websocket event.
        const updatedMessage = {
          ...message,
          fileId: uploadedFile.id,
          filePath: uploadedFile.file_path,
          fileType: uploadedFile.file_type,
          fileSize: uploadedFile.file_size,
          originalName: uploadedFile.original_name,
          fileCreatedAt: uploadedFile.created_at
        }
        appStore.updateMessage(message.id, updatedMessage)

        successCount++
      } catch (fileError) {
        console.error(`Failed to upload ${file.name}:`, fileError)
        toastStore.error(`Failed to upload ${file.name}`)
        options.onProgress?.(i, 0)
      }
    }

    return successCount
  }

  return { uploadFiles }
}
