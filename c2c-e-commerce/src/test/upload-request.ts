/**
 * Task 9 fix round 1 — shared multipart-upload request builder.
 *
 * `route.integration.test.ts` and `concurrency.integration.test.ts` both need to POST a
 * real multipart body against `POST /api/listings/[id]/images`, and both need it to carry
 * a genuine `Content-Length`: a `NextRequest` built in-process from a `FormData` body
 * never gets one (a real client's `fetch()` computes it while serialising the body just
 * before sending; constructing the request object directly skips that step entirely).
 * The route's size gate now requires the header, so encoding it here -- once, via the
 * same multipart encoder (`Response`) a browser applies invisibly -- is what keeps every
 * upload test able to reach the success path at all, rather than each caller
 * rediscovering (or worse, half-discovering) this on its own.
 */
import { NextRequest } from "next/server";

export type UploadRequestOptions = {
  filename?: string;
  /** Merged in last, so a caller can override anything above, e.g. `x-forwarded-for`. */
  headers?: Record<string, string>;
};

export async function uploadRequest(
  listingId: number,
  token: string,
  file: Blob,
  options: UploadRequestOptions = {},
): Promise<NextRequest> {
  const { filename = "photo.png", headers = {} } = options;

  const form = new FormData();
  form.set("file", file, filename);

  const encoded = new Response(form);
  const bytes = await encoded.arrayBuffer();
  const contentType = encoded.headers.get("content-type") ?? "multipart/form-data";

  return new NextRequest(`http://localhost/api/listings/${listingId}/images`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      ...headers,
    },
    body: bytes,
  });
}
