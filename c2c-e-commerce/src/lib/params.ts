// ─── Route params ─────────────────────────────────────────────────────────────

/**
 * Parse a resource id from a dynamic route segment.
 *
 * Returns null for anything that is not a positive integer, so handlers can
 * answer 400 instead of running a guaranteed-empty query. Strict on purpose:
 * parseInt is prefix-tolerant ("7abc" -> 7), and every id in this schema is a
 * `serial`, so zero and negatives can never match a row.
 *
 * ```ts
 * const id = parseResourceId((await params).id);
 * if (id === null) return jsonError("Invalid listing id", 400);
 * ```
 */
export function parseResourceId(raw: string | undefined | null): number | null {
  if (!raw || !/^\d+$/.test(raw.trim())) return null;

  const id = Number(raw.trim());
  return id > 0 && Number.isSafeInteger(id) ? id : null;
}
