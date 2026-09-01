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
          <Navbar />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
          <Footer />
        </div>
      </AnnouncerProvider>
    </AuthProvider>
  );
}
