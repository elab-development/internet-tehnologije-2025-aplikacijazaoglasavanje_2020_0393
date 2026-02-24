import { NextResponse } from "next/server";

// ─── jsonOk ───────────────────────────────────────────────────────────────────

export function jsonOk<T>(data: T, status: 200 | 201 = 200): NextResponse {
  return NextResponse.json(data, { status });
}

// ─── jsonError ────────────────────────────────────────────────────────────────

export function jsonError(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 = 500
): NextResponse {
  return NextResponse.json({ error: message, status }, { status });
}
