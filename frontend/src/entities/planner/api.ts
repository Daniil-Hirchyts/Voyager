import { requestJson } from '@/shared/api/client'
import type { PlannerResponse } from '@/shared/api/types'

export async function getPlanner(tripId: string): Promise<PlannerResponse> {
  return requestJson<PlannerResponse>(`/trips/${tripId}/planner`)
}
