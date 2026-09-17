'use client';
import { useState } from 'react';
import type { VaultController } from '@/hooks/parcel/use-vault';
import type { ExploreDraft } from '@/lib/parcel/explore';
import { OptionsView } from './OptionsView';

/**
 * One trading door.
 *
 * Trade, Underwrite and Structures were three nav items rendering the same
 * component with a prop that only filtered the template list. They are modes
 * of one workflow, so they are a control inside it rather than separate
 * destinations.
 */
const MODES = [
  { id: 'trade', label: 'Trade' },
  { id: 'underwrite', label: 'Underwrite' },
  { id: 'structures', label: 'Structures' },
] as const;

export type TradeMode = (typeof MODES)[number]['id'];

export function TradeView({
  desk,
  initialDraft,
  draftMode,
  draftKey,
}: {
  desk: VaultController;
  initialDraft?: ExploreDraft;
  draftMode?: TradeMode;
  draftKey?: number;
}) {
  const [mode, setMode] = useState<TradeMode>(draftMode || 'trade');
  return (
    <>
      <fieldset className="od-trade-modes" aria-label="Trading mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'selected' : ''}
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </fieldset>
      <OptionsView
        key={`${mode}:${draftKey || 0}`}
        desk={desk}
        mode={mode}
        initialDraft={draftMode === mode ? initialDraft : undefined}
      />
    </>
  );
}
