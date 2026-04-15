/**
 * Screenshot proxy — organisms request screenshots through hallway.
 *
 * POST /screenshot  → render HTML via Playwright sidecar (costs credits)
 */

import { debitOrg } from "./economy";
import { PRICES } from "../lib/pricing";

const SCREENSHOT_SIDECAR = process.env.SCREENSHOT_URL || "http://hallway-screenshot:3000/screenshot";

export async function proxyScreenshot(organismId: string, body: {
  html: string;
  width?: number;
  height?: number;
  wait?: number;
}) {
  // Debit upfront (screenshots are cheap)
  const ok = debitOrg(organismId, PRICES.screenshot, "spend", "screenshot");
  if (!ok) return { error: "insufficient credits" };

  try {
    const response = await fetch(SCREENSHOT_SIDECAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html: body.html,
        width: body.width || 800,
        height: body.height || 600,
        wait: Math.min(body.wait || 3000, 10000),
      }),
    });

    const data = await response.json() as any;

    if (data.error) return { error: data.error, cost: PRICES.screenshot };

    return {
      screenshot: data.screenshot,
      cost: PRICES.screenshot,
    };
  } catch (e) {
    return { error: String(e).slice(0, 200), cost: PRICES.screenshot };
  }
}
