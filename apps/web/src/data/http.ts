/** An error carrying the HTTP status, thrown when an Eden call returns an error body. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function messageFromValue(value: unknown, status: number): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message: unknown }).message
    if (typeof message === 'string') {
      return message
    }
  }
  return `Request failed (${status})`
}

/**
 * Turn an Eden treaty response into a resolved value or a thrown {@link ApiError}, so
 * it composes with React Query's success/error model. Treaty never throws on non-2xx;
 * it returns `{ data, error }`, so we normalize that here.
 */
export async function unwrap<T>(
  promise: Promise<{ data: T | null; error: { status: unknown; value: unknown } | null; status: number }>,
): Promise<T> {
  const res = await promise
  if (res.error !== null) {
    const status = typeof res.error.status === 'number' ? res.error.status : res.status
    throw new ApiError(status, messageFromValue(res.error.value, status))
  }
  if (res.data === null) {
    throw new ApiError(res.status, 'The server returned an empty response.')
  }
  return res.data
}
