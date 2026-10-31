import { describe, expect, it } from "vitest";
import { RemixController } from "../src/state/controller.js";
import { decodeMixFragment, encodeMixFragment } from "../src/state/share.js";

describe("share link fragment", () => {
  it("round-trips mix settings and refuses anything that is not the 55-byte word", () => {
    const ctrl = new RemixController();
    ctrl.setStemGain(2, 3, 8_000);
    ctrl.toggleStemSolo(1, 0);
    ctrl.toggleStemMute(1, 2);
    ctrl.setDeckVolume(3, 2_500);
    ctrl.toggleDeckPlaying(2);
    ctrl.setCrossfader(1_250);
    ctrl.decks[0].stemNames[0] = "secret-session-take.wav";
    ctrl.decks[0].stems[0] = new Float32Array([0.1, 0.2, 0.3]);

    const fragment = encodeMixFragment(ctrl.toMixSettings());
    expect(fragment.startsWith("#m1.")).toBe(true);
    expect(fragment).toMatch(/^#m1\.[A-Za-z0-9_-]+$/);
    expect(fragment.length).toBeLessThan(120);
    expect(fragment).not.toContain("secret-session-take");
    expect(fragment).not.toContain("0.1");

    expect(decodeMixFragment(fragment)).toEqual(ctrl.toMixSettings());
    expect(decodeMixFragment("")).toBeNull();
    expect(decodeMixFragment("#m1.%%%%")).toBeNull();
    expect(decodeMixFragment("#nope")).toBeNull();
    expect(decodeMixFragment("#m1." + "A".repeat(80))).toBeNull();
  });

  it("refuses a flipped version byte instead of guessing", () => {
    const fragment = encodeMixFragment(new RemixController().toMixSettings());
    const body = fragment.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
    bytes[0] = 2;
    let bin = "";
    for (const byte of bytes) bin += String.fromCharCode(byte);
    const broken = `#m1.${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    expect(decodeMixFragment(broken)).toBeNull();
  });
});
