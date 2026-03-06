import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProfile, patchProfile } from './api'
import type { UserProfilePatchInput } from '@/shared/api/types'

export const profileKeys = {
  all: ['profile'] as const,
}

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.all,
    queryFn: getProfile,
    staleTime: 5 * 60 * 1000,
  })
}

export function usePatchProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UserProfilePatchInput) => patchProfile(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: profileKeys.all }),
  })
}
