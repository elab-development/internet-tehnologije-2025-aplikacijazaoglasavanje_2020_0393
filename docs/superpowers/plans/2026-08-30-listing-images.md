# Listing Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text image URLs with real uploaded photos, stored behind a swappable provider, re-encoded to strip EXIF, and served same-origin.

**Architecture:** A `StorageProvider` interface with a local-disk driver and an in-memory driver, selected by environment — the same seam as `src/lib/ai/llm.ts`. A `listing_images` table replaces `listings.image_url`; keys are server-generated and the client's filename never reaches disk. Uploads are validated by magic bytes and re-encoded to WebP with `sharp`, which strips EXIF as a side effect. Listings gain a `draft` status so the form can create → upload → publish without a staging area.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM, PostgreSQL, Zod, `sharp`, Vitest (projects: `unit`, `integration`, `component`), Testing Library, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-30-listings-orders-reviews-categories-design.md` (Part 2, §4; decisions D8, D9, D10)

## Global Constraints

- **`listings.image_url` is dropped outright** (D9). Existing rows lose their images — a migration cannot fetch remote URLs. `seed.ts` ships real sample files through the storage provider so seeded data and real uploads take exactly one code path.
- **The drop happens in a SECOND migration, after every consumer is migrated.** Fifteen production files read `imageUrl` today. Dropping it in the additive migration would leave the tree broken between tasks — the defect that cost this project a fix round in Part 1.
- **Keys are generated server-side** as `listings/<id>/<random>.webp` and validated against a strict pattern before any path is joined. The client's filename never reaches disk.
- **Type is decided by magic bytes** — never the `Content-Type` header, never the extension. Accepted input: JPEG, PNG, WebP. Everything is re-encoded to WebP.
- **Limits: at most 8 images per listing, 5 MB each.**
- **Owner-or-admin** on every image mutation, via `canMutateListing` from `src/lib/authorization.ts`. Rate-limited through the existing limiter.
- **Drafts are excluded** from browse, search, similar-listings and recommendations.
- `STORAGE_DRIVER` and `STORAGE_DIR` must be forwarded **explicitly in every compose file**. Compose only passes variables it names; the OAuth variables are missing from all of them today and this is the same trap.
- `sharp` is a native binary — expect the `serverExternalPackages` lever `@huggingface/transformers` already needed.
- **`storage_key` is never sent to a client.** It is an internal address; the public handle for an image is its row id, and `/api/images/{id}` is the only way to reach the bytes. Every route projects a summary, never a raw `ListingImage` row.
- **Run commands from `c2c-e-commerce/`**; paths beginning `docs/`, `docker-compose*` or `.gitattributes` are relative to the repo root.

## Deliberate deviations from the spec

Both are recorded here so a reviewer judges them rather than reporting them as drift.

1. **`StorageProvider.get` returns `{ bytes: Buffer }`, not `{ stream: ReadableStream }`** as §4.1 writes it. Uploads are capped at 5 MB, the re-encoder needs the whole buffer in memory anyway, and a Buffer makes the contract suite trivially comparable across drivers. A stream would buy nothing at this size and complicate both drivers.
2. **`listings.image_url` is dropped in a second migration (0013), not alongside the new table.** §4.2 describes the end state; it does not say how many migrations reach it. See Global Constraints for why one migration would break the tree mid-plan.

---

## File Structure

**Create:**

| File | Responsibility |
|------|----------------|
| `.gitattributes` (repo root) | Normalise text to LF; mark image/binary types binary |
| `src/lib/storage.ts` | `StorageProvider` interface, `StorageError`, key generation and validation, driver selection |
| `src/lib/storage.test.ts` | Unit tests for key generation/validation and driver selection |
| `src/lib/storage-contract.test.ts` | One suite run against **both** drivers |
| `src/lib/image-type.ts` | Magic-byte sniffing, pure, no I/O |
| `src/lib/image-type.test.ts` | Its tests, including a polyglot |
| `src/db/listing-images.ts` | DB helpers: list, count, insert, delete, reorder |
| `drizzle/0012_listing_images.sql` | Additive: `listing_images` table, `draft` status |
| `drizzle/0013_drop_listing_image_url.sql` | Destructive: drops `listings.image_url` |
| `src/app/api/listings/[id]/images/route.ts` | `POST` upload, `PATCH` reorder |
| `src/app/api/listings/[id]/images/[imageId]/route.ts` | `DELETE` one image |
| `src/app/api/images/[id]/route.ts` | `GET` serve bytes |
| `src/components/listings/ImageUploader.tsx` | File input, previews, remove, reorder |
| `src/db/seed-assets/*.jpg` | Six small sample photos shipped in the repo |

**Modify:** `src/db/schema/listings.ts`, `src/db/schema/index.ts`, `src/lib/listings-query.ts`, `src/lib/validation.ts`, `src/app/api/listings/route.ts`, `src/app/api/listings/[id]/route.ts`, `src/app/api/listings/[id]/similar/route.ts`, `src/app/api/orders/seller/route.ts`, `src/app/api/recommendations/route.ts`, `src/components/listings/ListingForm.tsx`, `src/components/listings/SimilarListings.tsx`, `src/components/RecommendedForYou.tsx`, `src/components/seller/SellerListingCard.tsx`, `src/app/(frontend)/listings/page.tsx`, `src/app/(frontend)/listings/[id]/page.tsx`, `src/test/factories.ts`, `src/db/seed.ts`, `next.config.ts`, `scripts/generate-swagger.mjs`, `package.json`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `README.md`

**Delete:** `src/lib/swagger.ts` (dead code — nothing imports it; `scripts/generate-swagger.mjs` carries the definition that actually serves `/api/docs`)

---

### Task 1: Housekeeping precursor

Two pre-existing defects that this feature would otherwise make worse. `src/lib/swagger.ts` is dead code carrying a duplicate `swaggerDefinition` that has already drifted from the generator's copy; Part 2 adds a `ListingImage` schema and would have to be written into both. And this repo has no `.gitattributes`, so a fresh Windows clone gets CRLF — which already breaks `src/test/threat-model.test.ts` — and Part 2 ships binary sample images that must not be text-normalised.

**Files:**
- Create: `.gitattributes` (repo root)
- Delete: `c2c-e-commerce/src/lib/swagger.ts`
- Test: `c2c-e-commerce/src/test/threat-model.test.ts` (verify only; no edit expected)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `scripts/generate-swagger.mjs` is the single swagger definition, and where text files are LF in every checkout.

- [ ] **Step 1: Confirm `src/lib/swagger.ts` is genuinely unreferenced**

Run from `c2c-e-commerce/`:

```bash
grep -rn "lib/swagger\"" src scripts
grep -rn "from \"@/lib/swagger\"" src scripts
```

Expected: no matches (only `swagger-spec.json` has importers). If anything matches, STOP and report — the file is not dead and this task's premise is wrong.

- [ ] **Step 2: Create `.gitattributes` at the repo root**

```gitattributes
# Text files are LF in the repository and in every working tree. Without this,
# a Windows checkout with core.autocrlf=true rewrites line endings and any test
# matching a literal "\n" against a repo file fails — src/test/threat-model.test.ts
# does exactly that with its ```mermaid fences.
* text=auto eol=lf

# Binary: never touch these. The seed's sample photos are the reason this matters.
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.ico binary
*.woff binary
*.woff2 binary
*.node binary
```

- [ ] **Step 3: Renormalise the working tree**

```bash
git add --renormalize .
git status --short
```

Expected: files whose stored line endings change are staged. Review the list; it should be text files only, no binaries.

- [ ] **Step 4: Delete the dead swagger module**

```bash
git rm c2c-e-commerce/src/lib/swagger.ts
```

- [ ] **Step 5: Verify nothing broke**

Run from `c2c-e-commerce/`:

```bash
npx tsc --noEmit
node scripts/generate-swagger.mjs
npm run test:unit
```

Expected: `tsc` exit 0; the generator writes `src/lib/swagger-spec.json` with no diff (the generator never read the deleted file); unit tests pass, including `threat-model.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add .gitattributes
git commit -m "chore: normalise line endings and delete the dead swagger module"
```

---

### Task 2: Storage provider

**Files:**
- Create: `src/lib/storage.ts`
- Create: `src/lib/storage.test.ts`
- Create: `src/lib/storage-contract.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface StorageProvider { put(bytes: Buffer, opts: PutOptions): Promise<StoredObject>; get(key: string): Promise<StoredBytes | null>; delete(key: string): Promise<void>; }`
  - `type PutOptions = { contentType: string; prefix: string }`
  - `type StoredObject = { key: string; contentType: string; byteSize: number }`
  - `type StoredBytes = { bytes: Buffer; contentType: string }`
  - `class StorageError extends Error { readonly kind: "not_found" | "invalid_key" | "io" }`
  - `function storageKey(prefix: string, extension: string): string`
  - `function isValidStorageKey(key: string): boolean`
  - `class LocalStorageProvider implements StorageProvider` (constructor takes a root directory)
  - `class MemoryStorageProvider implements StorageProvider`
  - `function getStorageProvider(): StorageProvider` — memoised, selected by `STORAGE_DRIVER`

- [ ] **Step 1: Write the failing unit test**

Create `src/lib/storage.test.ts`:

```ts
/**
 * Part 2 spec — key generation and validation.
 *
 * The key is the only thing standing between a caller and the filesystem, so it is
 * generated here and never taken from the client. These tests run in the `unit` project:
 * no filesystem, no database.
 */
import { describe, expect, it } from "vitest";

import { isValidStorageKey, storageKey } from "./storage";

describe("storageKey", () => {
  it("builds a key under the given prefix with the given extension", () => {
    const key = storageKey("listings/42", "webp");

    expect(key).toMatch(/^listings\/42\/[0-9a-f]{32}\.webp$/);
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 100 }, () => storageKey("listings/1", "webp")));

    expect(keys.size).toBe(100);
  });
});

describe("isValidStorageKey", () => {
  it("accepts a generated key", () => {
    expect(isValidStorageKey(storageKey("listings/7", "webp"))).toBe(true);
  });

  it.each([
    ["../../etc/passwd", "parent traversal"],
    ["listings/../7/a.webp", "traversal in the middle"],
    ["/listings/7/a.webp", "absolute path"],
    ["listings\\7\\a.webp", "backslash separator"],
    ["listings/7/a.webp" + String.fromCharCode(0) + ".txt", "embedded null byte"],
    ["listings/7/", "no filename"],
    ["", "empty"],
  ])("rejects %s (%s)", (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- src/lib/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Write the module**

Create `src/lib/storage.ts`:

```ts
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
```

- [ ] **Step 4: Run the unit test**

Run: `npm run test:unit -- src/lib/storage.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Write the shared contract suite**

This is the valuable test in this task: the same assertions run against both drivers, so the mock cannot drift from the real thing.

Create `src/lib/storage-contract.test.ts`:

```ts
/**
 * Part 2 spec — the StorageProvider contract, run against every driver.
 *
 * A mock that disagrees with the real implementation is worse than no mock: every test
 * above it passes while production fails. So both drivers answer the same questions here.
 *
 * This lives in the `unit` project. LocalStorageProvider gets a real temp directory —
 * that is a filesystem, not a database, and it is torn down per case.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalStorageProvider,
  MemoryStorageProvider,
  StorageError,
  type StorageProvider,
} from "./storage";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function localProvider(): Promise<StorageProvider> {
  const root = await mkdtemp(path.join(tmpdir(), "c2c-storage-"));
  roots.push(root);
  return new LocalStorageProvider(root);
}

async function memoryProvider(): Promise<StorageProvider> {
  return new MemoryStorageProvider();
}

describe.each([
  ["MemoryStorageProvider", memoryProvider],
  ["LocalStorageProvider", localProvider],
])("%s honours the StorageProvider contract", (_name, make) => {
  it("returns the bytes it was given", async () => {
    const storage = await make();

    const stored = await storage.put(PNG, { contentType: "image/png", prefix: "listings/1" });
    const read = await storage.get(stored.key);

    expect(read?.bytes).toEqual(PNG);
    expect(read?.contentType).toBe("image/png");
  });

  it("reports the byte size it stored", async () => {
    const storage = await make();

    const stored = await storage.put(PNG, { contentType: "image/png", prefix: "listings/1" });

    expect(stored.byteSize).toBe(PNG.byteLength);
  });

  it("gives every object a distinct key", async () => {
    const storage = await make();

    const a = await storage.put(PNG, { contentType: "image/png", prefix: "listings/1" });
    const b = await storage.put(PNG, { contentType: "image/png", prefix: "listings/1" });

    expect(a.key).not.toBe(b.key);
  });

  it("answers null for a key it does not hold", async () => {
    const storage = await make();

    const absent = await storage.get("listings/1/" + "0".repeat(32) + ".webp");

    expect(absent).toBeNull();
  });

  it("deletes an object", async () => {
    const storage = await make();
    const stored = await storage.put(PNG, { contentType: "image/png", prefix: "listings/1" });

    await storage.delete(stored.key);

    expect(await storage.get(stored.key)).toBeNull();
  });

  it("treats deleting an absent object as a no-op", async () => {
    const storage = await make();

    await expect(
      storage.delete("listings/1/" + "f".repeat(32) + ".webp"),
    ).resolves.toBeUndefined();
  });

  it("refuses a traversal key rather than resolving it", async () => {
    const storage = await make();

    await expect(storage.get("../../etc/passwd")).rejects.toBeInstanceOf(StorageError);
  });
});
```

- [ ] **Step 6: Run the contract suite**

Run: `npm run test:unit -- src/lib/storage-contract.test.ts`
Expected: PASS, 14 tests (7 assertions × 2 drivers).

- [ ] **Step 7: Prove the contract suite is load-bearing**

Temporarily remove the `isValidStorageKey` guard from `LocalStorageProvider.resolve` (return `path.join(this.root, key)` unconditionally). Re-run the contract suite.

Expected: the traversal case fails **for `LocalStorageProvider` only** — the memory driver still refuses. That asymmetry is the point of running one suite against both. Restore the guard and confirm all 14 pass again. Record both observations in your report.

- [ ] **Step 8: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts src/lib/storage-contract.test.ts
git commit -m "feat(images): storage provider with local and memory drivers"
```

---

### Task 3: Magic-byte sniffing

**Files:**
- Create: `src/lib/image-type.ts`
- Create: `src/lib/image-type.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `function sniffImageType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/image-type.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:unit -- src/lib/image-type.test.ts`
Expected: FAIL — cannot resolve `./image-type`.

- [ ] **Step 3: Write the module**

Create `src/lib/image-type.ts`:

```ts
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
```

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- src/lib/image-type.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the RIFF test is load-bearing**

Temporarily change the WebP branch to check only `bytes.toString("ascii", 0, 4) === "RIFF"`. Re-run.

Expected: "rejects a RIFF container that is not WebP" fails; the others pass. Restore and confirm 8 pass. Record both observations.

- [ ] **Step 6: Commit**

```bash
git add src/lib/image-type.ts src/lib/image-type.test.ts
git commit -m "feat(images): decide upload type from magic bytes"
```

---

### Task 4: Schema and migration (additive)

**Files:**
- Create: `drizzle/0012_listing_images.sql`
- Create: `src/db/schema/listing-images.ts`
- Create: `src/db/schema/listing-images.integration.test.ts`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/db/schema/listings.ts` (the status enum only)
- Modify: `src/db/schema/index.ts`
- Modify: `src/test/factories.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `listingImages` table with `id`, `listingId`, `storageKey`, `contentType`, `byteSize`, `width`, `height`, `sortOrder`, `createdAt`
  - `type ListingImage = typeof listingImages.$inferSelect`
  - `listingStatusEnum` gains `"draft"`
  - `makeListingImage(options?: MakeListingImageOptions): Promise<ListingImage>`

**Note:** `listings.image_url` is NOT touched here. It is dropped in Task 10, after every consumer has moved. This is deliberate — see Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema/listing-images.integration.test.ts`:

```ts
/**
 * Part 2 spec — the listing_images table.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { listingImages, listings } from "@/db/schema";
import { getTestDb, resetDb } from "@/test/db";
import { makeListing, makeListingImage } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("listing_images", () => {
  it("stores an image against a listing", async () => {
    const listing = await makeListing();
    const image = await makeListingImage({ listingId: listing.id });

    expect(image.listingId).toBe(listing.id);
    expect(image.storageKey).toMatch(/^listings\/\d+\/[0-9a-f]{32}\.webp$/);
    expect(image.sortOrder).toBe(0);
  });

  it("cascades when its listing is deleted", async () => {
    const db = await getTestDb();
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id });

    await db.delete(listings).where(eq(listings.id, listing.id));

    const remaining = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id));

    expect(remaining).toHaveLength(0);
  });

  it("keeps images ordered by sortOrder", async () => {
    const db = await getTestDb();
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 2 });
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    const rows = await db
      .select()
      .from(listingImages)
      .where(eq(listingImages.listingId, listing.id))
      .orderBy(listingImages.sortOrder);

    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });
});

describe("listing status", () => {
  it("accepts draft", async () => {
    const listing = await makeListing({ status: "draft" });

    expect(listing.status).toBe("draft");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/db/schema/listing-images.integration.test.ts`
Expected: FAIL — `listingImages` is not exported and `makeListingImage` does not exist.

- [ ] **Step 3: Write the migration**

Create `drizzle/0012_listing_images.sql`:

```sql
-- Part 2 of the 2026-08-30 redesign — uploaded photos.
--
-- `storage_key` is opaque to the database: it is generated by src/lib/storage.ts and
-- resolved by whichever driver is configured, so nothing here assumes a filesystem.
--
-- `listings.image_url` is deliberately NOT dropped in this migration. Fifteen production
-- files still read it; dropping it here would leave the tree broken until the last of
-- them is migrated. 0013 drops it once they are.

CREATE TABLE IF NOT EXISTS "listing_images" (
  "id" serial PRIMARY KEY NOT NULL,
  "listing_id" integer NOT NULL,
  "storage_key" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "width" integer,
  "height" integer,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

--> statement-breakpoint
-- CASCADE, unlike categories' RESTRICT: an image has no meaning without its listing, and
-- orphaned rows would point at objects nothing will ever delete.
ALTER TABLE "listing_images"
  ADD CONSTRAINT "listing_images_listing_id_listings_id_fk"
  FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_images_listing_id_idx"
  ON "listing_images" ("listing_id", "sort_order");

--> statement-breakpoint
-- A listing exists before its photos do: the form creates it, uploads against its id,
-- then publishes. `draft` is that intermediate state, and it is excluded from every
-- public read path.
ALTER TYPE "listing_status" ADD VALUE IF NOT EXISTS 'draft';
```

- [ ] **Step 4: Register the migration**

Append to the `entries` array in `drizzle/meta/_journal.json`, after the `0011` entry:

```json
    {
      "idx": 12,
      "version": "7",
      "when": 1771946700000,
      "tag": "0012_listing_images",
      "breakpoints": true
    }
```

- [ ] **Step 5: Write the schema file**

Create `src/db/schema/listing-images.ts`:

```ts
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { listings } from "./listings";

export const listingImages = pgTable(
  "listing_images",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),

    /** Opaque key resolved by the configured StorageProvider. Never a filesystem path. */
    storageKey: text("storage_key").notNull(),

    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),

    /** Nullable: recorded when the re-encoder reports them, absent if it cannot. */
    width: integer("width"),
    height: integer("height"),

    /** Cover image is the lowest. */
    sortOrder: integer("sort_order").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("listing_images_listing_id_idx").on(table.listingId, table.sortOrder)],
);

export type ListingImage = typeof listingImages.$inferSelect;
export type NewListingImage = typeof listingImages.$inferInsert;
```

- [ ] **Step 6: Add `draft` to the status enum and re-export the table**

In `src/db/schema/listings.ts`, change the enum:

```ts
export const listingStatusEnum = pgEnum("listing_status", [
  "draft",
  "active",
  "sold",
  "removed",
]);
```

In `src/db/schema/index.ts`, add alongside the other imports and re-exports:

```ts
import { listingImages } from "./listing-images";
```

```ts
export * from "./listing-images";
```

and add the relation beside the existing ones:

```ts
export const listingImagesRelations = relations(listingImages, ({ one }) => ({
  listing: one(listings, {
    fields: [listingImages.listingId],
    references: [listings.id],
  }),
}));
```

- [ ] **Step 7: Add the factory**

In `src/test/factories.ts`, add `listingImages` and `type ListingImage` to the `@/db/schema` import, then add:

```ts
export type MakeListingImageOptions = Partial<
  Pick<ListingImage, "storageKey" | "contentType" | "byteSize" | "width" | "height" | "sortOrder">
> & {
  listingId?: number;
};

export async function makeListingImage(
  options: MakeListingImageOptions = {},
): Promise<ListingImage> {
  const db = await getTestDb();
  const n = next();

  const listingId = options.listingId ?? (await makeListing()).id;

  const [image] = await db
    .insert(listingImages)
    .values({
      listingId,
      // Shaped like a real key so a test that accidentally passes one to the storage
      // layer gets a realistic answer rather than an immediate validation error.
      storageKey:
        options.storageKey ?? `listings/${listingId}/${n.toString(16).padStart(32, "0")}.webp`,
      contentType: options.contentType ?? "image/webp",
      byteSize: options.byteSize ?? 1024,
      width: options.width ?? 800,
      height: options.height ?? 600,
      sortOrder: options.sortOrder ?? 0,
    })
    .returning();

  return image;
}
```

- [ ] **Step 8: Run the tests**

Run: `npm run test:integration -- src/db/schema/listing-images.integration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Run the whole integration project**

Run: `npm run test:integration`
Expected: PASS. Adding an enum value and a new table is additive; nothing existing reads either.

- [ ] **Step 10: Commit**

```bash
git add drizzle/0012_listing_images.sql drizzle/meta/_journal.json \
  src/db/schema/listing-images.ts src/db/schema/listings.ts src/db/schema/index.ts \
  src/test/factories.ts src/db/schema/listing-images.integration.test.ts
git commit -m "feat(images): listing_images table and the draft status"
```

---

### Task 5: Image database helpers

**Files:**
- Create: `src/db/listing-images.ts`
- Create: `src/db/listing-images.integration.test.ts`

**Interfaces:**
- Consumes: `listingImages` from `@/db/schema` (Task 4).
- Produces:
  - `MAX_IMAGES_PER_LISTING = 8`
  - `listImagesFor(listingId: number): Promise<ListingImage[]>` — ordered by `sortOrder`
  - `countImagesFor(listingId: number): Promise<number>`
  - `nextSortOrder(listingId: number): Promise<number>`
  - `insertImage(values: NewListingImage): Promise<ListingImage>`
  - `findImage(imageId: number): Promise<ListingImage | null>`
  - `deleteImage(imageId: number): Promise<ListingImage | null>` — returns the deleted row so the caller can delete its object
  - `reorderImages(listingId: number, orderedIds: number[]): Promise<void>` — transactional
  - `coverImageIdFor(listingId: number): Promise<number | null>`
  - `toImageSummary(image: ListingImage): ListingImageSummary` — strips `storageKey`, `listingId` and `createdAt`. **Every route that returns an image to a client goes through this.** The storage key is an internal address; publishing it would hand callers a name the storage layer resolves, and the only public handle an image needs is its id.

- [ ] **Step 1: Write the failing test**

Create `src/db/listing-images.integration.test.ts`:

```ts
/**
 * Part 2 spec — the image query helpers.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  coverImageIdFor,
  countImagesFor,
  deleteImage,
  findImage,
  listImagesFor,
  nextSortOrder,
  reorderImages,
} from "@/db/listing-images";
import { resetDb } from "@/test/db";
import { makeListing, makeListingImage } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

describe("listImagesFor", () => {
  it("returns images in sortOrder", async () => {
    const listing = await makeListing();
    const second = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const first = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const images = await listImagesFor(listing.id);

    expect(images.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("returns empty for a listing with none", async () => {
    const listing = await makeListing();

    expect(await listImagesFor(listing.id)).toEqual([]);
  });
});

describe("countImagesFor / nextSortOrder", () => {
  it("counts and appends after the highest", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    await makeListingImage({ listingId: listing.id, sortOrder: 5 });

    expect(await countImagesFor(listing.id)).toBe(2);
    expect(await nextSortOrder(listing.id)).toBe(6);
  });

  it("starts at 0 for an empty listing", async () => {
    const listing = await makeListing();

    expect(await countImagesFor(listing.id)).toBe(0);
    expect(await nextSortOrder(listing.id)).toBe(0);
  });
});

describe("findImage / deleteImage", () => {
  it("finds and then deletes, returning the removed row", async () => {
    const listing = await makeListing();
    const image = await makeListingImage({ listingId: listing.id });

    expect((await findImage(image.id))?.id).toBe(image.id);

    const deleted = await deleteImage(image.id);

    // The caller needs the storage key to delete the object; a bare boolean would
    // strand the bytes on disk forever.
    expect(deleted?.storageKey).toBe(image.storageKey);
    expect(await findImage(image.id)).toBeNull();
  });

  it("answers null for an unknown id", async () => {
    expect(await findImage(999999)).toBeNull();
    expect(await deleteImage(999999)).toBeNull();
  });
});

describe("reorderImages", () => {
  it("rewrites sortOrder to match the given sequence", async () => {
    const listing = await makeListing();
    const a = await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    const b = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const c = await makeListingImage({ listingId: listing.id, sortOrder: 2 });

    await reorderImages(listing.id, [c.id, a.id, b.id]);

    const images = await listImagesFor(listing.id);
    expect(images.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });

  it("ignores ids that belong to another listing", async () => {
    const mine = await makeListing();
    const theirs = await makeListing();
    const a = await makeListingImage({ listingId: mine.id, sortOrder: 0 });
    const foreign = await makeListingImage({ listingId: theirs.id, sortOrder: 0 });

    await reorderImages(mine.id, [foreign.id, a.id]);

    // The foreign row must not be renumbered into my listing's sequence.
    expect((await listImagesFor(mine.id)).map((i) => i.id)).toEqual([a.id]);
    expect((await listImagesFor(theirs.id)).map((i) => i.id)).toEqual([foreign.id]);
  });
});

describe("coverImageIdFor", () => {
  it("is the lowest sortOrder", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 3 });
    const cover = await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    expect(await coverImageIdFor(listing.id)).toBe(cover.id);
  });

  it("is null when there are none", async () => {
    const listing = await makeListing();

    expect(await coverImageIdFor(listing.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/db/listing-images.integration.test.ts`
Expected: FAIL — cannot resolve `@/db/listing-images`.

- [ ] **Step 3: Write the helpers**

Create `src/db/listing-images.ts`:

```ts
// ─── Listing image queries ────────────────────────────────────────────────────
// Part 2 of the 2026-08-30 redesign. Everything the routes need to ask about images,
// in one place, so the routes stay about HTTP.

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "./index";
import { listingImages, type ListingImage, type NewListingImage } from "./schema";

/** Spec §4.4. Enough for a second-hand listing; small enough to bound the upload cost. */
export const MAX_IMAGES_PER_LISTING = 8;

export async function listImagesFor(listingId: number): Promise<ListingImage[]> {
  return db
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id));
}

export async function countImagesFor(listingId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  return row?.count ?? 0;
}

/** One past the highest existing order, so an upload appends rather than collides. */
export async function nextSortOrder(listingId: number): Promise<number> {
  const [row] = await db
    .select({ highest: sql<number | null>`max(${listingImages.sortOrder})` })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId));

  return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
}

export async function insertImage(values: NewListingImage): Promise<ListingImage> {
  const [image] = await db.insert(listingImages).values(values).returning();
  return image;
}

export async function findImage(imageId: number): Promise<ListingImage | null> {
  const [image] = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.id, imageId))
    .limit(1);

  return image ?? null;
}

/**
 * Deletes a row and hands it back.
 *
 * The row carries the storage key, and the caller needs it to delete the object. A
 * boolean return would leave the bytes on disk with nothing pointing at them.
 */
export async function deleteImage(imageId: number): Promise<ListingImage | null> {
  const [deleted] = await db
    .delete(listingImages)
    .where(eq(listingImages.id, imageId))
    .returning();

  return deleted ?? null;
}

/**
 * Renumbers a listing's images to match `orderedIds`.
 *
 * Scoped to the listing on every update: an id belonging to someone else's listing must
 * not be renumbered into this sequence, and the scope is what stops a caller reordering
 * a listing they do not own by passing its image ids.
 */
export async function reorderImages(listingId: number, orderedIds: number[]): Promise<void> {
  if (orderedIds.length === 0) return;

  await db.transaction(async (tx) => {
    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(listingImages)
        .set({ sortOrder: index })
        .where(and(eq(listingImages.id, id), eq(listingImages.listingId, listingId)));
    }
  });
}

export async function coverImageIdFor(listingId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: listingImages.id })
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id))
    .limit(1);

  return row?.id ?? null;
}

/**
 * The client-facing shape of an image.
 *
 * `storageKey` is deliberately absent: it is the address the storage layer resolves, and
 * a caller has no use for it. The public handle is the row id, which `/api/images/{id}`
 * takes. `listingId` and `createdAt` are dropped as noise the caller already knows or
 * does not need.
 */
export function toImageSummary(image: ListingImage): {
  id: number;
  sortOrder: number;
  width: number | null;
  height: number | null;
} {
  return {
    id: image.id,
    sortOrder: image.sortOrder,
    width: image.width,
    height: image.height,
  };
}

/** Ids of every image on these listings, for the list projection. Unused ids are omitted. */
export async function coverImageIdsFor(
  listingIds: number[],
): Promise<Map<number, number>> {
  if (listingIds.length === 0) return new Map();

  const rows = await db
    .select({
      listingId: listingImages.listingId,
      id: listingImages.id,
      sortOrder: listingImages.sortOrder,
    })
    .from(listingImages)
    .where(inArray(listingImages.listingId, listingIds))
    .orderBy(asc(listingImages.sortOrder), asc(listingImages.id));

  const covers = new Map<number, number>();
  for (const row of rows) {
    if (!covers.has(row.listingId)) covers.set(row.listingId, row.id);
  }
  return covers;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- src/db/listing-images.integration.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Prove the reorder scoping is load-bearing**

Temporarily drop `eq(listingImages.listingId, listingId)` from `reorderImages`'s `where`. Re-run.

Expected: "ignores ids that belong to another listing" fails. Restore and confirm 10 pass. Record both observations.

- [ ] **Step 6: Commit**

```bash
git add src/db/listing-images.ts src/db/listing-images.integration.test.ts
git commit -m "feat(images): query helpers for listing images"
```

---

### Task 6: Upload, delete and reorder endpoints

**Files:**
- Create: `src/app/api/listings/[id]/images/route.ts`
- Create: `src/app/api/listings/[id]/images/[imageId]/route.ts`
- Create: `src/app/api/listings/[id]/images/route.integration.test.ts`
- Modify: `package.json` (add `sharp`)
- Modify: `next.config.ts` (`serverExternalPackages`)
- Modify: `src/lib/rate-limit.ts` (add `IMAGE_UPLOAD_RATE_LIMIT`)

**Interfaces:**
- Consumes: `getStorageProvider`, `StorageError` from `@/lib/storage` (Task 2); `sniffImageType` from `@/lib/image-type` (Task 3); the helpers from `@/db/listing-images` (Task 5); `canMutateListing` from `@/lib/authorization`; `authenticate`, `AuthError` from `@/lib/middleware`; `rateLimit`, `rateLimitHeaders`, `getClientIp` from `@/lib/rate-limit`; `parseResourceId` from `@/lib/params`; `jsonOk`, `jsonError` from `@/lib/response`.
- Produces: `POST /api/listings/[id]/images` returning 201 with the created `ListingImage`; `PATCH /api/listings/[id]/images` accepting `{ order: number[] }`; `DELETE /api/listings/[id]/images/[imageId]` returning 200.

- [ ] **Step 1: Install sharp and wire the bundler lever**

```bash
npm install sharp
```

In `next.config.ts`, extend the existing array:

```ts
  serverExternalPackages: ["@huggingface/transformers", "sharp"],
```

- [ ] **Step 2: Add the rate limit**

In `src/lib/rate-limit.ts`, beside the other limit constants:

```ts
/**
 * Uploads are expensive: a 5 MB decode and re-encode each. Looser than login, far tighter
 * than a read endpoint.
 */
export const IMAGE_UPLOAD_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60 * 60 * 1000,
};
```

`RateLimitOptions` is exactly `{ limit: number; windowMs: number }` — it carries no message field, and the route supplies the text. This matches `LOGIN_RATE_LIMIT` and `REGISTER_RATE_LIMIT` beside it.

- [ ] **Step 3: Write the failing test**

Create `src/app/api/listings/[id]/images/route.integration.test.ts`:

```ts
/**
 * Part 2 spec — uploading, reordering and deleting a listing's photos.
 *
 * Storage runs on the memory driver here (STORAGE_DRIVER defaults to memory under
 * NODE_ENV=test), so these tests exercise the real route and the real re-encoder without
 * touching a filesystem.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { listImagesFor } from "@/db/listing-images";
import { signToken } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";
import { __resetStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing, makeListingImage, makeUser } from "@/test/factories";

let clientCounter = 0;
const nextIp = () => `10.7.0.${(clientCounter += 1) % 250}`;

/** A real 4x4 PNG — sharp must be able to decode whatever we claim is an image. */
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

function uploadRequest(listingId: number, token: string, file: Blob, filename = "photo.png") {
  const body = new FormData();
  body.set("file", file, filename);

  return new NextRequest(`http://localhost/api/listings/${listingId}/images`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-forwarded-for": nextIp() },
    body,
  });
}

async function upload(listingId: number, token: string, bytes: Buffer, filename?: string) {
  const { POST } = await import("./route");
  const file = new Blob([bytes], { type: "image/png" });
  return POST(uploadRequest(listingId, token, file, filename), {
    params: Promise.resolve({ id: String(listingId) }),
  });
}

let sellerToken: string;
let sellerId: number;

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  __resetStorageProvider();
  const seller = await makeUser({ role: "seller" });
  sellerId = seller.id;
  sellerToken = signToken({ sub: seller.id, email: seller.email, role: seller.role });
});

describe("POST /api/listings/[id]/images", () => {
  it("stores an image and returns it", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(listing.id, sellerToken, await pngBytes());
    const created = await response.json();

    expect(response.status).toBe(201);
    expect(created.width).toBe(4);
    expect(created.height).toBe(4);
    expect(created.sortOrder).toBe(0);

    // The response is a summary. The storage key is an internal address and must not
    // appear in it, so the re-encode is confirmed against the row instead.
    expect(created.storageKey).toBeUndefined();
    expect(created.listingId).toBeUndefined();

    const [stored] = await listImagesFor(listing.id);
    expect(stored.contentType).toBe("image/webp"); // re-encoded whatever came in (D10)
    expect(stored.storageKey).toMatch(/\.webp$/);
  });

  it("appends after existing images", async () => {
    const listing = await makeListing({ sellerId });
    await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect((await response.json()).sortOrder).toBe(1);
  });

  it("rejects a file whose bytes are not an image, whatever it claims", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(listing.id, sellerToken, Buffer.from("<html>nope</html>"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "That file is not a JPEG, PNG or WebP image",
    });
  });

  it("rejects a file over the size limit", async () => {
    const listing = await makeListing({ sellerId });
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1);
    // Give it a real PNG header so the rejection is the size check, not the sniffer.
    (await pngBytes()).copy(huge, 0);

    const response = await upload(listing.id, sellerToken, huge);

    expect(response.status).toBe(413);
  });

  it("rejects the ninth image", async () => {
    const listing = await makeListing({ sellerId });
    for (let i = 0; i < 8; i++) {
      await makeListingImage({ listingId: listing.id, sortOrder: i });
    }

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "A listing may have at most 8 images",
    });
  });

  it("refuses a listing the caller does not own", async () => {
    const otherSeller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: otherSeller.id });

    const response = await upload(listing.id, sellerToken, await pngBytes());

    expect(response.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const listing = await makeListing({ sellerId });
    const { POST } = await import("./route");

    const body = new FormData();
    body.set("file", new Blob([await pngBytes()], { type: "image/png" }), "p.png");
    const response = await POST(
      new NextRequest(`http://localhost/api/listings/${listing.id}/images`, {
        method: "POST",
        headers: { "x-forwarded-for": nextIp() },
        body,
      }),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect(response.status).toBe(401);
  });

  it("never lets the client's filename reach the storage key", async () => {
    const listing = await makeListing({ sellerId });

    const response = await upload(
      listing.id,
      sellerToken,
      await pngBytes(),
      "../../etc/passwd.png",
    );

    expect(response.status).toBe(201);

    // Checked against the row, since the key never appears in the response.
    const [stored] = await listImagesFor(listing.id);
    expect(stored.storageKey).not.toContain("passwd");
    expect(stored.storageKey).not.toContain("..");
    expect(stored.storageKey).toMatch(/^listings\/\d+\/[0-9a-f]{32}\.webp$/);
  });
});

describe("PATCH /api/listings/[id]/images", () => {
  it("reorders", async () => {
    const listing = await makeListing({ sellerId });
    const a = await makeListingImage({ listingId: listing.id, sortOrder: 0 });
    const b = await makeListingImage({ listingId: listing.id, sortOrder: 1 });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest(`http://localhost/api/listings/${listing.id}/images`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${sellerToken}`,
          "content-type": "application/json",
          "x-forwarded-for": nextIp(),
        },
        body: JSON.stringify({ order: [b.id, a.id] }),
      }),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect(response.status).toBe(200);
    expect((await listImagesFor(listing.id)).map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe("DELETE /api/listings/[id]/images/[imageId]", () => {
  it("removes the row", async () => {
    const listing = await makeListing({ sellerId });
    const image = await makeListingImage({ listingId: listing.id });

    const { DELETE } = await import("./[imageId]/route");
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/listings/${listing.id}/images/${image.id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${sellerToken}` } },
      ),
      { params: Promise.resolve({ id: String(listing.id), imageId: String(image.id) }) },
    );

    expect(response.status).toBe(200);
    expect(await listImagesFor(listing.id)).toHaveLength(0);
  });

  it("refuses an image on someone else's listing", async () => {
    const otherSeller = await makeUser({ role: "seller" });
    const listing = await makeListing({ sellerId: otherSeller.id });
    const image = await makeListingImage({ listingId: listing.id });

    const { DELETE } = await import("./[imageId]/route");
    const response = await DELETE(
      new NextRequest(
        `http://localhost/api/listings/${listing.id}/images/${image.id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${sellerToken}` } },
      ),
      { params: Promise.resolve({ id: String(listing.id), imageId: String(image.id) }) },
    );

    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npm run test:integration -- src/app/api/listings/[id]/images`
Expected: FAIL — the route modules do not exist.

- [ ] **Step 5: Write the upload/reorder route**

Create `src/app/api/listings/[id]/images/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";

import { db } from "@/db";
import {
  MAX_IMAGES_PER_LISTING,
  countImagesFor,
  insertImage,
  nextSortOrder,
  reorderImages,
  toImageSummary,
} from "@/db/listing-images";
import { listings } from "@/db/schema";
import { canMutateListing } from "@/lib/authorization";
import { sniffImageType } from "@/lib/image-type";
import { AuthError, authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import {
  IMAGE_UPLOAD_RATE_LIMIT,
  getClientIp,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { jsonError, jsonOk } from "@/lib/response";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/** Spec §4.4. Bytes, not megabytes, so the comparison is unambiguous. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * @swagger
 * /api/listings/{id}/images:
 *   post:
 *     tags: [Listings]
 *     summary: Upload a photo to a listing
 *     description: >
 *       Multipart upload of a single `file`. The type is decided from the file's magic
 *       bytes, never its declared Content-Type or filename, and the image is re-encoded
 *       to WebP — which also strips EXIF, including any GPS coordinates. Owner or admin
 *       only. At most 8 images per listing, 5 MB each.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       201: { description: The stored image }
 *       400: { description: Not a JPEG, PNG or WebP }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing not found }
 *       409: { description: Image limit reached }
 *       413: { description: File too large }
 *       429: { description: Rate limited }
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const limit = rateLimit(`images:${getClientIp(request)}`, IMAGE_UPLOAD_RATE_LIMIT);
    if (!limit.allowed) {
      return jsonError(
        "Too many image uploads. Please try again later.",
        429,
        rateLimitHeaders(limit, IMAGE_UPLOAD_RATE_LIMIT),
      );
    }

    const listingId = parseResourceId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    if ((await countImagesFor(listingId)) >= MAX_IMAGES_PER_LISTING) {
      return jsonError(`A listing may have at most ${MAX_IMAGES_PER_LISTING} images`, 409);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return jsonError("Expected a file field named `file`", 400);

    if (file.size > MAX_BYTES) {
      return jsonError("That image is larger than 5 MB", 413);
    }

    const incoming = Buffer.from(await file.arrayBuffer());

    // Size is checked twice on purpose: Blob.size is what the client claimed, and this is
    // what actually arrived.
    if (incoming.byteLength > MAX_BYTES) {
      return jsonError("That image is larger than 5 MB", 413);
    }

    // The bytes decide, not the multipart Content-Type and not the filename.
    if (sniffImageType(incoming) === null) {
      return jsonError("That file is not a JPEG, PNG or WebP image", 400);
    }

    // Re-encoding is the point, not a formatting nicety: it drops EXIF — including the
    // GPS coordinates phone cameras attach — and a decode-then-encode cycle cannot carry
    // a polyglot payload through (D10).
    let webp: Buffer;
    let width: number | null = null;
    let height: number | null = null;
    try {
      const output = await sharp(incoming).rotate().webp({ quality: 82 }).toBuffer({
        resolveWithObject: true,
      });
      webp = output.data;
      width = output.info.width;
      height = output.info.height;
    } catch {
      // Sniffed as an image but undecodable: truncated, or crafted to look like one.
      return jsonError("That image could not be processed", 400);
    }

    const stored = await getStorageProvider().put(webp, {
      contentType: "image/webp",
      prefix: `listings/${listingId}`,
    });

    const image = await insertImage({
      listingId,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width,
      height,
      sortOrder: await nextSortOrder(listingId),
    });

    // Summary, not the row: `storageKey` is an internal address and never leaves the
    // server, not even to the listing's owner.
    return jsonOk(toImageSummary(image), 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    if (err instanceof StorageError) {
      console.error("[POST /api/listings/[id]/images] storage", err);
      return jsonError("Could not store that image", 500);
    }
    console.error("[POST /api/listings/[id]/images]", err);
    return jsonError("Internal server error");
  }
}

/**
 * @swagger
 * /api/listings/{id}/images:
 *   patch:
 *     tags: [Listings]
 *     summary: Reorder a listing's photos
 *     description: Body `{ order: number[] }` — image ids in their new order. Owner or admin.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Reordered }
 *       400: { description: Invalid body }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing not found }
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const listingId = parseResourceId((await params).id);
    if (!listingId) return jsonError("Invalid listing id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const order = (body as { order?: unknown }).order;
    if (!Array.isArray(order) || !order.every((id) => Number.isInteger(id) && id > 0)) {
      return jsonError("`order` must be an array of image ids", 400);
    }

    // reorderImages scopes every update to this listing, so a foreign id in the array is
    // ignored rather than renumbered.
    await reorderImages(listingId, order as number[]);

    return jsonOk({ message: "Images reordered" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[PATCH /api/listings/[id]/images]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 6: Write the delete route**

Create `src/app/api/listings/[id]/images/[imageId]/route.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

import { db } from "@/db";
import { deleteImage, findImage } from "@/db/listing-images";
import { listings } from "@/db/schema";
import { canMutateListing } from "@/lib/authorization";
import { AuthError, authenticate } from "@/lib/middleware";
import { parseResourceId } from "@/lib/params";
import { jsonError, jsonOk } from "@/lib/response";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string; imageId: string }> };

/**
 * @swagger
 * /api/listings/{id}/images/{imageId}:
 *   delete:
 *     tags: [Listings]
 *     summary: Remove a photo from a listing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: imageId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       401: { description: Missing or invalid token }
 *       403: { description: Not the listing's owner }
 *       404: { description: Listing or image not found }
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const payload = authenticate(request);

    const { id, imageId: rawImageId } = await params;
    const listingId = parseResourceId(id);
    const imageId = parseResourceId(rawImageId);
    if (!listingId || !imageId) return jsonError("Invalid id", 400);

    const [listing] = await db
      .select({ id: listings.id, sellerId: listings.sellerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    if (!listing) return jsonError("Listing not found", 404);

    if (!canMutateListing(payload, listing)) {
      return jsonError("Forbidden: this listing is not yours", 403);
    }

    const image = await findImage(imageId);
    // Ownership is settled before the image's existence is revealed, and the image must
    // belong to the listing in the path — otherwise an owner of listing A could delete
    // an image of listing B by naming it in A's URL.
    if (!image || image.listingId !== listingId) return jsonError("Image not found", 404);

    const deleted = await deleteImage(imageId);

    if (deleted) {
      // Row first, object second: a deleted row with a surviving object is wasted disk,
      // while a surviving row pointing at a deleted object is a broken image on a page.
      try {
        await getStorageProvider().delete(deleted.storageKey);
      } catch (err) {
        if (!(err instanceof StorageError)) throw err;
        console.error("[DELETE image] object left behind", deleted.storageKey, err);
      }
    }

    return jsonOk({ message: "Image deleted" });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(err.message, err.statusCode);
    console.error("[DELETE /api/listings/[id]/images/[imageId]]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 7: Run the tests**

Run: `npm run test:integration -- src/app/api/listings/[id]/images`
Expected: PASS, 11 tests.

- [ ] **Step 8: Prove the magic-byte check is load-bearing**

Temporarily remove the `sniffImageType(incoming) === null` guard. Re-run.

Expected: "rejects a file whose bytes are not an image" now fails at a different point — sharp cannot decode `<html>`, so it becomes a 400 from the re-encode branch rather than the sniffer. **Both reject it**, which is the layered defence working. Note in your report which guard produced the rejection each time; restore the check.

- [ ] **Step 9: Regenerate swagger and commit**

```bash
node scripts/generate-swagger.mjs
git add package.json package-lock.json next.config.ts src/lib/rate-limit.ts \
  "src/app/api/listings/[id]/images" src/lib/swagger-spec.json
git commit -m "feat(images): upload, reorder and delete endpoints"
```

---

### Task 7: Serving route

**Files:**
- Create: `src/app/api/images/[id]/route.ts`
- Create: `src/app/api/images/[id]/route.integration.test.ts`

**Interfaces:**
- Consumes: `findImage` from `@/db/listing-images` (Task 5); `getStorageProvider` from `@/lib/storage` (Task 2).
- Produces: `GET /api/images/[id]` streaming bytes with `nosniff`, `Content-Disposition: inline` and an immutable cache header.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/images/[id]/route.integration.test.ts`:

```ts
/**
 * Part 2 spec — serving a stored image.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { insertImage } from "@/db/listing-images";
import { __resetStorageProvider, getStorageProvider } from "@/lib/storage";
import { resetDb } from "@/test/db";
import { makeListing } from "@/test/factories";

const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

beforeEach(async () => {
  await resetDb();
  __resetStorageProvider();
});

async function get(imageId: number) {
  const { GET } = await import("./route");
  return GET(new NextRequest(`http://localhost/api/images/${imageId}`), {
    params: Promise.resolve({ id: String(imageId) }),
  });
}

describe("GET /api/images/[id]", () => {
  it("returns the stored bytes with the right headers", async () => {
    const listing = await makeListing();
    const stored = await getStorageProvider().put(BYTES, {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });
    const image = await insertImage({
      listingId: listing.id,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width: 1,
      height: 1,
      sortOrder: 0,
    });

    const response = await get(image.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    // Without nosniff a browser may re-interpret the bytes as something executable.
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("404s for an unknown image id", async () => {
    expect((await get(999999)).status).toBe(404);
  });

  it("404s when the row exists but the object is gone", async () => {
    const listing = await makeListing();
    const image = await insertImage({
      listingId: listing.id,
      storageKey: `listings/${listing.id}/${"a".repeat(32)}.webp`,
      contentType: "image/webp",
      byteSize: 10,
      width: 1,
      height: 1,
      sortOrder: 0,
    });

    expect((await get(image.id)).status).toBe(404);
  });

  it("400s on a non-numeric id", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/images/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/app/api/images`
Expected: FAIL — the route does not exist.

- [ ] **Step 3: Write the route**

Create `src/app/api/images/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { findImage } from "@/db/listing-images";
import { parseResourceId } from "@/lib/params";
import { jsonError } from "@/lib/response";
import { StorageError, getStorageProvider } from "@/lib/storage";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * @swagger
 * /api/images/{id}:
 *   get:
 *     tags: [Listings]
 *     summary: Fetch a listing photo
 *     description: >
 *       Public. Streams the stored bytes same-origin. Storage keys are random, so a URL
 *       never outlives the bytes it names and the response is cached immutably.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The image
 *         content:
 *           image/webp:
 *             schema: { type: string, format: binary }
 *       400: { description: Invalid image id }
 *       404: { description: Image not found }
 */
export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const imageId = parseResourceId((await params).id);
    if (!imageId) return jsonError("Invalid image id", 400);

    const image = await findImage(imageId);
    if (!image) return jsonError("Image not found", 404);

    const object = await getStorageProvider().get(image.storageKey);
    // A row whose object has vanished is a 404, not a 500: the bytes are gone either way
    // and the caller can do nothing with an error.
    if (!object) return jsonError("Image not found", 404);

    return new NextResponse(new Uint8Array(object.bytes), {
      status: 200,
      headers: {
        "Content-Type": object.contentType,
        "Content-Length": String(object.bytes.byteLength),
        // The bytes behind a key never change — a new upload gets a new key — so this can
        // be cached for a year without an invalidation story.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof StorageError) {
      console.error("[GET /api/images/[id]] storage", err);
      return jsonError("Image not found", 404);
    }
    console.error("[GET /api/images/[id]]", err);
    return jsonError("Internal server error");
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- src/app/api/images`
Expected: PASS, 4 tests.

- [ ] **Step 5: Regenerate swagger and commit**

```bash
node scripts/generate-swagger.mjs
git add "src/app/api/images" src/lib/swagger-spec.json
git commit -m "feat(images): serve stored images same-origin"
```

---

### Task 8: Read paths — expose images, hide drafts

**Files:**
- Modify: `src/lib/listings-query.ts`
- Modify: `src/app/api/listings/route.ts`
- Modify: `src/app/api/listings/[id]/route.ts`
- Modify: `src/app/api/listings/[id]/similar/route.ts`
- Modify: `src/app/api/recommendations/route.ts`
- Modify: `src/app/api/orders/seller/route.ts`
- Modify: `src/types/api.ts`
- Create: `src/app/api/listings/images-visibility.integration.test.ts`

**Interfaces:**
- Consumes: `coverImageIdsFor`, `listImagesFor` from `@/db/listing-images` (Task 5).
- Produces:
  - list rows gain `coverImageId: number | null`
  - `GET /api/listings/[id]` gains `images: ListingImage[]`
  - `type ListingImageSummary = { id: number; sortOrder: number; width: number | null; height: number | null }`
  - drafts excluded from browse, search, similar and recommendations

- [ ] **Step 1: Write the failing test**

Create `src/app/api/listings/images-visibility.integration.test.ts`:

```ts
/**
 * Part 2 spec — what the read paths expose.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";

import { resetDb } from "@/test/db";
import { makeListing, makeListingImage } from "@/test/factories";

beforeEach(async () => {
  await resetDb();
});

async function browse() {
  const { GET } = await import("./route");
  const response = await GET(new NextRequest("http://localhost/api/listings?limit=50"));
  return (await response.json()) as { data: { id: number; coverImageId: number | null }[] };
}

describe("GET /api/listings", () => {
  it("carries the cover image id — the lowest sortOrder", async () => {
    const listing = await makeListing();
    await makeListingImage({ listingId: listing.id, sortOrder: 2 });
    const cover = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const found = (await browse()).data.find((l) => l.id === listing.id);

    expect(found?.coverImageId).toBe(cover.id);
  });

  it("carries null for a listing with no images", async () => {
    const listing = await makeListing();

    expect((await browse()).data.find((l) => l.id === listing.id)?.coverImageId).toBeNull();
  });

  it("omits drafts", async () => {
    const draft = await makeListing({ status: "draft" });
    const active = await makeListing({ status: "active" });

    const ids = (await browse()).data.map((l) => l.id);

    expect(ids).toContain(active.id);
    expect(ids).not.toContain(draft.id);
  });
});

describe("GET /api/listings/[id]", () => {
  it("carries every image in order", async () => {
    const listing = await makeListing();
    const second = await makeListingImage({ listingId: listing.id, sortOrder: 1 });
    const first = await makeListingImage({ listingId: listing.id, sortOrder: 0 });

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );
    const detail = (await response.json()) as { images: { id: number }[] };

    expect(detail.images.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("carries an empty array for a listing with none", async () => {
    const listing = await makeListing();

    const { GET } = await import("./[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost/api/listings/${listing.id}`),
      { params: Promise.resolve({ id: String(listing.id) }) },
    );

    expect((await response.json()).images).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:integration -- src/app/api/listings/images-visibility.integration.test.ts`
Expected: FAIL — `coverImageId` and `images` are undefined; the draft appears in browse.

- [ ] **Step 3: Exclude drafts in the query builder**

In `src/lib/listings-query.ts`, the filter conditions are assembled from around line 157 (`if (sellerFilter !== null) conditions.push(...)`). Add immediately before that line:

```ts
  // Drafts are a private authoring state: the listing exists so images can be uploaded
  // against its id, but it is not for sale and must not appear anywhere public.
  conditions.push(ne(listings.status, "draft"));
```

Add `ne` to the `drizzle-orm` import.

If the caller can already filter by an explicit `status`, make sure `status=draft` cannot override this — the draft exclusion is unconditional on the public list.

- [ ] **Step 4: Attach cover ids in the list route**

In `src/app/api/listings/route.ts`, after the rows are fetched and before the response is built, add:

```ts
    const covers = await coverImageIdsFor(rows.map((row) => row.id));
    const data = rows.map((row) => ({ ...row, coverImageId: covers.get(row.id) ?? null }));
```

and return `data` where `rows` was returned. Add the import:

```ts
import { coverImageIdsFor } from "@/db/listing-images";
```

Apply the same two lines to `src/app/api/listings/[id]/similar/route.ts` and `src/app/api/recommendations/route.ts` — both project `listingColumns` and both feed grids that show a cover.

- [ ] **Step 5: Attach the full set in the detail route**

In `src/app/api/listings/[id]/route.ts`, after the listing is loaded:

```ts
    // Summaries, not rows — `storageKey` must not reach the client.
    const images = (await listImagesFor(listingId)).map(toImageSummary);
```

and include `images` in the response object. Add the import:

```ts
import { listImagesFor, toImageSummary } from "@/db/listing-images";
```

- [ ] **Step 6: Give the seller-orders route a cover instead of a URL**

In `src/app/api/orders/seller/route.ts`, the projection selects `listingImageUrl: listings.imageUrl`. Leave that line for now — Task 10 removes it — and add a cover id beside it using `coverImageIdsFor` over the listing ids in the result, exactly as in Step 4.

- [ ] **Step 7: Extend the API types**

In `src/types/api.ts`, add beside the other listing types:

```ts
/** One photo, as the API exposes it. The bytes come from `/api/images/{id}`. */
export type ListingImageSummary = {
  id: number;
  sortOrder: number;
  width: number | null;
  height: number | null;
};
```

and extend the two shapes:

```ts
export type Listing = Omit<
  Serialized<ListingRow>,
  "embedding" | "embeddingUpdatedAt"
> & { similarity?: number; coverImageId: number | null };
```

```ts
export type ListingDetail = Listing & {
  sellerName: string | null;
  categoryName: string | null;
  images: ListingImageSummary[];
};
```

- [ ] **Step 8: Run the tests**

Run: `npm run test:integration -- src/app/api/listings`
Expected: PASS, including the five new cases.

- [ ] **Step 9: Run the whole integration project**

Run: `npm run test:integration`
Expected: PASS. If a recommendations or similar-listings test breaks on the new field, update its expectation — an added field is not a regression.

- [ ] **Step 10: Commit**

```bash
git add src/lib/listings-query.ts "src/app/api/listings" "src/app/api/orders/seller" \
  src/app/api/recommendations/route.ts src/types/api.ts
git commit -m "feat(images): expose cover and full image sets, hide drafts"
```

---

### Task 9: The upload UI

**Files:**
- Create: `src/components/listings/ImageUploader.tsx`
- Create: `src/components/listings/ImageUploader.component.test.tsx`
- Modify: `src/components/listings/ListingForm.tsx`
- Modify: `src/components/listings/ListingForm.component.test.tsx`

**Interfaces:**
- Consumes: `ListingImageSummary` from `@/types/api` (Task 8).
- Produces: `<ImageUploader files={File[]} existing={ListingImageSummary[]} onFilesChange={(files: File[]) => void} onRemoveExisting={(imageId: number) => void} disabled?: boolean />`

The uploader is **controlled**, like `CategorySelect` and `CategoryTreeFilter`: the form owns the file list. Local state is limited to object-URL bookkeeping, which is presentation.

- [ ] **Step 1: Write the failing test**

Create `src/components/listings/ImageUploader.component.test.tsx`:

```tsx
/**
 * Part 2 spec — choosing photos before the listing exists.
 *
 * Previews come from local object URLs, so nothing is uploaded until submit and there is
 * no staging area to garbage-collect.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import ImageUploader from "./ImageUploader";

beforeAll(() => {
  // jsdom implements neither; the component only needs them to be callable.
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

function pngFile(name: string): File {
  return new File([Buffer.from([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
}

describe("ImageUploader", () => {
  it("reports the files a user picks", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/photos/i), pngFile("a.png"));

    expect(onFilesChange).toHaveBeenCalledTimes(1);
    expect(onFilesChange.mock.calls[0][0].map((f: File) => f.name)).toEqual(["a.png"]);
  });

  it("renders a preview per pending file", () => {
    render(
      <ImageUploader
        files={[pngFile("a.png"), pngFile("b.png")]}
        existing={[]}
        onFilesChange={vi.fn()}
        onRemoveExisting={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("removes a pending file without touching the others", async () => {
    const onFilesChange = vi.fn();
    render(
      <ImageUploader
        files={[pngFile("a.png"), pngFile("b.png")]}
        existing={[]}
        onFilesChange={onFilesChange}
        onRemoveExisting={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /remove a\.png/i }));

    expect(onFilesChange.mock.calls[0][0].map((f: File) => f.name)).toEqual(["b.png"]);
  });

  it("renders already-uploaded images from the API and reports removals by id", async () => {
    const onRemoveExisting = vi.fn();
    render(
      <ImageUploader
        files={[]}
        existing={[{ id: 7, sortOrder: 0, width: 800, height: 600 }]}
        onFilesChange={vi.fn()}
        onRemoveExisting={onRemoveExisting}
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute("src", "/api/images/7");

    await userEvent.click(screen.getByRole("button", { name: /remove image 7/i }));

    expect(onRemoveExisting).toHaveBeenCalledWith(7);
  });

  it("refuses more than eight in total and says so", async () => {
    const onFilesChange = vi.fn();
    const eight = Array.from({ length: 8 }, (_, i) => pngFile(`f${i}.png`));
    render(
      <ImageUploader files={eight} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />,
    );

    await userEvent.upload(screen.getByLabelText(/photos/i), pngFile("ninth.png"));

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(screen.getByText(/at most 8 photos/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:component -- src/components/listings/ImageUploader.component.test.tsx`
Expected: FAIL — cannot resolve `./ImageUploader`.

- [ ] **Step 3: Write the component**

Create `src/components/listings/ImageUploader.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import type { ListingImageSummary } from "@/types/api";

/** Mirrors MAX_IMAGES_PER_LISTING in src/db/listing-images.ts. */
const MAX_IMAGES = 8;

export type ImageUploaderProps = {
  /** Files chosen but not yet uploaded. The form owns this list. */
  files: File[];
  /** Images already stored against the listing (edit mode). */
  existing: ListingImageSummary[];
  onFilesChange: (files: File[]) => void;
  onRemoveExisting: (imageId: number) => void;
  disabled?: boolean;
};

/**
 * Photo picker with local previews.
 *
 * Nothing is uploaded here — the form submits, creates the listing, then uploads against
 * its id. Previews are object URLs, so a half-filled form costs nothing on the server and
 * there is no orphaned upload to collect.
 */
export default function ImageUploader({
  files,
  existing,
  onFilesChange,
  onRemoveExisting,
  disabled = false,
}: ImageUploaderProps) {
  const [tooMany, setTooMany] = useState(false);

  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  // Object URLs are a document-lifetime leak until revoked.
  useEffect(() => {
    return () => previews.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [previews]);

  const total = files.length + existing.length;

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;

    if (total + picked.length > MAX_IMAGES) {
      setTooMany(true);
      return;
    }

    setTooMany(false);
    onFilesChange([...files, ...picked]);
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-zinc-700" htmlFor="listing-photos">
        Photos
      </label>

      <input
        id="listing-photos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={handleSelect}
        className="text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700"
      />

      <p className="text-xs text-zinc-500">
        JPEG, PNG or WebP. Up to {MAX_IMAGES} photos, 5 MB each. The first is the cover.
      </p>

      {tooMany && (
        <p className="text-xs text-red-600">You can attach at most 8 photos to a listing.</p>
      )}

      {total > 0 && (
        <ul className="flex flex-wrap gap-2">
          {existing.map((image) => (
            <li key={`existing-${image.id}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/images/${image.id}`}
                alt=""
                className="h-20 w-20 rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove image ${image.id}`}
                onClick={() => onRemoveExisting(image.id)}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-full bg-zinc-900/80 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}

          {previews.map(({ file, url }) => (
            <li key={`pending-${file.name}-${file.size}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-20 w-20 rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onFilesChange(files.filter((f) => f !== file))}
                disabled={disabled}
                className="absolute -right-1 -top-1 rounded-full bg-zinc-900/80 px-1.5 text-xs text-white"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the component tests**

Run: `npm run test:component -- src/components/listings/ImageUploader.component.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire the form's create → upload → publish flow**

In `src/components/listings/ListingForm.tsx`:

Replace the `imageUrl` state with:

```tsx
  const [files, setFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<ListingImageSummary[]>([]);
```

In the prefill effect, replace the `setImageUrl` line with:

```tsx
    setExistingImages(listing.images ?? []);
```

Remove `imageUrl` from the submit `payload`. Replace the `InputField` for Image URL with:

```tsx
        <ImageUploader
          files={files}
          existing={existingImages}
          onFilesChange={setFiles}
          onRemoveExisting={handleRemoveExisting}
          disabled={submitting}
        />
```

Add the handler and the upload helper above `handleSubmit`:

```tsx
  async function handleRemoveExisting(imageId: number) {
    if (props.mode !== "edit") return;
    try {
      await api.delete(`/api/listings/${props.listingId}/images/${imageId}`);
      setExistingImages((current) => current.filter((image) => image.id !== imageId));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not remove that photo");
    }
  }

  /**
   * Uploads each chosen file against a listing that already exists.
   *
   * Sequential rather than parallel: the server appends by reading the current highest
   * sortOrder, so concurrent uploads would race for the same position.
   */
  async function uploadFiles(listingId: number): Promise<void> {
    for (const file of files) {
      const body = new FormData();
      body.set("file", file);

      const response = await fetch(`/api/listings/${listingId}/images`, {
        method: "POST",
        credentials: "include",
        body,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? `Could not upload ${file.name}`);
      }
    }
  }
```

`uploadFiles` uses `fetch` directly rather than `api.post`, because the shared client sets `Content-Type: application/json` and a multipart body must let the browser set its own boundary.

In `handleSubmit`'s create branch, replace the single `api.post` with:

```tsx
        // Create as a draft, upload against its id, then publish. A failure part-way
        // leaves a draft the seller can finish or delete from their dashboard — no
        // staging area, and no orphaned uploads.
        const created = await api.post<CreatedListing>("/api/listings", {
          ...payload,
          status: "draft",
        });

        await uploadFiles(created.id);

        await api.put(`/api/listings/${created.id}`, { status: "active" });

        toast.success("Listing created successfully!");
        router.push(`/listings/${created.id}`);
```

In the edit branch, upload any newly chosen files after the `api.put`:

```tsx
        await api.put(`/api/listings/${props.listingId}`, { ...payload, status });
        if (files.length > 0) await uploadFiles(props.listingId);
```

Add the imports:

```tsx
import ImageUploader from "./ImageUploader";
import type { ListingImageSummary } from "@/types/api";
```

- [ ] **Step 6: Run the form's tests**

Run: `npm run test:component -- src/components/listings/ListingForm.component.test.tsx`
Expected: some failures — its `useFetch` mock returns a listing without `images`, and the create path now makes three calls instead of one. Update the mock to include `images: []` and update any assertion counting `api.post` calls. Do not weaken assertions to make them pass; adjust them to the new flow and say in your report what you changed.

- [ ] **Step 7: Run the full component project**

Run: `npm run test:component`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/listings/ImageUploader.tsx \
  src/components/listings/ImageUploader.component.test.tsx \
  src/components/listings/ListingForm.tsx \
  src/components/listings/ListingForm.component.test.tsx
git commit -m "feat(images): pick photos in the form, upload on submit"
```

---

### Task 10: Display surfaces, seed, drop the column, and ship

**Files:**
- Create: `drizzle/0013_drop_listing_image_url.sql`
- Create: `src/db/seed-assets/` (six small JPEGs)
- Modify: `drizzle/meta/_journal.json`, `src/db/schema/listings.ts`, `src/db/seed.ts`, `src/lib/listings-query.ts`, `src/lib/validation.ts`, `src/app/api/listings/route.ts`, `src/app/api/listings/[id]/route.ts`, `src/app/api/listings/[id]/similar/route.ts`, `src/app/api/orders/seller/route.ts`, `src/test/factories.ts`, `next.config.ts`, `scripts/generate-swagger.mjs`, `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `README.md`
- Modify (display): `src/app/(frontend)/listings/page.tsx`, `src/app/(frontend)/listings/[id]/page.tsx`, `src/components/listings/SimilarListings.tsx`, `src/components/RecommendedForYou.tsx`, `src/components/seller/SellerListingCard.tsx`

**Interfaces:**
- Consumes: `coverImageId` and `images` from Task 8; `/api/images/[id]` from Task 7.
- Produces: no `imageUrl` anywhere; images rendered from `/api/images/{id}`.

- [ ] **Step 1: Point every display surface at the new field**

In each of these, replace the `imageUrl` read with a `coverImageId` read and an `/api/images/{id}` src:

- `src/app/(frontend)/listings/page.tsx:262` — `image={listing.imageUrl}` becomes `image={listing.coverImageId ? \`/api/images/${listing.coverImageId}\` : null}`
- `src/components/seller/SellerListingCard.tsx:53` — same substitution
- `src/components/listings/SimilarListings.tsx:48-51` — same substitution
- `src/components/RecommendedForYou.tsx:47-50` — same substitution

In `src/app/(frontend)/listings/[id]/page.tsx:131-133`, replace the single `<img src={listing.imageUrl}>` with a gallery over `listing.images`: the first image large, the rest as thumbnails that swap the large one. Keep the existing empty-state placeholder for a listing with no images.

- [ ] **Step 2: Run the component project**

Run: `npm run test:component`
Expected: PASS, or failures only where a fixture still supplies `imageUrl`. Update those fixtures to `coverImageId`.

- [ ] **Step 3: Ship sample photos and rework the seed**

The repo needs six sample photos, and you cannot download stock images — the seed must work offline and in CI. **Generate them** with a throwaway script, then delete the script and commit only the output:

```bash
node -e '
const sharp = require("sharp");
const files = {
  "iphone.jpg":  [ 40,  44,  52],
  "laptop.jpg":  [ 70,  78,  90],
  "jacket.jpg":  [ 38,  62, 102],
  "shelf.jpg":   [166, 138, 100],
  "book.jpg":    [122,  60,  52],
  "racket.jpg":  [ 46, 110,  74],
};
const fs = require("fs");
fs.mkdirSync("src/db/seed-assets", { recursive: true });
for (const [name, [r, g, b]] of Object.entries(files)) {
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 80 })
    .toFile("src/db/seed-assets/" + name)
    .then(() => console.log("wrote", name));
}
'
```

These are flat colour panels, not photographs — the seed exists to prove the pipeline and give the UI something to lay out, not to look like a real marketplace. Each lands well under 20 KB. Confirm with `ls -la src/db/seed-assets/` that six files exist, and that `.gitattributes` from Task 1 marks `*.jpg` binary so git does not mangle them.

In `src/db/seed.ts`, after the listings are inserted, push each file through the provider and insert a row:

```ts
  // Seeded photos go through the same StorageProvider as a real upload, so seeded data
  // and uploaded data take exactly one code path (D9).
  const seedImages: Record<string, string> = {
    "iPhone 14 Pro — excellent condition": "iphone.jpg",
    "Dell XPS 15 Laptop": "laptop.jpg",
    "Vintage Denim Jacket — Size M": "jacket.jpg",
    "IKEA KALLAX Shelf Unit": "shelf.jpg",
    "Clean Code by Robert C. Martin": "book.jpg",
    "Wilson Tennis Racket": "racket.jpg",
  };

  const storage = getStorageProvider();

  for (const listing of insertedListings) {
    const filename = seedImages[listing.title];
    if (!filename) continue;

    const bytes = await readFile(path.resolve(__dirname, "seed-assets", filename));
    const webp = await sharp(bytes).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const stored = await storage.put(webp.data, {
      contentType: "image/webp",
      prefix: `listings/${listing.id}`,
    });

    await db.insert(listingImages).values({
      listingId: listing.id,
      storageKey: stored.key,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      width: webp.info.width,
      height: webp.info.height,
      sortOrder: 0,
    });
  }

  console.log(`  ✔ Listing photos stored: ${insertedListings.length}`);
```

Add the imports `readFile` from `node:fs/promises`, `sharp`, `getStorageProvider` from `@/lib/storage`, and `listingImages` from `./schema`. Remove every `imageUrl:` line from `listingData`.

- [ ] **Step 4: Write the destructive migration**

Create `drizzle/0013_drop_listing_image_url.sql`:

```sql
-- Part 2 of the 2026-08-30 redesign — remove the old image URL column.
--
-- IRREVERSIBLE. Existing rows lose their image links; a migration cannot fetch remote
-- URLs and re-host them (D9). The seed now ships real files through the storage provider,
-- so seeded data and uploaded data take one code path.
--
-- Deliberately separate from 0012: every consumer of image_url had to move to
-- listing_images first, and dropping it in the additive migration would have left the
-- tree broken between tasks.

ALTER TABLE "listings" DROP COLUMN IF EXISTS "image_url";
```

Append to `drizzle/meta/_journal.json`:

```json
    {
      "idx": 13,
      "version": "7",
      "when": 1771946800000,
      "tag": "0013_drop_listing_image_url",
      "breakpoints": true
    }
```

- [ ] **Step 5: Remove the column and its validation**

- `src/db/schema/listings.ts`: delete the `imageUrl: text("image_url"),` line.
- `src/lib/listings-query.ts`: delete `imageUrl: listings.imageUrl,` from `listingColumns`.
- `src/lib/validation.ts`: delete the `imageUrlField` transformer and both `imageUrl: imageUrlField.optional(),` lines.
- `src/app/api/listings/route.ts` and `[id]/route.ts`: remove `imageUrl` from the destructuring, the insert/update, and the swagger request bodies.
- `src/app/api/listings/[id]/similar/route.ts`: remove `imageUrl` from the projection.
- `src/app/api/orders/seller/route.ts`: remove `listingImageUrl`.
- `src/test/factories.ts`: remove `imageUrl` from `MakeListingOptions` and the insert.
- `next.config.ts`: delete the whole `images.remotePatterns` block — every image is same-origin now.
- `scripts/generate-swagger.mjs`: remove `imageUrl` from the `Listing` schema and add `coverImageId` (`integer`, nullable) plus a `ListingImage` schema with `id`, `listingId`, `contentType`, `byteSize`, `width`, `height`, `sortOrder`.

- [ ] **Step 6: Forward the storage variables in Docker and document them**

In **both** `docker-compose.yml` and `docker-compose.dev.yml`, add to the `app` service's `environment` block:

```yaml
      STORAGE_DRIVER: ${STORAGE_DRIVER:-local}
      STORAGE_DIR: ${STORAGE_DIR:-/app/uploads}
```

and give the service a named volume:

```yaml
    volumes:
      - uploads_data:/app/uploads
```

declaring `uploads_data:` under the top-level `volumes:` key in each file.

Compose passes only the variables it names — the OAuth variables are missing from every compose file today for exactly this reason. Add both keys to `.env.example` with a comment, and document them in the README's environment table.

- [ ] **Step 7: Verify the seed against a disposable database**

**Do not run `db:seed` against the configured `DATABASE_URL`** — it resolves to the developer's live database and `seed.ts` opens with `TRUNCATE listings, categories, users RESTART IDENTITY CASCADE`.

```bash
docker run --rm -d --name c2c-seed-check -p 55432:5432 \
  -e POSTGRES_PASSWORD=seedcheck -e POSTGRES_USER=seedcheck -e POSTGRES_DB=seedcheck \
  pgvector/pgvector:pg16
```

Poll `docker exec c2c-seed-check pg_isready -U seedcheck`, then:

```bash
DATABASE_URL="postgresql://seedcheck:seedcheck@localhost:55432/seedcheck" STORAGE_DRIVER=local STORAGE_DIR=/tmp/c2c-seed-uploads npm run db:migrate
DATABASE_URL="postgresql://seedcheck:seedcheck@localhost:55432/seedcheck" STORAGE_DRIVER=local STORAGE_DIR=/tmp/c2c-seed-uploads npm run db:seed
```

Confirm six `listing_images` rows exist and six files landed under `/tmp/c2c-seed-uploads`. Then `docker rm -f c2c-seed-check` and remove the temp directory.

- [ ] **Step 8: Run the full gate**

```bash
npm run test:unit
npm run test:component
npm run test:integration
npx tsc --noEmit
npx eslint .
node scripts/generate-swagger.mjs
```

Report each separately with its numbers.

- [ ] **Step 9: Commit**

```bash
git add -- drizzle/0013_drop_listing_image_url.sql drizzle/meta/_journal.json \
  src/db/schema/listings.ts src/db/seed.ts src/db/seed-assets src/lib/listings-query.ts \
  src/lib/validation.ts "src/app/api/listings" "src/app/api/orders/seller" \
  src/test/factories.ts next.config.ts scripts/generate-swagger.mjs src/lib/swagger-spec.json \
  "src/app/(frontend)/listings" src/components ../docker-compose.yml ../docker-compose.dev.yml \
  ../.env.example ../README.md
git commit -m "feat(images): render uploads, seed real photos, drop image_url"
```

---

## Done when

- All four gates pass: `test:unit`, `test:component`, `test:integration`, `tsc --noEmit`, plus `eslint` clean.
- `grep -rn "imageUrl" src/` returns nothing outside `swagger-spec.json` history.
- A listing created through the form has photos that render from `/api/images/{id}`.
- `npm run db:migrate && npm run db:seed` against a disposable database produces six listings each with one image row and one stored object.
- `next.config.ts` has no `remotePatterns` block.
- `STORAGE_DRIVER` and `STORAGE_DIR` appear in both compose files, `.env.example` and the README.
