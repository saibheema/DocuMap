import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900">
      <div className="mx-auto max-w-7xl px-8 py-10">
        <header className="mb-16 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">DocuMap SaaS</h1>
            <p className="mt-1 text-sm text-slate-400">
              Extraction and mapping platform for corporates with different document formats.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Open App
            </Link>
            <Link
              href="/mapping"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Start Mapping
            </Link>
          </div>
        </header>

        <section className="mb-10 grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 inline-flex rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
              Multi-tenant SaaS for finance teams
            </p>
            <h2 className="text-4xl font-bold leading-tight text-white">
              One platform to normalize PDFs from all your corporate entities.
            </h2>
            <p className="mt-4 text-slate-300">
              Upload audit reports, extract data, visually map fields, and run template-based
              automation across subsidiaries, vendors, and partners.
            </p>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-white">Portfolio Snapshot</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="glass rounded-lg p-3">
                <p className="text-xs text-slate-400">Corporate Workspaces</p>
                <p className="mt-1 text-xl font-semibold">18</p>
              </div>
              <div className="glass rounded-lg p-3">
                <p className="text-xs text-slate-400">Template Coverage</p>
                <p className="mt-1 text-xl font-semibold">92%</p>
              </div>
              <div className="glass rounded-lg p-3">
                <p className="text-xs text-slate-400">Documents Processed</p>
                <p className="mt-1 text-xl font-semibold">24,921</p>
              </div>
              <div className="glass rounded-lg p-3">
                <p className="text-xs text-slate-400">Average TAT</p>
                <p className="mt-1 text-xl font-semibold">11 sec</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="card p-5">
            <h2 className="font-semibold text-white">Tenant Isolation</h2>
            <p className="mt-2 text-sm text-slate-400">
              Separate corporate data, templates, and jobs per workspace.
            </p>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-white">Graphical Mapper</h2>
            <p className="mt-2 text-sm text-slate-400">
              Drag source fields to standard schema with validation hints.
            </p>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-white">Automation at Scale</h2>
            <p className="mt-2 text-sm text-slate-400">
              Reusable templates and smart source detection for known formats.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
