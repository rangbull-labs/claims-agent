import { useEffect, useState } from "react";

import { listMembers } from "../lib/api";
import type { Member } from "../types";

interface Props {
  value: string | null;
  onChange: (memberId: string | null) => void;
}

export function MemberPicker({ value, onChange }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMembers()
      .then((m) => {
        if (cancelled) return;
        // Stable order: by memberId ascending (M-001, M-002, ...)
        m.sort((a, b) => a.memberId.localeCompare(b.memberId));
        setMembers(m);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="text-zinc-500 text-sm">Loading members…</div>;
  }
  if (error) {
    return (
      <div className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 text-sm">
        Couldn't load members: {error}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-zinc-700">Member</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="border border-zinc-300 rounded px-3 py-2 bg-white text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      >
        <option value="">— Select a member —</option>
        {members.map((m) => (
          <option key={m.memberId} value={m.memberId}>
            {m.firstName} {m.lastName} · {m.memberId} · {m.planType}
          </option>
        ))}
      </select>
    </label>
  );
}
