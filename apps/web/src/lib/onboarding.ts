/**
 * Client-side, *non-secret* progress for the first-run wizard, so a reload mid-flow resumes
 * where the user left off instead of restarting (and re-creating a project). Deliberately
 * holds NO API key — the agent's key is a secret and lives only in React state for the life
 * of the page; on resume the wizard rotates a fresh key instead of reading one back from here.
 *
 * The durable "did the user finish onboarding" fact lives server-side
 * (`users.onboarding_completed_at` via `/api/me`); this is just ephemeral UI position.
 */
export interface OnboardingProgress {
  orgId: string
  /** Wizard step the user had reached: 0 = create project, 1 = connect agent, 2 = grant. */
  step: number
  projectId?: string
  projectName?: string
  agentId?: string
  agentName?: string
}

const STORAGE_KEY = 'walnut.onboarding'

export interface ProgressStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Read saved progress for `orgId`, or null if there's none (or it's for another org). */
export function loadOnboarding(store: ProgressStore, orgId: string): OnboardingProgress | null {
  const raw = store.getItem(STORAGE_KEY)
  if (raw === null) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as OnboardingProgress).orgId === orgId &&
      typeof (parsed as OnboardingProgress).step === 'number'
    ) {
      return parsed as OnboardingProgress
    }
    return null
  } catch {
    return null
  }
}

export function saveOnboarding(store: ProgressStore, progress: OnboardingProgress): void {
  store.setItem(STORAGE_KEY, JSON.stringify(progress))
}

export function clearOnboarding(store: ProgressStore): void {
  store.removeItem(STORAGE_KEY)
}
