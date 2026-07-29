import type { NextFunction, Request, Response } from "express";
import { SECRET_KEY } from "../config";
import { logger } from "../globals";

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers['authorization'];
    if (!token) {
        // Not a credential attempt — a client that never sent one. Logged at
        // info so it can't trip the fail2ban filter (see
        // /etc/fail2ban/filter.d/notebrook-auth.conf); a browser that hasn't
        // been given a token yet would otherwise ban its own user.
        logger.info(`Auth missing from ${req.ip} for ${req.method} ${req.originalUrl}`);
        return res.status(403).json({ error: 'No token provided' });
    }
    if (token === SECRET_KEY) {
        next();
    } else {
        // A wrong token is an unambiguous guess. This exact wording is what the
        // notebrook-auth fail2ban filter matches on.
        logger.warn(`Auth failed from ${req.ip} for ${req.method} ${req.originalUrl}`);
        res.status(401).json({ error: "Unauthenticated" })
    }
}
