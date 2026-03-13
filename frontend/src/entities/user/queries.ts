import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteProfileAvatar, getProfile, patchProfile, uploadProfileAvatar } from './api'
import type { UserProfile, UserProfilePatchInput } from '@/shared/api/types'

export const profileKeys = {
  all: ['profile'] as const,
}

function writeProfileCache(qc: ReturnType<typeof useQueryClient>, profile: UserProfile) {
  qc.setQueryData(profileKeys.all, profile)
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
    onSuccess: (profile) => {
      writeProfileCache(qc, profile)
    },
  })
}

export function useUploadProfileAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadProfileAvatar(file),
    onSuccess: (profile) => {
      writeProfileCache(qc, profile)
    },
  })
}

export function useDeleteProfileAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deleteProfileAvatar(),
    onSuccess: (profile) => {
      writeProfileCache(qc, profile)
    },
  })
}
