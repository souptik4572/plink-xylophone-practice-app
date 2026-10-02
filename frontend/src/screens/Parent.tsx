import { useState } from 'react'
import type { Instrument } from '../instrument'
import { Calibrate } from './Calibrate'
import { SelfTest } from './SelfTest'

const TABS = [
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'mic', label: 'Mic check' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Grown-up tools: setup and troubleshooting live here, away from her screens. */
export function Parent({ instrument, onInstrument }: { instrument: Instrument; onInstrument: (i: Instrument) => void }) {
  const [tab, setTab] = useState<TabId>('calibrate')
  return (
    <div className="parent">
      <div className="subnav" role="tablist" aria-label="Parent tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'calibrate' && <Calibrate instrument={instrument} onSaved={onInstrument} />}
      {tab === 'mic' && <SelfTest instrument={instrument} />}
    </div>
  )
}
