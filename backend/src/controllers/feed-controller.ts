import type { Request, Response } from "express";
import * as ChannelService from "../services/channel-service";
import * as MessageService from "../services/message-service";
import { FEED_CHANNEL } from "../config";
import { logger } from "../globals";

// Unauthenticated on purpose: this is the endpoint for callers that can't
// manage a token. It only ever appends to the feed channel, and answers with
// bare text — "ok" on 200, the failure reason on 500.
export const sendToFeed = async (req: Request, res: Response) => {
    // The whole body is the message; no envelope to build. `?m=` covers callers
    // that can only send a URL.
    const body = typeof req.body === "string" ? req.body : "";
    const content = (body || String(req.query["m"] ?? "")).trim();

    if (!content) {
        return res.status(500).type("text/plain").send("empty message");
    }

    try {
        const channel = await ChannelService.getOrCreateChannelByName(FEED_CHANNEL);
        const messageId = await MessageService.createMessage(String(channel.id), content);
        logger.info(`Feed message ${messageId} posted to #${FEED_CHANNEL}`);

        res.status(200).type("text/plain").send("ok");
    } catch (error: any) {
        logger.critical(`Failed to post feed message:`, error);
        res.status(500).type("text/plain").send(error?.message || "unknown error");
    }
}
