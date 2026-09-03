import sharp from "sharp";

import { sniffImageType } from "@/lib/image-type";

export type ProcessedImage = {
  webp: Buffer;
  width: number;
  height: number;
};

export type ImageProcessingErrorKind = "not_an_image" | "undecodable";

export class ImageProcessingError extends Error {
  readonly kind: ImageProcessingErrorKind;

  constructor(
    message: string,
    kind: ImageProcessingErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ImageProcessingError";
    this.kind = kind;
  }
}

/**
 * Decode, normalise and re-encode an uploaded image to WebP.
 *
 * Re-encoding is the point, not a formatting nicety: it drops EXIF -- including the GPS
 * coordinates phone cameras attach -- and a decode-then-encode cycle cannot carry a
 * polyglot payload through (D10).
 *
 * The caller's size checks bound the *compressed* bytes only. Without a decode-side
 * bound, a 5 MB PNG or WebP can still be crafted to decode to ~200 megapixels -- sharp's
 * own default ceiling -- which allocates roughly 600 MB of raw pixels in this process.
 * `limitInputPixels` caps that; `resize` additionally caps what gets stored.
 */
export async function processUploadedImage(incoming: Buffer): Promise<ProcessedImage> {
  // The bytes decide, not the multipart Content-Type and not the filename.
  if (sniffImageType(incoming) === null) {
    throw new ImageProcessingError(
      "That file is not a JPEG, PNG or WebP image",
      "not_an_image",
    );
  }

  try {
    const output = await sharp(incoming, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 4000, height: 4000, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return { webp: output.data, width: output.info.width, height: output.info.height };
  } catch (err) {
    // Sniffed as an image but undecodable: truncated, crafted to look like one, or
    // rejected by limitInputPixels.
    throw new ImageProcessingError("That image could not be processed", "undecodable", {
      cause: err,
    });
  }
}
