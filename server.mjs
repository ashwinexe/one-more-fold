import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4323);
const cache = new Map();

http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    let name = pathname === "/" ? "exact.html" : pathname.slice(1);
    if (pathname.endsWith("/overview/main.built.js")) name = "apple-main.js";

    if (!name.includes("..")) {
      try {
        const body = await fs.readFile(path.join(root, name));
        const type = name.endsWith(".js")
          ? "application/javascript"
          : name.endsWith(".png")
            ? "image/png"
            : name.endsWith(".wav") ? "audio/wav"
              : name.endsWith(".webp") ? "image/webp"
                : name.endsWith(".json") ? "application/json" : "text/html";
        res.writeHead(200, { "Content-Type": type });
        res.end(body);
        return;
      } catch {}
    }

    if (pathname.startsWith("/metrics") || pathname.startsWith("/api-www")) {
      res.writeHead(204);
      res.end();
      return;
    }

    let response = cache.get(pathname);
    if (!response) {
      const upstream = await fetch(`https://www.apple.com${pathname}`);
      response = {
        status: upstream.status,
        type: upstream.headers.get("content-type"),
        body: Buffer.from(await upstream.arrayBuffer()),
      };
      if (upstream.ok) cache.set(pathname, response);
    }

    res.writeHead(response.status, {
      "Content-Type": response.type || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(response.body);
  } catch (error) {
    console.error(error.message);
    res.writeHead(502);
    res.end();
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Voice Design Duo preview: http://127.0.0.1:${port}`);
});
