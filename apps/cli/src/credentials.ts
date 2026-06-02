import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * The agent's stored credential. Minted by a human in the dashboard and saved by
 * `walnut login`; read by every authed command. The home directory is passed in
 * (never read from process state) so it stays testable and never surprises.
 */
export interface Credentials {
  apiKey: string
  apiUrl?: string
}

export function credentialsPath(homeDir: string): string {
  return join(homeDir, '.walnut', 'credentials.json')
}

export async function readCredentials(homeDir: string): Promise<Credentials | null> {
  let raw: string
  try {
    raw = await readFile(credentialsPath(homeDir), 'utf8')
  } catch {
    return null
  }
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) {
      return null
    }
    const obj = data as Record<string, unknown>
    if (typeof obj.apiKey !== 'string' || obj.apiKey === '') {
      return null
    }
    return {
      apiKey: obj.apiKey,
      apiUrl: typeof obj.apiUrl === 'string' && obj.apiUrl !== '' ? obj.apiUrl : undefined,
    }
  } catch {
    return null
  }
}

/** Persist credentials with owner-only permissions. Returns the path written. */
export async function writeCredentials(homeDir: string, creds: Credentials): Promise<string> {
  const path = credentialsPath(homeDir)
  await mkdir(dirname(path), { recursive: true })
  const body: Credentials = creds.apiUrl === undefined ? { apiKey: creds.apiKey } : creds
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return path
}

/** Remove stored credentials. Returns whether a file was actually deleted. */
export async function deleteCredentials(homeDir: string): Promise<boolean> {
  try {
    await unlink(credentialsPath(homeDir))
    return true
  } catch {
    return false
  }
}
