import { treaty } from '@elysiajs/eden'
import type { App } from '@walnut/api/app'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** Type-safe RPC client generated from the Elysia backend's types. */
export const api = treaty<App>(API_URL)

export { API_URL }
