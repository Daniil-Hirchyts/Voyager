import { requestJson } from '@/shared/api/client'
import type {
  JobAcceptedResponse,
  ProposalListResponse,
  ProposalResponse,
  ProposalApplyResponse,
  TripOptimizeInput,
} from '@/shared/api/types'

export async function optimizeTrip(
  tripId: string,
  data: TripOptimizeInput,
  idempotencyKey: string,
): Promise<JobAcceptedResponse> {
  return requestJson<JobAcceptedResponse>(`/trips/${tripId}/optimize`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(data),
  })
}

export async function listProposals(
  tripId: string,
  params: { limit?: number; offset?: number } = {},
): Promise<ProposalListResponse> {
  const qs = new URLSearchParams()
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  const q = qs.toString()
  return requestJson<ProposalListResponse>(`/trips/${tripId}/proposals${q ? `?${q}` : ''}`)
}

export async function getProposal(proposalId: string): Promise<ProposalResponse> {
  return requestJson<ProposalResponse>(`/proposals/${proposalId}`)
}

export async function applyProposal(
  proposalId: string,
  tripVersion: number,
  idempotencyKey: string,
): Promise<ProposalApplyResponse> {
  return requestJson<ProposalApplyResponse>(`/proposals/${proposalId}/apply`, {
    method: 'POST',
    headers: {
      'If-Match': String(tripVersion),
      'Idempotency-Key': idempotencyKey,
    },
  })
}
