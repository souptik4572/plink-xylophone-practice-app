import { useEffect, useState } from 'react'
import { deleteAllData, listSessions, writeParentNote, type SessionSummary } from '../api'
import type { Instrument } from '../instrument'
import { Calibrate } from './Calibrate'
import { SelfTest } from './SelfTest'

const TABS = [
  { id: 'progress', label: 'Progress' },
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'mic', label: 'Mic check' },
  { id: 'data', label: 'Data' },
] as const
type TabId = (typeof TABS)[number]['id']

function Progress() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [writing, setWriting] = useState<number | null>(null)

  const load = () =>
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  useEffect(() => {
    void load()
  }, [])

  const write = async (id: number) => {
    setWriting(id)
    try {
      await writeParentNote(id)
      await load()
    } finally {
      setWriting(null)
    }
  }

  if (!sessions) return <p className="muted">Loading…</p>
  if (sessions.length === 0) return <p className="muted">No practice yet. Notes appear here after each session.</p>
  return (
    <ul className="sessions">
      {sessions.map((s) => (
        <li key={s.id} className="panel">
          <div className="session-head">
            <strong>{new Date(s.started_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</strong>
            <span className="muted">
              {s.stats.phrases} phrases · {s.stats.notes} notes · {s.stats.first_try_pct}% first time
              {s.player === 'tester' && ' · tester'}
            </span>
          </div>
          {s.parent_note ? (
            <p>{s.parent_note}</p>
          ) : (
            <button type="button" onClick={() => write(s.id)} disabled={writing !== null}>
              {writing === s.id ? 'Gemma is writing…' : 'Write a note'}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Data({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const remove = async () => {
    await deleteAllData()
    setConfirming(false)
    setDone(true)
    onDeleted()
  }
  return (
    <div className="panel">
      <p>
        Everything Plink keeps is on this laptop: her practice log, session notes, added songs and the calibration. No
        audio is ever stored.
      </p>
      {done && <p className="muted">All data deleted.</p>}
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)}>
          Delete all data…
        </button>
      ) : (
        <div className="row">
          <button type="button" className="danger" onClick={remove}>
            Yes, delete everything
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}
    </div>
  )
}

/** Grown-up tools: progress notes, setup and troubleshooting live here, away from her screens. */
export function Parent({
  instrument,
  onInstrument,
  onDeleted,
}: {
  instrument: Instrument
  onInstrument: (i: Instrument) => void
  onDeleted: () => void
}) {
  const [tab, setTab] = useState<TabId>('progress')
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
      {tab === 'progress' && <Progress />}
      {tab === 'calibrate' && <Calibrate instrument={instrument} onSaved={onInstrument} />}
      {tab === 'mic' && <SelfTest instrument={instrument} />}
      {tab === 'data' && <Data onDeleted={onDeleted} />}
    </div>
  )
}
