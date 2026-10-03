import { BrainCircuit, Headphones, Play, Plus, Sparkles, WandSparkles } from 'lucide-react'
import { useState } from 'react'
import { buildLesson } from '../api'
import { useApp } from '../app/AppContext'
import { useInsights } from '../app/useInsights'
import { useSongs } from '../app/useSongs'
import { cn, tone } from '../theme/palette'
import { Deco } from '../ui/Deco'
import { Button, Chip, ScreenTitle } from '../ui/ui'
import { AddSong } from './AddSong'

const SOURCE = { builtin: 'Built-in', played: 'Played in', hummed: 'Sung', typed: 'Typed', photo: 'From a photo', drill: 'Practice' } as Record<string, string>

export function Songs({ adding }: { adding: boolean }) {
  const { instrument, navigate, serverUp, settings } = useApp()
  const { songs, offline, setSongs } = useSongs()
  const insights = useInsights()
  const readiness = (id: string) => insights?.songs.find((s) => s.song_id === id)?.by_level[settings.help_level]
  const [building, setBuilding] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (adding) return <AddSong />

  const rebuild = async (id: string) => {
    setBuilding(id)
    setError('')
    try {
      const updated = await buildLesson(id)
      setSongs((list) => list?.map((s) => (s.id === id ? updated : s)) ?? null)
      if (updated.lesson_source !== 'gemma') setError('Gemma was not available, so the song keeps its plain parts.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBuilding(null)
    }
  }

  return (
    <section className="screen songs">
      <Deco
        items={[
          { shape: 'note', at: { top: '0%', right: '3%' }, size: 58, t: 0, motion: 'float' },
          { shape: 'star', at: { top: '6%', right: '24%' }, size: 30, t: 2, motion: 'spin-slow', wide: true },
          { emoji: '🎼', at: { top: '0%', left: '46%' }, size: 40, t: 1, motion: 'bounce', wide: true },
        ]}
      />
      <ScreenTitle kicker="Song library" t={0}>
        Her <span className="gradient-text">songs</span>
      </ScreenTitle>
      {error && <p className="alert">{error}</p>}

      <ul className="library">
        <li>
          <a
            className={cn('add-card card card-dashed pat-stripes tone-2', (!serverUp || offline) && 'disabled')}
            href="#/songs/new"
            aria-disabled={!serverUp || offline}
          >
            <span className="add-plus" aria-hidden>
              <Plus />
            </span>
            <span className="card-title">Add a song</span>
            <span className="dim small">Play it in, or type the notes. Gemma turns it into a lesson.</span>
          </a>
        </li>
        {songs?.map((s, i) => (
          <li key={s.id} className={cn(i % 2 === 0 && 'offset')}>
            <article className={cn('card song-card', tone(i + 1), i % 3 === 2 && 'card-dashed', i % 4 === 1 ? 'tilt-r' : i % 4 === 3 && 'tilt-l')}>
              <div className="card-head">
                <h3 className="card-title">{s.title}</h3>
                <Chip t={i + 3}>{SOURCE[s.source] ?? s.source}</Chip>
              </div>
              <div className="strip-preview" aria-label={`${s.bars.length} notes`}>
                {s.bars.map((b, j) => (
                  <i
                    key={j}
                    className={cn(s.misfits.includes(j) && 'misfit')}
                    style={{ background: instrument.bars[b]?.colour, '--beats': s.beats[j] ?? 1 } as React.CSSProperties}
                  />
                ))}
              </div>
              <p className="row small">
                <span className="faint">
                  {s.bars.length} notes · {s.phrases.length || '–'} parts
                </span>
                {s.source === 'drill' ? null : s.lesson === 'gemma' ? (
                  <Chip t={4} solid icon={<Sparkles aria-hidden />}>
                    Gemma lesson
                  </Chip>
                ) : (
                  <Chip t={1} dashed>
                    Plain parts
                  </Chip>
                )}
                {s.misfits.length > 0 && <Chip t={3}>Almost fits</Chip>}
              </p>
              {readiness(s.id) !== undefined && (
                <p className="row small">
                  <Chip
                    t={readiness(s.id)! >= settings.drill_target ? 1 : readiness(s.id)! >= settings.drill_target - 0.2 ? 2 : 3}
                    icon={<BrainCircuit aria-hidden />}
                  >
                    For her: {Math.round(readiness(s.id)! * 100)}% first try
                  </Chip>
                </p>
              )}
              {s.lesson === 'gemma' && (
                <p className="nicknames small">
                  {s.phrases
                    .slice(0, 4)
                    .map((p) => p.nickname)
                    .join(' · ')}
                  {s.phrases.length > 4 && ` +${s.phrases.length - 4} more`}
                </p>
              )}
              <div className="row song-actions">
                <Button variant="primary" size="sm" icon={<Play aria-hidden size={18} />} onClick={() => navigate(`/play/${s.id}/go`)} disabled={offline}>
                  Practise
                </Button>
                <Button variant="secondary" size="sm" t={i + 1} icon={<Headphones aria-hidden size={18} />} onClick={() => navigate(`/free/${s.id}`)}>
                  Listen
                </Button>
                {/* Practice parts are built from her jumps; a lesson would cut across them. */}
                {!offline && s.source !== 'drill' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    t={i + 2}
                    icon={building === s.id ? <span className="spinner" aria-hidden /> : <WandSparkles aria-hidden size={18} />}
                    onClick={() => rebuild(s.id)}
                    disabled={building !== null}
                  >
                    {building === s.id ? 'Gemma is thinking…' : s.lesson === 'gemma' ? 'New lesson' : 'Make lesson'}
                  </Button>
                )}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
