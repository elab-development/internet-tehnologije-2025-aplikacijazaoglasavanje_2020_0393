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

describe("H3 — files are validated before they are accepted", () => {
  function oversize() {
    const file = new File(["x"], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 6 * 1024 * 1024 });
    return file;
  }

  it("rejects a file over 5 MB and names it", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    await userEvent.upload(screen.getByLabelText(/photos/i), oversize());

    // The UI promises "5 MB each" three lines below the input. It has to mean it.
    expect(await screen.findByText(/huge\.jpg is larger than 5 MB/i)).toBeInTheDocument();
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it("rejects a type the server will not store, whatever the picker allowed", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    // user-event's default instance filters `.upload()` by the input's `accept`
    // attribute before it ever fires a change event — the opposite of the real bug,
    // where an OS "All files" picker ignores `accept` entirely. `applyAccept: false`
    // is what lets this test reach the component's own validation.
    const user = userEvent.setup({ applyAccept: false });
    const pdf = new File(["x"], "invoice.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/photos/i), pdf);

    expect(await screen.findByText(/invoice\.pdf is not a JPEG, PNG or WebP/i)).toBeInTheDocument();
    expect(onFilesChange).not.toHaveBeenCalled();
  });

  it("accepts the valid files from a mixed selection and reports only the rejects", async () => {
    const onFilesChange = vi.fn();
    render(<ImageUploader files={[]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    const good = new File(["x"], "ok.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/photos/i), [good, oversize()]);

    expect(onFilesChange).toHaveBeenCalledWith([good]);
    expect(await screen.findByText(/huge\.jpg is larger than 5 MB/i)).toBeInTheDocument();
  });
});

describe("L27 — alt text describes position, not a database id", () => {
  it("describes saved photos by position, not by database id", () => {
    render(
      <ImageUploader
        files={[]}
        existing={[
          { id: 4162, sortOrder: 0, width: 800, height: 600 },
          { id: 4163, sortOrder: 1, width: 800, height: 600 },
        ]}
        onFilesChange={vi.fn()}
        onRemoveExisting={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Listing photo 1 of 2")).toBeInTheDocument();
    expect(screen.getByAltText("Listing photo 2 of 2")).toBeInTheDocument();
    expect(screen.queryByAltText(/4162/)).toBeNull();
    expect(screen.queryByAltText(/4163/)).toBeNull();
  });
});

describe("L23 — two files with the same name and size", () => {
  it("renders both without a duplicate React key", async () => {
    const onFilesChange = vi.fn();
    const a = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const b = new File(["x"], "photo.jpg", { type: "image/jpeg" });

    render(<ImageUploader files={[a, b]} existing={[]} onFilesChange={onFilesChange} onRemoveExisting={vi.fn()} />);

    expect(screen.getAllByAltText("photo.jpg")).toHaveLength(2);
  });
});
