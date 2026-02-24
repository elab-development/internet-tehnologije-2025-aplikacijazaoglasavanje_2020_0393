"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  RiStoreLine,
  RiShoppingBagLine,
  RiUserLine,
  RiLogoutBoxLine,
  RiMenuLine,
  RiCloseLine,
  RiAddCircleLine,
  RiDashboardLine,
  RiCodeLine,
} from "@remixicon/react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { href: "/listings", label: "Listings", icon: <RiStoreLine size={18} /> },
  { href: "/orders", label: "My Orders", icon: <RiShoppingBagLine size={18} /> },
  { href: "/api-docs", label: "API Docs", icon: <RiCodeLine size={18} /> },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user, logout, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  // Derive open state from pathname so the menu closes automatically on navigation
  // without needing a setState call inside a useEffect.
  const [openedForPath, setOpenedForPath] = useState<string | null>(null);
  const mobileOpen = openedForPath === pathname;

  const avatarUrl = user
    ? `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(user.name)}`
    : "";

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function handleLogout() {
    logout();
    router.push("/");
  }

  const isSeller = user?.role === "seller" || user?.role === "admin";

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">

        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <RiStoreLine size={24} />
          <span>C2C Market</span>
        </Link>

        {/* Desktop nav links */}
        <ul className="hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
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
          {isSeller && (
            <li>
              <Link
                href="/seller"
                className={[
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname === "/seller"
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                ].join(" ")}
              >
                <RiDashboardLine size={18} />
                Seller Dashboard
              </Link>
            </li>
          )}
          {isSeller && (
            <li>
              <Link
                href="/listings/new"
                className={[
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  pathname === "/listings/new"
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                ].join(" ")}
              >
                <RiAddCircleLine size={18} />
                Sell Item
              </Link>
            </li>
          )}
        </ul>

        {/* Right section: auth + hamburger */}
        <div className="flex items-center gap-2">
          {/* Desktop auth */}
          <div className="hidden sm:flex items-center gap-2">
            {loading ? (
              <span className="h-8 w-24 animate-pulse rounded-lg bg-zinc-100" />
            ) : user ? (
              <>
                <span className="flex items-center gap-1.5 text-sm text-zinc-600">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={user.name}
                      className="h-7 w-7 rounded-full border border-zinc-200 bg-zinc-50"
                    />
                  ) : (
                    <RiUserLine size={16} />
                  )}
                  <span className="max-w-[140px] truncate font-medium">{user.name}</span>
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
                <Button variant="ghost" size="sm" onClick={() => router.push("/login")}>
                  Login
                </Button>
                <Button variant="primary" size="sm" onClick={() => router.push("/register")}>
                  Register
                </Button>
              </>
            )}
          </div>

          {/* Hamburger (mobile only) */}
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="flex sm:hidden items-center justify-center rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 transition-colors"
            onClick={() => setOpenedForPath((prev) => prev === null ? pathname : null)}
          >
            {mobileOpen ? <RiCloseLine size={22} /> : <RiMenuLine size={22} />}
          </button>
        </div>
      </nav>

      {/* ─── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-zinc-200 bg-white px-4 pb-5 pt-3 space-y-1">
          {NAV_LINKS.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-zinc-700 hover:bg-zinc-100",
                ].join(" ")}
              >
                {icon}
                {label}
              </Link>
            );
          })}
          {isSeller && (
            <Link
              href="/seller"
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                pathname === "/seller"
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              <RiDashboardLine size={18} />
              Seller Dashboard
            </Link>
          )}
          {isSeller && (
            <Link
              href="/listings/new"
              className={[
                "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                pathname === "/listings/new"
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              <RiAddCircleLine size={18} />
              Sell Item
            </Link>
          )}

          <div className="border-t border-zinc-100 pt-3 mt-3 space-y-1">
            {loading ? (
              <span className="block h-8 animate-pulse rounded-lg bg-zinc-100" />
            ) : user ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700">
                  {avatarUrl && (
                    <img
                      src={avatarUrl}
                      alt={user.name}
                      className="h-7 w-7 rounded-full border border-zinc-200 bg-zinc-50"
                    />
                  )}
                  <span className="font-medium truncate">{user.name}</span>
                  <span className="ml-1 text-xs capitalize bg-zinc-100 text-zinc-500 rounded-full px-2 py-0.5">
                    {user.role}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
                >
                  <RiLogoutBoxLine size={18} />
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors text-center"
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
