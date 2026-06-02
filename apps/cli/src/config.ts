import { readCredentials } from './credentials.ts'
import { EXIT } from './exit.ts'
import { fail, type CliResult } from './output.ts'

export interface Config {
  apiUrl: string
  apiKey: string
}

const DEFAULT_API_URL = 'https://api.walnut.sh'

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Resolve the API URL + key for an authed command: explicit flags win, otherwise the
 * stored credentials from `walnut login`. If nothing is configured, return a failure
 * that tells the agent exactly how to get authenticated — by asking the user to log in.
 */
export async function resolveConfig(
  options: Record<string, string | boolean>,
  homeDir: string,
  pretty: boolean,
): Promise<Config | CliResult> {
  const stored = await readCredentials(homeDir)
  const apiKey = asString(options['api-key']) ?? stored?.apiKey
  const apiUrl = asString(options['api-url']) ?? stored?.apiUrl ?? DEFAULT_API_URL
  if (apiKey === undefined || apiKey === '') {
    return fail(
      EXIT.AUTH,
      'not_logged_in',
      'Not logged in. Ask the user to run `walnut login --api-key <key>` before retrying.',
      pretty,
    )
  }
  return { apiUrl, apiKey }
}
