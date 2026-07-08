import path from "path";
import type { Message } from "../../types";
import { events, logger } from "../globals"
import { describeImage } from "../services/image-description";
import { getMessage, updateMessage } from "../services/message-service";
import { UPLOAD_DIR } from "../config";

export const describeImageJob = () => {
    events.on("file-uploaded", (id, channelId, messageId, filePath, fileType, fileSize, originalName) => {
        if (fileType.includes("image")) {
            // filePath is stored relative to UPLOAD_DIR; resolve it to an absolute
            // path on disk (older records may already be absolute).
            const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(UPLOAD_DIR, filePath);
            describeImage(absolutePath).then((description) => {
                const msg = getMessage(messageId) as any;
                updateMessage(messageId, `${msg.content ? msg.content : ''}\n\n${description}`);
            }).catch((e) => {
                logger.warn(`Failed to describe image: ${e.message}`);
            });
        }
    });
}