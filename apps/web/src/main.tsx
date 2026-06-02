import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { queryClient } from './app/queryClient.ts'
import { RootGate } from './app/RootGate.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import './index.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('Root element #root not found')
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootGate />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
