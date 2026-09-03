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
import { avatarUrl as buildAvatarUrl } from "@/lib/format";

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

/**
 * The wordmark: five bars, one per top-level category, in the hues those
 * categories own everywhere else. The identity is made out of the system rather
 * than sitting beside it.
 */
function Mark() {
  return (
    <span className="grid grid-cols-5 gap-[2px]" aria-hidden="true">
      <span className="h-5 w-[6px] bg-cat-electronics" />
      <span className="h-5 w-[6px] bg-cat-clothing" />
      <span className="h-5 w-[6px] bg-cat-home" />
      <span className="h-5 w-[6px] bg-cat-books" />
      <span className="h-5 w-[6px] bg-cat-sports" />
    </span>
  );
}

type NavLinksProps = {
  links: NavLink[];
  pathname: string;
  userRole?: Role;
  /**
   * The desktop bar and the mobile drawer render the same links with different
   * markup and spacing: desktop is a row of caps on the black bar, mobile is a
   * flat column of full-width rows on paper. That is a real visual difference,
   * not an accident, so it stays a parameter rather than being forced to agree.
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
            "inline-flex h-16 items-center border-b-[3px] text-[12px] font-bold uppercase tracking-[0.08em] transition-colors",
            active
              ? "border-white text-white"
              : "border-transparent text-white/60 hover:text-white",
          ].join(" ")
        : [
            "flex items-center gap-2.5 border-l-[3px] px-3 py-3 text-sm font-semibold transition-colors",
            active
              ? "border-ink bg-inset text-ink"
              : "border-transparent text-ink-2 hover:bg-inset",
          ].join(" ");

    return (
      <Link key={href} href={href} className={className}>
        {/* The desktop bar is signage — words only. The drawer is a list, and a
            list of rows reads faster with a glyph on each. */}
        {variant === "mobile" && icon}
        {label}
      </Link>
    );
  };

  if (variant === "desktop") {
    return (
      <ul className="hidden items-center gap-6 sm:flex lg:gap-7">
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

  const avatarUrl = user ? buildAvatarUrl(user.id) : "";

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
    <header className="sticky top-0 z-40">
      <div className="bg-ink">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">

          {/* Logo */}
          <Link
            href="/"
            className="flex shrink-0 items-center gap-3 text-white no-underline"
          >
            <Mark />
            <span className="font-display text-xl font-bold uppercase tracking-[-0.01em]">
              C2C&nbsp;Market
            </span>
          </Link>

          {/* Desktop nav links */}
          <NavLinks links={NAV_LINKS} pathname={pathname} userRole={user?.role} variant="desktop" />

          {/* Right section: auth + hamburger */}
          <div className="flex shrink-0 items-center gap-3">
            {/* Desktop auth. These are hand-styled rather than <Button>: every
                variant of that component is built for paper, and on the black bar
                its ink fills and ink outlines disappear. */}
            <div className="hidden items-center gap-4 sm:flex">
              {loading ? (
                <span className="h-8 w-24 animate-pulse bg-white/15" />
              ) : (
                <>
                  {user ? (
                    <>
                      <span className="flex items-center gap-2.5 text-sm text-white">
                        {avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarUrl}
                            alt={user.name}
                            className="h-7 w-7 border border-white/25 bg-white/10"
                          />
                        ) : (
                          <RiUserLine size={16} aria-hidden="true" />
                        )}
                        <span className="max-w-[140px] truncate font-semibold">
                          {user.name}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="text-[12px] font-bold uppercase tracking-[0.08em] text-white/60 underline decoration-1 underline-offset-[3px] transition-colors hover:text-white hover:decoration-2"
                      >
                        Logout
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        className="text-[12px] font-bold uppercase tracking-[0.08em] text-white/60 underline decoration-1 underline-offset-[3px] transition-colors hover:text-white hover:decoration-2"
                      >
                        Login
                      </Link>
                      <Link
                        href="/register"
                        className="bg-white px-4 py-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink no-underline transition-colors hover:bg-white/85"
                      >
                        Register
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>

            {/* Hamburger (mobile only) */}
            <button
              type="button"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              className="flex h-11 w-11 items-center justify-center text-white transition-colors hover:bg-white/10 sm:hidden"
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
      </div>

      {/* The five categories, as a rule under the bar. The clickable directory
          lives on the browse page, where the category list is already loaded —
          this is the same idea at the width of a hairline. */}
      <div className="grid h-[5px] grid-cols-5">
        <span className="bg-cat-electronics" />
        <span className="bg-cat-clothing" />
        <span className="bg-cat-home" />
        <span className="bg-cat-books" />
        <span className="bg-cat-sports" />
      </div>

      {/* ─── Mobile drawer ────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="border-b border-rule bg-surface px-4 pb-5 pt-3 sm:hidden">
          <NavLinks links={NAV_LINKS} pathname={pathname} userRole={user?.role} variant="mobile" />

          <div className="mt-3 border-t border-rule pt-3">
            {loading ? (
              <span className="block h-8 animate-pulse bg-inset" />
            ) : user ? (
              <>
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-2">
                  {avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={user.name}
                      className="h-7 w-7 border border-rule bg-inset"
                    />
                  )}
                  <span className="truncate font-semibold">{user.name}</span>
                  <span className="eyebrow bg-inset px-2 py-0.5 text-ink-3">
                    {user.role}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-3 py-3 text-sm font-semibold text-ink-2 transition-colors hover:bg-inset"
                >
                  <RiLogoutBoxLine size={18} aria-hidden="true" />
                  Logout
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2 px-3">
                <Link
                  href="/login"
                  className="border-[1.5px] border-ink px-4 py-3 text-center text-[12px] font-bold uppercase tracking-[0.06em] text-ink no-underline"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="bg-ink px-4 py-3 text-center text-[12px] font-bold uppercase tracking-[0.06em] text-white no-underline"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
