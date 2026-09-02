"use client";

import { useState, useEffect, type ReactNode } from "react";
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
  RiSettings4Line,
} from "@remixicon/react";
import { useAuth, type AuthUser } from "@/context/AuthContext";
import { Button } from "@/components/ui";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Role = AuthUser["role"];

type NavLink = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Omitted means every visitor sees the link — the page it points at is what
   *  gates access, not the nav. Present restricts the link to these roles. */
  roles?: Role[];
};

/**
 * Every link the nav can show, desktop and mobile alike (L5). `roles` replaces
 * what used to be four hand-written `isSeller &&` conditionals — two for the
 * desktop bar, two for the mobile drawer, one per link, all identical.
 *
 * `/settings` is new here (M9): it is the only way to reach the linked-accounts
 * screen, and before this it had no link anywhere in the UI.
 */
const NAV_LINKS: NavLink[] = [
  { href: "/listings", label: "Listings", icon: <RiStoreLine size={18} aria-hidden="true" /> },
  {
    href: "/orders",
    label: "My Orders",
    icon: <RiShoppingBagLine size={18} aria-hidden="true" />,
  },
  { href: "/api-docs", label: "API Docs", icon: <RiCodeLine size={18} aria-hidden="true" /> },
  {
    href: "/seller",
    label: "Seller Dashboard",
    icon: <RiDashboardLine size={18} aria-hidden="true" />,
    roles: ["seller", "admin"],
  },
  {
    href: "/listings/new",
    label: "Sell Item",
    icon: <RiAddCircleLine size={18} aria-hidden="true" />,
    roles: ["seller", "admin"],
  },
  {
    href: "/settings",
    label: "Settings",
    icon: <RiSettings4Line size={18} aria-hidden="true" />,
  },
];

type NavLinksProps = {
  links: NavLink[];
  pathname: string;
  userRole?: Role;
  /**
   * The desktop bar and the mobile drawer render the same links with different
   * markup and spacing: desktop is a `<ul>` of chips, mobile is a flat column of
   * full-width rows. That is a real visual difference, not an accident, so it
   * stays a parameter rather than being forced to agree.
   */
  variant: "desktop" | "mobile";
};

/** One nav link list, parameterised by variant, standing in for what used to be
 *  written out separately for desktop and mobile (L5). */
function NavLinks({ links, pathname, userRole, variant }: NavLinksProps) {
  const visible = links.filter(
    (link) => !link.roles || (userRole && link.roles.includes(userRole))
  );

  const renderLink = ({ href, label, icon }: NavLink) => {
    // Prefix match, so a link stays highlighted on its own subpages (e.g. a
    // listing detail page under /listings). Applied uniformly to every link,
    // including the role-gated ones — the old hand-written seller blocks used
    // an exact match instead, but /seller and /listings/new have no subroutes,
    // so that inconsistency never changed what rendered.
    const active = pathname === href || pathname.startsWith(href + "/");
    const className =
      variant === "desktop"
        ? [
            "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            active
              ? "bg-indigo-50 text-indigo-700"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
          ].join(" ")
        : [
            "flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            active ? "bg-indigo-50 text-indigo-700" : "text-zinc-700 hover:bg-zinc-100",
          ].join(" ");

    return (
      <Link key={href} href={href} className={className}>
        {icon}
        {label}
      </Link>
    );
  };

  if (variant === "desktop") {
    return (
      <ul className="hidden items-center gap-1 sm:flex">
        {visible.map((link) => (
          <li key={link.href}>{renderLink(link)}</li>
        ))}
      </ul>
    );
  }

  return <>{visible.map(renderLink)}</>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Navbar() {
  const { user, logout, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const avatarUrl = user
    ? `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(user.name)}`
    : "";

  // Close mobile menu on route change
  useEffect(() => {
    const timeout = setTimeout(() => {
      setMobileOpen(false);
    }, 0);
    return () => clearTimeout(timeout);
  }, [pathname]);

  // Lock body scroll while mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">

        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
        >
          <RiStoreLine size={24} aria-hidden="true" />
          <span>C2C Market</span>
        </Link>

        {/* Desktop nav links */}
        <NavLinks links={NAV_LINKS} pathname={pathname} userRole={user?.role} variant="desktop" />

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
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={user.name}
                      className="h-7 w-7 rounded-full border border-zinc-200 bg-zinc-50"
                    />
                  ) : (
                    <RiUserLine size={16} aria-hidden="true" />
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
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? (
              <RiCloseLine size={22} aria-hidden="true" />
            ) : (
              <RiMenuLine size={22} aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>

      {/* ─── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-zinc-200 bg-white px-4 pb-5 pt-3 space-y-1">
          <NavLinks links={NAV_LINKS} pathname={pathname} userRole={user?.role} variant="mobile" />

          <div className="border-t border-zinc-100 pt-3 mt-3 space-y-1">
            {loading ? (
              <span className="block h-8 animate-pulse rounded-lg bg-zinc-100" />
            ) : user ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700">
                  {avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
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
                  <RiLogoutBoxLine size={18} aria-hidden="true" />
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
