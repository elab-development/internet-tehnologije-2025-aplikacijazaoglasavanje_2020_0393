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

/**
 * Parse a bounded integer from a query parameter.
 *
 * Strict for the same reason `parseResourceId` is: the `parseInt(raw, 10) || fallback`
 * idiom this replaces is prefix-tolerant, so "7abc" became 7, and `|| fallback` also
 * swallows a legitimate 0. Four call sites had grown their own copy of that idiom, two
 * of them byte-identical including a comment warning against it.
 */
export function parseBoundedInt(
  raw: string | null | undefined,
  { fallback, min = 1, max }: { fallback: number; min?: number; max: number },
): number {
  if (raw === null || raw === undefined) return fallback;

  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return fallback;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return fallback;

  return Math.min(max, Math.max(min, value));
}
