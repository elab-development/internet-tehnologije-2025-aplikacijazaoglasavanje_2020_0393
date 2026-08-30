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
