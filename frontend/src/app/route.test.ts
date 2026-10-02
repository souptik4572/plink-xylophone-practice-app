import { describe, expect, it } from 'vitest'
import { parseRoute } from './route'

describe('parseRoute', () => {
  it('reads screen, argument and the one-tap start flag', () => {
    expect(parseRoute('#/play/twinkle/go')).toEqual({ screen: 'play', arg: 'twinkle', go: true })
    expect(parseRoute('#/free/mary')).toEqual({ screen: 'free', arg: 'mary', go: false })
    expect(parseRoute('#/grownups/settings')).toMatchObject({ screen: 'grownups', arg: 'settings' })
  })

  it('falls back to home for empty or unknown routes', () => {
    expect(parseRoute('')).toEqual({ screen: 'home' })
    expect(parseRoute('#/')).toEqual({ screen: 'home' })
    expect(parseRoute('#/nope')).toEqual({ screen: 'home' })
  })

  it('decodes song ids', () => {
    expect(parseRoute('#/play/song-ab%2012').arg).toBe('song-ab 12')
  })
})
