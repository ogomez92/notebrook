import dotenv from "dotenv";
dotenv.config();

export const DB_PATH = process.env["DB_PATH"] || "/usr/src/app/data/db.sqlite";
export const SECRET_KEY = process.env["API_TOKEN"] || "";
export const UPLOAD_DIR = process.env["UPLOAD_DIR"] || "/usr/src/app/data/uploads/";
export const FRONTEND_DIR = process.env["FRONTEND_DIR"] || "/usr/src/app/backend/public";
export const DESCRIBE_IMAGES: boolean = process.env["DESCRIBE_IMAGES"] === "1" ? true : false;
export const DESCRIBE_IMAGES_API = process.env["DESCRIBE_IMAGES_API"] || "ollama";
export const DESCRIBE_IMAGES_PROMPT= process.env["DESCRIBE_IMAGES_PROMPT"] || "Describe this image.";
export const DESCRIBE_IMAGES_TEMPERATURE= parseFloat(process.env["DESCRIBE_IMAGES_TEMPERATURE"]!) || 0.5;
export const DESCRIBE_IMAGES_MAX_TOKENS= parseInt(process.env["DESCRIBE_IMAGES_MAX_TOKENS"]!) || 1024;
export const OPENAI_API_KEY= process.env["OPENAI_API_KEY"] || "";
export const OPENAI_MODEL = process.env["OPENAI_MODEL"] || "gpt-4o";
export const OLLAMA_URL= process.env["OLLAMA_URL"] || "http://localhost:11434";
export const OLLAMA_MODEL= process.env["OLLAMA_MODEL"] || "moondream";
export const PORT = parseInt(process.env["PORT"]!) || 3000;
export const FEED_CHANNEL = process.env["FEED_CHANNEL"] || "feeds";
export const USE_SSL = process.env["USE_SSL"] === "1" ? true : false;
export const SSL_KEY = process.env["SSL_KEY"] || "";
export const SSL_CERT = process.env["SSL_CERT"] || "";

// --- Push notifications -----------------------------------------------------
// A provider is enabled only when all of its settings are present; with none
// configured the push endpoints still work (devices can register, channels can
// be marked) but nothing is delivered. See PUSH.md.

// Apple Push Notification service (iOS). Token-based auth with a .p8 key.
// Either paste the key contents (newlines may be written as "\n") or point at
// the file.
export const APNS_KEY = (process.env["APNS_KEY"] || "").replaceAll("\\n", "\n");
export const APNS_KEY_PATH = process.env["APNS_KEY_PATH"] || "";
export const APNS_KEY_ID = process.env["APNS_KEY_ID"] || "";
export const APNS_TEAM_ID = process.env["APNS_TEAM_ID"] || "";
export const APNS_BUNDLE_ID = process.env["APNS_BUNDLE_ID"] || "com.oriolgomez.notebrook";
// Debug builds installed from Xcode use the sandbox gateway; TestFlight and
// App Store builds use production.
export const APNS_PRODUCTION = process.env["APNS_PRODUCTION"] === "1";

// Web Push (browsers / PWA). Generate a pair with `npm run push:vapid`.
export const VAPID_PUBLIC_KEY = process.env["VAPID_PUBLIC_KEY"] || "";
export const VAPID_PRIVATE_KEY = process.env["VAPID_PRIVATE_KEY"] || "";
// Contact for the push service operator: "mailto:you@example.com" or an https URL.
export const VAPID_SUBJECT = process.env["VAPID_SUBJECT"] || "";

// Longest message excerpt placed in a notification body.
export const PUSH_BODY_MAX_LENGTH = parseInt(process.env["PUSH_BODY_MAX_LENGTH"]!) || 200;
