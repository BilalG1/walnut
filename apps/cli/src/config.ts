import { EXIT } from './exit.ts'
import { fail, type CliResult } from './output.ts'

export interface Config {
  apiUrl: string
  apiKey: string
}

const DEFAULT_API_URL = 'http://localhost:3001'

function asString(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Resolve the API URL + key from flags (highest priority) then env. Returns a
 * failure `CliResult` if no key is configured — an agent gets a key + URL injected
 * into its environment, so this never prompts.
 */
export function resolveConfig(
  options: Record<string, string | boolean>,
  env: Record<string, string | undefined>,
  pretty: boolean,
): Config | CliResult {
  const apiUrl = asString(options['api-url']) ?? env.WALNUT_API_URL ?? DEFAULT_API_URL
  const apiKey = asString(options['api-key']) ?? env.WALNUT_API_KEY
  if (apiKey === undefined || apiKey === '') {
    return fail(
      EXIT.USAGE,
      'missing_api_key',
      'No API key configured. Set WALNUT_API_KEY in the environment or pass --api-key <key>.',
      pretty,
    )
  }
  return { apiUrl, apiKey }
}
