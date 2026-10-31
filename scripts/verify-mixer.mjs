/**
 * Headless pass over the stem mixer: two generated tones, fader, mute,
 * keyboard, share fragment, and a WAV export that must be a non-silent RIFF.
 *
 * Usage: node scripts/verify-mixer.mjs http://localhost:4173
 * Chrome: CHROME_PATH, otherwise the first existing common install path.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = process.argv[2] ?? "http://localhost:4173";
const shotDir = process.env.SHOT_DIR ?? "/opt/cursor/artifacts/screenshots";

function chromeCandidates() {
  const home = homedir();
  if (platform() === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      join(home, "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      join(home, "Applications", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ];
  }
  if (platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFiles, "Google", "Chrome Beta", "Application", "chrome.exe"),
      join(localAppData, "Google", "Chrome Beta", "Application", "chrome.exe"),
      join(programFiles, "Chromium", "Application", "chrome.exe"),
      join(localAppData, "Chromium", "Application", "chrome.exe"),
    ];
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/opt/google/chrome/chrome",
  ];
}

function resolveChromePath() {
  const override = process.env.CHROME_PATH;
  if (override) {
    if (!existsSync(override)) throw new Error(`CHROME_PATH is set but not found: ${override}`);
    return override;
  }
  const found = chromeCandidates().find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Chrome was not found. Set CHROME_PATH to the browser executable.");
  return found;
}

const chromePath = resolveChromePath();

function toneWav(freq, seconds = 1, sampleRate = 48_000) {
  const frames = Math.floor(sampleRate * seconds);
  const dataBytes = frames * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.4;
    view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), true);
  }
  return Array.from(new Uint8Array(buf));
}

function assertWav(bytes, label) {
  const buf = Buffer.from(bytes);
  const riff = buf.subarray(0, 4).toString("ascii");
  const wave = buf.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`${label} is not a RIFF WAVE (got ${riff}/${wave}, ${buf.length} bytes)`);
  }
  let peak = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
  }
  if (peak < 200) throw new Error(`${label} is silent (peak ${peak})`);
  return { bytes: buf.length, peak };
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
  ],
});

const page = await browser.newPage();
const logs = [];
page.on("console", (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => logs.push(`pageerror: ${err.message}`));
await page.evaluateOnNewDocument(() => {
  const orig = URL.createObjectURL;
  URL.createObjectURL = function (blob) {
    globalThis.__lastExportBlob = blob;
    return orig.call(URL, blob);
  };
});

mkdirSync(shotDir, { recursive: true });
const shots = [];

try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await page.waitForSelector("article.song-card[data-song-card='3']");

  const loadTone = async (deck, stem, freq) => {
    const before = await page.$eval("#status-msg", (el) => el.textContent);
    await page.evaluate(
      ({ deck, stem, freq, bytes, name }) => {
        const input = document.querySelector(
          `.stem-file[data-deck="${deck}"][data-stem="${stem}"]`,
        );
        const file = new File([new Uint8Array(bytes)], name, { type: "audio/wav" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { deck, stem, freq, bytes: toneWav(freq), name: `tone-deck${deck}-stem${stem}-${freq}hz.wav` },
    );
    await page.waitForFunction(
      (previous) => {
        const text = document.querySelector("#status-msg")?.textContent ?? "";
        return text !== previous && (text.includes("loaded") || text.includes("Could not") || text.includes("failed"));
      },
      { timeout: 30_000 },
      before,
    );
    const status = await page.$eval("#status-msg", (el) => el.textContent ?? "");
    if (!status.includes("loaded")) throw new Error(`load failed: ${status}`);
  };

  await loadTone(0, 0, 220);
  await loadTone(1, 1, 330);

  await page.click('.deck-play[data-deck="0"]');
  await page.click('.deck-play[data-deck="1"]');
  await page.waitForFunction(
    () => document.querySelector('.deck-play[data-deck="0"]')?.getAttribute("aria-pressed") === "true"
      && document.querySelector('.deck-play[data-deck="1"]')?.getAttribute("aria-pressed") === "true",
  );

  const beforeGain = await page.$eval("#val-0-0", (el) => el.textContent);
  await page.$eval('.stem-fader[data-deck="0"][data-stem="0"]', (el) => {
    el.value = "2000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const afterGain = await page.$eval("#val-0-0", (el) => el.textContent);
  if (afterGain === beforeGain) throw new Error("fader did not move the readout");

  const mute = '[data-action="stem-mute"][data-deck="0"][data-stem="0"]';
  await page.click(mute);
  const muted = await page.$eval(mute, (el) => el.getAttribute("aria-pressed"));
  if (muted !== "true") throw new Error("mute button did not latch");

  // Songs 3 and 4 start collapsed, so deck C's volume slider is not focusable until shown.
  await page.click('[data-action="toggle-4-songs"]');
  await page.waitForFunction(
    () => document.querySelector("article.song-card[data-song-card='2']")?.hidden === false,
  );

  await page.focus('.deck-volume[data-deck="2"]');
  const volumeBefore = Number(await page.$eval('.deck-volume[data-deck="2"]', (el) => el.value));
  await page.keyboard.press("ArrowLeft");
  const volumeAfter = Number(await page.$eval('.deck-volume[data-deck="2"]', (el) => el.value));
  if (!(volumeAfter < volumeBefore)) throw new Error(`keyboard did not lower deck C (${volumeBefore} -> ${volumeAfter})`);
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  if (!focused.includes("deck-volume")) throw new Error(`focus left the fader (${focused})`);

  await page.click("#btn-share");
  await page.waitForFunction(() => location.hash.startsWith("#m1."));
  const hash = await page.evaluate(() => location.hash);
  if (hash.includes("tone-deck") || hash.includes(".wav") || hash.includes("220hz")) {
    throw new Error(`share fragment contains audio identity: ${hash}`);
  }

  const rms = await page
    .waitForFunction(
      () => {
        const text = document.querySelector("#rms-readout")?.textContent ?? "";
        const match = text.match(/RMS\s+([0-9.]+)/);
        return match && Number(match[1]) > 0.001 ? text : false;
      },
      { timeout: 8_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => page.$eval("#rms-readout", (el) => el.textContent));

  shots.push(resolve(shotDir, "stem-mixer-1280.png"));
  await page.screenshot({ path: shots[0], fullPage: true });

  await page.setViewport({ width: 1024, height: 800 });
  shots.push(resolve(shotDir, "stem-mixer-1024.png"));
  await page.screenshot({ path: shots[1], fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });

  await page.click("#btn-export-wav");
  await page.waitForFunction(
    () => {
      const text = document.querySelector("#status-msg")?.textContent ?? "";
      return text.startsWith("Saved") || text.startsWith("Save refused") || text.startsWith("Press play");
    },
    { timeout: 30_000 },
  );
  const exportStatus = await page.$eval("#status-msg", (el) => el.textContent ?? "");
  if (!exportStatus.startsWith("Saved")) throw new Error(exportStatus);

  const wavBytes = await page.evaluate(async () => {
    const blob = globalThis.__lastExportBlob;
    if (!blob) return null;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  if (!wavBytes) throw new Error("export did not produce a blob");
  const wav = assertWav(wavBytes, "export");
  const wavPath = resolve(shotDir, "..", "forge-stem-mix.wav");
  writeFileSync(wavPath, Buffer.from(wavBytes));

  const report = {
    ok: true,
    hash,
    afterGain,
    rms,
    exportStatus,
    wav,
    shots,
    logs: logs.slice(-20),
  };
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  const failShot = resolve(shotDir, "stem-mixer-failure.png");
  await page.screenshot({ path: failShot, fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ ok: false, error: String(err), logs: logs.slice(-40), failShot }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
