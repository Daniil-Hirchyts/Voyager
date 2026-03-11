import { useState, useEffect, useCallback, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, Image } from 'lucide-react'
import { toast } from 'sonner'
import { usePlacePhotos, useRefreshPlacePhotos } from '@/entities/photo/queries'
import { useJob } from '@/entities/job/queries'
import { isJobRunning, isJobSuccessful } from '@/shared/lib/jobs'
import { resolvePhotoUrl } from '@/shared/lib/media'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { PlacePhoto } from '@/shared/api/types'

function Lightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: PlacePhoto[]
  initialIndex: number
  onClose: () => void
}) {
  const [index, setIndex] = useState(initialIndex)
  const photo = photos[index]

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const next = useCallback(() => setIndex((i) => Math.min(photos.length - 1, i + 1)), [photos.length])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, prev, next])

  if (!photo) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Photo gallery"
    >
      {/* Close */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white hover:bg-white/10"
        aria-label="Close gallery"
      >
        <X className="w-5 h-5" />
      </Button>

      {/* Counter */}
      <p className="absolute top-4 left-4 text-white/60 text-sm">
        {index + 1} / {photos.length}
      </p>

      {/* Main image */}
      <img
        src={resolvePhotoUrl(photo, 'full') || photo.image_url}
        alt={photo.attribution_text ?? `Photo ${index + 1}`}
        className="max-h-[80vh] max-w-[90vw] object-contain rounded-[8px]"
      />

      {/* Attribution */}
      {(photo.attribution_text || photo.license_code) && (
        <div className="mt-3 text-center text-xs text-white/50 max-w-lg px-4">
          {photo.attribution_text}
          {photo.license_url && (
            <>
              {' '}·{' '}
              <a href={photo.license_url} target="_blank" rel="noopener noreferrer" className="underline">
                {photo.license_code ?? 'License'}
              </a>
            </>
          )}
        </div>
      )}

      {/* Navigation */}
      {photos.length > 1 && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={prev}
            disabled={index === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={next}
            disabled={index === photos.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30"
            aria-label="Next photo"
          >
            <ChevronRight className="w-6 h-6" />
          </Button>
        </>
      )}
    </div>
  )
}

interface Props {
  placeId: string
  placeName?: string
  autoFetchWhenEmpty?: boolean
}

export default function PlacePhotos({
  placeId,
  placeName,
  autoFetchWhenEmpty = false,
}: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null)
  const autoRefreshAttemptedRef = useRef(false)

  const { data, isLoading } = usePlacePhotos(placeId)
  const photos = data?.items ?? []

  const { mutateAsync: triggerRefresh, isPending: refreshPending } = useRefreshPlacePhotos(placeId)
  const { data: refreshJob } = useJob(refreshJobId)
  const refreshRunning = isJobRunning(refreshJob?.status)
  const refreshSucceeded = isJobSuccessful(refreshJob?.status)

  useEffect(() => {
    if (refreshSucceeded && refreshJobId) {
      setRefreshJobId(null)
      toast.success('Photos refreshed')
    }
  }, [refreshSucceeded, refreshJobId])

  useEffect(() => {
    autoRefreshAttemptedRef.current = false
  }, [placeId])

  useEffect(() => {
    if (
      !autoFetchWhenEmpty ||
      isLoading ||
      photos.length > 0 ||
      refreshPending ||
      refreshRunning ||
      autoRefreshAttemptedRef.current
    ) {
      return
    }

    autoRefreshAttemptedRef.current = true
    const idempotencyKey = `photo-refresh-${placeId}-${Date.now()}`
    void triggerRefresh(idempotencyKey)
      .then((accepted) => {
        setRefreshJobId(accepted.job_id)
      })
      .catch(() => {
        toast.error('Photo refresh failed')
      })
  }, [
    autoFetchWhenEmpty,
    isLoading,
    photos.length,
    placeId,
    refreshPending,
    refreshRunning,
    triggerRefresh,
  ])

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Photos</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="w-24 h-24 rounded-[8px] shrink-0" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Photos{placeName ? ` — ${placeName}` : ''}
        </p>
      </div>

      {photos.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Image className="w-8 h-8 text-[var(--color-text-muted)]/30" />
          <p className="text-xs text-[var(--color-text-muted)]">No photos yet</p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Place photos">
          {photos.map((photo, i) => (
            <button
              key={photo.id}
              role="listitem"
              onClick={() => setLightboxIndex(i)}
              className="h-24 w-24 shrink-0 overflow-hidden rounded-[12px] border border-[var(--color-border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              aria-label={photo.attribution_text ?? `Photo ${i + 1}`}
            >
              <img
                src={resolvePhotoUrl(photo, 'thumb') || photo.thumbnail_url || photo.image_url}
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover hover:scale-105 transition-transform"
              />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
