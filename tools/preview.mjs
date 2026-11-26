// Local preview of the built site (dist/client) with the same clean URLs and redirects as the worker,
// while /api, /v1, /mcp and /media are forwarded to production so pages show real data.
// Usage: npm run build && node tools/preview.mjs [port]   (default 5199; PREVIEW_ROOT=<dir> for another build)
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// PREVIEW_ROOT serves another build folder (see tools/vite.qa.config.mjs).
const ROOT = process.env.PREVIEW_ROOT ? `${resolve(process.env.PREVIEW_ROOT)}/` : fileURLToPath(new URL("../dist/client/", import.meta.url));
const PORT = Number(process.argv[2] ?? 5199);
const UPSTREAM = "https://siroagent.com";
const PAGES = { "/ask": "ask.html", "/budget": "budget.html", "/tools": "tools.html", "/activity": "activity.html", "/docs": "docs.html", "/shipped": "shipped.html" };
const MOVED = { "/app": "/ask", "/wallet": "/budget", "/resources": "/tools", "/ledger": "/activity", "/roadmap": "/shipped" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json", ".txt": "text/plain", ".xml": "application/xml", ".tgz": "application/gzip" };

const send = (res, file, status = 200) => {
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  if (/^\/(api|v1|mcp|media)(\/|$)/.test(path)) {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise((ok) => {
      const parts = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => ok(Buffer.concat(parts)));
    });
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "origin", "referer", "connection"].includes(k)));
    try {
      const up = await fetch(UPSTREAM + path + url.search, { method: req.method, headers: { ...headers, "user-agent": "siro-preview/1.0" }, body });
      const out = Object.fromEntries([...up.headers].filter(([k]) => !["content-encoding", "content-length", "transfer-encoding"].includes(k)));
      res.writeHead(up.status, out);
      res.end(Buffer.from(await up.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "preview_upstream", message: String(e) } }));
    }
    return;
  }
  const moved = Object.keys(MOVED).find((p) => path === p || path.startsWith(p + "/"));
  if (moved) {
    res.writeHead(301, { location: MOVED[moved] + path.slice(moved.length) + url.search });
    return res.end();
  }
  if (PAGES[path]) return send(res, join(ROOT, PAGES[path]));
  if (path.startsWith("/tools/")) return send(res, join(ROOT, "tools.html"));
  if (path === "/") return send(res, join(ROOT, "index.html"));
  const file = normalize(join(ROOT, path));
  if (file.startsWith(ROOT) && existsSync(file) && statSync(file).isFile()) return send(res, file);
  send(res, join(ROOT, "404.html"), 404);
}).listen(PORT, () => console.log(`preview on http://localhost:${PORT} (api → ${UPSTREAM})`));
