// ─── Image type sniffing ──────────────────────────────────────────────────────
// Part 2 of the 2026-08-30 redesign. Pure, no I/O — the bytes decide.
//
// The multipart Content-Type and the filename both come from the client and are worth
// nothing. A file that claims image/png and starts "<html>" is not a PNG, and accepting
// it on the header's word is how a stored-XSS lands.

export type AcceptedImageType = "image/jpeg" | "image/png" | "image/webp";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Buffer, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * The image type these bytes actually are, or null.
 *
 * WebP needs both halves of its header: "RIFF" alone is also how a .wav begins, and the
 * format marker sits at offset 8.
 */
export function sniffImageType(bytes: Buffer): AcceptedImageType | null {
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";

  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}
