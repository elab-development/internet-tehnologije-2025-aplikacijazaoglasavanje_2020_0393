import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageProcessingError, processUploadedImage } from "@/lib/image-pipeline";

// Real bytes, generated in-process: a fixture file would be one more thing to keep in
// sync with what the pipeline actually accepts.
async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
}

describe("processUploadedImage", () => {
  it("re-encodes to WebP and reports the stored dimensions", async () => {
    const result = await processUploadedImage(await png(800, 600));

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    // Re-encoding is the security property, not a nicety: it drops EXIF (including phone
    // GPS) and a decode-then-encode cycle cannot carry a polyglot payload through.
    expect((await sharp(result.webp).metadata()).format).toBe("webp");
  });

  it("resizes down to the 4000px bound without enlarging", async () => {
    const large = await processUploadedImage(await png(5000, 2500));
    expect(large.width).toBe(4000);
    expect(large.height).toBe(2000);

    const small = await processUploadedImage(await png(100, 50));
    expect(small.width).toBe(100);
  });

  it("rejects bytes that are not an image at all", async () => {
    await expect(processUploadedImage(Buffer.from("<html>nope</html>"))).rejects.toThrow(
      expect.objectContaining({ kind: "not_an_image" }),
    );
  });

  it("rejects bytes that sniff as an image but cannot be decoded", async () => {
    // A valid PNG magic number followed by rubbish: passes the sniff, fails the decode.
    const truncated = Buffer.concat([
      (await png(10, 10)).subarray(0, 16),
      Buffer.alloc(64, 0),
    ]);

    await expect(processUploadedImage(truncated)).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
  });
});
