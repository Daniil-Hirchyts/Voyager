import { buildApiUrl, createRequestHeaders, requestJson, toApiError } from '@/shared/api/client';
import type { UserProfile, UserProfilePatchInput } from '@/shared/api/types';

export async function getProfile(): Promise<UserProfile> {
  return requestJson<UserProfile>('/users/profile');
}

export async function patchProfile(data: UserProfilePatchInput): Promise<UserProfile> {
  return requestJson<UserProfile>('/users/profile', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function uploadProfileAvatar(file: File): Promise<UserProfile> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(buildApiUrl('/users/profile/avatar'), {
    method: 'POST',
    headers: createRequestHeaders(),
    body: formData,
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  return response.json() as Promise<UserProfile>;
}

export async function deleteProfileAvatar(): Promise<UserProfile> {
  return requestJson<UserProfile>('/users/profile/avatar', {
    method: 'DELETE',
  });
}
