import { QueryClient } from '@tanstack/react-query'

/** Shared React Query client. Modest staleness + a single retry suit a dashboard:
 * data is read often and re-fetched on navigation, not on every focus. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})
