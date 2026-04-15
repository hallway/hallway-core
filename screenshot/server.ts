#!/usr/bin/env bun

/**
 * Screenshot sidecar — accepts HTML, returns PNG screenshot.
 *
 * POST /screenshot  { html: "..." }  →  { screenshot: "<base64 PNG>" }
 * GET  /health                       →  { ok: true }
 */

import { chromium, type Browser } from "playwright";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/screenshot" && req.method === "POST") {
      try {
        const body = await req.json() as { html: string; width?: number; height?: number; wait?: number };
        const html = body.html;
        if (!html) return Response.json({ error: "missing html" }, { status: 400 });

        const width = body.width || 800;
        const height = body.height || 600;
        const wait = Math.min(body.wait || 3000, 10000);

        const b = await getBrowser();
        const page = await b.newPage({ viewport: { width, height } });

        await page.setContent(html, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(wait);

        const buf = await page.screenshot({ type: "png" });
        await page.close();

        const b64 = Buffer.from(buf).toString("base64");
        return Response.json({ screenshot: b64 });
      } catch (e: any) {
        return Response.json({ error: String(e).slice(0, 500) }, { status: 500 });
      }
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
});

console.log("screenshot server listening on port " + server.port);
