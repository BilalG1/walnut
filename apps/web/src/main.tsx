import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import './index.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('Root element #root not found')
}

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
