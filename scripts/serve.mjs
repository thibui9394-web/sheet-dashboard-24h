import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function toSafePath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split("?")[0]);
  const relative = cleaned === "/" ? "/index.html" : cleaned;
  const fullPath = path.resolve(rootDir, `.${relative}`);
  if (!fullPath.startsWith(rootDir)) return null;
  return fullPath;
}

const server = createServer(async (req, res) => {
  const target = toSafePath(req.url || "/");
  if (!target) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard running at http://localhost:${port}`);
});
