import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function proxyApi(req, res) {
  const base = process.env.API_URL?.replace(/\/$/, "");
  if (!base) {
    send(res, 502, "API_URL is not set");
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const headers = {};
  const contentType = req.headers["content-type"];
  const authorization = req.headers.authorization;
  if (contentType) headers["content-type"] = contentType;
  if (authorization) headers.authorization = authorization;

  try {
    const target = new URL(req.url || "/api", `${base}/`);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
    };
    res.writeHead(upstream.status, responseHeaders);
    res.end(responseBody);
  } catch {
    send(res, 502, "Bad Gateway");
  }
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] || "/");
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) return null;
  return full;
}

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function cacheControl(filePath) {
  const base = path.basename(filePath);
  // Vite hashed assets: long cache. HTML: always revalidate.
  if (base === "index.html") return "no-cache";
  if (/-[a-zA-Z0-9_-]{6,}\./.test(base)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

function serveFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    send(res, 500, "Internal Server Error");
  });
  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": cacheControl(filePath),
  });
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";
  if (urlPath === "/api" || urlPath.startsWith("/api/")) {
    proxyApi(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed");
    return;
  }

  const urlPath = req.url || "/";
  let filePath = safeJoin(DIST, urlPath === "/" ? "/index.html" : urlPath);
  if (!filePath) {
    send(res, 400, "Bad Request");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    fs.stat(filePath, (fileErr, fileStat) => {
      if (!fileErr && fileStat.isFile()) {
        if (req.method === "HEAD") {
          send(res, 200, "", {
            "Content-Type": contentType(filePath),
            "Cache-Control": cacheControl(filePath),
          });
          return;
        }
        serveFile(res, filePath);
        return;
      }

      // SPA fallback for client routes
      const indexPath = path.join(DIST, "index.html");
      fs.stat(indexPath, (indexErr) => {
        if (indexErr) {
          send(res, 404, "Not Found");
          return;
        }
        if (req.method === "HEAD") {
          send(res, 200, "", {
            "Content-Type": MIME[".html"],
            "Cache-Control": "no-cache",
          });
          return;
        }
        serveFile(res, indexPath);
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Dragotoba Quiz Maker serving ${DIST} on http://${HOST}:${PORT}`);
});
