import type { TraceDisposition } from "../types";

const STYLES: Record<TraceDisposition, string> = {
  draft: "bg-indigo-100 text-indigo-800 border-indigo-200",
  escalated: "bg-amber-100 text-amber-900 border-amber-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
};

export function DispositionBadge({ disposition }: { disposition: TraceDisposition }) {
  return (
    <span
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${STYLES[disposition]}`}
    >
      {disposition}
    </span>
  );
}
