import { Fragment, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DispositionBadge } from "../components/DispositionBadge";
import { listTraces } from "../lib/api";
import type { AgentTrace } from "../types";

const INQUIRY_TRUNCATE = 80;

interface ConfidenceBucket {
  bucket: string;
  count: number;
}

function computeConfidenceBuckets(traces: AgentTrace[]): ConfidenceBucket[] {
  const ranges = [
    { bucket: "0.0–0.2", min: 0, max: 0.2 },
    { bucket: "0.2–0.4", min: 0.2, max: 0.4 },
    { bucket: "0.4–0.6", min: 0.4, max: 0.6 },
    { bucket: "0.6–0.8", min: 0.6, max: 0.8 },
    { bucket: "0.8–1.0", min: 0.8, max: 1.01 },
  ];
  const counts = new Array<number>(ranges.length).fill(0);
  for (const t of traces) {
    const conf = t.classification?.confidence;
    if (conf === undefined || conf === null) continue;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      if (conf >= r.min && conf < r.max) {
        counts[i]!++;
        break;
      }
    }
  }
  return ranges.map((r, i) => ({ bucket: r.bucket, count: counts[i]! }));
}

export function Traces() {
  const [traces, setTraces] = useState<AgentTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await listTraces();
      result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setTraces(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function toggle(traceId: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(traceId)) next.delete(traceId);
      else next.add(traceId);
      return next;
    });
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900">Recent traces</h2>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="bg-white border border-zinc-300 hover:border-indigo-500 hover:text-indigo-600 text-sm font-medium px-3 py-1.5 rounded disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <ConfidenceChart traces={traces} />

      {error && (
        <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 text-sm">
          Couldn't load traces: {error}
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-600 text-left">
            <tr>
              <Th>Timestamp</Th>
              <Th>Member</Th>
              <Th>Inquiry</Th>
              <Th>Intent</Th>
              <Th>Conf.</Th>
              <Th>Tools</Th>
              <Th>Disposition</Th>
            </tr>
          </thead>
          <tbody>
            {traces.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center text-zinc-500 py-6">
                  No traces yet. Ask the agent something on the Chat page.
                </td>
              </tr>
            )}
            {traces.map((t) => {
              const isOpen = expanded.has(t.traceId);
              const inquiryDisplay =
                t.userInquiry.length > INQUIRY_TRUNCATE
                  ? `${t.userInquiry.slice(0, INQUIRY_TRUNCATE)}…`
                  : t.userInquiry;
              return (
                <Fragment key={t.traceId}>
                  <tr
                    onClick={() => toggle(t.traceId)}
                    className="border-t border-zinc-100 hover:bg-zinc-50 cursor-pointer"
                  >
                    <Td className="font-mono text-xs text-zinc-600 whitespace-nowrap">
                      {formatTimestamp(t.timestamp)}
                    </Td>
                    <Td className="font-mono text-xs">{t.memberId}</Td>
                    <Td className="text-zinc-700">{inquiryDisplay}</Td>
                    <Td className="text-xs">
                      {t.classification?.intent ?? <span className="text-zinc-400">—</span>}
                    </Td>
                    <Td className="text-xs font-medium">
                      {t.classification ? t.classification.confidence.toFixed(2) : "—"}
                    </Td>
                    <Td className="text-xs text-zinc-600">{t.toolCalls.length}</Td>
                    <Td>
                      <DispositionBadge disposition={t.disposition} />
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-50/50 border-t border-zinc-100">
                      <td colSpan={7} className="px-4 py-4">
                        <TraceDetail trace={t} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium text-xs uppercase tracking-wide">{children}</th>;
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className ?? ""}`}>{children}</td>;
}

function TraceDetail({ trace }: { trace: AgentTrace }) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Trace ID">
        <span className="font-mono text-xs">{trace.traceId}</span>
      </Section>

      <Section title="Inquiry">
        <p className="text-sm text-zinc-800 whitespace-pre-wrap">{trace.userInquiry}</p>
      </Section>

      {trace.classification && (
        <Section title="Classification">
          <div className="text-sm">
            <div>
              Intent: <span className="font-medium">{trace.classification.intent}</span>
              <span className="text-zinc-500"> · confidence {trace.classification.confidence.toFixed(2)}</span>
            </div>
            <div className="text-zinc-600 mt-1">{trace.classification.reasoning}</div>
          </div>
        </Section>
      )}

      <Section title="Draft response">
        {trace.disposition === "escalated" ? (
          <div className="text-sm">
            <span className="font-medium text-amber-900">Escalated.</span>
            {trace.escalationReason && (
              <span className="text-zinc-600">
                {" "}Reason: <span className="font-mono">{trace.escalationReason}</span>
              </span>
            )}
          </div>
        ) : trace.draftResponse ? (
          <p className="text-sm text-zinc-800 whitespace-pre-wrap">{trace.draftResponse}</p>
        ) : (
          <p className="text-sm text-zinc-500 italic">No draft produced.</p>
        )}
      </Section>

      <Section title={`Tool calls (${trace.toolCalls.length})`}>
        {trace.toolCalls.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No tool calls.</p>
        ) : (
          <ol className="flex flex-col gap-2 text-xs">
            {trace.toolCalls.map((c, i) => (
              <li key={i} className="bg-white border border-zinc-200 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-medium text-zinc-900">{c.toolName}</span>
                  <span className="text-zinc-500">{c.durationMs}ms</span>
                </div>
                <pre className="bg-zinc-50 border border-zinc-100 rounded p-2 overflow-x-auto text-zinc-700">
                  {JSON.stringify({ input: c.input, output: c.output }, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function ConfidenceChart({ traces }: { traces: AgentTrace[] }) {
  const buckets = computeConfidenceBuckets(traces);
  const hasData = buckets.some((b) => b.count > 0);
  if (!hasData) return null;

  return (
    <div className="bg-white border border-zinc-200 rounded p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-2">
        Classifier confidence distribution
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={buckets}>
          <XAxis dataKey="bucket" tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={30} />
          <Tooltip />
          <Bar dataKey="count" fill="#6366f1" radius={[2, 2, 0, 0]}>
            <LabelList dataKey="count" position="top" fill="#52525b" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
