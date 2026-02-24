import Link from "next/link";
import { RiStoreLine } from "@remixicon/react";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-zinc-200 bg-white py-8 mt-auto">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 text-center sm:flex-row sm:justify-between sm:text-left sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold text-indigo-600"
        >
          <RiStoreLine size={18} />
          C2C Market
        </Link>

        <p className="text-xs text-zinc-400">
          © {year} C2C Market. All rights reserved.
        </p>

        <nav className="flex gap-4 text-xs text-zinc-500">
          <Link href="/" className="hover:text-zinc-900">
            Home
          </Link>
          <Link href="/orders" className="hover:text-zinc-900">
            My Orders
          </Link>
        </nav>
      </div>
    </footer>
  );
}
