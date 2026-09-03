/**
 * WCAG 1.4.3 contrast, computed rather than asserted from memory.
 *
 * The review quoted v3 hex ratios; this project is Tailwind v4, whose zinc scale is
 * defined in oklch. The sRGB values below are not guessed — they were derived by:
 *
 *  1. Reading the oklch definitions Tailwind v4.2.1 actually ships, straight from
 *     `node_modules/tailwindcss/theme.css`:
 *       --color-zinc-300: oklch(87.1% 0.006 286.286)
 *       --color-zinc-400: oklch(70.5% 0.015 286.067)
 *       --color-zinc-500: oklch(55.2% 0.016 285.938)
 *       --color-zinc-600: oklch(44.2% 0.017 285.786)
 *  2. Confirming those are exactly what `@tailwindcss/postcss` emits for this project by
 *     compiling a throwaway stylesheet (`@import "tailwindcss"; .p{ @apply text-zinc-400 }`)
 *     through the installed plugin — the generated `.text-zinc-400 { color: var(--color-zinc-400) }`
 *     resolves to the same oklch triples as the theme file, so v4 does not remap them
 *     per-project.
 *  3. Converting each oklch triple to sRGB by hand, using the standard OKLab -> linear
 *     sRGB matrices from the CSS Color Module 4 spec (the same ones colorjs.io and
 *     browsers use), then sRGB gamma-encoding and rounding to a byte per channel. No
 *     colour library was added to do this — see `oklchToSrgb` below.
 *
 * This keeps the shade decision anchored to what the browser will actually paint,
 * not to the v3 hex figures the original finding quoted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** oklch(L C H) -> sRGB hex, per CSS Color Module 4 (Björn Ottosson's OKLab). */
function oklchToSrgbHex(L: number, C: number, Hdeg: number): string {
  const hRad = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const gammaEncode = (c: number) => {
    const clamped = Math.min(1, Math.max(0, c));
    return clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };
  const toByte = (c: number) =>
    Math.round(Math.min(1, Math.max(0, gammaEncode(c))) * 255);

  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(toByte(rLin))}${hex(toByte(gLin))}${hex(toByte(bLin))}`;
}

/** sRGB hex -> relative luminance, per WCAG 2.1 definition. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

// Read from globals.css rather than duplicated here: zinc-500 clears this background by
// only 0.085, so a change to --background could push the real page under 4.5:1 while a
// hardcoded copy kept this test green.
const PAGE = (() => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const match = css.match(/--background:\s*(#[0-9a-fA-F]{3,8})\s*;/);
  if (!match) throw new Error("could not read --background from globals.css");
  return match[1];
})();
const WHITE = "#ffffff";

// Tailwind v4.2.1's zinc oklch triples (from theme.css, confirmed by compiling the
// project's own postcss pipeline), converted to sRGB via oklchToSrgbHex above.
const ZINC = {
  300: oklchToSrgbHex(0.871, 0.006, 286.286),
  400: oklchToSrgbHex(0.705, 0.015, 286.067),
  500: oklchToSrgbHex(0.552, 0.016, 285.938),
  600: oklchToSrgbHex(0.442, 0.017, 285.786),
} as const;

describe("the muted text shade clears WCAG AA", () => {
  it("measures the actual v4 sRGB values, not the v3 hex figures", () => {
    // v3's hardcoded hex was zinc-400 #a1a1aa / zinc-500 #71717a / zinc-600 #52525b.
    // v4's oklch-derived values are close but not identical.
    expect(ZINC[300]).toBe("#d4d4d8");
    expect(ZINC[400]).toBe("#9f9fa9");
    expect(ZINC[500]).toBe("#71717b");
    expect(ZINC[600]).toBe("#52525c");
  });

  it("names a shade that passes on both surfaces", () => {
    // MUTED_TEXT is text-zinc-500, used at every fixed site in Step 3.
    expect(contrastRatio(ZINC[500], WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ZINC[500], PAGE)).toBeGreaterThanOrEqual(4.5);
  });

  it("records why the previous shades were wrong", () => {
    expect(contrastRatio(ZINC[400], WHITE)).toBeLessThan(4.5);
    expect(contrastRatio(ZINC[300], WHITE)).toBeLessThan(4.5);
  });

  it("records that zinc-600, not zinc-500, would have been needed had 500 failed", () => {
    // zinc-500 does clear 4.5:1 here (measured below), so zinc-600 is not the chosen
    // shade — but it comfortably clears both surfaces too, confirming the fallback
    // the brief described would have worked if 500 had come up short.
    expect(contrastRatio(ZINC[600], WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ZINC[600], PAGE)).toBeGreaterThanOrEqual(4.5);
  });
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("the failing shades do not come back", () => {
  it("uses text-zinc-400 and text-zinc-300 only where a comment justifies it", () => {
    const offenders: string[] = [];

    for (const file of tsxFiles("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!/text-zinc-[34]00|placeholder:text-zinc-[34]00/.test(line)) return;
        // An exemption is a comment within the three lines above the usage saying
        // "contrast-exempt" and why.
        const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
        if (!/contrast-exempt/.test(context)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
