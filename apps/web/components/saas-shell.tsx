"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ingestion", label: "Upload" },
  { href: "/mapping", label: "Mapping Studio" },
  { href: "/templates", label: "Templates" },
  { href: "/jobs", label: "Jobs" }
];

export function SaaSShell({
  title,
  subtitle,
  workspaceLabel,
  children
}: {
  title: string;
  subtitle?: string;
  workspaceLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-gray-100">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-lg font-semibold text-gray-900">
              DocuMap
            </Link>
            <p className="text-xs text-gray-500">AI-powered document extraction and mapping</p>
          </div>

          <nav className="hidden items-center gap-2 md:flex">
            {links.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-2 text-sm ${
                    active ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            Workspace: {workspaceLabel ?? "Global Finance Group"}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </main>
  );
}
