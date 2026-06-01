/**
 * Test-only surface: enough of the app's internals for another package's test
 * harness to stand up a real server against a throwaway database. Not imported by
 * any runtime path.
 */
export { createApp, type App, type AppOptions } from './app.ts'
export { createContext, type AppContext, type OwnedContext } from './context.ts'
export { ensureSeed } from './seed.ts'
