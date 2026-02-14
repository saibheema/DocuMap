"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ingestion", label: "Ingestion" },
  { href: "/connections", label: "Connections" },
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
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-800/70 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <Link href="/" className="text-lg font-semibold text-white">
              DocuMap SaaS
            </Link>
            <p className="text-xs text-slate-400">Multi-corporate PDF extraction and mapping</p>
          </div>

          <nav className="hidden items-center gap-2 md:flex">
            {links.map((link) => {
              const active = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-2 text-sm ${
                    active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
            Workspace: {workspaceLabel ?? "Global Finance Group"}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {children}
      </section>
    </main>
  );
}
