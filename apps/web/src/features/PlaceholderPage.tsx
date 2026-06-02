import { PageContainer } from '../components/layout/PageContainer.tsx'

/** A simple stub for routes whose real content lands in a later iteration. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-neutral-500">Coming soon.</p>
    </PageContainer>
  )
}
