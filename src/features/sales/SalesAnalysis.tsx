'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function SalesAnalysis({ month }: { month: string | null }) {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'error' | 'ready'; text?: string }>({ kind: 'idle' });

  async function runAnalysis() {
    if (!month) return;
    const lastDay = new Date(`${month}-01T12:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: 'daily_summary',
          startDate: `${month}-01`,
          endDate: `${month}-${String(lastDay.getUTCDate()).padStart(2, '0')}`,
        }),
      });
      const payload = await response.json().catch(() => null) as { analysis?: string; error?: string } | null;
      if (!response.ok || !payload?.analysis) {
        throw new Error(payload?.error ?? 'Analysis is unavailable right now.');
      }
      setState({ kind: 'ready', text: payload.analysis });
    } catch (error) {
      setState({ kind: 'error', text: error instanceof Error ? error.message : 'Analysis is unavailable right now.' });
    }
  }

  return (
    <div className="space-y-4">
      <Button disabled={!month || state.kind === 'loading'} onClick={() => void runAnalysis()} variant="secondary">
        {state.kind === 'loading' ? 'Running analysis…' : 'Run AI analysis'}
      </Button>
      {state.kind === 'error' ? <p className="text-sm text-ink" role="alert">{state.text}</p> : null}
      {state.kind === 'ready' ? <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{state.text}</p> : null}
    </div>
  );
}
