// Vercel serverless entry point. Route handlers live in ./_lib (the leading
// underscore prevents Vercel from deploying helper modules as functions).
import { createApp } from "./_lib/app.js";

const app = createApp();

export default function handler(req, res) {
  return app(req, res);
}
