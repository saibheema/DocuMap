"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OUTPUT_FIELDS } from "@documap/shared";
import { SaaSShell } from "../../components/saas-shell";
import {
  autoApplyMappings,
  generateOutput,
  getTenantId,
  learnMappings,
  listUploads,
  saveMapping,
  type UploadReference
} from "../../lib/api";

/* ───── types ───── */

type SourceNode = {
  id: string;
  label: string;
  value: string;
  y: number; // position on left lane
};

type TargetNode = {
  key: string;
  label: string;
  y: number;
};

type Connection = {
  id: string;
  sourceId: string;
  targetKey: string;
  autoApplied?: boolean;
  confidence?: number;
};

/* ───── constants ───── */

const LANE_LEFT = 30;       // x% position of source lane center
const LANE_RIGHT = 70;      // x% position of target lane center
const NODE_W = 240;
const NODE_H = 52;
const NODE_GAP = 10;
const DOT_RADIUS = 8;

/* ───── helpers ───── */

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function getColor(confidence?: number, auto?: boolean) {
  if (!auto) return "#3b82f6"; // blue – manual
  if (confidence && confidence >= 0.8) return "#22c55e"; // green
  if (confidence && confidence >= 0.5) return "#f59e0b"; // amber
  return "#3b82f6";
}

/* ───── component ───── */

export default function MappingVisualPage() {
  const [uploads, setUploads] = useState<UploadReference[]>([]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Canvas drag-to-connect state
  const [dragging, setDragging] = useState<{ sourceId: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Source + target nodes
  const selectedFile = useMemo(
    () => uploads.find((u) => u.fileId === selectedFileId) || null,
    [uploads, selectedFileId]
  );

  const sourceNodes: SourceNode[] = useMemo(() => {
    if (!selectedFile) return [];
    return selectedFile.extractedFields.map((f, i) => ({
      id: f.id,
      label: f.label,
      value: f.value,
      y: i * (NODE_H + NODE_GAP) + 20
    }));
  }, [selectedFile]);

  const targetNodes: TargetNode[] = useMemo(() => {
    return OUTPUT_FIELDS.map((o, i) => ({
      key: o.key,
      label: o.label,
      y: i * (NODE_H + NODE_GAP) + 20
    }));
  }, []);

  // Scroll containers
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const targetScrollRef = useRef<HTMLDivElement>(null);
  const [sourceScroll, setSourceScroll] = useState(0);
  const [targetScroll, setTargetScroll] = useState(0);

  /* ───── load data ───── */

  useEffect(() => {
    listUploads()
      .then((res) => {
        setUploads(res.items);
        if (res.items.length > 0) setSelectedFileId(res.items[0].fileId);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load uploads"));
  }, []);

  /* ───── auto-apply when file changes ───── */

  useEffect(() => {
    if (!selectedFile) return;
    setConnections([]);
    setMessage(null);

    autoApplyMappings(selectedFile.extractedFields)
      .then((rows) => {
        if (rows.length > 0) {
          setConnections(
            rows.map((r) => ({
              id: r.id,
              sourceId: r.sourceKey,
              targetKey: r.targetKey,
              autoApplied: r.autoApplied,
              confidence: r.confidence
            }))
          );
          setMessage(`Auto-applied ${rows.length} mapping(s) from memory`);
        }
      })
      .catch(() => {});
  }, [selectedFileId, selectedFile]);

  /* ───── connection management ───── */

  const addConnection = useCallback(
    (sourceId: string, targetKey: string) => {
      // Allow multiple sources per target (that's the feature!)
      // But prevent exact duplicate source→target link
      if (connections.some((c) => c.sourceId === sourceId && c.targetKey === targetKey)) return;
      setConnections((prev) => [
        ...prev,
        { id: `conn_${Date.now()}_${prev.length}`, sourceId, targetKey }
      ]);
    },
    [connections]
  );

  const removeConnection = useCallback((id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setConnections([]);
    setMessage(null);
  }, []);

  /* ───── drag-to-connect handlers ───── */

  const handleSourceMouseDown = useCallback(
    (sourceId: string, e: React.MouseEvent) => {
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setDragging({ sourceId, x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragging) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      setDragging((prev) => prev ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  const handleTargetDrop = useCallback(
    (targetKey: string) => {
      if (dragging) {
        addConnection(dragging.sourceId, targetKey);
        setDragging(null);
      }
    },
    [dragging, addConnection]
  );

  /* ───── save & generate ───── */

  const handleSave = async () => {
    if (!selectedFile || connections.length === 0) {
      setError("Add at least one mapping connection first.");
      return;
    }
    const mappings = connections.map((c) => ({
      sourceType: "field" as const,
      sourceKey: c.sourceId,
      targetType: "field" as const,
      targetKey: c.targetKey
    }));

    try {
      await saveMapping({
        name: `visual-mapping-${selectedFile.fileName.replace(/\.[^.]+$/, "")}`,
        fileId: selectedFile.fileId,
        outputFormat: "csv",
        mappings
      });
      await learnMappings(mappings, selectedFile.extractedFields);
      setMessage(`Saved ${connections.length} mapping(s) and learned for future auto-apply.`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save mappings");
    }
  };

  const handleGenerate = async () => {
    if (!selectedFile || connections.length === 0) {
      setError("Add at least one mapping connection first.");
      return;
    }
    try {
      const result = await generateOutput({
        fileId: selectedFile.fileId,
        mappings: connections.map((c) => ({
          sourceType: "field" as const,
          sourceKey: c.sourceId,
          targetType: "field" as const,
          targetKey: c.targetKey
        }))
      });
      // Download CSV
      const headers = Object.keys(result.output.fields);
      const values = Object.values(result.output.fields);
      const csv = `file_name,${headers.join(",")}\n${result.sourceFileName},${values.join(",")}\n`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mapped_${result.sourceFileName.replace(/\.pdf$/i, "")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Learn these mappings
      await learnMappings(
        connections.map((c) => ({
          sourceType: "field" as const,
          sourceKey: c.sourceId,
          targetType: "field" as const,
          targetKey: c.targetKey
        })),
        selectedFile.extractedFields
      );

      setMessage(`Generated output for ${result.sourceFileName} and learned mappings.`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    }
  };

  /* ───── source node positions by id ───── */

  const sourceYById = useMemo(() => {
    const map = new Map<string, number>();
    sourceNodes.forEach((n) => map.set(n.id, n.y));
    return map;
  }, [sourceNodes]);

  const targetYByKey = useMemo(() => {
    const map = new Map<string, number>();
    targetNodes.forEach((n) => map.set(n.key, n.y));
    return map;
  }, [targetNodes]);

  /* ───── summary: per-target grouped sources ───── */

  const targetSummary = useMemo(() => {
    const map = new Map<string, { targetLabel: string; sources: Array<{ id: string; label: string; value: string; confidence?: number }> }>();
    for (const t of targetNodes) {
      map.set(t.key, { targetLabel: t.label, sources: [] });
    }
    for (const c of connections) {
      const entry = map.get(c.targetKey);
      const src = sourceNodes.find((s) => s.id === c.sourceId);
      if (entry && src) {
        entry.sources.push({ id: src.id, label: src.label, value: src.value, confidence: c.confidence });
      }
    }
    return Array.from(map.entries())
      .filter(([, v]) => v.sources.length > 0)
      .map(([key, v]) => ({ targetKey: key, ...v }));
  }, [connections, sourceNodes, targetNodes]);

  /* ───── canvas height ───── */
  const canvasH = Math.max(
    sourceNodes.length * (NODE_H + NODE_GAP) + 40,
    targetNodes.length * (NODE_H + NODE_GAP) + 40,
    400
  );

  /* ───── render ───── */

  return (
    <SaaSShell
      title="Visual Mapping Canvas"
      subtitle="Drag from source fields (left) to target fields (right). Multiple sources can feed one target."
      workspaceLabel={getTenantId()}
    >
      {error && <div className="card mb-4 p-3 text-sm text-rose-600">{error}</div>}
      {message && <div className="card mb-4 p-3 text-sm text-emerald-600">{message}</div>}

      {/* Toolbar */}
      <section className="card mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            <span className="text-xs text-gray-500">Source file</span>
            <select
              value={selectedFileId}
              onChange={(e) => setSelectedFileId(e.target.value)}
              className="ml-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">Select</option>
              {uploads.map((u) => (
                <option key={u.fileId} value={u.fileId}>
                  {u.fileName}
                </option>
              ))}
            </select>
          </label>

          <button onClick={clearAll} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            Clear All
          </button>
          <button onClick={handleSave} className="rounded-md border border-emerald-500 px-3 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50">
            Save & Learn
          </button>
          <button onClick={handleGenerate} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Generate Output
          </button>

          <span className="ml-auto text-xs text-gray-500">{connections.length} connection(s)</span>
        </div>
      </section>

      {/* Canvas area */}
      {selectedFile && sourceNodes.length > 0 ? (
        <section className="card p-0 overflow-hidden">
          <div className="relative flex" style={{ minHeight: 500 }}>
            {/* Left: Source Nodes */}
            <div
              ref={sourceScrollRef}
              onScroll={() => setSourceScroll(sourceScrollRef.current?.scrollTop ?? 0)}
              className="w-[35%] overflow-y-auto border-r border-gray-200 bg-gray-50/50 p-4"
              style={{ maxHeight: 600 }}
            >
              <h3 className="mb-3 text-xs font-semibold uppercase text-gray-500">Source Fields ({sourceNodes.length})</h3>
              <div style={{ height: canvasH, position: "relative" }}>
                {sourceNodes.map((node) => {
                  const connected = connections.some((c) => c.sourceId === node.id);
                  return (
                    <div
                      key={node.id}
                      className={`absolute flex items-center justify-between rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors select-none
                        ${connected ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-white"}`}
                      style={{ top: node.y, left: 0, right: 16, height: NODE_H }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800 truncate">{truncate(node.label, 28)}</div>
                        <div className="text-xs text-gray-400 truncate">{truncate(node.value, 32)}</div>
                      </div>
                      {/* Connector dot */}
                      <div
                        className="ml-2 flex-shrink-0 h-5 w-5 rounded-full bg-blue-500 cursor-grab active:cursor-grabbing border-2 border-white shadow hover:scale-125 transition-transform"
                        onMouseDown={(e) => handleSourceMouseDown(node.id, e)}
                        title="Drag to a target field"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Center: SVG Connection Lines */}
            <div className="w-[30%] relative" style={{ minHeight: Math.max(canvasH, 500) }}>
              <svg
                ref={svgRef}
                className="absolute inset-0 w-full h-full"
                style={{ width: "100%", height: Math.max(canvasH + 40, 500) }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {/* Existing connections */}
                {connections.map((conn) => {
                  const sY = (sourceYById.get(conn.sourceId) ?? 0) + NODE_H / 2 - sourceScroll;
                  const tY = (targetYByKey.get(conn.targetKey) ?? 0) + NODE_H / 2 - targetScroll;
                  const color = getColor(conn.confidence, conn.autoApplied);
                  const x1 = 0;
                  const x2 = svgRef.current?.clientWidth ?? 200;
                  const midX = (x1 + x2) / 2;

                  return (
                    <g key={conn.id} className="cursor-pointer" onClick={() => removeConnection(conn.id)}>
                      <path
                        d={`M ${x1} ${sY} C ${midX} ${sY}, ${midX} ${tY}, ${x2} ${tY}`}
                        stroke={color}
                        strokeWidth={2.5}
                        fill="none"
                        strokeOpacity={0.8}
                      />
                      {/* hover overlay – wider click target */}
                      <path
                        d={`M ${x1} ${sY} C ${midX} ${sY}, ${midX} ${tY}, ${x2} ${tY}`}
                        stroke="transparent"
                        strokeWidth={14}
                        fill="none"
                      />
                      {/* confidence badge */}
                      {conn.confidence != null && (
                        <>
                          <rect
                            x={midX - 18}
                            y={(sY + tY) / 2 - 10}
                            width={36}
                            height={20}
                            rx={10}
                            fill={color}
                          />
                          <text
                            x={midX}
                            y={(sY + tY) / 2 + 4}
                            textAnchor="middle"
                            fontSize={10}
                            fill="white"
                            fontWeight={600}
                          >
                            {Math.round(conn.confidence * 100)}%
                          </text>
                        </>
                      )}
                    </g>
                  );
                })}

                {/* Drag preview line */}
                {dragging && (() => {
                  const sY = (sourceYById.get(dragging.sourceId) ?? 0) + NODE_H / 2 - sourceScroll;
                  const x1 = 0;
                  return (
                    <path
                      d={`M ${x1} ${sY} C ${dragging.x / 2} ${sY}, ${dragging.x / 2} ${dragging.y}, ${dragging.x} ${dragging.y}`}
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="none"
                      strokeDasharray="6 4"
                      strokeOpacity={0.6}
                    />
                  );
                })()}
              </svg>
            </div>

            {/* Right: Target Nodes */}
            <div
              ref={targetScrollRef}
              onScroll={() => setTargetScroll(targetScrollRef.current?.scrollTop ?? 0)}
              className="w-[35%] overflow-y-auto border-l border-gray-200 bg-gray-50/50 p-4"
              style={{ maxHeight: 600 }}
            >
              <h3 className="mb-3 text-xs font-semibold uppercase text-gray-500">Target Fields ({targetNodes.length})</h3>
              <div style={{ height: targetNodes.length * (NODE_H + NODE_GAP) + 40, position: "relative" }}>
                {targetNodes.map((node) => {
                  const linked = connections.filter((c) => c.targetKey === node.key);
                  const count = linked.length;
                  return (
                    <div
                      key={node.key}
                      className={`absolute flex items-center rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors select-none
                        ${count > 0 ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white"}
                        ${dragging ? "hover:border-blue-400 hover:bg-blue-50 hover:shadow-md" : ""}`}
                      style={{ top: node.y, left: 16, right: 0, height: NODE_H }}
                      onMouseUp={() => handleTargetDrop(node.key)}
                    >
                      {/* Connector dot (left side) */}
                      <div
                        className={`mr-2 flex-shrink-0 h-5 w-5 rounded-full border-2 border-white shadow
                          ${count > 0 ? "bg-emerald-500" : "bg-gray-300"}
                          ${dragging ? "animate-pulse bg-blue-400" : ""}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-800">{node.label}</div>
                        {count > 0 && (
                          <div className="text-xs text-emerald-600">{count} source{count > 1 ? "s" : ""} linked</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 border-t border-gray-200 px-4 py-2 text-xs text-gray-500 bg-gray-50/50">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-blue-500" /> Manual
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500" /> Auto (≥80%)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-500" /> Auto (50–80%)
            </span>
            <span className="ml-auto">Click a line to remove it</span>
          </div>
        </section>
      ) : (
        <section className="card p-8 text-center text-sm text-gray-500">
          {uploads.length === 0
            ? "No uploaded files found. Go to Upload to add a PDF first."
            : "Select a source file above to start mapping."}
        </section>
      )}

      {/* Mapping Summary — Multi-source per target */}
      {targetSummary.length > 0 && (
        <section className="card mt-4 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Mapping Summary</h2>
          <p className="text-xs text-gray-500 mb-3">
            Multiple source fields per target are summed (numbers) or appended (text) in the output.
          </p>
          <div className="space-y-3">
            {targetSummary.map((item) => (
              <div key={item.targetKey} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="font-medium text-gray-900">{item.targetLabel}</span>
                  <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    {item.sources.length} source{item.sources.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="ml-5 space-y-1">
                  {item.sources.map((src) => (
                    <div key={src.id} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-gray-400">←</span>
                      <span className="font-medium">{src.label}</span>
                      <span className="text-xs text-gray-400 truncate max-w-[200px]" title={src.value}>
                        ({truncate(src.value, 30)})
                      </span>
                      {src.confidence != null && (
                        <span className={`ml-auto text-xs font-medium ${src.confidence >= 0.8 ? "text-emerald-600" : "text-amber-600"}`}>
                          {Math.round(src.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </SaaSShell>
  );
}
