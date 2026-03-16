import { requestJson } from '@/shared/api/client';
import type {
  Trip,
  TripInvitation,
  TripInvitationCreateInput,
  TripInvitationCreateResponse,
  TripInvitationPreview,
  TripSharingResponse,
} from '@/shared/api/types';

export async function getTripSharing(tripId: string): Promise<TripSharingResponse> {
  return requestJson<TripSharingResponse>(`/trips/${tripId}/sharing`);
}

export async function createTripInvite(
  tripId: string,
  data: TripInvitationCreateInput = { role: 'editor' },
): Promise<TripInvitationCreateResponse> {
  return requestJson<TripInvitationCreateResponse>(`/trips/${tripId}/invites`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function revokeTripInvite(tripId: string, invitationId: string): Promise<void> {
  return requestJson<void>(`/trips/${tripId}/invites/${invitationId}`, {
    method: 'DELETE',
  });
}

export async function removeTripCollaborator(
  tripId: string,
  collaboratorUserId: string,
): Promise<void> {
  return requestJson<void>(`/trips/${tripId}/collaborators/${collaboratorUserId}`, {
    method: 'DELETE',
  });
}

export async function getTripInvitationPreview(token: string): Promise<TripInvitationPreview> {
  return requestJson<TripInvitationPreview>(`/trip-invitations/${token}`);
}

export async function acceptTripInvitation(token: string): Promise<Trip> {
  return requestJson<Trip>(`/trip-invitations/${token}/accept`, {
    method: 'POST',
  });
}

export function buildTripInviteUrl(invitation: Pick<TripInvitation, 'invite_path'>) {
  return `${window.location.origin}${invitation.invite_path}`;
}
