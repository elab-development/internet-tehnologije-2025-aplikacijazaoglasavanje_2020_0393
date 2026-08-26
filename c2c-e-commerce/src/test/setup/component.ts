/**
 * Setup file for the `component` Vitest project.
 *
 * Registers the `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveValue`,
 * …) on Vitest's `expect`, and unmounts every rendered tree between tests so a component
 * test cannot see the previous one's DOM.
 */
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
