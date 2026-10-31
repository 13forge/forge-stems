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

/** 60 Hz sine + 1 kHz vibrato (±150 Hz at 5 Hz) + a click train. Mono 16-bit WAV. */
function splitMixWav(seconds = 3, sampleRate = 48_000) {
  const frames = Math.floor(sampleRate * seconds);
  const dataBytes = frames * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  const clickEvery = 512;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const bass = Math.sin(2 * Math.PI * 60 * t) * 0.35;
    const voice = Math.sin(2 * Math.PI * 1000 * t - 30 * Math.cos(2 * Math.PI * 5 * t)) * 0.25;
    const click = i % clickEvery < 6 ? 0.85 : 0;
    const sample = Math.max(-1, Math.min(1, bass + voice + click));
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buf;
}

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
  shots.push(resolve(shotDir, "empty-123-1280.png"));
  await page.screenshot({ path: shots[0], fullPage: true });

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

  await page.focus('.stem-fader[data-deck="2"][data-stem="0"]');
  const volumeBefore = Number(await page.$eval('.stem-fader[data-deck="2"][data-stem="0"]', (el) => el.value));
  await page.keyboard.press("ArrowLeft");
  const volumeAfter = Number(await page.$eval('.stem-fader[data-deck="2"][data-stem="0"]', (el) => el.value));
  if (!(volumeAfter < volumeBefore)) throw new Error(`keyboard did not lower deck C (${volumeBefore} -> ${volumeAfter})`);
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  if (!focused.includes("stem-fader")) throw new Error(`focus left the fader (${focused})`);

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
  await page.screenshot({ path: shots.at(-1), fullPage: true });

  await page.setViewport({ width: 1024, height: 800 });
  shots.push(resolve(shotDir, "stem-mixer-1024.png"));
  await page.screenshot({ path: shots.at(-1), fullPage: true });
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

  const studio = await page.evaluate(() => {
    return ["#remix-bpm", "#remix-key", "#remix-lufs"].map((sel) => {
      const el = document.querySelector(sel);
      const style = getComputedStyle(el);
      return {
        sel,
        width: Number.parseFloat(style.width),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    });
  });
  for (const field of studio) {
    if (field.display === "none" || field.visibility === "hidden" || field.opacity === "0") {
      throw new Error(`vocal studio input hidden: ${JSON.stringify(field)}`);
    }
    if (!(field.width >= 40)) throw new Error(`vocal studio input narrower than 40px: ${JSON.stringify(field)}`);
  }

  await page.click("#btn-play-all");
  await page.waitForFunction(
    () => document.querySelector("#btn-play-all")?.getAttribute("aria-pressed") === "false",
  );

  const loadNamed = async (deck, stem, freq, seconds, name) => {
    const before = await page.$eval("#status-msg", (el) => el.textContent);
    await page.evaluate(
      ({ deck, stem, bytes, name }) => {
        const input = document.querySelector(`.stem-file[data-deck="${deck}"][data-stem="${stem}"]`);
        const file = new File([new Uint8Array(bytes)], name, { type: "audio/wav" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { deck, stem, bytes: toneWav(freq, seconds), name },
    );
    await page.waitForFunction(
      (previous) => {
        const text = document.querySelector("#status-msg")?.textContent ?? "";
        return text !== previous && text.includes("loaded");
      },
      { timeout: 30_000 },
      before,
    );
  };

  const freqs = [200, 330, 510, 870];
  for (let stem = 0; stem < 4; stem++) {
    await loadNamed(2, stem, freqs[stem], 4, `stem-${stem}-${freqs[stem]}hz.wav`);
  }
  await page.click('.deck-play[data-deck="2"]');
  await page.waitForFunction(
    () => document.querySelector('.deck-play[data-deck="2"]')?.getAttribute("aria-pressed") === "true",
  );

  const capture = () =>
    page.evaluate(() => {
      const sample = window.__forgeCapture?.();
      if (!sample) return null;
      return {
        rms: sample.rms,
        peak: sample.peak,
        nan: sample.nan,
        time: Array.from(sample.time),
        rate: Number(document.documentElement.dataset.sampleRate || 48000),
      };
    });

  const goertzel = (time, freq, rate) => {
    const n = time.length;
    const k = Math.round((freq * n) / rate);
    const omega = (2 * Math.PI * k) / n;
    const coeff = 2 * Math.cos(omega);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      s0 = time[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / n;
  };

  await page.waitForFunction(
    () => {
      const sample = window.__forgeCapture?.();
      return Boolean(sample && sample.rms > 0.05);
    },
    { timeout: 8_000 },
  );
  const allOn = await capture();
  if (!allOn || !(allOn.rms > 0.05)) throw new Error(`four stems silent: ${allOn?.rms}`);

  for (let stem = 0; stem < 4; stem++) {
    await page.click(`[data-action="stem-mute"][data-deck="2"][data-stem="${stem}"]`);
  }
  await new Promise((r) => setTimeout(r, 250));
  const allMuted = await capture();
  if (!allMuted || !(allMuted.rms < 0.025) || !(allMuted.rms < allOn.rms * 0.1)) {
    throw new Error(`mute-all RMS ${allMuted?.rms} (full ${allOn.rms})`);
  }
  for (let stem = 0; stem < 4; stem++) {
    await page.click(`[data-action="stem-mute"][data-deck="2"][data-stem="${stem}"]`);
  }

  const solos = [];
  for (let stem = 0; stem < 4; stem++) {
    await page.click(`[data-action="stem-solo"][data-deck="2"][data-stem="${stem}"]`);
    await new Promise((r) => setTimeout(r, 200));
    const sample = await capture();
    if (!sample || sample.nan) throw new Error(`solo ${stem} NaN`);
    if (sample.peak > 1.001) throw new Error(`solo ${stem} clipped at ${sample.peak}`);
    const powers = freqs.map((freq) => goertzel(sample.time, freq, sample.rate));
    const peak = Math.max(...powers);
    solos.push({ stem, powers, rms: sample.rms });
    if (!(sample.rms > 0.001)) throw new Error(`solo ${stem} silent`);
    powers.forEach((power, index) => {
      if (index === stem) return;
      if (power > peak * 0.08) throw new Error(`solo ${stem} leaked freq ${freqs[index]} (${power} vs ${peak})`);
    });
    await page.click(`[data-action="stem-solo"][data-deck="2"][data-stem="${stem}"]`);
  }

  await page.click('[data-action="stem-solo"][data-deck="2"][data-stem="1"]');
  const gains = [];
  let previous = -1;
  for (const gain of [0, 2500, 5000, 10000, 12500]) {
    await page.$eval('.stem-fader[data-deck="2"][data-stem="1"]', (el, value) => {
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, gain);
    await new Promise((r) => setTimeout(r, 180));
    const sample = await capture();
    if (!sample) throw new Error("capture missing during gain sweep");
    gains.push(sample.rms);
    if (!(sample.rms + 0.0005 >= previous)) throw new Error(`gain ${gain} RMS ${sample.rms} after ${previous}`);
    previous = sample.rms;
  }
  await page.click('[data-action="stem-solo"][data-deck="2"][data-stem="1"]');
  await page.$eval('.stem-fader[data-deck="2"][data-stem="1"]', (el) => {
    el.value = "10000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const readPos = () => page.$eval("[data-song-card='2']", (el) => Number(el.dataset.playhead || 0));
  await page.click('.deck-play[data-deck="2"]');
  await new Promise((r) => setTimeout(r, 250));
  const paused = await capture();
  const heldA = await readPos();
  await new Promise((r) => setTimeout(r, 350));
  const heldB = await readPos();
  if (!paused || paused.rms > 0.025) throw new Error(`pause RMS ${paused?.rms}`);
  if (Math.abs(heldB - heldA) > 2_048) throw new Error(`pause moved playhead ${heldA} -> ${heldB}`);
  await page.click('.deck-play[data-deck="2"]');
  await new Promise((r) => setTimeout(r, 400));
  const posResumed = await readPos();
  if (!(posResumed > heldB + 200)) throw new Error(`playhead did not continue ${heldB} -> ${posResumed}`);

  await page.click('[data-action="repeat-toggle"][data-deck="2"]');
  const repeat = await page.$eval('[data-action="repeat-toggle"][data-deck="2"]', (el) => ({
    pressed: el.getAttribute("aria-pressed"),
    text: el.textContent,
  }));
  if (repeat.pressed !== "true") throw new Error("repeat did not press");
  if (!repeat.text?.includes("4 beats")) throw new Error(`repeat label ${repeat.text}`);
  const region = await page.$eval("[data-song-card='2']", (el) => ({
    start: Number(el.dataset.loopStart),
    end: Number(el.dataset.loopEnd),
  }));
  if (!(region.end > region.start)) throw new Error(`empty loop ${region.start} ${region.end}`);
  let previousPos = await readPos();
  let wrapped = false;
  const wrapDeadline = Date.now() + 8_000;
  while (Date.now() < wrapDeadline) {
    await new Promise((r) => setTimeout(r, 100));
    const pos = await readPos();
    if (pos < previousPos - 1_000 && pos >= region.start - 2_048 && pos < region.end) {
      wrapped = true;
      break;
    }
    previousPos = pos;
  }
  if (!wrapped) throw new Error(`playhead did not wrap inside ${region.start}..${region.end}, last ${previousPos}`);
  shots.push(resolve(shotDir, "loop-active-1280.png"));
  await page.screenshot({ path: shots.at(-1), fullPage: true });

  if ((await page.$eval('[data-action="repeat-toggle"][data-deck="2"]', (el) => el.getAttribute("aria-pressed"))) === "true") {
    await page.click('[data-action="repeat-toggle"][data-deck="2"]');
  }
  await loadNamed(2, 0, 220, 8, "pace-8s.wav");
  if ((await page.$eval('.deck-play[data-deck="2"]', (el) => el.getAttribute("aria-pressed"))) !== "true") {
    await page.click('.deck-play[data-deck="2"]');
  }
  const rateOf = async () => {
    const a = await readPos();
    await new Promise((r) => setTimeout(r, 400));
    const b = await readPos();
    return b - a;
  };
  await page.$eval('[data-slider="pace"][data-deck="2"]', (el) => {
    el.value = "500";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const unity = await rateOf();
  await page.$eval('[data-slider="pace"][data-deck="2"]', (el) => {
    el.value = "1000";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const fast = await rateOf();
  const tempo = await page.$eval("[data-song-card='2']", (el) => el.dataset.tempoPmy);
  if (tempo !== "20000") throw new Error(`tempo pmy ${tempo}`);
  if (!(fast > unity * 1.4)) throw new Error(`pace did not speed up (${unity} -> ${fast} frames)`);
  await page.click('[data-action="keylock"][data-deck="2"]');
  const locked = await page.$eval('[data-action="keylock"][data-deck="2"]', (el) => el.getAttribute("aria-pressed"));
  if (locked !== "true") throw new Error("keylock did not latch");

  const dry = await capture();
  const fxDeltas = {};
  for (const name of ["filter", "echo", "reverb"]) {
    await page.click(`[data-fx="${name}"]`);
    await new Promise((r) => setTimeout(r, 350));
    const wet = await capture();
    if (!wet || wet.nan) throw new Error(`${name} produced NaN`);
    if (wet.peak > 1.001) throw new Error(`${name} clipped at ${wet.peak}`);
    const delta = Math.abs(wet.rms - dry.rms);
    fxDeltas[name] = delta;
    if (!(delta > 0.002)) throw new Error(`${name} did not change the mix (rms ${dry.rms} -> ${wet.rms})`);
    await page.click(`[data-fx="${name}"]`);
    await new Promise((r) => setTimeout(r, 200));
  }
  await page.evaluate(() => {
    const button = document.querySelector('[data-fx="buildup"]');
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 280));
  const buildup = await capture();
  await page.evaluate(() => {
    document.querySelector('[data-fx="buildup"]').dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  if (!buildup || buildup.nan || buildup.peak > 1.001) throw new Error("build-up invalid");
  if (!(Math.abs(buildup.rms - dry.rms) > 0.002)) throw new Error(`build-up did not change RMS ${dry.rms} -> ${buildup.rms}`);

  if ((await page.$eval("#btn-play-all", (el) => el.getAttribute("aria-pressed"))) === "true") {
    await page.click("#btn-play-all");
  }

  const splitBytes = [...splitMixWav(3)];
  await page.evaluate(async (bytes) => {
    const raw = new Uint8Array(bytes.length);
    const step = 16_384;
    for (let i = 0; i < bytes.length; i += step) {
      raw.set(bytes.subarray ? bytes.subarray(i, i + step) : bytes.slice(i, i + step), i);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    window.__splitFile = new File([raw], "split-mix.wav", { type: "audio/wav" });
  }, splitBytes);
  await page.evaluate(() => {
    window.__sawSplitPill = false;
    window.__longTasks = [];
    window.__splitWatch = setInterval(() => {
      const badge = document.querySelector('[data-split-badge][data-deck="3"]');
      if (badge && !badge.hidden && (badge.textContent ?? "").includes("Splitting 4 stems")) {
        window.__sawSplitPill = true;
      }
    }, 5);
    try {
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({ duration: entry.duration, start: entry.startTime });
        }
      });
      obs.observe({ type: "longtask", buffered: false });
      window.__longObs = obs;
    } catch (err) {
      window.__longTasks = null;
      window.__longTaskError = String(err);
    }
  });
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(window.__splitFile);
    const zone = document.querySelector('.song-drop[data-deck="3"]');
    zone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    zone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(() => document.querySelector('.song-drop[data-deck="3"]')?.classList.contains("is-hot"));
  const dropText = await page.$eval('.song-drop[data-deck="3"] .drop-hint', (el) => el.textContent);
  if (!dropText?.includes("Drop to load")) throw new Error(`drop hint ${dropText}`);
  shots.push(resolve(shotDir, "drag-over-1280.png"));
  await page.screenshot({ path: shots.at(-1), fullPage: true });
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(window.__splitFile);
    const zone = document.querySelector('.song-drop[data-deck="3"]');
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(
    () => (document.querySelector("#status-msg")?.textContent ?? "").includes("split into"),
    { timeout: 60_000 },
  );
  const splitWatch = await page.evaluate(() => {
    clearInterval(window.__splitWatch);
    window.__longObs?.disconnect();
    const names = [...document.querySelectorAll('[data-song-card="3"] .stem-file-name')].map((el) => el.textContent);
    return {
      sawPill: window.__sawSplitPill === true,
      longTasks: window.__longTasks,
      longTaskError: window.__longTaskError ?? null,
      names,
      splitMs: Number(document.querySelector("[data-song-card='3']")?.dataset.splitMs || 0),
    };
  });
  if (!splitWatch.sawPill) throw new Error("Splitting 4 stems pill was not shown");
  if (splitWatch.longTasks === null) throw new Error(`longtask observer failed: ${splitWatch.longTaskError}`);
  const workerWindow = await page.evaluate(() => ({
    start: Number(document.documentElement.dataset.workerStart || 0),
    end: Number(document.documentElement.dataset.workerEnd || 0),
  }));
  const duringSplit = (splitWatch.longTasks ?? []).filter(
    (task) => task.start >= workerWindow.start && task.start <= workerWindow.end,
  );
  const longTaskMax = duringSplit.reduce((max, task) => Math.max(max, task.duration), 0);
  if (longTaskMax >= 50) throw new Error(`main thread blocked during split (${longTaskMax.toFixed(1)} ms)`);
  if (splitWatch.names.some((name) => !name || name.includes("Drop a part"))) {
    throw new Error(`stem slots not filled: ${splitWatch.names.join(" | ")}`);
  }

  await page.evaluate(() => document.querySelector("[data-song-card='3']")?.scrollIntoView({ block: "start" }));
  shots.push(resolve(shotDir, "auto-split-1280.png"));
  await page.screenshot({ path: shots.at(-1) });

  await page.click('.deck-play[data-deck="3"]');
  await page.waitForFunction(() => {
    const sample = window.__forgeCapture?.();
    return Boolean(sample && sample.rms > 0.02);
  });
  const splitAll = await capture();
  if (!splitAll || splitAll.nan || splitAll.peak > 1.001) throw new Error("split mix capture invalid");
  const hz60 = goertzel(splitAll.time, 60, splitAll.rate);
  await page.click('[data-action="stem-mute"][data-deck="3"][data-stem="1"]');
  await new Promise((r) => setTimeout(r, 220));
  const bassMuted = await capture();
  const hz60Muted = goertzel(bassMuted.time, 60, bassMuted.rate);
  if (!(hz60Muted < hz60 * 0.35)) throw new Error(`mute bass left 60 Hz ${hz60Muted} of ${hz60}`);
  await page.click('[data-action="stem-mute"][data-deck="3"][data-stem="1"]');

  const splitSolos = [];
  for (let stem = 0; stem < 4; stem++) {
    await page.click(`[data-action="stem-solo"][data-deck="3"][data-stem="${stem}"]`);
    await new Promise((r) => setTimeout(r, 220));
    const sample = await capture();
    if (!sample || sample.nan || sample.peak > 1.001) throw new Error(`split solo ${stem} invalid`);
    if (!(sample.rms > 0.012)) throw new Error(`stem ${stem} silent after split (rms ${sample.rms})`);
    if (!(Math.abs(sample.rms - splitAll.rms) > 0.004)) {
      throw new Error(`Only This on stem ${stem} did not change the mix (${sample.rms} vs ${splitAll.rms})`);
    }
    splitSolos.push(sample.rms);
    await page.click(`[data-action="stem-solo"][data-deck="3"][data-stem="${stem}"]`);
  }

  await page.evaluate(async () => {
    const sampleRate = 48_000;
    const frames = sampleRate * 180;
    const pcm = new Float32Array(frames);
    const step = sampleRate;
    for (let start = 0; start < frames; start += step) {
      const end = Math.min(frames, start + step);
      for (let i = start; i < end; i++) {
        const t = i / sampleRate;
        const bass = Math.sin(2 * Math.PI * 60 * t) * 0.2;
        const click = i % 512 < 4 ? 0.4 : 0;
        pcm[i] = bass + click;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const dataBytes = frames * 2;
    const bytes = new Uint8Array(44 + dataBytes);
    const view = new DataView(bytes.buffer);
    const ascii = (offset, text) => {
      for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
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
      const sample = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
    }
    window.__longFile = new File([bytes], "three-minutes.wav", { type: "audio/wav" });
    window.__longTasks = [];
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({ duration: entry.duration, start: entry.startTime });
      }
    });
    obs.observe({ type: "longtask", buffered: false });
    window.__longObs = obs;
  });
  const longStarted = Date.now();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(window.__longFile);
    const zone = document.querySelector('.song-drop[data-deck="3"]');
    zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(
    (previous) => {
      const card = document.querySelector("[data-song-card='3']");
      const badge = document.querySelector('[data-split-badge][data-deck="3"]');
      const ms = Number(card?.dataset.splitMs || 0);
      return badge?.hidden === true && ms > previous;
    },
    { timeout: 180_000 },
    splitWatch.splitMs,
  );
  const threeMinute = await page.evaluate(() => {
    window.__longObs?.disconnect();
    return {
      wallMs: 0,
      splitMs: Number(document.querySelector("[data-song-card='3']")?.dataset.splitMs || 0),
      longTasks: window.__longTasks,
      workerStart: Number(document.documentElement.dataset.workerStart || 0),
      workerEnd: Number(document.documentElement.dataset.workerEnd || 0),
    };
  });
  threeMinute.wallMs = Date.now() - longStarted;
  const threeMinuteDuring = (threeMinute.longTasks ?? []).filter(
    (task) => task.start >= threeMinute.workerStart && task.start <= threeMinute.workerEnd,
  );
  const threeMinuteLongMax = threeMinuteDuring.reduce((max, task) => Math.max(max, task.duration), 0);
  if (threeMinuteLongMax >= 50) {
    const offenders = threeMinuteDuring.map((task) => `${task.duration.toFixed(0)}@${task.start.toFixed(0)}`).join(", ");
    throw new Error(
      `3-minute split blocked the main thread (${threeMinuteLongMax.toFixed(1)} ms) window ${threeMinute.workerStart.toFixed(0)}-${threeMinute.workerEnd.toFixed(0)} [${offenders}]`,
    );
  }

  await page.click('[data-action="toggle-pro"][data-deck="0"]');
  shots.push(resolve(shotDir, "more-controls-1280.png"));
  await page.screenshot({ path: shots.at(-1), fullPage: true });

  const report = {
    ok: true,
    hash,
    afterGain,
    rms,
    exportStatus,
    wav,
    studio,
    solos: solos.map((row) => row.rms),
    gains,
    fxDeltas,
    split: {
      sawPill: splitWatch.sawPill,
      splitMs: splitWatch.splitMs,
      longTaskMax,
      solos: splitSolos,
      hz60,
      hz60Muted,
    },
    threeMinute: {
      wallMs: threeMinute.wallMs,
      splitMs: threeMinute.splitMs,
      longTaskMax: threeMinuteLongMax,
    },
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
