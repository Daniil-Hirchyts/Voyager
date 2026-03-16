import { requestJson } from '@/shared/api/client';
import type { Day, DayListResponse, DayUpdateInput } from '@/shared/api/types';

export async function getDays(tripId: string): Promise<DayListResponse> {
  return requestJson<DayListResponse>(`/trips/${tripId}/days`);
}

export async function patchDay(dayId: string, data: Partial<DayUpdateInput>): Promise<Day> {
  return requestJson<Day>(`/days/${dayId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
