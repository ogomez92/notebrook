import multer from "multer";
import { mkdirSync } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { UPLOAD_DIR } from "../config";

// Maximum accepted upload size: 10 GB.
export const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;

// Keep filesystem paths tame: strip anything that isn't a safe path segment.
const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_");

// Store uploads on disk (never in the DB), grouped into a subfolder per channel
// and keeping the original filename + extension so the files stay browsable and
// serve with the correct content type.
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const channelId = sanitize(String(req.params["channelId"] || "misc")) || "misc";
    const dir = path.join(UPLOAD_DIR, channelId);
    try {
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err as Error, dir);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = sanitize(path.basename(file.originalname, ext)).slice(0, 100) || "file";
    const unique = randomBytes(8).toString("hex");
    cb(null, `${base}-${unique}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
});
