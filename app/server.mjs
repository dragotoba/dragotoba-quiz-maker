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

function proxyLog(message, data = {}) {
  console.log(`[proxy] ${message}`, data);
}

async function proxyApi(req, res) {
  const started = Date.now();
  const reqUrl = req.url || "/api";
  const base = process.env.API_URL?.replace(/\/$/, "");
  let targetHref = null;
  try {
    targetHref = base ? new URL(reqUrl, `${base}/`).href : null;
  } catch (error) {
    targetHref = null;
    proxyLog("invalid API_URL or request path", {
      reqUrl,
      hasApiUrl: Boolean(base),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  // #region agent log
  fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "a58a7b",
    },
    body: JSON.stringify({
      sessionId: "a58a7b",
      hypothesisId: "A",
      location: "app/server.mjs:proxyApi",
      message: "proxy start",
      data: {
        method: req.method,
        reqUrl,
        hasApiUrl: Boolean(base),
        apiHost: base ? (() => { try { return new URL(base).host; } catch { return "invalid"; } })() : null,
        targetHref,
        incomingHost: hostName(req.headers.host),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!base) {
    proxyLog("API_URL is not set", { method: req.method, reqUrl });
    sendJson(res, 502, { error: "API_URL is not set on the app service." });
    return;
  }

  let target;
  try {
    target = new URL(reqUrl, `${base}/`);
  } catch (error) {
    proxyLog("could not build upstream URL", {
      reqUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(res, 502, { error: "API_URL is invalid." });
    return;
  }

  const incomingHost = hostName(req.headers.host);
  const targetHost = hostName(target.host);
  if (incomingHost && targetHost === incomingHost) {
    proxyLog("API_URL points at this website, not the API server", {
      incomingHost,
      targetHost,
      target: target.href,
    });
    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "C",
        location: "app/server.mjs:proxyApi",
        message: "self-proxy blocked",
        data: { incomingHost, targetHost, target: target.href },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
    proxyLog("forwarding", {
      method: req.method,
      reqUrl,
      target: target.href,
      bodyBytes: body.length,
    });
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
    proxyLog("upstream response", {
      method: req.method,
      target: target.href,
      status: upstream.status,
      contentType: responseHeaders["Content-Type"],
      ms: Date.now() - started,
    });
    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "B",
        location: "app/server.mjs:proxyApi",
        message: "proxy upstream ok",
        data: { status: upstream.status, target: target.href, ms: Date.now() - started },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    res.writeHead(upstream.status, responseHeaders);
    res.end(responseBody);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    proxyLog("upstream fetch failed", {
      method: req.method,
      reqUrl,
      target: targetHref,
      ms: Date.now() - started,
      error: errMsg,
    });
    // #region agent log
    fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "a58a7b",
      },
      body: JSON.stringify({
        sessionId: "a58a7b",
        hypothesisId: "B",
        location: "app/server.mjs:proxyApi",
        message: "proxy upstream failed",
        data: { reqUrl, targetHref, ms: Date.now() - started, error: errMsg },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    sendJson(res, 502, { error: "Could not reach the API server." });
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
