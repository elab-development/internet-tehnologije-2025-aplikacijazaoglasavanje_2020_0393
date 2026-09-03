import type { Metadata } from "next";
import { Bricolage_Grotesque, Public_Sans } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

// Display face. Used for headings, prices and anything that has to carry across a
// page — its slightly odd proportions are the point, so it is never set as body copy.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

// Interface face. A signage-lineage grotesque: plain, workmanlike, and legible at
// the 11px the eyebrows and column heads run at.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  display: "swap",
});

// Top-level metadata — (frontend)/layout.tsx refines title per-page
export const metadata: Metadata = {
  title: {
    default: "C2C Market",
    template: "%s | C2C Market",
  },
  description: "Community marketplace for listings, orders, and reviews",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bricolage.variable} ${publicSans.variable} antialiased bg-paper text-ink`}
      >
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "0px",
              background: "#141414",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
            },
            success: {
              iconTheme: { primary: "#12813f", secondary: "#ffffff" },
            },
            error: {
              iconTheme: { primary: "#c4231c", secondary: "#ffffff" },
            },
          }}
        />
      </body>
    </html>
  );
}
