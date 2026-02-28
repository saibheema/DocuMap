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

/* ───── API helpers (direct calls for mapping memory CRUD) ───── */

const isLocal =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

const API_URL =
  process.env.NEXT_PUBLIC_API_URL || (isLocal ? "http://localhost:4000" : "");

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

type MemoryStore = {
  tenantId: string;
  entries: MemoryEntry[];
  updatedAt: string;
};

/* ───── custom node components ───── */

function SourceLabelNode({ data }: NodeProps) {
  const d = data as { label: string; onRemove?: () => void };
  return (
    <div className="group flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2 shadow-sm hover:shadow-md transition-shadow min-w-[140px] max-w-[260px]">
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !bg-blue-500 !border-white !border-2" />
      <span className="text-sm text-gray-800 truncate flex-1" title={d.label}>{d.label}</span>
      {d.onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onRemove!(); }}
          className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-600 transition-opacity ml-1"
          title="Remove this source label"
        >&#10005;</button>
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
  return (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm min-w-[200px] max-w-[280px]">
      <Handle type="target" position={Position.Left} className="!w-3.5 !h-3.5 !bg-emerald-500 !border-white !border-2" />
      <div className="font-semibold text-gray-900 text-sm">{d.label}</div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500">
          {d.sourceCount} source{d.sourceCount !== 1 ? "s" : ""} mapped
        </span>
        {d.onAddLabel && (
          <button
            onClick={(e) => { e.stopPropagation(); d.onAddLabel!(d.targetKey); }}
            className="flex items-center gap-0.5 rounded-md bg-blue-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-600 transition-colors"
          >
            <span className="text-sm leading-none">+</span> Add
          </button>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  sourceLabel: SourceLabelNode,
  targetField: TargetFieldNode,
};

/* ───── layout helpers ───── */

const SOURCE_X = 50;
const TARGET_X = 550;
const Y_GAP = 80;
const GROUP_GAP = 30;

function buildNodesAndEdges(
  entries: MemoryEntry[],
  onRemoveLabel: (targetKey: string, label: string) => void,
  onAddLabel: (targetKey: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const fieldOrder = new Map<string, number>(OUTPUT_FIELDS.map((f, i) => [f.key, i]));
  const sorted = [...entries].sort((a, b) => {
    const oa = fieldOrder.get(a.targetKey) ?? 999;
    const ob = fieldOrder.get(b.targetKey) ?? 999;
    return oa - ob || a.targetKey.localeCompare(b.targetKey);
  });

  let targetY = 40;

  for (const entry of sorted) {
    const targetId = `target_${entry.targetKey}`;
    const groupStartY = targetY;

    entry.sourceLabels.forEach((label, li) => {
      const sourceId = `source_${entry.targetKey}_${li}`;
      nodes.push({
        id: sourceId,
        type: "sourceLabel",
        position: { x: SOURCE_X, y: groupStartY + li * (Y_GAP - 20) },
        data: {
          label,
          onRemove: () => onRemoveLabel(entry.targetKey, label),
        },
        draggable: true,
      });

      edges.push({
        id: `edge_${sourceId}_${targetId}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#3b82f6", strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
      });
    });

    const centerY = entry.sourceLabels.length > 0
      ? groupStartY + ((entry.sourceLabels.length - 1) * (Y_GAP - 20)) / 2
      : groupStartY;

    nodes.push({
      id: targetId,
      type: "targetField",
      position: { x: TARGET_X, y: centerY },
      data: {
        label: OUTPUT_FIELDS.find((f) => f.key === entry.targetKey)?.label || entry.targetKey,
        targetKey: entry.targetKey,
        sourceCount: entry.sourceLabels.length,
        onAddLabel,
      },
      draggable: true,
    });

    targetY = groupStartY + Math.max(entry.sourceLabels.length, 1) * (Y_GAP - 20) + GROUP_GAP + Y_GAP;
  }

  const usedTargets = new Set(entries.map((e) => e.targetKey));
  for (const field of OUTPUT_FIELDS) {
    if (usedTargets.has(field.key)) continue;
    const targetId = `target_${field.key}`;
    nodes.push({
      id: targetId,
      type: "targetField",
      position: { x: TARGET_X, y: targetY },
      data: {
        label: field.label,
        targetKey: field.key,
        sourceCount: 0,
        onAddLabel,
      },
      draggable: true,
    });
    targetY += Y_GAP + 10;
  }

  return { nodes, edges };
}

/* ───── main page ───── */

export default function MappingVisualPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [addModal, setAddModal] = useState<{ targetKey: string; targetLabel: string } | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const loadMemory = useCallback(async () => {
    try {
      const store = await api<MemoryStore>("/mapping-memory");
      setMemoryEntries(store.entries);
      setError(null);
    } catch (e) {
      setMemoryEntries([]);
      setError(e instanceof Error ? e.message : "Failed to load mapping memory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMemory();
  }, [loadMemory]);

  const handleRemoveLabel = useCallback(async (targetKey: string, label: string) => {
    try {
      const store = await api<MemoryStore>("/mapping-memory/remove-label", {
        method: "POST",
        body: { targetKey, sourceLabel: label },
      });
      setMemoryEntries(store.entries);
      setMessage(`Removed "${label}" from ${targetKey}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove label");
    }
  }, []);

  const handleAddLabel = useCallback((targetKey: string) => {
    const field = OUTPUT_FIELDS.find((f) => f.key === targetKey);
    setAddModal({ targetKey, targetLabel: field?.label || targetKey });
    setNewLabel("");
  }, []);

  const submitAddLabel = useCallback(async () => {
    if (!addModal || !newLabel.trim()) return;
    try {
      const store = await api<MemoryStore>("/mapping-memory/add-label", {
        method: "POST",
        body: { targetKey: addModal.targetKey, targetType: "field", sourceLabel: newLabel.trim() },
      });
      setMemoryEntries(store.entries);
      setMessage(`Added "${newLabel.trim()}" to ${addModal.targetLabel}`);
      setAddModal(null);
      setNewLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add label");
    }
  }, [addModal, newLabel]);

  useEffect(() => {
    const { nodes: n, edges: e } = buildNodesAndEdges(memoryEntries, handleRemoveLabel, handleAddLabel);
    setNodes(n);
    setEdges(e);
  }, [memoryEntries, handleRemoveLabel, handleAddLabel, setNodes, setEdges]);

  const totalLabels = useMemo(
    () => memoryEntries.reduce((sum, e) => sum + e.sourceLabels.length, 0),
    [memoryEntries]
  );

  const totalTargets = useMemo(
    () => memoryEntries.filter((e) => e.sourceLabels.length > 0).length,
    [memoryEntries]
  );

  if (loading) {
    return (
      <SaaSShell title="Visual Mapping Board" workspaceLabel={getTenantId()}>
        <div className="card p-8 text-center text-gray-500">Loading mapping memory...</div>
      </SaaSShell>
    );
  }

  return (
    <SaaSShell
      title="Visual Mapping Board"
      subtitle="Your mapping rules. Drag to rearrange, click + to add source labels."
      workspaceLabel={getTenantId()}
    >
      {error && <div className="card mb-4 p-3 text-sm text-rose-600">{error}</div>}
      {message && <div className="card mb-4 p-3 text-sm text-emerald-600">{message}</div>}

      <div className="card mb-4 p-3 flex items-center gap-6 text-sm">
        <span className="text-gray-600">
          <span className="font-semibold text-gray-900">{totalTargets}</span> target fields with
          <span className="font-semibold text-gray-900"> {totalLabels}</span> source label rules
        </span>
        <button
          onClick={loadMemory}
          className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <div className="card overflow-hidden" style={{ height: 650 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "#3b82f6", strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n: Node) => (n.type === "targetField" ? "#d1fae5" : "#dbeafe")}
            maskColor="rgba(0,0,0,0.08)"
            style={{ border: "1px solid #e5e7eb" }}
          />
          <Panel position="top-left" className="!bg-white/90 !rounded-lg !border !border-gray-200 !px-3 !py-2 !shadow-sm">
            <div className="text-xs text-gray-500">
              <span className="inline-block w-3 h-3 rounded bg-blue-100 border border-blue-300 mr-1 align-middle" /> Source labels
              <span className="mx-2">&rarr;</span>
              <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300 mr-1 align-middle" /> Target fields
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {addModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Add Source Label</h3>
            <p className="text-sm text-gray-500 mb-4">
              Add a new source field name that maps to <span className="font-medium text-emerald-700">{addModal.targetLabel}</span>.
              This will be remembered for all future file uploads.
            </p>
            <input
              autoFocus
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAddLabel()}
              placeholder="e.g. Current Assets - Closing Balance"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setAddModal(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitAddLabel}
                disabled={!newLabel.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Save Label
              </button>
            </div>
          </div>
        </div>
      )}

      {memoryEntries.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">All Mapping Rules</h2>
          <div className="overflow-auto max-h-96 rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-gray-500">Target Field</th>
                  <th className="px-4 py-2 text-left text-xs text-gray-500">Source Labels</th>
                  <th className="px-4 py-2 text-right text-xs text-gray-500">Uses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {memoryEntries.map((entry) => (
                  <tr key={entry.targetKey} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {OUTPUT_FIELDS.find((f) => f.key === entry.targetKey)?.label || entry.targetKey}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {entry.sourceLabels.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs text-blue-700"
                          >
                            {label}
                            <button
                              onClick={() => handleRemoveLabel(entry.targetKey, label)}
                              className="text-blue-400 hover:text-red-500 ml-0.5"
                            >&#10005;</button>
                          </span>
                        ))}
                        <button
                          onClick={() => handleAddLabel(entry.targetKey)}
                          className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600"
                        >+ add</button>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{entry.usageCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </SaaSShell>
  );
}
