import Link from "next/link";

type FooterLink = { href: string; label: string };

const MARKETPLACE: FooterLink[] = [
  { href: "/listings", label: "Browse listings" },
  { href: "/listings/new", label: "Sell an item" },
  { href: "/seller", label: "Seller dashboard" },
];

const ACCOUNT: FooterLink[] = [
  { href: "/login", label: "Log in" },
  { href: "/register", label: "Register" },
  { href: "/orders", label: "My orders" },
  { href: "/settings", label: "Settings" },
];

const DEVELOPERS: FooterLink[] = [{ href: "/api-docs", label: "API documentation" }];

function Column({ heading, links }: { heading: string; links: FooterLink[] }) {
  return (
    <div className="flex flex-col gap-3.5">
      <span className="eyebrow text-white/50">{heading}</span>
      <ul className="flex flex-col gap-2.5 text-sm">
        {links.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className="text-white/80 no-underline hover:text-white hover:underline">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto bg-ink text-white">
      {/* The five categories again, closing the page the way the header opens it. */}
      <div className="grid h-[5px] grid-cols-5">
        <span className="bg-cat-electronics" />
        <span className="bg-cat-clothing" />
        <span className="bg-cat-home" />
        <span className="bg-cat-books" />
        <span className="bg-cat-sports" />
      </div>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-11 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.7fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <Link href="/" className="flex items-center gap-3 text-white no-underline">
            <span className="grid grid-cols-5 gap-[2px]" aria-hidden="true">
              <span className="h-5 w-[6px] bg-cat-electronics" />
              <span className="h-5 w-[6px] bg-cat-clothing" />
              <span className="h-5 w-[6px] bg-cat-home" />
              <span className="h-5 w-[6px] bg-cat-books" />
              <span className="h-5 w-[6px] bg-cat-sports" />
            </span>
            <span className="font-display text-xl font-bold uppercase tracking-[-0.01em]">
              C2C&nbsp;Market
            </span>
          </Link>
          <p className="max-w-[36ch] text-sm text-white/65">
            People selling to people. Five categories, no storefronts, and a seller who
            has to confirm before anything moves.
          </p>
        </div>

        <Column heading="Marketplace" links={MARKETPLACE} />
        <Column heading="Account" links={ACCOUNT} />
        <Column heading="Developers" links={DEVELOPERS} />
      </div>

      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="eyebrow text-white/50">© {year} C2C Market</span>
          <span className="eyebrow text-white/50">
            Set in Bricolage Grotesque &amp; Public Sans
          </span>
        </div>
      </div>
    </footer>
  );
}
