import {
  BrainCircuit,
  CalendarDays,
  ChartColumn,
  Check,
  Database,
  Ear,
  Flame,
  Heart,
  MessageCircleQuestion,
  Mic,
  Music,
  PenLine,
  Save,
  SlidersHorizontal,
  Target,
  Trash2,
  Volume2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  deleteAllData,
  getProgress,
  listSessions,
  saveSettings,
  writeParentNote,
  type Progress,
  type SessionSummary,
  type Settings,
} from '../api'
import { useApp } from '../app/AppContext'
import { useInsights } from '../app/useInsights'
import { AskPlink } from '../kids/AskPlink'
import { adviceText, HELP } from '../kids/help'
import { useSongs } from '../app/useSongs'
import { cn } from '../theme/palette'
import { Button, Card, Chip, Field, ScreenTitle, Switch } from '../ui/ui'
import { say, setSpeechLang } from '../voice'
import { Calibrate } from './Calibrate'
import { SelfTest } from './SelfTest'

const TABS = [
  { id: 'progress', label: 'Progress', icon: ChartColumn },
  { id: 'ask', label: 'Ask Plink', icon: MessageCircleQuestion },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { id: 'calibrate', label: 'Calibrate', icon: Mic },
  { id: 'mic', label: 'Mic check', icon: Ear },
  { id: 'data', label: 'Data', icon: Database },
] as const
type TabId = (typeof TABS)[number]['id']

const LANGUAGES = ['English', 'Bengali', 'Hindi', 'Tamil', 'Telugu', 'Marathi', 'Kannada', 'Malayalam', 'Gujarati', 'Punjabi', 'Urdu', 'Spanish', 'French', 'German']

function HelpCoach() {
  const insights = useInsights()
  const { songs } = useSongs()
  if (!insights) return null
  if (insights.source === 'fallback' || !insights.help) {
    return (
      <Card t={4} border="dashed" className="stack">
        <h3 className="card-title">Help coach</h3>
        <p className="dim with-icon">
          <BrainCircuit aria-hidden size={20} /> TabPFN is still getting to know her: {insights.rows_used} notes so far. After a short
          session with a few hits and a few misses, it starts choosing her practice and advising on help.
        </p>
      </Card>
    )
  }
  const basis = insights.songs.find((s) => s.song_id === insights.help!.basis_song)!
  const title = songs?.find((s) => s.id === basis.song_id)?.title ?? basis.song_id
  const known = new Set(insights.known_levels ?? [])
  return (
    <Card t={4} pattern="dots" className="stack">
      <div className="card-head">
        <h3 className="card-title">Help coach</h3>
        <Chip t={1} icon={<BrainCircuit aria-hidden />}>
          TabPFN · {insights.rows_used} notes · {insights.seconds}s
        </Chip>
      </div>
      <p className="dim">
        Her chance of getting each note right first time on <strong>{title}</strong>, the song she practises most, at each level of help:
      </p>
      <ul className="meters">
        {HELP.map((h) => {
          const pct = Math.round(basis.by_level[h.level] * 100)
          return (
            <li key={h.level} className="meter-row">
              <span className="meter-label">
                {h.emoji} {h.title.split(' ')[0]}
              </span>
              {known.has(h.level) ? (
                <>
                  <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={h.title}>
                    <span className="meter-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="meter-value">{pct}%</span>
                </>
              ) : (
                <span className="faint small meter-unknown">Not tried yet ({insights.rows_by_level?.[h.level] ?? 0} notes)</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="bubble tone-1 with-icon">
        <BrainCircuit aria-hidden size={20} /> {adviceText(insights.help)}
      </p>
    </Card>
  )
}

function ProgressTab() {
  const { dataVersion } = useApp()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)
  const [writing, setWriting] = useState<number | null>(null)

  const load = () => {
    getProgress()
      .then(setProgress)
      .catch(() => setProgress(null))
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
  }
  useEffect(load, [dataVersion])

  const write = async (id: number) => {
    setWriting(id)
    try {
      await writeParentNote(id)
      load()
    } finally {
      setWriting(null)
    }
  }

  if (!sessions) return <p className="faint">Loading…</p>

  return (
    <div className="stack-lg">
      {progress && progress.sessions > 0 && (
        <div className="stats">
          <Card t={3} className="stat">
            <p className="label">
              <Flame aria-hidden size={16} /> Streak
            </p>
            <p className="stat-value">
              {progress.streak_days}
              <span className="stat-unit"> {progress.streak_days === 1 ? 'day' : 'days'}</span>
            </p>
          </Card>
          <Card t={1} className="stat" border="dashed">
            <p className="label">
              <CalendarDays aria-hidden size={16} /> Days played
            </p>
            <p className="stat-value">{progress.practice_days}</p>
          </Card>
          <Card t={0} className="stat">
            <p className="label">
              <Music aria-hidden size={16} /> Notes
            </p>
            <p className="stat-value">{progress.notes}</p>
          </Card>
          <Card t={4} className="stat" border="dashed">
            <p className="label">
              <Target aria-hidden size={16} /> First try
            </p>
            <p className="stat-value">
              {progress.first_try_pct}
              <span className="stat-unit">%</span>
            </p>
          </Card>
        </div>
      )}

      <HelpCoach />

      {progress && progress.weakest_jumps.length > 0 && (
        <Card t={1} pattern="dots" className="stack">
          <div className="card-head">
            <h3 className="card-title">Trickiest jumps</h3>
            <Chip t={4} icon={<BrainCircuit aria-hidden />}>
              {progress.weakest_jumps[0].source === 'tabpfn' ? 'Predicted by TabPFN' : 'From her misses so far'}
            </Chip>
          </div>
          <p className="dim small">How likely she is to hit the second bar first time, straight after the first. Lower is trickier.</p>
          <ul className="meters">
            {progress.weakest_jumps.map((w) => {
              const pct = Math.round(w.expected * 100)
              return (
                <li key={`${w.from}-${w.to}`} className="meter-row">
                  <span className="meter-label">
                    {w.from} → {w.to}
                  </span>
                  <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${w.from} to ${w.to}`}>
                    <span className="meter-fill" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="meter-value">{pct}%</span>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {sessions.length === 0 ? (
        <Card t={2} border="dashed" pattern="stripes">
          <p className="card-title">No practice yet</p>
          <p className="dim">After each session, a short note from Gemma appears here: what went well, and what to practise next.</p>
        </Card>
      ) : (
        <ul className="sessions">
          {sessions.map((s, i) => (
            <Card key={s.id} as="li" t={i + 2} className={cn('session', i % 2 === 1 && 'offset-r')} border={i % 3 === 1 ? 'dashed' : 'solid'}>
              <div className="card-head">
                <strong className="session-date">
                  {new Date(s.started_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </strong>
                <span className="row small">
                  <span className="faint">
                    {s.stats.phrases} {s.stats.phrases === 1 ? 'part' : 'parts'} · {s.stats.notes} notes · {s.stats.first_try_pct}% first
                    time
                  </span>
                  {s.player === 'tester' && <Chip t={3}>Grown-up test</Chip>}
                </span>
              </div>
              {s.parent_note ? (
                <p className="note-text">
                  <Heart aria-hidden size={18} className="inline-icon" /> {s.parent_note}
                </p>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  t={i + 2}
                  icon={writing === s.id ? <span className="spinner" aria-hidden /> : <PenLine aria-hidden size={18} />}
                  onClick={() => write(s.id)}
                  disabled={writing !== null}
                >
                  {writing === s.id ? 'Gemma is writing…' : 'Write a note'}
                </Button>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  )
}

function SettingsTab() {
  const { settings, setSettings } = useApp()
  const [draft, setDraft] = useState<Settings>(settings)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)
  const save = async () => {
    setError('')
    try {
      setSettings(await saveSettings(draft))
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const testVoice = () => {
    setSpeechLang(draft.speech_lang)
    say(draft.child_name ? `Well done, ${draft.child_name}! Try the red one.` : 'Well done! Try the red one.')
    setSpeechLang(settings.speech_lang)
  }

  const byLang = [...new Map(voices.map((v) => [v.lang, v])).values()].sort((a, b) => a.lang.localeCompare(b.lang))
  const pct = Math.round(draft.drill_target * 100)

  return (
    <div className="settings-grid">
      <Card t={0} className="stack">
        <h3 className="card-title">Her</h3>
        <Field t={0} label="Name" hint="A first name or nickname. Used in praise and in your notes.">
          <input className="input" value={draft.child_name} maxLength={40} onChange={(e) => set('child_name', e.target.value)} placeholder="e.g. Mira" />
        </Field>
        <Field t={1} label="Family language" hint="Gemma writes praise and your notes in this language.">
          <input className="input" list="languages" value={draft.home_language} maxLength={40} onChange={(e) => set('home_language', e.target.value)} />
          <datalist id="languages">
            {LANGUAGES.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field t={2} label="Speaking voice" hint="The voice that says praise and hints. Pick one in her language.">
          <select className="select" value={draft.speech_lang} onChange={(e) => set('speech_lang', e.target.value)}>
            <option value="">Browser default</option>
            {byLang.map((v) => (
              <option key={v.lang} value={v.lang}>
                {v.lang} · {v.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <Button variant="secondary" size="sm" t={2} icon={<Volume2 aria-hidden size={18} />} onClick={testVoice}>
            Test the voice
          </Button>
        </div>
      </Card>

      <Card t={3} className="stack" border="dashed">
        <h3 className="card-title">Practice</h3>
        <Field t={3} label={`Session length: ${draft.session_minutes} min`} hint="Plink wraps up with a celebration and a note for you.">
          <input
            className="range"
            type="range"
            min={2}
            max={15}
            step={1}
            value={draft.session_minutes}
            onChange={(e) => set('session_minutes', Number(e.target.value))}
          />
        </Field>
        <Field
          t={4}
          label={`Challenge: aim for ${pct}% right first time`}
          hint="TabPFN picks parts she should get about this often: mostly wins, with one stretch."
        >
          <input
            className="range"
            type="range"
            min={0.6}
            max={0.95}
            step={0.05}
            value={draft.drill_target}
            onChange={(e) => set('drill_target', Number(e.target.value))}
          />
          <span className="range-ends faint small" aria-hidden>
            <span>More stretch</span>
            <span>Mostly wins</span>
          </span>
        </Field>
        <Field t={2} label="Help while playing" hint="She can also pick this before each session. Move down a step as she gets confident.">
          <select className="select" value={draft.help_level} onChange={(e) => set('help_level', e.target.value as Settings['help_level'])}>
            <option value="lots">🌱 Lots of help: only the glowing bar plays</option>
            <option value="some">🌿 Some help: glow and hints</option>
            <option value="little">🌳 Little help: from memory, glow if stuck</option>
          </select>
        </Field>
        <Switch t={1} checked={draft.calm_mode} onChange={(e) => set('calm_mode', e.target.checked)} label="Calm mode: no floating shapes or confetti" />
        <Switch t={0} checked={draft.show_key_caps} onChange={(e) => set('show_key_caps', e.target.checked)} label="Show keyboard letters on the bars" />
        <Switch t={4} checked={draft.parent_gate} onChange={(e) => set('parent_gate', e.target.checked)} label="Ask a grown-up sum before opening this area" />
      </Card>

      <div className="settings-save row">
        <Button variant="primary" icon={saved && !dirty ? <Check aria-hidden /> : <Save aria-hidden />} onClick={save} disabled={!dirty}>
          {saved && !dirty ? 'Saved' : 'Save settings'}
        </Button>
        {error && <p className="alert">{error}</p>}
      </div>
    </div>
  )
}

function DataTab() {
  const { bumpData, navigate } = useApp()
  const [confirming, setConfirming] = useState(false)
  const remove = async () => {
    await deleteAllData()
    setConfirming(false)
    bumpData()
    navigate('/')
  }
  return (
    <Card t={3} border="double" pattern="stripes" className="stack">
      <h3 className="card-title">Her data</h3>
      <p className="dim">
        Everything Plink keeps is in one file on this laptop: her practice log, your notes, added songs, settings and the
        calibration. No recording of her playing is ever made or stored, and nothing is sent anywhere.
      </p>
      {!confirming ? (
        <div className="row">
          <Button variant="secondary" t={3} icon={<Trash2 aria-hidden />} onClick={() => setConfirming(true)}>
            Delete all data…
          </Button>
        </div>
      ) : (
        <div className="row danger-zone">
          <p className="alert">This can’t be undone. Built-in songs stay; everything else goes.</p>
          <Button variant="outline" t={3} className="danger" icon={<Trash2 aria-hidden />} onClick={remove}>
            Yes, delete everything
          </Button>
          <Button variant="ghost" t={1} onClick={() => setConfirming(false)}>
            Keep it
          </Button>
        </div>
      )}
    </Card>
  )
}

/** Grown-up tools: progress notes, settings, setup and troubleshooting, away from her screens. */
export function GrownUps({ tab: routeTab }: { tab?: string }) {
  const { instrument, setInstrument, navigate } = useApp()
  const tab: TabId = TABS.some((t) => t.id === routeTab) ? (routeTab as TabId) : 'progress'

  return (
    <section className="screen grownups">
      <ScreenTitle kicker="For grown-ups" t={4}>
        Behind the <span className="gradient-text">scenes</span>
      </ScreenTitle>
      <div className="tabs" role="tablist" aria-label="Grown-up tools">
        {TABS.map((t, i) => {
          const Icon = t.icon
          return (
            <Button
              key={t.id}
              variant="secondary"
              size="sm"
              t={i}
              role="tab"
              aria-selected={tab === t.id}
              icon={<Icon aria-hidden size={18} />}
              onClick={() => navigate(`/grownups/${t.id}`)}
            >
              {t.label}
            </Button>
          )
        })}
      </div>
      <div role="tabpanel">
        {tab === 'progress' && <ProgressTab />}
        {tab === 'ask' && <AskPlink />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'calibrate' && <Calibrate instrument={instrument} onSaved={setInstrument} onDone={() => navigate('/grownups/mic')} />}
        {tab === 'mic' && <SelfTest instrument={instrument} onCalibrate={() => navigate('/grownups/calibrate')} />}
        {tab === 'data' && <DataTab />}
      </div>
    </section>
  )
}
