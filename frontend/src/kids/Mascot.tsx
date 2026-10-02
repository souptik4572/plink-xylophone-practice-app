import { cn } from '../theme/palette'

/**
 * Plink, the practice friend: a round creature with a xylophone mallet for a
 * head. Its face says whose turn it is, so a child who can't read yet can follow.
 */
export type Mood = 'hello' | 'listen' | 'turn' | 'happy' | 'hint' | 'cheer'

const EYES_OPEN = (
  <>
    <ellipse cx="52" cy="76" rx="11" ry="13" fill="#fff" stroke="#0d0d1a" strokeWidth="3" />
    <ellipse cx="88" cy="76" rx="11" ry="13" fill="#fff" stroke="#0d0d1a" strokeWidth="3" />
  </>
)

function Face({ mood }: { mood: Mood }) {
  const closed = mood === 'happy' || mood === 'cheer'
  // Pupils look up while listening, down at the bars on her turn.
  const look = mood === 'listen' ? [0, -4] : mood === 'turn' || mood === 'hint' ? [2, 4] : [0, 1]
  return (
    <g className="face">
      {closed ? (
        <g fill="none" stroke="#0d0d1a" strokeWidth="5" strokeLinecap="round">
          <path d="M42 78 q10 -12 20 0" />
          <path d="M78 78 q10 -12 20 0" />
        </g>
      ) : (
        <>
          {EYES_OPEN}
          <g className="pupils" fill="#0d0d1a">
            <circle cx={52 + look[0]} cy={77 + look[1]} r="5.5" />
            <circle cx={88 + look[0]} cy={77 + look[1]} r="5.5" />
            <circle cx={50 + look[0]} cy={74 + look[1]} r="1.8" fill="#fff" />
            <circle cx={86 + look[0]} cy={74 + look[1]} r="1.8" fill="#fff" />
          </g>
        </>
      )}
      {mood === 'hint' && (
        <g stroke="#0d0d1a" strokeWidth="4" strokeLinecap="round">
          <path d="M42 58 l18 -4" />
          <path d="M98 58 l-18 -4" />
        </g>
      )}
      <circle cx="38" cy="96" r="7" fill="#ff8af7" opacity="0.75" />
      <circle cx="102" cy="96" r="7" fill="#ff8af7" opacity="0.75" />
      {mood === 'listen' ? (
        <ellipse cx="70" cy="101" rx="6" ry="7" fill="#0d0d1a" />
      ) : mood === 'cheer' || mood === 'happy' ? (
        <path d="M52 94 q18 26 36 0 z" fill="#0d0d1a" stroke="#0d0d1a" strokeWidth="3" strokeLinejoin="round" />
      ) : (
        <path d="M56 97 q14 13 28 0" fill="none" stroke="#0d0d1a" strokeWidth="5" strokeLinecap="round" />
      )}
    </g>
  )
}

function Arms({ mood }: { mood: Mood }) {
  const arm = (d: string, key: string) => (
    <g key={key}>
      <path d={d} fill="none" stroke="#0d0d1a" strokeWidth="11" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#b44dff" strokeWidth="5" strokeLinecap="round" />
    </g>
  )
  if (mood === 'cheer') return <g className="arms">{[arm('M26 82 L8 52', 'l'), arm('M114 82 L132 52', 'r')]}</g>
  if (mood === 'listen') return <g className="arms">{[arm('M26 86 L12 100', 'l'), arm('M114 80 Q126 66 116 52', 'r')]}</g>
  if (mood === 'turn') return <g className="arms">{[arm('M26 86 L12 100', 'l'), arm('M114 92 L132 112', 'r')]}</g>
  if (mood === 'hello') return <g className="arms">{[arm('M26 86 L12 100', 'l'), <g key="wave" className="wave">{arm('M114 82 L130 56', 'r')}</g>]}</g>
  return <g className="arms">{[arm('M26 86 L12 100', 'l'), arm('M114 86 L128 100', 'r')]}</g>
}

export function Mascot({ mood, say, size = 120, className }: { mood: Mood; say?: string; size?: number; className?: string }) {
  return (
    <div className={cn('mascot', className)} data-mood={mood}>
      <svg className="mascot-svg" viewBox="0 0 140 140" width={size} height={size} aria-hidden>
        <defs>
          <linearGradient id="plink-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff3af2" />
            <stop offset="1" stopColor="#7b2fff" />
          </linearGradient>
        </defs>
        <g className="mascot-mallet">
          <line x1="70" y1="40" x2="70" y2="16" stroke="#0d0d1a" strokeWidth="6" strokeLinecap="round" />
          <line x1="70" y1="40" x2="70" y2="16" stroke="#ffe600" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="70" cy="13" r="10" fill="#00f5d4" stroke="#0d0d1a" strokeWidth="3.5" />
          <circle cx="66" cy="9" r="3" fill="#fff" opacity="0.8" />
        </g>
        <Arms mood={mood} />
        <ellipse cx="70" cy="86" rx="50" ry="44" fill="url(#plink-body)" stroke="#0d0d1a" strokeWidth="5" />
        <g className="belly" stroke="#0d0d1a" strokeWidth="2">
          <rect x="50" y="113" width="10" height="9" rx="2" fill="#00f5d4" />
          <rect x="62" y="114" width="10" height="8" rx="2" fill="#ffe600" />
          <rect x="74" y="115" width="10" height="7" rx="2" fill="#ff6b35" />
        </g>
        <Face mood={mood} />
        {mood === 'listen' && (
          <g className="notes" fill="#ffe600" stroke="#0d0d1a" strokeWidth="1.5">
            <text x="112" y="34" fontSize="22">
              ♪
            </text>
            <text x="12" y="40" fontSize="18">
              ♫
            </text>
          </g>
        )}
        {mood === 'cheer' && (
          <g className="sparkles" fill="#ffe600" stroke="#0d0d1a" strokeWidth="1.5">
            <path d="M18 18l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
            <path d="M122 14l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" />
          </g>
        )}
      </svg>
      {say && (
        <p className="mascot-say" aria-live="polite">
          {say}
        </p>
      )}
    </div>
  )
}
