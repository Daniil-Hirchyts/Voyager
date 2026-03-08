import { buildApiUrl } from '@/shared/api/client'
import type { PlacePhotoSummary } from '@/shared/api/types'

export function resolveMediaUrl(url: string | null | undefined) {
  if (!url) return null
  return buildApiUrl(url)
}

export function resolvePhotoUrl(
  photo: Pick<
    PlacePhotoSummary,
    'display_url' | 'display_thumbnail_url' | 'image_url' | 'thumbnail_url'
  > | null | undefined,
  variant: 'full' | 'thumb' = 'thumb',
) {
  if (!photo) return null
  if (variant === 'thumb') {
    return resolveMediaUrl(photo.display_thumbnail_url || photo.display_url || photo.thumbnail_url || photo.image_url)
  }
  return resolveMediaUrl(photo.display_url || photo.image_url || photo.thumbnail_url)
}
