/**
 * Part 2 spec — deciding an upload's type from its bytes.
 *
 * The Content-Type header and the filename are both attacker-controlled. The first bytes
 * of the file are not, so they are what decides.
 */
import { describe, expect, it } from "vitest";

import { sniffImageType } from "./image-type";

/** Real signatures, padded so length checks cannot pass by accident. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.alloc(32),
]);

describe("sniffImageType", () => {
  it("recognises JPEG", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
  });

  it("recognises PNG", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
  });

  it("recognises WebP", () => {
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("rejects a RIFF container that is not WebP", () => {
    // A .wav starts RIFF too. Checking only the first four bytes would accept it.
    const wav = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE"),
      Buffer.alloc(32),
    ]);

    expect(sniffImageType(wav)).toBeNull();
  });

  it("rejects HTML that claims to be an image", () => {
    expect(sniffImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("rejects a GIF — not on the accepted list", () => {
    expect(sniffImageType(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32)]))).toBeNull();
  });

  it("rejects a buffer too short to carry any signature", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
