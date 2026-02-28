import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-gray-100">
      <div className="mx-auto max-w-7xl px-8 py-10">
        <header className="mb-16 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">DocuMap</h1>
            <p className="mt-1 text-sm text-gray-500">
              AI-powered document extraction and field mapping
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Dashboard
            </Link>
            <Link
              href="/mapping"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              Open Mapping Studio
            </Link>
          </div>
        </header>

        <section className="mb-10 grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="mb-3 inline-flex rounded-full border border-blue-500/30 bg-blue-50 px-3 py-1 text-xs text-blue-600">
              Intelligent document processing
            </p>
            <h2 className="text-4xl font-bold leading-tight text-gray-900">
              Extract, map, and normalize data from any PDF document.
            </h2>
            <p className="mt-4 text-gray-600">
              Upload documents, let AI extract structured fields, visually map them
              to your target schema, and export clean output in PDF, Excel, or text format.
            </p>
          </div>

          <div className="card p-5">
            <h3 className="font-semibold text-gray-900">How It Works</h3>
            <div className="mt-4 grid gap-3">
              <div className="glass flex items-start gap-3 rounded-lg p-3">
                <span className="mt-0.5 text-lg">📄</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">1. Upload Documents</p>
                  <p className="text-xs text-gray-500">Upload PDFs and let Gemini AI extract all data fields automatically.</p>
                </div>
              </div>
              <div className="glass flex items-start gap-3 rounded-lg p-3">
                <span className="mt-0.5 text-lg">🔗</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">2. Map Fields</p>
                  <p className="text-xs text-gray-500">Use the visual mapping studio to connect source fields to your target schema.</p>
                </div>
              </div>
              <div className="glass flex items-start gap-3 rounded-lg p-3">
                <span className="mt-0.5 text-lg">📊</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">3. Export Output</p>
                  <p className="text-xs text-gray-500">Generate mapped output as PDF, Excel, or plain text files.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900">AI-Powered Extraction</h2>
            <p className="mt-2 text-sm text-gray-500">
              Uses Google Gemini to accurately extract fields, tables, and values from complex PDFs.
            </p>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900">Visual Mapping Studio</h2>
            <p className="mt-2 text-sm text-gray-500">
              Map extracted source fields to standardized output schema with an intuitive interface.
            </p>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900">Multi-Format Export</h2>
            <p className="mt-2 text-sm text-gray-500">
              Download mapped results as PDF, Excel, or text. Save mapping configurations for reuse.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
