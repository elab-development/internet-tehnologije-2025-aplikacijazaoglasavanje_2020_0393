/**
 * Task 10 — the listing detail page's photo gallery.
 *
 * A pure presentational component (props in, no data fetching), so no mocking is needed:
 * what's under test is what it renders for a given `images` array and how clicking a
 * thumbnail changes which image is "large".
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import ListingGallery from "./ListingGallery";
import type { ListingImageSummary } from "@/types/api";

const image = (id: number, sortOrder: number): ListingImageSummary => ({
  id,
  sortOrder,
  width: 800,
  height: 600,
});

describe("ListingGallery", () => {
  it("renders the placeholder when there are no images", () => {
    render(<ListingGallery images={[]} title="Vintage Denim Jacket" />);

    // The emoji alone conveyed "no photo" to sighted users only — Task 20 fix round 1
    // gave the placeholder a real accessible name instead, so it is announced too.
    const placeholder = screen.getByRole("img", { name: "No photo available" });
    expect(placeholder).toHaveTextContent("🖼️");
    // Still no actual <img> element — that's what the "one image" case below covers.
    expect(placeholder.tagName).not.toBe("IMG");
  });

  it("renders one large image and no thumbnail row for a single image", () => {
    render(<ListingGallery images={[image(1, 0)]} title="Vintage Denim Jacket" />);

    const large = screen.getByRole("img", { name: "Vintage Denim Jacket" });
    expect(large).toHaveAttribute("src", "/api/images/1");

    // No placeholder, and no thumbnail buttons — a single photo is not a "gallery".
    expect(screen.queryByText("🖼️")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a thumbnail per image when there is more than one", () => {
    render(
      <ListingGallery
        images={[image(1, 0), image(2, 1), image(3, 2)]}
        title="Vintage Denim Jacket"
      />,
    );

    expect(screen.getByRole("button", { name: "Show photo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 3" })).toBeInTheDocument();
  });

  it("defaults the large image to the first (cover) image", () => {
    render(
      <ListingGallery images={[image(1, 0), image(2, 1)]} title="Vintage Denim Jacket" />,
    );

    const large = screen.getByRole("img", { name: "Vintage Denim Jacket" });
    expect(large).toHaveAttribute("src", "/api/images/1");
  });

  it("clicking a thumbnail swaps the large image", async () => {
    const user = userEvent.setup();
    render(
      <ListingGallery
        images={[image(1, 0), image(2, 1), image(3, 2)]}
        title="Vintage Denim Jacket"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Show photo 3" }));

    const large = screen.getByRole("img", { name: "Vintage Denim Jacket" });
    expect(large).toHaveAttribute("src", "/api/images/3");
  });

  it("labels thumbnails by position, not by sortOrder — a gap left by a deletion does not skew them", () => {
    // sortOrder is not renumbered when an image is deleted (see the component's comment),
    // so a survivor can carry sortOrder 2 while being the second of two images. The label
    // must still read "2", not "3".
    render(
      <ListingGallery images={[image(10, 0), image(30, 2)]} title="Vintage Denim Jacket" />,
    );

    expect(screen.getByRole("button", { name: "Show photo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show photo 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show photo 3" })).not.toBeInTheDocument();
  });
});
