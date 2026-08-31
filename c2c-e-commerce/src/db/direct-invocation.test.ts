/**
 * The guard that decides whether a maintenance script does its work.
 *
 * A false negative here is silent: the script exits 0 having done nothing, which reads
 * exactly like success. The space-in-path case below is not hypothetical — it is the bug
 * this function was extracted to fix, and it reproduces on this project's own checkout.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isDirectInvocation } from "./direct-invocation";

/** A literal backslash, spelled this way so no layer of quoting can eat it. */
const BACKSLASH = String.fromCharCode(92);

/** What the old implementation asked, kept here to show what it got wrong. */
const oldForm = (argv1: string, metaUrl: string) =>
  metaUrl.endsWith(argv1.split(BACKSLASH).join("/"));

describe("isDirectInvocation", () => {
  it("recognises the script it was asked to run", () => {
    const file = path.resolve("/tmp/project/src/db/prune-tokens.ts");
    expect(isDirectInvocation(file, pathToFileURL(file).href)).toBe(true);
  });

  it("still recognises it when the path contains spaces", () => {
    // The regression. Both of this project's own directory names have one.
    const file = path.resolve("/tmp/IV godina/Internet tehnologije/src/db/prune-tokens.ts");
    const url = pathToFileURL(file).href;

    expect(url).toContain("%20");
    expect(isDirectInvocation(file, url)).toBe(true);
  });

  it("is the case the old string comparison got wrong", () => {
    // Not a test of our code — a record of why this function exists. If this ever starts
    // passing, `import.meta.url` stopped percent-encoding and the extraction is moot.
    const file = path.resolve("/tmp/IV godina/Internet tehnologije/src/db/prune-tokens.ts");
    const url = pathToFileURL(file).href;

    expect(oldForm(file, url)).toBe(false);
    expect(isDirectInvocation(file, url)).toBe(true);
  });

  it("refuses a different file in the same directory", () => {
    const running = path.resolve("/tmp/project/src/db/seed.ts");
    const me = path.resolve("/tmp/project/src/db/prune-tokens.ts");

    expect(isDirectInvocation(running, pathToFileURL(me).href)).toBe(false);
  });

  it("is false when nothing was invoked", () => {
    const me = path.resolve("/tmp/project/src/db/prune-tokens.ts");
    expect(isDirectInvocation(undefined, pathToFileURL(me).href)).toBe(false);
  });
});
