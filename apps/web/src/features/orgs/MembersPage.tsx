import { Plus } from '@walnut/icons'
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Spinner, type BadgeTone } from '@walnut/ui'
import { useState } from 'react'
import { useScope } from '../../app/useScope.ts'
import { ApiKeyReveal } from '../../components/ApiKeyReveal.tsx'
import { PageContainer } from '../../components/layout/PageContainer.tsx'
import {
  useCreateInvitation,
  useMe,
  useOrgInvitations,
  useOrgMembers,
  useRemoveMember,
  useRevokeInvitation,
} from '../../data/queries.ts'
import { expiresLabel, timeAgo } from '../../lib/format.ts'

type Member = NonNullable<ReturnType<typeof useOrgMembers>['data']>[number]

/** Tone-code an org role: owner stands out, admin is mid, member is neutral. */
function roleTone(role: string): BadgeTone {
  return role === 'owner' ? 'amber' : role === 'admin' ? 'purple' : 'neutral'
}

/** Org members roster + link-based invites: see who's in the org, mint shareable invite links,
 * revoke pending ones, and remove members. */
export function MembersPage() {
  const { orgId } = useScope()
  if (orgId === undefined) {
    return null
  }
  return <MembersView orgId={orgId} />
}

function MembersView({ orgId }: { orgId: string }) {
  const me = useMe()
  const members = useOrgMembers(orgId)
  const removeMember = useRemoveMember(orgId)
  const createInvite = useCreateInvitation(orgId)

  const [removing, setRemoving] = useState<Member | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const rows = members.data ?? []

  // Generation is driven by user action (button click / "New link"), never a render-time effect.
  function generateInvite() {
    setInviteLink(null)
    createInvite.mutate(undefined, {
      onSuccess: (inv) => setInviteLink(`${window.location.origin}/invite/${inv.token}`),
    })
  }
  function openInvite() {
    setInviteOpen(true)
    generateInvite()
  }
  function closeInvite() {
    setInviteOpen(false)
    setInviteLink(null)
    createInvite.reset()
  }

  function confirmRemove() {
    if (removing === null) {
      return
    }
    removeMember.mutate(removing.userId, { onSuccess: () => setRemoving(null) })
  }

  return (
    <PageContainer>
      <div className="flex items-start gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
          <p className="mt-1 text-sm text-subtle">
            Everyone in this organization. Share an invite link to add a teammate.
          </p>
        </div>
        <Button className="ml-auto" onClick={openInvite}>
          <Plus size={15} />
          Invite link
        </Button>
      </div>

      <PendingInvites orgId={orgId} />

      <div className="mt-6">
        {members.isPending ? (
          <Spinner />
        ) : members.error !== null ? (
          <p className="text-sm text-danger">{members.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No members" hint="This shouldn't happen — an org always has at least its owner." />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-subtle">
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Joined</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((m) => {
                  const isYou = m.userId === me.data?.id
                  return (
                    <tr key={m.userId} className="hover:bg-hover">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar label={m.email} size={28} gradient="from-emerald-500 to-teal-600" />
                          <span className="font-medium">{m.email}</span>
                          {isYou ? <span className="text-xs text-subtle">(you)</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={roleTone(m.role)}>{m.role}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-subtle">{timeAgo(m.joinedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        {isYou ? null : (
                          <Button variant="subtle" size="sm" onClick={() => setRemoving(m)}>
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* Invite-link dialog */}
      <Dialog open={inviteOpen} onClose={closeInvite} title="Invite link">
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Anyone who opens this link while signed in joins the organization. It works once and expires in 7 days, so
            share it over a trusted channel — you won&apos;t be able to see it again.
          </p>
          {createInvite.error !== null ? (
            <p className="text-xs text-danger">{createInvite.error.message}</p>
          ) : inviteLink === null ? (
            <p className="text-sm text-subtle">Generating link…</p>
          ) : (
            <ApiKeyReveal apiKey={inviteLink} />
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={generateInvite} disabled={createInvite.isPending}>
              {createInvite.isPending ? 'Generating…' : 'New link'}
            </Button>
            <Button onClick={closeInvite}>Done</Button>
          </div>
        </div>
      </Dialog>

      {/* Remove-member confirmation */}
      <Dialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null)
          removeMember.reset()
        }}
        title="Remove member?"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setRemoving(null)
                removeMember.reset()
              }}
              disabled={removeMember.isPending}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRemove} disabled={removeMember.isPending}>
              {removeMember.isPending ? 'Removing…' : 'Remove'}
            </Button>
          </>
        }
      >
        <p>
          Remove <span className="font-medium text-fg">{removing?.email}</span> from this organization? They lose access
          to all of its projects immediately.
        </p>
        {removeMember.error !== null ? <p className="mt-2 text-xs text-danger">{removeMember.error.message}</p> : null}
      </Dialog>
    </PageContainer>
  )
}

/** The org's live invite links, each revocable. Renders nothing when there are none. */
function PendingInvites({ orgId }: { orgId: string }) {
  const invites = useOrgInvitations(orgId)
  const revoke = useRevokeInvitation(orgId)
  const rows = invites.data ?? []
  if (invites.error !== null) {
    return <p className="mt-6 text-sm text-danger">{invites.error.message}</p>
  }
  if (rows.length === 0) {
    return null
  }
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold">Pending invite links</h2>
      <p className="mt-1 text-xs text-subtle">
        Live links anyone can use once to join. The full link is shown only when created — revoke any you no longer
        trust.
      </p>
      <Card className="mt-3 divide-y divide-line">
        {rows.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
            <code className="font-mono text-xs text-subtle">{inv.tokenPrefix}…</code>
            <Badge tone={roleTone(inv.role)}>{inv.role}</Badge>
            <span className="text-xs text-subtle">{expiresLabel(inv.expiresAt)}</span>
            <span className="text-xs text-faint">created {timeAgo(inv.createdAt)}</span>
            <Button
              variant="subtle"
              size="sm"
              className="ml-auto"
              disabled={revoke.isPending && revoke.variables === inv.id}
              onClick={() => revoke.mutate(inv.id)}
            >
              {revoke.isPending && revoke.variables === inv.id ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        ))}
      </Card>
    </div>
  )
}
