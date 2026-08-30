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
