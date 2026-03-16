import { useEffect, useRef, useState } from 'react';
import { Image } from 'lucide-react';
import { toast } from 'sonner';
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer';
import { usePlacePhotos, useRefreshPlacePhotos } from '@/entities/photo/queries';
import { useJob } from '@/entities/job/queries';
import { isJobRunning, isJobSuccessful } from '@/shared/lib/jobs';
import { resolvePhotoUrl } from '@/shared/lib/media';
import { Skeleton } from '@/components/ui/skeleton';
import type { PlacePhoto } from '@/shared/api/types';

function PlacePhotoOverlay({ photo }: { photo: PlacePhoto }) {
  if (!photo.attribution_text && !photo.license_code) {
    return null;
  }

  return (
    <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 rounded-[14px] bg-black/58 px-3 py-2 text-[0.72rem] text-white backdrop-blur-sm">
      <span className="min-w-0 truncate">{photo.attribution_text ?? 'Licensed photo'}</span>
      {photo.license_url ? (
        <a
          href={photo.license_url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-full border border-white/18 bg-white/10 px-2 py-1 text-[0.66rem] font-semibold text-white transition-colors hover:bg-white/18"
          onClick={(event) => event.stopPropagation()}
        >
          {photo.license_code ?? 'License'}
        </a>
      ) : null}
    </div>
  );
}

interface Props {
  placeId: string;
  placeName?: string;
  autoFetchWhenEmpty?: boolean;
}

export default function PlacePhotos({ placeId, placeName, autoFetchWhenEmpty = false }: Props) {
  const [refreshJobId, setRefreshJobId] = useState<string | null>(null);
  const autoRefreshAttemptedRef = useRef(false);

  const { data, isLoading } = usePlacePhotos(placeId);
  const photos = data?.items ?? [];

  const { mutateAsync: triggerRefresh, isPending: refreshPending } = useRefreshPlacePhotos(placeId);
  const { data: refreshJob } = useJob(refreshJobId);
  const refreshRunning = isJobRunning(refreshJob?.status);
  const refreshSucceeded = isJobSuccessful(refreshJob?.status);

  useEffect(() => {
    if (refreshSucceeded && refreshJobId) {
      setRefreshJobId(null);
      toast.success('Photos refreshed');
    }
  }, [refreshSucceeded, refreshJobId]);

  useEffect(() => {
    autoRefreshAttemptedRef.current = false;
  }, [placeId]);

  useEffect(() => {
    if (
      !autoFetchWhenEmpty ||
      isLoading ||
      photos.length > 0 ||
      refreshPending ||
      refreshRunning ||
      autoRefreshAttemptedRef.current
    ) {
      return;
    }

    autoRefreshAttemptedRef.current = true;
    const idempotencyKey = `photo-refresh-${placeId}-${Date.now()}`;
    void triggerRefresh(idempotencyKey)
      .then((accepted) => {
        setRefreshJobId(accepted.job_id);
      })
      .catch(() => {
        toast.error('Photo refresh failed');
      });
  }, [
    autoFetchWhenEmpty,
    isLoading,
    photos.length,
    placeId,
    refreshPending,
    refreshRunning,
    triggerRefresh,
  ]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Photos
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-24 shrink-0 rounded-[8px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Photos{placeName ? ` — ${placeName}` : ''}
        </p>
      </div>

      {photos.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Image className="h-8 w-8 text-[var(--color-text-muted)]/30" />
          <p className="text-xs text-[var(--color-text-muted)]">No photos yet</p>
        </div>
      )}

      {photos.length > 0 && (
        <PhotoViewerProvider>
          <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Place photos">
            {photos.map((photo, i) => {
              const thumbnailUrl =
                resolvePhotoUrl(photo, 'thumb') || photo.thumbnail_url || photo.image_url;
              const fullUrl = resolvePhotoUrl(photo, 'full') || photo.image_url;

              return (
                <PhotoViewer
                  key={photo.id}
                  src={fullUrl}
                  overlay={<PlacePhotoOverlay photo={photo} />}
                >
                  <button
                    type="button"
                    role="listitem"
                    className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-[12px] border border-[var(--color-border-strong)] focus:ring-2 focus:ring-[var(--ring)] focus:outline-none"
                    aria-label={photo.attribution_text ?? `Photo ${i + 1}`}
                  >
                    <img
                      src={thumbnailUrl}
                      alt=""
                      aria-hidden="true"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                </PhotoViewer>
              );
            })}
          </div>
        </PhotoViewerProvider>
      )}
    </div>
  );
}
