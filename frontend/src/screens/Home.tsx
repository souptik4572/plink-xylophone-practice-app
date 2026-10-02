import { ArrowRight, Check, Flame, Heart, ListMusic, Mic, Music, Piano, Play, Sparkles, Target, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getProgress, listSessions, type Progress, type SessionSummary } from '../api'
import { useApp } from '../app/AppContext'
import { lastSongId, useSongs } from '../app/useSongs'
import { isCalibrated } from '../instrument'
import { Mascot } from '../kids/Mascot'
import { stickerProgress } from '../kids/stickers'
import { cn, tone } from '../theme/palette'
import { BigWord, Deco, type DecoItem } from '../ui/Deco'
import { Button, Card, Chip } from '../ui/ui'

// Decorations stay in the hero's right-hand side, clear of the copy and buttons.
const HERO_DECO: DecoItem[] = [
  { shape: 'star', at: { top: '8%', right: '30%' }, size: 46, t: 2, motion: 'float', wide: true },
  { shape: 'sparkle', at: { top: '12%', right: '6%' }, size: 64, t: 1, motion: 'spin-slow' },
  { shape: 'circle', at: { top: '46%', right: '24%' }, size: 38, t: 0, motion: 'float-reverse', wide: true },
  { shape: 'squiggle', at: { bottom: '16%', right: '30%' }, size: 80, t: 3, motion: 'wiggle', wide: true },
  { shape: 'square', at: { top: '50%', right: '3%' }, size: 34, t: 4, motion: 'float', delay: 1.2, wide: true },
  { shape: 'note', at: { top: '30%', right: '14%' }, size: 52, t: 1, motion: 'bounce', wide: true },
  { emoji: '⭐', at: { bottom: '6%', right: '8%' }, size: 44, t: 2, motion: 'bounce' },
]

export function Home() {
  const { settings, instrument, serverUp, health, dataVersion } = useApp()
  const { songs } = useSongs()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [latest, setLatest] = useState<SessionSummary | null>(null)

  useEffect(() => {
    getProgress()
      .then(setProgress)
      .catch(() => setProgress(null))
    listSessions()
      .then((s) => setLatest(s.find((x) => x.player === 'child' && x.parent_note) ?? null))
      .catch(() => {})
  }, [dataVersion])

  const name = settings.child_name.trim()
  const last = songs?.find((s) => s.id === lastSongId()) ?? songs?.[0]

  const steps = [
    { done: serverUp && !!health?.ollama && !!health?.tabpfn, label: 'Plink’s local brain is on', hint: 'make dev, with Ollama running', href: undefined },
    { done: !!name, label: 'Tell Plink her name', hint: 'Used in praise and in your notes', href: '#/grownups/settings' },
    { done: (progress?.sessions ?? 0) > 0, label: 'Play a first session', hint: 'Five minutes, on screen or her xylophone', href: last ? `#/play/${last.id}/go` : '#/play' },
    { done: isCalibrated(instrument), label: 'Teach Plink her xylophone', hint: 'Optional: lets her play the real one', href: '#/grownups/calibrate' },
  ]
  const setupDone = steps.slice(0, 3).every((s) => s.done)
  const jar = stickerProgress(progress?.stars ?? 0)

  return (
    <div className="home">
      <section className="hero tone-0">
        <Deco items={HERO_DECO} />
        <BigWord word="PLINK" t={4} at={{ right: '-4%', bottom: '-12%' }} />
        <div className="hero-copy">
          <p className="label">Your patient xylophone friend</p>
          <h1 className="hero-title">
            <span className="ts-mega">{name ? 'Hi,' : 'Ready to'}</span>
            <span className="gradient-text ts-3">{name ? `${name}!` : 'Plink?'}</span>
          </h1>
          <p className="hero-sub dim">
            Hit the glowing bar. Plink waits, cheers, and picks what to practise next. Everything stays on this laptop.
          </p>
          <div className="row hero-actions">
            <Button
              variant="primary"
              size="lg"
              className="animate-pulse-glow"
              icon={<Play aria-hidden />}
              onClick={() => (window.location.hash = last ? `/play/${last.id}/go` : '/play')}
            >
              Let’s play!
            </Button>
            <Button variant="secondary" t={1} icon={<Piano aria-hidden />} onClick={() => (window.location.hash = '/free')}>
              Just jam
            </Button>
          </div>
          {last && (
            <p className="next-up dim">
              <Music aria-hidden size={18} /> Next up: <strong>{last.title}</strong>
              <a href="#/play" className="tone-1">
                change
              </a>
            </p>
          )}
        </div>
        <Mascot mood="hello" say="Let’s play!" size={150} className="hero-mascot" />
      </section>

      {progress && (
        <section className="section" aria-labelledby="jar-title">
          <h2 id="jar-title" className="ts-2">
            {name ? `${name}’s` : 'Her'} <span className="gradient-text">star jar</span>
          </h2>
          <Card t={2} pattern="mesh" className="jar" tilt="l">
            <p className="jar-count" aria-label={`${progress.stars} stars`}>
              <span className="star-big" aria-hidden>
                ★
              </span>
              {progress.stars}
            </p>
            <div className="next-sticker">
              <p className="dim">
                {jar.toNext} more {jar.toNext === 1 ? 'star' : 'stars'} for the next sticker: one for every note right first time.
              </p>
              <span className="next-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(jar.fraction * 100)} aria-label="Next sticker">
                <span className="next-fill" style={{ width: `${Math.max(4, jar.fraction * 100)}%` }} />
              </span>
            </div>
            <ul className="sticker-book" aria-label="Sticker book">
              {jar.earned.map((s, i) => (
                <li key={s.emoji} className={cn('sticker', tone(i))} style={{ '--r': `${(i % 3) * 4 - 4}deg` } as React.CSSProperties} title={s.name}>
                  <span role="img" aria-label={s.name}>
                    {s.emoji}
                  </span>
                </li>
              ))}
              <li className="sticker locked tone-2" aria-label="Next sticker, still a surprise">
                ?
              </li>
            </ul>
          </Card>
        </section>
      )}

      {songs && songs.length > 0 && (
        <section className="section" aria-labelledby="pick-title">
          <div className="section-head">
            <h2 id="pick-title" className="ts-2">
              Pick a <span className="gradient-text">song</span>
            </h2>
            <a className="btn btn-ghost tone-1" href="#/songs">
              All songs <ArrowRight aria-hidden />
            </a>
          </div>
          <ul className="song-picks">
            {songs.slice(0, 5).map((s, i) => (
              <li key={s.id} className={cn(i % 2 === 1 && 'offset')}>
                <a className={cn('song-pick card card-sm-shadow card-hover', tone(i), i % 3 === 1 && 'card-dashed')} href={`#/play/${s.id}/go`}>
                  <span className="song-pick-icon" aria-hidden>
                    <Music />
                  </span>
                  <span className="song-pick-title">{s.title}</span>
                  <span className="mini-strip" aria-hidden>
                    {s.bars.slice(0, 10).map((b, j) => (
                      <i key={j} style={{ background: instrument.bars[b]?.colour }} />
                    ))}
                  </span>
                  <span className="row small">
                    <span className="faint">{s.bars.length} notes</span>
                    {s.misfits.length > 0 && <Chip t={3}>Almost fits</Chip>}
                    {s.lesson === 'gemma' && <Chip t={4} icon={<Sparkles aria-hidden />}>Lesson</Chip>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section" aria-labelledby="progress-title">
        <div className="section-head">
          <h2 id="progress-title" className="ts-2">
            How she’s <span className="gradient-text">doing</span>
          </h2>
          <a className="btn btn-ghost tone-3" href="#/grownups/progress">
            Details <ArrowRight aria-hidden />
          </a>
        </div>
        {progress && progress.sessions > 0 ? (
          <div className="stats">
            <Card t={3} className="stat">
              <p className="label">
                <Flame aria-hidden size={16} /> Day streak
              </p>
              <p className="stat-value">{progress.streak_days}</p>
            </Card>
            <Card t={1} className="stat" border="dashed">
              <p className="label">
                <Music aria-hidden size={16} /> Notes played
              </p>
              <p className="stat-value">{progress.notes}</p>
            </Card>
            <Card t={0} className="stat">
              <p className="label">
                <Target aria-hidden size={16} /> First try
              </p>
              <p className="stat-value">
                {progress.first_try_pct}
                <span className="stat-unit">%</span>
              </p>
            </Card>
            <Card t={4} className="stat" border="dashed">
              <p className="label">
                <Trophy aria-hidden size={16} /> Sessions
              </p>
              <p className="stat-value">{progress.sessions}</p>
            </Card>
          </div>
        ) : (
          <Card t={2} border="dashed" pattern="stripes" className="empty">
            <p className="card-title">No practice yet</p>
            <p className="dim">After her first session, her streak, notes and first-try score show up here.</p>
          </Card>
        )}
        {latest?.parent_note && (
          <Card t={4} as="aside" className="latest-note" pattern="dots" tilt="l">
            <div className="card-head">
              <span className="label">
                <Heart aria-hidden size={16} /> Last note for you
              </span>
              <span className="faint small">{new Date(latest.started_at).toLocaleDateString(undefined, { weekday: 'long' })}</span>
            </div>
            <p className="note-text">{latest.parent_note}</p>
          </Card>
        )}
      </section>

      {!setupDone && (
        <section className="section" aria-labelledby="setup-title">
          <h2 id="setup-title" className="ts-2">
            Getting <span className="gradient-text">started</span>
          </h2>
          <ol className="checklist">
            {steps.map((s, i) => (
              <li key={s.label} className={cn('card card-sm-shadow', tone(i + 1), s.done && 'done', i % 2 === 1 && 'card-dashed')}>
                <span className="check" aria-hidden>
                  {s.done ? <Check /> : i === 3 ? <Mic /> : <ListMusic />}
                </span>
                <span className="stack-tight">
                  <strong>{s.label}</strong>
                  <span className="faint small">{s.done ? 'Done' : s.hint}</span>
                </span>
                {!s.done && s.href && (
                  <a className="btn btn-secondary btn-sm" href={s.href}>
                    Go <ArrowRight aria-hidden size={18} />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
