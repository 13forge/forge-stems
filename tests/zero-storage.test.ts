import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shellRoot = fileURLToPath(new URL("../", import.meta.url));

const FORBIDDEN = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "mozIndexedDB",
  "webkitIndexedDB",
  "document.cookie",
  "caches.open",
  "caches.match",
  "serviceWorker",
  "CacheStorage",
  "openDatabase",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|css|html)$/.test(name)) out.push(path);
  }
  return out;
}

describe("zero storage", () => {
  it("does not touch browser storage, cookies, or service workers", () => {
    const files = [...sourceFiles(join(shellRoot, "src")), join(shellRoot, "index.html")];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const token of FORBIDDEN) {
        if (text.includes(token)) hits.push(`${file} contains ${token}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
