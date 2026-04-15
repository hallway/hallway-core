/**
 * Screenshot sidecar — accepts HTML, returns PNG screenshot.
 *
 * POST /screenshot  { html: "..." }  →  { screenshot: "<base64 PNG>" }
 * GET  /health                       →  { ok: true }
 */

const http = require("http");
const { chromium } = require("playwright");

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/screenshot" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const html = data.html;
        if (!html) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "missing html" }));
          return;
        }

        const width = data.width || 800;
        const height = data.height || 600;
        const wait = Math.min(data.wait || 3000, 10000);

        const b = await getBrowser();
        const page = await b.newPage({ viewport: { width, height } });

        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(wait);

        const buf = await page.screenshot({ type: "png" });
        await page.close();

        const b64 = buf.toString("base64");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ screenshot: b64 }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e).slice(0, 500) }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(3000, () => {
  console.log("screenshot server listening on port 3000");
});
