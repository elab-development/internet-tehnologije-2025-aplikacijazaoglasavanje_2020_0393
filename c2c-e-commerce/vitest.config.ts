import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(__dirname, "./src"),
};

export default defineConfig({
  test: {
    projects: [
      {
        // Fast, dependency-free tests. No database, no DOM, full parallelism.
        // The excludes matter: `src/**/*.test.ts` would otherwise also collect
        // `*.integration.test.ts`, which needs a database this project never sets up.
        test: {
          name: "unit",
          globals: true,
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.integration.test.ts", "**/*.component.test.tsx"],
        },
        resolve: { alias },
      },
      {
        // Tests against a real Postgres. One shared database, truncated between tests,
        // so files must not run concurrently.
        test: {
          name: "integration",
          globals: true,
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
          // globalSetup starts ONE container per run and publishes its URL; the setup
          // file then points DATABASE_URL at it before any test module imports @/db.
          globalSetup: ["src/test/global-setup.ts"],
          setupFiles: ["src/test/setup/integration.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
        resolve: { alias },
      },
      {
        // React component tests. The react plugin is loaded here only — the node
        // projects would pay its transform cost for nothing.
        plugins: [react()],
        test: {
          name: "component",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.component.test.tsx"],
          setupFiles: ["src/test/setup/component.ts"],
          // Vitest's 5s default is enough for these in isolation, but `npm run test`
          // runs this project alongside the integration one -- Testcontainers, real
          // Postgres, and the embedding model all competing for the same cores. A
          // user-event-driven test that types into a form then loses its slice of the
          // CPU can exceed 5s while behaving perfectly. This is a ceiling for a hung
          // test, not a target: nothing here should take anywhere near it.
          testTimeout: 20_000,
        },
        resolve: { alias },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["src/lib/**", "src/app/api/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "src/test/**",
        "src/lib/swagger-spec.json",
        "src/db/migrate.ts",
        "src/db/seed.ts",
      ],
      // Thresholds are deliberately absent: C2C-QA-9 sets them from a measured
      // baseline once the test stories have landed.
    },
  },
});
