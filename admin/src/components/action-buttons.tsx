'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ActionType, ReportStatus } from '@/lib/types';

const ACTIONS: { type: ActionType; label: string; tone: string }[] = [
  { type: 'removed_content', label: 'Remove content', tone: 'bg-slate-900 hover:bg-slate-800' },
  { type: 'warned', label: 'Warn', tone: 'bg-amber-600 hover:bg-amber-500' },
  { type: 'dismissed', label: 'Dismiss', tone: 'bg-slate-200 text-slate-700 hover:bg-slate-300' },
];

export function ActionButtons({
  reportId,
  status,
  isCsae,
  targetUserId,
}: {
  reportId: string;
  status: ReportStatus;
  isCsae: boolean;
  targetUserId: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<ActionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolved = status === 'actioned' || status === 'dismissed';

  async function runAction(actionType: ActionType) {
    setPending(actionType);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Action failed');
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setPending(null);
    }
  }

  if (resolved) {
    return <p className="mt-6 text-sm text-slate-500">This report has been resolved ({status}).</p>;
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.type}
            onClick={() => runAction(a.type)}
            disabled={pending !== null}
            className={`rounded-lg px-3 py-2 text-sm font-medium text-white disabled:opacity-50 ${a.tone}`}
          >
            {pending === a.type ? 'Working…' : a.label}
          </button>
        ))}
        <button
          onClick={() => runAction('disabled_account')}
          disabled={pending !== null || !targetUserId}
          title={targetUserId ? undefined : 'This report has no target user to disable.'}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {pending === 'disabled_account' ? 'Working…' : 'Suspend / disable account'}
        </button>
        {isCsae && (
          <button
            onClick={() => runAction('reported_to_authorities')}
            disabled={pending !== null}
            className="rounded-lg border-2 border-red-600 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
          >
            {pending === 'reported_to_authorities' ? 'Working…' : 'Mark reported to Cybertip.ca'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
