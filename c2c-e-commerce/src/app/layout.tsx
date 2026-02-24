import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 text-zinc-900`}
      >
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "10px",
              background: "#1f2937",
              color: "#f9fafb",
              fontSize: "0.875rem",
            },
            success: {
              iconTheme: { primary: "#34d399", secondary: "#1f2937" },
            },
            error: {
              iconTheme: { primary: "#f87171", secondary: "#1f2937" },
            },
          }}
        />
      </body>
    </html>
  );
}
