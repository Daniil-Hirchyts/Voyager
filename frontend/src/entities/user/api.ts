import { requestJson } from '@/shared/api/client'
import type { UserProfile, UserProfilePatchInput } from '@/shared/api/types'

export async function getProfile(): Promise<UserProfile> {
  return requestJson<UserProfile>('/users/profile')
}

export async function patchProfile(data: UserProfilePatchInput): Promise<UserProfile> {
  return requestJson<UserProfile>('/users/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}
