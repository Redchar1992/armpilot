import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "out");
const port = Number(process.env.PORT ?? 4173);
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

createServer((request, response) => {
  const urlPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = normalize(urlPath).replace(/^[/\\]+/, "");
  let file = join(root, relative);
  if (!file.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    const stat = statSync(file);
    response.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": file.endsWith(".html") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`ArmPilot static export: http://127.0.0.1:${port}\n`);
});

