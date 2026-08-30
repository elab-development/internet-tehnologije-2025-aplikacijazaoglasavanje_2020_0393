// ─── Object storage ───────────────────────────────────────────────────────────
// Part 2 of the 2026-08-30 redesign. One interface, two implementations, selected by
// environment — the same seam as src/lib/ai/llm.ts, and for the same reason: the local
// driver is what runs, the memory driver is what makes the suite fast and hermetic, and
// an S3 driver later is a drop-in with no call-site changes.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type PutOptions = {
  contentType: string;
  /** Directory-ish namespace, e.g. `listings/42`. Server-generated. */
  prefix: string;
};

export type StoredObject = { key: string; contentType: string; byteSize: number };
export type StoredBytes = { bytes: Buffer; contentType: string };

export type StorageErrorKind = "not_found" | "invalid_key" | "io";

export class StorageError extends Error {
  readonly kind: StorageErrorKind;

  constructor(message: string, kind: StorageErrorKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StorageError";
    this.kind = kind;
  }
}

export interface StorageProvider {
  put(bytes: Buffer, opts: PutOptions): Promise<StoredObject>;
  get(key: string): Promise<StoredBytes | null>;
  delete(key: string): Promise<void>;
}

/**
 * A fresh key under `prefix`.
 *
 * 16 random bytes, hex. The client's filename never appears: it is attacker-controlled
 * text that would otherwise reach a path join, and it carries no information the row
 * does not already hold.
 */
export function storageKey(prefix: string, extension: string): string {
  return `${prefix}/${randomBytes(16).toString("hex")}.${extension}`;
}

/**
 * Whether a key is one this module could have generated.
 *
 * Deliberately a whitelist. Every driver validates before touching its backing store, so
 * a key that reached the database through some future bug still cannot escape the root.
 */
export function isValidStorageKey(key: string): boolean {
  return /^[a-z0-9]+(?:\/[a-z0-9-]+)*\/[0-9a-f]{32}\.[a-z0-9]+$/.test(key);
}

// ─── Local disk ───────────────────────────────────────────────────────────────

export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) {
      throw new StorageError(`Refusing to touch an invalid key`, "invalid_key");
    }
    return path.join(this.root, key);
  }

  async put(bytes: Buffer, opts: PutOptions): Promise<StoredObject> {
    const key = storageKey(opts.prefix, extensionFor(opts.contentType));
    const full = this.resolve(key);

    try {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, bytes);
    } catch (err) {
      throw new StorageError("Could not write object", "io", { cause: err });
    }

    return { key, contentType: opts.contentType, byteSize: bytes.byteLength };
  }

  async get(key: string): Promise<StoredBytes | null> {
    const full = this.resolve(key);

    try {
      const bytes = await readFile(full);
      return { bytes, contentType: contentTypeFor(key) };
    } catch (err) {
      // A missing object is an ordinary answer, not a failure: the row may have been
      // deleted between the lookup and the read.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new StorageError("Could not read object", "io", { cause: err });
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);

    try {
      await unlink(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new StorageError("Could not delete object", "io", { cause: err });
    }
  }
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export class MemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, StoredBytes>();

  async put(bytes: Buffer, opts: PutOptions): Promise<StoredObject> {
    const key = storageKey(opts.prefix, extensionFor(opts.contentType));
    if (!isValidStorageKey(key)) {
      throw new StorageError("Generated an invalid key", "invalid_key");
    }
    this.objects.set(key, { bytes, contentType: opts.contentType });
    return { key, contentType: opts.contentType, byteSize: bytes.byteLength };
  }

  async get(key: string): Promise<StoredBytes | null> {
    if (!isValidStorageKey(key)) {
      throw new StorageError("Refusing to read an invalid key", "invalid_key");
    }
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    if (!isValidStorageKey(key)) {
      throw new StorageError("Refusing to delete an invalid key", "invalid_key");
    }
    this.objects.delete(key);
  }
}

// ─── Selection ────────────────────────────────────────────────────────────────

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

function extensionFor(contentType: string): string {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new StorageError(`Unsupported content type`, "invalid_key");
  return ext;
}

function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  const found = Object.entries(EXTENSIONS).find(([, value]) => value === ext);
  return found?.[0] ?? "application/octet-stream";
}

let provider: StorageProvider | null = null;

/**
 * The configured provider.
 *
 * `STORAGE_DRIVER` defaults to `memory` under NODE_ENV=test and `local` otherwise, so a
 * test that forgets to configure storage cannot silently write to a real directory.
 */
export function getStorageProvider(): StorageProvider {
  if (provider) return provider;

  const driver =
    process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "test" ? "memory" : "local");

  if (driver === "memory") {
    provider = new MemoryStorageProvider();
  } else if (driver === "local") {
    const dir = process.env.STORAGE_DIR;
    if (!dir) throw new StorageError("STORAGE_DIR is required for the local driver", "io");
    provider = new LocalStorageProvider(dir);
  } else {
    throw new StorageError(`Unknown STORAGE_DRIVER: ${driver}`, "io");
  }

  return provider;
}

/** Test seam: drops the memoised provider so one test's driver cannot leak into the next. */
export function __resetStorageProvider(): void {
  provider = null;
}
