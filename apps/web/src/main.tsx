import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary, initSentry } from './app/observability.ts'
import { queryClient } from './app/queryClient.ts'
import { RootGate } from './app/RootGate.tsx'
import { ThemeProvider } from './app/theme.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import './index.css'

initSentry()

const root = document.getElementById('root')
if (root === null) {
  throw new Error('Root element #root not found')
}

/** Last-resort fallback when a render error escapes every page. Sentry's ErrorBoundary reports
 * the error before showing this (a no-op report when Sentry isn't configured). */
function CrashFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8 text-center text-sm text-subtle">
      <div>
        <p className="text-fg">Something went wrong.</p>
        <p className="mt-1">Try reloading the page.</p>
      </div>
    </div>
  )
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashFallback />}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootGate />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
