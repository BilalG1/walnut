export interface ApiErrorBody {
  error: string
  message: string
  missingScopes?: string[]
  requiredScopes?: string[]
  grantedScopes?: string[]
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.filter((x): x is string => typeof x === 'string')
}

/** Normalise an unknown treaty error value into a predictable shape. */
export function readErrorBody(value: unknown): ApiErrorBody {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>
    return {
      error: typeof v.error === 'string' ? v.error : 'error',
      message: typeof v.message === 'string' ? v.message : 'Request failed.',
      missingScopes: stringArray(v.missingScopes),
      requiredScopes: stringArray(v.requiredScopes),
      grantedScopes: stringArray(v.grantedScopes),
    }
  }
  return {
    error: 'error',
    message: typeof value === 'string' && value.length > 0 ? value : 'Request failed.',
  }
}
