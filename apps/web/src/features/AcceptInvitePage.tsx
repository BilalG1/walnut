import { useNavigate, useParams } from '@tanstack/react-router'
import { Building } from '@walnut/icons'
import { Badge, Button, Card, Spinner } from '@walnut/ui'
import { ApiError } from '../data/http.ts'
import { useAcceptInvite, useInvitePreview } from '../data/queries.ts'

/** Standalone redeem page for an invite link (`/invite/:token`). The router only mounts when
 * signed in (see RootGate), so a logged-out visitor signs in first and lands back here. Previews
 * the invite, then joins the org on accept and routes the new member into it. */
export function AcceptInvitePage() {
  const { token } = useParams({ strict: false }) as { token?: string }
  if (token === undefined) {
    return null
  }
  return <AcceptInviteView token={token} />
}

/** Message for a link that can't be redeemed, mirroring the server's reasons. */
function deadMessage(state: string): string {
  switch (state) {
    case 'expired':
      return 'This invite link has expired.'
    case 'revoked':
      return 'This invite link has been revoked.'
    case 'accepted':
      return 'This invite link has already been used.'
    default:
      return 'This invite link is no longer valid.'
  }
}

function AcceptInviteView({ token }: { token: string }) {
  const navigate = useNavigate()
  const preview = useInvitePreview(token)
  const accept = useAcceptInvite()

  function goHome() {
    void navigate({ to: '/' })
  }
  function goToOrg(orgId: string) {
    void navigate({ to: '/orgs/$orgId', params: { orgId } })
  }
  function onAccept() {
    accept.mutate(token, { onSuccess: (res) => goToOrg(res.organizationId) })
  }

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <Card className="w-full p-8 text-center">
        {preview.isPending ? (
          <Spinner />
        ) : preview.error !== null ? (
          <Dead
            message={
              preview.error instanceof ApiError && preview.error.status === 404
                ? 'This invite link is invalid.'
                : preview.error.message
            }
            onHome={goHome}
          />
        ) : preview.data === undefined ? null : preview.data.alreadyMember ? (
          <>
            <Header name={preview.data.organizationName} />
            <p className="mt-2 text-sm text-subtle">You&apos;re already a member of this organization.</p>
            <Button className="mt-6 w-full justify-center" onClick={() => goToOrg(preview.data.organizationId)}>
              Go to organization
            </Button>
          </>
        ) : preview.data.state !== 'valid' ? (
          <Dead message={deadMessage(preview.data.state)} onHome={goHome} />
        ) : (
          <>
            <Header name={preview.data.organizationName} />
            <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-subtle">
              You&apos;ve been invited to join as <Badge tone="neutral">{preview.data.role}</Badge>
            </p>
            {accept.error !== null ? <p className="mt-4 text-sm text-danger">{accept.error.message}</p> : null}
            <div className="mt-6 flex flex-col gap-2">
              <Button className="w-full justify-center" disabled={accept.isPending} onClick={onAccept}>
                {accept.isPending ? 'Joining…' : 'Accept invite'}
              </Button>
              <Button variant="ghost" className="w-full justify-center" disabled={accept.isPending} onClick={goHome}>
                Not now
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}

function Header({ name }: { name: string }) {
  return (
    <>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-walnut-500/10 text-accent">
        <Building size={22} />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{name}</h1>
    </>
  )
}

function Dead({ message, onHome }: { message: string; onHome: () => void }) {
  return (
    <>
      <h1 className="text-lg font-semibold tracking-tight">Invite unavailable</h1>
      <p className="mt-2 text-sm text-subtle">{message}</p>
      <Button variant="ghost" className="mt-6 w-full justify-center" onClick={onHome}>
        Go to dashboard
      </Button>
    </>
  )
}
