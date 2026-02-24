"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { RiStoreLine, RiShoppingBagLine, RiUserLine, RiLogoutBoxLine } from "@remixicon/react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: "/", label: "Home", icon: <RiStoreLine size={18} /> },
  { href: "/orders", label: "My Orders", icon: <RiShoppingBagLine size={18} /> },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user, logout, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-indigo-600 hover:text-indigo-700"
        >
          <RiStoreLine size={24} />
          <span>C2C Market</span>
        </Link>

        {/* Nav links */}
        <ul className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map(({ href, label, icon }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={[
                    "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  ].join(" ")}
                >
                  {icon}
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Auth area */}
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="h-8 w-24 animate-pulse rounded-lg bg-zinc-100" />
          ) : user ? (
            <>
              <span className="hidden items-center gap-1.5 text-sm text-zinc-600 sm:flex">
                <RiUserLine size={16} />
                <span className="max-w-[140px] truncate font-medium">
                  {user.name}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={<RiLogoutBoxLine size={16} />}
                onClick={handleLogout}
              >
                Logout
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/login")}
              >
                Login
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => router.push("/register")}
              >
                Register
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
