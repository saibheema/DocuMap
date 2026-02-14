"use client";

import { useEffect, useState } from "react";
import { SaaSShell } from "../../components/saas-shell";
import {
  createConnection,
  deactivateConnection,
  getTenantId,
  listConnections,
  type SourceConnection
} from "../../lib/api";

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<SourceConnection[]>([]);
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState<SourceConnection["protocol"]>("local-agent");
  const [inputPath, setInputPath] = useState("");
  const [outputPath, setOutputPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadConnections = async () => {
    try {
      const response = await listConnections();
      setConnections(response.items);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connections");
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const addConnection = async () => {
    if (!name.trim() || !inputPath.trim() || !outputPath.trim()) {
      return;
    }
    try {
      await createConnection({
        name,
        protocol,
        inputFolderPath: inputPath,
        outputFolderPath: outputPath
      });
      setName("");
      setProtocol("local-agent");
      setInputPath("");
      setOutputPath("");
      await loadConnections();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create connection");
    }
  };

  const toggleActive = async (id: string, active: boolean) => {
    if (active) {
      await deactivateConnection(id);
      await loadConnections();
    }
  };

  return (
    <SaaSShell
      title="Tenant Source Connections"
      subtitle="Configure client folder connections. DocuMap stores references only."
      workspaceLabel={getTenantId()}
    >
      {error ? <div className="card mb-4 p-3 text-sm text-rose-300">{error}</div> : null}

      <section className="card p-5">
        <h2 className="font-semibold text-white">Add Connection</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Connection name"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as SourceConnection["protocol"])}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          >
            <option value="local-agent">local-agent</option>
            <option value="smb">smb</option>
            <option value="nfs">nfs</option>
          </select>
          <input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="Input folder path"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={outputPath}
            onChange={(e) => setOutputPath(e.target.value)}
            placeholder="Output folder path"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
        </div>
        <button
          type="button"
          onClick={addConnection}
          className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white"
        >
          Save Connection
        </button>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="grid grid-cols-5 border-b border-slate-800 px-5 py-3 text-xs uppercase tracking-wide text-slate-400">
          <span>Name</span>
          <span>Protocol</span>
          <span>Input</span>
          <span>Output</span>
          <span>Status</span>
        </div>
        <div className="divide-y divide-slate-800">
          {connections.map((c) => (
            <div key={c.id} className="grid grid-cols-5 gap-3 px-5 py-4 text-sm">
              <span className="text-slate-100">{c.name}</span>
              <span className="text-slate-300">{c.protocol}</span>
              <span className="truncate text-slate-300" title={c.inputFolderPath}>
                {c.inputFolderPath}
              </span>
              <span className="truncate text-slate-300" title={c.outputFolderPath}>
                {c.outputFolderPath}
              </span>
              <button
                type="button"
                onClick={() => toggleActive(c.id, c.active)}
                className={`w-fit rounded-md px-2 py-1 text-xs ${
                  c.active ? "bg-emerald-900/50 text-emerald-300" : "bg-slate-800 text-slate-300"
                }`}
              >
                {c.active ? "Active" : "Inactive"}
              </button>
            </div>
          ))}
        </div>
      </section>
    </SaaSShell>
  );
}
