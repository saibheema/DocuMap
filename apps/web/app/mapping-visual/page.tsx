"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
  Panel,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SaaSShell } from "../../components/saas-shell";
import { getTenantId } from "../../lib/api";
import { OUTPUT_FIELDS } from "@documap/shared";

/* ───── API helpers ───── */

const API_URL = process.env.NEXT_PUBLIC_API_URL || (
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:4000"
    : ""
);

const TENANT = process.env.NEXT_PUBLIC_TENANT_ID || "default-tenant";

async function api<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts?.method || "GET",
    headers: { "Content-Type": "application/json", "x-tenant-id": TENANT },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type MemoryEntry = {
  targetKey: string;
  targetType: "field" | "table";
  sourceLabels: string[];
  usageCount: number;
  lastUsed: string;
};

type MemoryStore = { tenantId: string; entries: MemoryEntry[]; updatedAt: string };

/* ─── Icons (inline SVG for zero deps) ─── */

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="4" y="8" width="16" height="8" rx="4" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1.5" />
      <rect x="4" y="20" width="16" height="8" rx="4" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1.5" />
      <rect x="4" y="32" width="16" height="8" rx="4" fill="#DBEAFE" stroke="#93C5FD" strokeWidth="1.5" />
      <rect x="28" y="14" width="16" height="10" rx="5" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="1.5" />
      <rect x="28" y="30" width="16" height="10" rx="5" fill="#D1FAE5" stroke="#6EE7B7" strokeWidth="1.5" />
      <path d="M20 12 L28 19" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 24 L28 19" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M20 36 L28 35" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ─── Custom Nodes ─── */

function SourceLabelNode({ data }: NodeProps) {
  const d = data as { label: string; onRemove?: () => void };
  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-white px-3.5 py-2.5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all duration-200 cursor-grab active:cursor-grabbing min-w-[160px] max-w-[280px]">
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-white !shadow-sm !right-[-6px]"
      />
      <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
      <span className="text-sm font-medium text-gray-700 truncate flex-1" title={d.label}>
        {d.label}
      </span>
      {d.onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onRemove!(); }}
          className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-all duration-200"
          title="Remove this source label"
        >
          <IconX />
        </button>
      )}
    </div>
  );
}

function TargetFieldNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    targetKey: string;
    sourceCount: number;
    onAddLabel?: (targetKey: string) => void;
  };
  const hasLabels = d.sourceCount > 0;
  return (
    <div className={`relative rounded-xl border-2 px-4 py-3 shadow-sm hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing min-w-[220px] max-w-[300px] ${
      hasLabels
        ? "border-emerald-300 bg-gradient-to-br from-emerald-50 to-green-50"
        : "border-gray-200 bg-gradient-to-br from-gray-50 to-white border-dashed"
    }`}>
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3.5 !h-3.5 !border-2 !border-white !shadow-sm !left-[-7px] ${
          hasLabels ? "!bg-emerald-500" : "!bg-gray-400"
        }`}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm truncate ${hasLabels ? "text-gray-900" : "text-gray-500"}`}>
            {d.label}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {hasLabels ? (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {d.sourceCount} source{d.sourceCount !== 1 ? "s" : ""}
              </span>
            ) : (
              <span className="text-xs text-gray-400 italic">No sources yet</span>
            )}
          </div>
        </div>
        {d.onAddLabel && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onAddLabel!(d.targetKey); }}
            className="flex items-center gap-1 rounded-lg bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-600 active:bg-blue-700 transition-colors shadow-sm"
          >
            <IconPlus /> Add
          </button>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { sourceLabel: SourceLabelNode, targetField: TargetFieldNode };

/* ─── Layout ─── */

const SRC_X = 40;
const TGT_X = 580;
const ROW_H = 70;
const GAP = 35;

function buildGraph(
  entries: MemoryEntry[],
  onRemove: (k: string, l: string) => void,
  onAdd: (k: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const order = new Map<string, number>(OUTPUT_FIELDS.map((f, i) => [f.key, i]));
  const sorted = [...entries].sort((a, b) =>
    (order.get(a.targetKey) ?? 999) - (order.get(b.targetKey) ?? 999) || a.targetKey.localeCompare(b.targetKey)
  );

  let y = 30;

  for (const entry of sorted) {
    const tid = `t_${entry.targetKey}`;
    const startY = y;

    entry.sourceLabels.forEach((label, i) => {
      const sid = `s_${entry.targetKey}_${i}`;
      nodes.push({
        id: sid,
        type: "sourceLabel",
        position: { x: SRC_X, y: startY + i * ROW_H },
        data: { label, onRemove: () => onRemove(entry.targetKey, label) },
        draggable: true,
      });
      edges.push({
        id: `e_${sid}`,
        source: sid,
        target: tid,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#3b82f6", strokeWidth: 2, strokeDasharray: undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6", width: 16, height: 16 },
      });
    });

    const centerY = entry.sourceLabels.length > 0
      ? startY + ((entry.sourceLabels.length - 1) * ROW_H) / 2
      : startY;

    const field = OUTPUT_FIELDS.find((f) => f.key === entry.targetKey);
    nodes.push({
      id: tid,
      type: "targetField",
      position: { x: TGT_X, y: centerY },
      data: {
        label: field?.label || entry.targetKey,
        targetKey: entry.targetKey,
        sourceCount: entry.sourceLabels.length,
        onAddLabel: onAdd,
      },
      draggable: true,
    });

    y = startY + Math.max(entry.sourceLabels.length, 1) * ROW_H + GAP;
  }

  // Unmapped targets
  const used = new Set(entries.map((e) => e.targetKey));
  OUTPUT_FIELDS.forEach((field) => {
    if (used.has(field.key)) return;
    nodes.push({
      id: `t_${field.key}`,
      type: "targetField",
      position: { x: TGT_X, y },
      data: { label: field.label, targetKey: field.key, sourceCount: 0, onAddLabel: onAdd },
      draggable: true,
    });
    y += ROW_H + 8;
  });

  return { nodes, edges };
}

/* ─── Page ─── */

export default function MappingVisualPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const [addModal, setAddModal] = useState<{ key: string; label: string } | null>(null);
  const [newLabel, setNewLabel] = useState("");

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const s = await api<MemoryStore>("/mapping-memory");
      setEntries(s.entries);
      setError(null);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : "Could not load mapping memory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeLabel = useCallback(async (targetKey: string, label: string) => {
    try {
      const s = await api<MemoryStore>("/mapping-memory/remove-label", {
        method: "POST", body: { targetKey, sourceLabel: label },
      });
      setEntries(s.entries);
      setToast({ text: `Removed "${label}"`, type: "ok" });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Remove failed", type: "err" });
    }
  }, []);

  const openAdd = useCallback((targetKey: string) => {
    const f = OUTPUT_FIELDS.find((o) => o.key === targetKey);
    setAddModal({ key: targetKey, label: f?.label || targetKey });
    setNewLabel("");
  }, []);

  const submitAdd = useCallback(async () => {
    if (!addModal || !newLabel.trim()) return;
    try {
      const s = await api<MemoryStore>("/mapping-memory/add-label", {
        method: "POST",
        body: { targetKey: addModal.key, targetType: "field", sourceLabel: newLabel.trim() },
      });
      setEntries(s.entries);
      setToast({ text: `Added "${newLabel.trim()}" \u2192 ${addModal.label}`, type: "ok" });
      setAddModal(null);
      setNewLabel("");
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Add failed", type: "err" });
    }
  }, [addModal, newLabel]);

  useEffect(() => {
    const g = buildGraph(entries, removeLabel, openAdd);
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [entries, removeLabel, openAdd, setNodes, setEdges]);

  const totalLabels = useMemo(() => entries.reduce((s, e) => s + e.sourceLabels.length, 0), [entries]);
  const mappedTargets = useMemo(() => entries.filter((e) => e.sourceLabels.length > 0).length, [entries]);

  /* ─── Loading ─── */
  if (loading) {
    return (
      <SaaSShell title="Visual Mapping Board" workspaceLabel={getTenantId()}>
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
          <p className="mt-4 text-sm text-gray-500">Loading mapping rules...</p>
        </div>
      </SaaSShell>
    );
  }

  /* ─── Render ─── */
  return (
    <SaaSShell title="Visual Mapping Board" workspaceLabel={getTenantId()}>
      {/* ── Header bar ── */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Manage your field mapping rules. Source labels on the left map to target output fields on the right.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm shadow-sm">
            <div>
              <span className="font-semibold text-gray-900">{mappedTargets}</span>
              <span className="ml-1 text-gray-500">targets</span>
            </div>
            <div className="h-4 w-px bg-gray-200" />
            <div>
              <span className="font-semibold text-gray-900">{totalLabels}</span>
              <span className="ml-1 text-gray-500">rules</span>
            </div>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <IconRefresh /> Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.5a1 1 0 110-2 1 1 0 010 2z"/></svg>
          {error}
        </div>
      )}

      {/* ── Canvas ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ height: "calc(100vh - 280px)", minHeight: 500 }}>
        {entries.length === 0 && totalLabels === 0 ? (
          /* ── Empty state inside canvas area ── */
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <IconMap />
            <h3 className="mt-4 text-lg font-semibold text-gray-900">No mapping rules yet</h3>
            <p className="mt-2 max-w-md text-sm text-gray-500">
              Upload a PDF in the <span className="font-medium text-blue-600">Upload</span> tab, then map fields in <span className="font-medium text-blue-600">Mapping Studio</span>.
              Once you save mappings, they appear here as visual rules you can edit.
            </p>
            <p className="mt-1 max-w-md text-xs text-gray-400">
              Or click <span className="font-medium">+ Add</span> on any target field below to manually create rules.
            </p>
            <div className="mt-8 pt-6 border-t border-gray-100 w-full max-w-lg">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Target fields available</p>
              <div className="flex flex-wrap justify-center gap-2">
                {OUTPUT_FIELDS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => openAdd(f.key)}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  >
                    <IconPlus /> {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.35 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              type: "smoothstep",
              style: { stroke: "#3b82f6", strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#e5e7eb" />
            <Controls
              showInteractive={false}
              className="!rounded-lg !border !border-gray-200 !shadow-sm [&>button]:!rounded-md [&>button]:!border-gray-200"
            />
            <MiniMap
              nodeColor={(n: Node) => (n.type === "targetField" ? "#a7f3d0" : "#bfdbfe")}
              maskColor="rgba(0,0,0,0.06)"
              className="!rounded-lg !border !border-gray-200 !shadow-sm"
            />
            <Panel position="top-left">
              <div className="rounded-lg border border-gray-200 bg-white/95 backdrop-blur px-3 py-2 shadow-sm text-xs text-gray-500 flex items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-gradient-to-r from-blue-100 to-blue-200 border border-blue-300" />
                  Source labels
                </span>
                <span className="text-gray-300">&rarr;</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-md bg-gradient-to-r from-emerald-100 to-emerald-200 border border-emerald-300" />
                  Target fields
                </span>
              </div>
            </Panel>
          </ReactFlow>
        )}
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all duration-300 ${
          toast.type === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
        }`}>
          {toast.type === "ok" ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.03 5.53l-3.5 3.5a.75.75 0 01-1.06 0l-1.5-1.5a.75.75 0 011.06-1.06l.97.97 2.97-2.97a.75.75 0 011.06 1.06z"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3a.75.75 0 01-1.5 0V5zm.75 6.5a1 1 0 110-2 1 1 0 010 2z"/></svg>
          )}
          {toast.text}
        </div>
      )}

      {/* ── Add Label Modal ── */}
      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setAddModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                <IconPlus />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Add Source Label</h3>
                <p className="text-xs text-gray-500">
                  Map to <span className="font-semibold text-emerald-600">{addModal.label}</span>
                </p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Type the exact source field name as it appears in your PDF documents. This mapping will be remembered for all future uploads.
            </p>
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              placeholder="e.g. Current Assets - Closing Balance"
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100 outline-none transition-all"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setAddModal(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitAdd}
                disabled={!newLabel.trim()}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Save Label
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rules table ── */}
      {entries.length > 0 && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm">All Mapping Rules</h2>
            <span className="text-xs text-gray-400">{entries.length} entries</span>
          </div>
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">
                <tr>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Field</th>
                  <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source Labels</th>
                  <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map((entry) => (
                  <tr key={entry.targetKey} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-900 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        {OUTPUT_FIELDS.find((f) => f.key === entry.targetKey)?.label || entry.targetKey}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {entry.sourceLabels.map((label) => (
                          <span
                            key={label}
                            className="group inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs text-blue-700 hover:border-blue-300 transition-colors"
                          >
                            {label}
                            <button
                              onClick={() => removeLabel(entry.targetKey, label)}
                              className="opacity-50 group-hover:opacity-100 text-blue-400 hover:text-red-500 transition-all"
                            >
                              <IconX />
                            </button>
                          </span>
                        ))}
                        <button
                          onClick={() => openAdd(entry.targetKey)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <IconPlus /> add
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {entry.usageCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SaaSShell>
  );
}
