import { afterEach, describe, expect, it, vi } from 'vitest'

type Api = typeof import('./api')

/** A fresh api module (its token lives in module state) over a fake server. */
async function withServer(handle: (url: string, auth: string | undefined) => Response) {
  const calls: { url: string; auth?: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      calls.push({ url, auth })
      return handle(url, auth)
    }),
  )
  vi.resetModules()
  const api: Api = await import('./api')
  return { api, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const tokens = (access: string) => json({ access_token: access, email: 'parent@example.com', display_name: '' })

afterEach(() => vi.unstubAllGlobals())

describe('api login handling', () => {
  it('sends the access token from a log-in, and drops it on log-out', async () => {
    const { api, calls } = await withServer((url) => (url === '/api/auth/login' ? tokens('t1') : json([])))
    expect(await api.logIn('parent@example.com', 'secret password')).toEqual({ email: 'parent@example.com', display_name: '' })
    await api.listSongs()
    expect(calls[1]).toEqual({ url: '/api/songs', auth: 'Bearer t1' })
    await api.logOut()
    await api.listSongs()
    expect(calls.at(-1)).toEqual({ url: '/api/songs', auth: undefined })
  })

  it('refreshes an expired access token once, then retries the request', async () => {
    const { api, calls } = await withServer((url, auth) => {
      if (url === '/api/auth/refresh') return tokens('fresh')
      return auth === 'Bearer fresh' ? json([]) : json({ detail: 'Log in again' }, 401)
    })
    await expect(api.listSongs()).resolves.toEqual([])
    expect(calls.map((c) => c.url)).toEqual(['/api/songs', '/api/auth/refresh', '/api/songs'])
  })

  it('shares one refresh between requests that expire together, so the cookie is swapped once', async () => {
    const { api, calls } = await withServer((url, auth) => {
      if (url === '/api/auth/refresh') return tokens('fresh')
      return auth === 'Bearer fresh' ? json({}) : json({}, 401)
    })
    await Promise.all([api.listSongs(), api.getProgress(), api.getSettings()])
    expect(calls.filter((c) => c.url === '/api/auth/refresh')).toHaveLength(1)
  })

  it('signs out when the refresh cookie is gone or revoked', async () => {
    const { api } = await withServer(() => json({}, 401))
    const signedOut = vi.fn()
    api.whenSignedOut(signedOut)
    await expect(api.listSongs()).rejects.toMatchObject({ status: 401 })
    expect(signedOut).toHaveBeenCalledOnce()
    await expect(api.refreshLogin()).resolves.toBeNull()
  })

  it('keeps the login when deleting the account fails on a wrong password', async () => {
    const { api, calls } = await withServer((url) => {
      if (url === '/api/auth/login') return tokens('t1')
      return url === '/api/account' ? json({ detail: 'Wrong password' }, 403) : json([])
    })
    const signedOut = vi.fn()
    api.whenSignedOut(signedOut)
    await api.logIn('parent@example.com', 'secret password')
    await expect(api.deleteAccount('wrong password')).rejects.toMatchObject({ status: 403 })
    expect(signedOut).not.toHaveBeenCalled()
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/login', '/api/account'])
    await api.listSongs()
    expect(calls.at(-1)?.auth).toBe('Bearer t1')
  })

  it('reports a wrong password without trying to refresh', async () => {
    const { api, calls } = await withServer(() => json({ detail: 'Wrong email or password' }, 401))
    await expect(api.logIn('parent@example.com', 'wrong password')).rejects.toBeInstanceOf(api.ApiError)
    expect(calls.map((c) => c.url)).toEqual(['/api/auth/login'])
  })
})
