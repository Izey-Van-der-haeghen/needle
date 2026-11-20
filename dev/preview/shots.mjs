// Render the Chrome Web Store images from the preview: five 1280×800 screenshots
// and the 440×280 promo tile, all on the fictional demo page.
//   node dev/preview/serve.js &   then   node dev/preview/shots.mjs
// Add --promo to render only the promo tile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./capture/cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, "../../store/screenshots");
const args = process.argv.slice(2);
const ONLY_PROMO = args.includes("--promo");
const BASE = args.find((a) => !a.startsWith("--")) || "http://localhost:5178";
fs.mkdirSync(OUT, { recursive: true });

const chrome = await launchChrome();
try {
  const page = await chrome.newPage();
  async function capture(url, file, width, height) {
    await page.cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page.goto(url);
    for (let i = 0; i < 100; i++) {
      if ((await page.evaluate("document.title")) === "ready") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const { data } = await page.cmd("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log("wrote", path.relative(process.cwd(), file));
  }
  const shots = ONLY_PROMO ? [] : ["onpage", "links", "technical", "ai", "content"];
  for (const [i, s] of shots.entries()) {
    await capture(`${BASE}/__preview/store-frame.html?shot=${s}`, path.join(OUT, `${i + 1}-${s}-1280x800.png`), 1280, 800);
  }
  await capture(`${BASE}/__preview/promo.html`, path.resolve(OUT, "../promo-440x280.png"), 440, 280);
} finally {
  await chrome.close();
}
