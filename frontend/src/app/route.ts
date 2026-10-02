import { useEffect, useState } from 'react'

/**
 * Hash routes, so a refresh or a bookmark lands on the same screen:
 *   #/  #/play  #/play/twinkle  #/play/twinkle/go  #/free/mary  #/songs  #/songs/new  #/grownups/settings
 */
export interface Route {
  screen: 'home' | 'play' | 'free' | 'songs' | 'grownups'
  arg?: string
  go?: boolean
}

const SCREENS = new Set(['play', 'free', 'songs', 'grownups'])

export function parseRoute(hash: string): Route {
  const [screen, arg, go] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  if (!SCREENS.has(screen)) return { screen: 'home' }
  return { screen: screen as Route['screen'], arg: arg || undefined, go: go === 'go' }
}

export function useRoute(): [Route, (path: string) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = (path: string) => {
    window.location.hash = path
    window.scrollTo({ top: 0 })
  }
  return [route, navigate]
}
