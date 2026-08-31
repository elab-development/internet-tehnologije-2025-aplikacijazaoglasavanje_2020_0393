import { NextResponse } from "next/server";

// ─── jsonOk ───────────────────────────────────────────────────────────────────

export function jsonOk<T>(data: T, status: 200 | 201 = 200): NextResponse {
  return NextResponse.json(data, { status });
}

// ─── jsonError ────────────────────────────────────────────────────────────────

export function jsonError(
  message: string,
  // 502 is for an upstream dependency failing (C2C-AI-5 AC6): the request was fine,
  // our provider was not. Distinct from 500, which means this service is at fault.
  // 413 is for a request body that exceeds a declared limit (image uploads).
  // 411 is for a request that never declared its size at all (Content-Length missing).
  status: 400 | 401 | 403 | 404 | 409 | 411 | 413 | 429 | 500 | 502 = 500,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json({ error: message, status }, { status, headers });
}
