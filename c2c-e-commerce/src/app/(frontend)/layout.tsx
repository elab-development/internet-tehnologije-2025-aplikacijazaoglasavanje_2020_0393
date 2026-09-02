import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
import { AnnouncerProvider } from "@/components/ui/Announcer";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "C2C Market",
    template: "%s | C2C Market",
  },
  description: "Buy and sell anything on C2C Market — your peer-to-peer marketplace.",
};

export default function FrontendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <AnnouncerProvider>
        <div className="flex min-h-screen flex-col">
          {/* A signed-in seller passes eight navbar tab stops before reaching content
              on every page load. Visible only when focused. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg focus:ring-2 focus:ring-indigo-500"
          >
            Skip to main content
          </a>
          <Navbar />
          <main
            id="main-content"
            className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6"
          >
            {children}
          </main>
          <Footer />
        </div>
      </AnnouncerProvider>
    </AuthProvider>
  );
}
