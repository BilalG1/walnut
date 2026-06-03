import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '../data/http.ts'
import { captureException } from './observability.ts'

/** Report only the errors worth a human's attention: server faults (HTTP 5xx) and anything
 * that isn't a recognized {@link ApiError} (an unexpected client-side throw). Expected 4xx —
 * auth, validation, not-found — are the app working as designed and would be noise. */
function reportUnexpected(error: unknown, context: Record<string, unknown>): void {
  const unexpected = error instanceof ApiError ? error.status >= 500 : true
  if (unexpected) {
    captureException(error, context)
  }
}

/** Shared React Query client. Modest staleness + a single retry suit a dashboard:
 * data is read often and re-fetched on navigation, not on every focus. */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => reportUnexpected(error, { kind: 'query', queryKey: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error) => reportUnexpected(error, { kind: 'mutation' }),
  }),
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})
