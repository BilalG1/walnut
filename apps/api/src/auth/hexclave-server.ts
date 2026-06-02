/**
 * Minimal server-side Hexclave REST client, used ONLY by the dev-login bypass. It
 * talks the raw API with the secret server key (`X-Hexclave-Secret-Server-Key`) — a
 * god-mode credential that mints sessions for any user. It is never constructed on a
 * production request path; see env.ts/index.ts for the locks that keep it dev-only.
 */
export interface HexclaveUser {
  id: string
  email: string
}

export interface HexclaveSession {
  accessToken: string
  refreshToken: string
}

export interface HexclaveServerClient {
  /** Find a user by exact email, creating one (email pre-verified) if none exists. */
  getOrCreateUser(email: string): Promise<HexclaveUser>
  /** Mint a real session (access + refresh tokens) for a user — no password/OAuth. */
  createSession(userId: string): Promise<HexclaveSession>
}

export interface HexclaveServerConfig {
  /** Hexclave API base, e.g. `https://api.hexclave.com`. */
  apiBaseUrl: string
  projectId: string
  secretServerKey: string
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function createHexclaveServerClient(config: HexclaveServerConfig): HexclaveServerClient {
  const base = `${config.apiBaseUrl}/api/v1`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-hexclave-project-id': config.projectId,
    'x-hexclave-access-type': 'server',
    'x-hexclave-secret-server-key': config.secretServerKey,
  }

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Hexclave ${method} ${path} failed (${res.status}): ${text}`)
    }
    return res.json()
  }

  /**
   * Find a user by exact email. `query` is free-text (matches id/display name/email),
   * so we (a) filter for an exact primary_email match — never trust the first hit — and
   * (b) page through ALL results, since the match could be past the first page. Returns
   * undefined only when no exact match exists across every page.
   */
  async function findUserByEmail(normalized: string): Promise<HexclaveUser | undefined> {
    let cursor: string | undefined
    // Safety cap: `query=<email>` is a targeted search (~1 page in practice); the bound
    // just prevents an unbounded loop if `next_cursor` ever misbehaves.
    for (let page = 0; page < 50; page += 1) {
      const params = new URLSearchParams({ query: normalized, limit: '100' })
      if (cursor !== undefined && cursor !== '') {
        params.set('cursor', cursor)
      }
      // Sequential by necessity: each page's cursor comes from the previous response.
      // eslint-disable-next-line no-await-in-loop
      const listed = await request('GET', `/users?${params.toString()}`)
      const items = (listed as { items?: unknown }).items
      if (Array.isArray(items)) {
        for (const item of items) {
          const record = item as { id?: unknown; primary_email?: unknown }
          const id = asString(record.id)
          const primaryEmail = asString(record.primary_email)
          if (id !== undefined && primaryEmail !== undefined && primaryEmail.toLowerCase() === normalized) {
            return { id, email: primaryEmail }
          }
        }
      }
      const next = asString((listed as { pagination?: { next_cursor?: unknown } }).pagination?.next_cursor)
      if (next === undefined || next === '') {
        return undefined
      }
      cursor = next
    }
    return undefined
  }

  return {
    async getOrCreateUser(email: string): Promise<HexclaveUser> {
      const normalized = email.trim().toLowerCase()
      const existing = await findUserByEmail(normalized)
      if (existing !== undefined) {
        return existing
      }
      let created: unknown
      try {
        created = await request('POST', '/users', {
          primary_email: normalized,
          primary_email_verified: true,
          primary_email_auth_enabled: true,
        })
      } catch (err) {
        // A concurrent dev-login (or a list that lagged) can collide on the unique
        // primary_email; re-resolve to the now-existing user instead of failing.
        const raced = await findUserByEmail(normalized)
        if (raced !== undefined) {
          return raced
        }
        throw err
      }
      const id = asString((created as { id?: unknown }).id)
      if (id === undefined) {
        throw new Error('Hexclave create-user response was missing an id.')
      }
      return { id, email: normalized }
    },

    async createSession(userId: string): Promise<HexclaveSession> {
      const session = await request('POST', '/auth/sessions', { user_id: userId })
      const accessToken = asString((session as { access_token?: unknown }).access_token)
      const refreshToken = asString((session as { refresh_token?: unknown }).refresh_token)
      if (accessToken === undefined || refreshToken === undefined) {
        throw new Error('Hexclave create-session response was missing tokens.')
      }
      return { accessToken, refreshToken }
    },
  }
}
