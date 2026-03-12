import { useRef, useState, type DragEvent } from 'react'
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useDeleteTripAsset,
  useTripAssets,
  useUploadTripAsset,
} from '@/entities/trip-asset/queries'
import type { TripAssetResponse } from '@/shared/api/types'
import { cn } from '@/shared/lib/cn'

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

interface TripAssetManagerProps {
  tripId: string
  activityId?: string | null
  title: string
  description: string
  className?: string
}

export default function TripAssetManager({
  tripId,
  activityId,
  title,
  description,
  className,
}: TripAssetManagerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploadingCount, setUploadingCount] = useState(0)
  const [previewAsset, setPreviewAsset] = useState<TripAssetResponse | null>(null)
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null)

  const { data, isLoading } = useTripAssets(tripId, activityId)
  const uploadMutation = useUploadTripAsset(tripId)
  const deleteMutation = useDeleteTripAsset(tripId)

  const items = data?.items ?? []
  const photos = items.filter((item) => item.kind === 'photo')
  const files = items.filter((item) => item.kind === 'file')

  const acceptLabel = activityId ? 'Add activity files' : 'Add trip files'

  async function handleFiles(fileList: FileList | File[]) {
    const filesToUpload = Array.from(fileList)
    if (filesToUpload.length === 0) return

    setUploadingCount(filesToUpload.length)
    const results = await Promise.allSettled(
      filesToUpload.map((file) =>
        uploadMutation.mutateAsync({
          file,
          activityId,
        }),
      ),
    )
    setUploadingCount(0)

    const succeeded = results.filter((result) => result.status === 'fulfilled').length
    const failed = results.length - succeeded
    if (succeeded > 0) {
      toast.success(
        `${succeeded} upload${succeeded === 1 ? '' : 's'} added`,
      )
    }
    if (failed > 0) {
      toast.error(`${failed} upload${failed === 1 ? '' : 's'} failed`)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    if (event.dataTransfer.files.length > 0) {
      void handleFiles(event.dataTransfer.files)
    }
  }

  async function handleDelete(assetId: string) {
    setDeletingAssetId(assetId)
    try {
      await deleteMutation.mutateAsync(assetId)
      toast.success('Upload removed')
      if (previewAsset?.id === assetId) {
        setPreviewAsset(null)
      }
    } catch {
      toast.error('Could not remove upload')
    } finally {
      setDeletingAssetId(null)
    }
  }

  return (
    <>
      <section
        className={cn(
          'rounded-[20px] border border-black/8 bg-white p-5 shadow-[0_22px_60px_-44px_rgba(15,23,42,0.22)]',
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
              {title}
            </h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={uploadingCount > 0}
          >
            {uploadingCount > 0 ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            {uploadingCount > 0 ? `Uploading ${uploadingCount}` : acceptLabel}
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="trip-asset-input"
          onChange={(event) => {
            if (event.target.files?.length) {
              void handleFiles(event.target.files)
            }
            event.target.value = ''
          }}
        />

        <div
          className={cn(
            'mt-4 rounded-[18px] border border-dashed px-4 py-5 transition-colors',
            dragActive
              ? 'border-[rgba(0,0,0,0.28)] bg-[rgba(15,23,42,0.04)]'
              : 'border-black/12 bg-[var(--color-secondary-surface)]',
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragActive(false)
          }}
          onDrop={handleDrop}
        >
          <p className="text-sm font-medium text-[var(--color-text)]">
            Drag files and photos here
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Voyager uploads one file per request, keeps images previewable, and stores everything
            in your local bucket.
          </p>
        </div>

        {isLoading ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 className="size-4 animate-spin" />
            Loading uploads…
          </div>
        ) : null}

        {!isLoading && items.length === 0 ? (
          <div className="mt-4 rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)] px-4 py-5 text-sm text-[var(--color-text-muted)]">
            No uploads yet.
          </div>
        ) : null}

        {photos.length > 0 ? (
          <div className="mt-4">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              Photos
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {photos.map((asset) => (
                <article
                  key={asset.id}
                  className="overflow-hidden rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)]"
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => setPreviewAsset(asset)}
                  >
                    {asset.preview_url ? (
                      <img
                        src={asset.preview_url}
                        alt={asset.original_filename}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center bg-white text-[var(--color-text-muted)]">
                        <ImageIcon className="size-6" />
                      </div>
                    )}
                  </button>
                  <div className="space-y-3 px-4 py-3">
                    <div>
                      <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                        {asset.original_filename}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {formatBytes(asset.size_bytes)}
                        {asset.image_width && asset.image_height
                          ? ` · ${asset.image_width}×${asset.image_height}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewAsset(asset)}
                      >
                        Preview
                      </Button>
                      <Button asChild type="button" size="sm" variant="outline">
                        <a href={asset.download_url} target="_blank" rel="noopener noreferrer">
                          <Download className="mr-2 size-4" />
                          Download
                        </a>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        disabled={deletingAssetId === asset.id}
                        onClick={() => void handleDelete(asset.id)}
                      >
                        {deletingAssetId === asset.id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 size-4" />
                        )}
                        Remove
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {files.length > 0 ? (
          <div className="mt-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
              Files
            </p>
            <div className="mt-3 space-y-3">
              {files.map((asset) => (
                <article
                  key={asset.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)] px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[var(--color-text-muted)]">
                        <FileText className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {asset.original_filename}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {asset.content_type} · {formatBytes(asset.size_bytes)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild type="button" size="sm" variant="outline">
                      <a href={asset.download_url} target="_blank" rel="noopener noreferrer">
                        <Download className="mr-2 size-4" />
                        Download
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingAssetId === asset.id}
                      onClick={() => void handleDelete(asset.id)}
                    >
                      {deletingAssetId === asset.id ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 size-4" />
                      )}
                      Remove
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => (!open ? setPreviewAsset(null) : undefined)}>
        <DialogContent className="max-w-4xl overflow-hidden p-0">
          <DialogHeader>
            <DialogTitle>{previewAsset?.original_filename ?? 'Preview'}</DialogTitle>
            <DialogDescription>
              Full-size preview for uploaded trip media.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-[var(--color-secondary-surface)] p-5">
            {previewAsset?.preview_url ? (
              <img
                src={previewAsset.preview_url}
                alt={previewAsset.original_filename}
                className="max-h-[72vh] w-full rounded-[20px] object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
