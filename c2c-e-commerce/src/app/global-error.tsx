"use client";

/**
 * Last-resort boundary: a throw in the root layout itself.
 *
 * This REPLACES the root layout, so it must render its own <html> and <body> and
 * cannot use the app's fonts, providers or components — none of them are mounted
 * when this renders. Deliberately plain and dependency-free: inline styles only, no
 * imports from @/components.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f8f9fc",
          color: "#111827",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            C2C Market is temporarily unavailable
          </h1>
          <p style={{ color: "#4b5563", marginBottom: "1.5rem" }}>
            Something went wrong while loading the application.
          </p>
          <button
            onClick={reset}
            style={{
              border: 0,
              borderRadius: "0.5rem",
              background: "#4f46e5",
              color: "#fff",
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#6b7280" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
