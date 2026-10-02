import { useEffect, useState } from 'react'
import { getInsights, type Insights } from '../api'
import { useApp } from './AppContext'

/** TabPFN's view of her (every song at every help level), refreshed when her data changes. */
export function useInsights(): Insights | null {
  const { dataVersion } = useApp()
  const [insights, setInsights] = useState<Insights | null>(null)
  useEffect(() => {
    let live = true
    getInsights()
      .then((i) => live && setInsights(i))
      .catch(() => live && setInsights(null))
    return () => {
      live = false
    }
  }, [dataVersion])
  return insights
}
