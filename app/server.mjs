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

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

function hostName(value) {
  return String(value || "")
    .split(":")[0]
    .toLowerCase();
}

function apiBase() {
  return process.env.API_URL?.trim().replace(/\/$/, "") || "";
}

function hasUnresolvedTemplate(value) {
  return value.includes("${{") || /\$\{[^{]/.test(value);
}

async function proxyApi(req, res) {
  const reqUrl = req.url || "/api";
  const base = apiBase();
  if (!base) {
    sendJson(res, 502, { error: "API_URL is not set on the app service." });
    return;
  }
  if (hasUnresolvedTemplate(base)) {
    sendJson(res, 502, {
      error:
        "API_URL is still a Railway template. Set it to the server's public or private URL.",
    });
    return;
  }

  let target;
  try {
    target = new URL(reqUrl, `${base}/`);
  } catch {
    sendJson(res, 502, { error: "API_URL is invalid." });
    return;
  }

  const incomingHost = hostName(req.headers.host);
  const targetHost = hostName(target.host);
  if (incomingHost && targetHost === incomingHost) {
    sendJson(res, 502, {
      error:
        "API_URL points at the website. Set it to the server service URL (not the app URL).",
    });
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
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
    });
    res.end(responseBody);
  } catch (error) {
    const cause = error instanceof Error ? error.cause : null;
    const code =
      cause && typeof cause === "object" && "code" in cause ? cause.code : null;
    console.error("[proxy] upstream fetch failed", {
      target: target.href,
      error: error instanceof Error ? error.message : String(error),
      code,
    });
    sendJson(res, 502, {
      error:
        code === "ENOTFOUND"
          ? "Could not DNS-resolve API_URL. Use the server's public https://….up.railway.app URL."
          : "Could not reach the API server.",
    });
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
