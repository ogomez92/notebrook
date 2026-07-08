import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { upload, MAX_FILE_SIZE } from "../utils/multer";
import * as FileController from "../controllers/file-controller";
import { authenticate } from "../middleware/auth";

export const router = Router({ mergeParams: true });

// Run multer but translate its errors into clean JSON responses (e.g. a file
// larger than the 10GB limit should be a 413, not an unhandled 500).
const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        const gb = MAX_FILE_SIZE / (1024 * 1024 * 1024);
        return res.status(413).json({ error: `File exceeds the ${gb}GB size limit` });
      }
      return res.status(400).json({ error: (err as Error).message || "File upload failed" });
    }
    next();
  });
};

router.post("/", authenticate, uploadSingle, FileController.uploadFile);
router.get("/", authenticate, FileController.getFiles);
