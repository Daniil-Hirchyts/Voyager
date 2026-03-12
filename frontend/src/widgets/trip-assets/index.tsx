import { useRef, useState, type DragEvent } from 'react'
import {
  Download,
  FileText,
  Loader2,
  MoreVertical,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  title?: string
  description?: string
  className?: string
}

export default function TripAssetManager({
  tripId,
  activityId,
  title = "Files & Media",
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
      toast.success(`${succeeded} file${succeeded === 1 ? '' : 's'} uploaded`)
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
      toast.success('File removed')
      if (previewAsset?.id === assetId) {
        setPreviewAsset(null)
      }
    } catch {
      toast.error('Could not remove file')
    } finally {
      setDeletingAssetId(null)
    }
  }

  return (
    <>
      <section
        className={cn(
          'relative flex flex-col gap-4 rounded-[22px] border border-black/8 bg-white p-5 shadow-sm',
          dragActive && 'ring-2 ring-black/5 ring-offset-2',
          className,
        )}
        onDragEnter={() => setDragActive(true)}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 max-w-[28rem] text-[0.78rem] leading-5 text-[var(--color-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-3 text-[0.75rem] font-bold"
            onClick={() => inputRef.current?.click()}
            disabled={uploadingCount > 0}
          >
            {uploadingCount > 0 ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1.5 size-3.5" />
            )}
            {uploadingCount > 0 ? `Uploading...` : 'Add'}
          </Button>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) {
              void handleFiles(event.target.files)
            }
            event.target.value = ''
          }}
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-black/20" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[18px] border border-dashed border-black/8 bg-[var(--color-secondary-surface)] py-8 text-center">
            <p className="text-[0.8rem] font-medium text-[var(--color-text-muted)]">
              No files yet
            </p>
            <p className="mt-1 text-[0.7rem] text-black/40">
              Drop files here to upload
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((asset) => (
              <div
                key={asset.id}
                className="group relative flex items-center gap-3 rounded-[16px] border border-black/5 bg-[var(--color-secondary-surface)] p-2 transition-all hover:border-black/10 hover:bg-white hover:shadow-sm"
              >
                <div 
                  className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/5 cursor-pointer"
                  onClick={() => asset.kind === 'photo' && setPreviewAsset(asset)}
                >
                  {asset.kind === 'photo' && asset.preview_url ? (
                    <img
                      src={asset.preview_url}
                      alt=""
                      className="h-full w-full object-cover transition-transform group-hover:scale-110"
                    />
                  ) : (
                    <FileText className="size-5 text-black/20" />
                  )}
                </div>

                <div className="min-w-0 flex-1 pr-8">
                  <p className="truncate text-[0.82rem] font-semibold text-[var(--color-text)]">
                    {asset.original_filename}
                  </p>
                  <p className="mt-0.5 text-[0.7rem] font-medium text-[var(--color-text-muted)] opacity-70">
                    {formatBytes(asset.size_bytes)}
                  </p>
                </div>

                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-[14px]">
                      <DropdownMenuItem asChild className="rounded-[10px] cursor-pointer">
                        <a href={asset.download_url} target="_blank" rel="noopener noreferrer" className="flex items-center">
                          <Download className="mr-2 size-4" />
                          Download
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="rounded-[10px] cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50"
                        disabled={deletingAssetId === asset.id}
                        onClick={() => void handleDelete(asset.id)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}

        {dragActive && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[22px] bg-white/80 backdrop-blur-sm transition-all animate-in fade-in zoom-in-95">
            <div className="flex flex-col items-center gap-2">
              <div className="flex size-12 items-center justify-center rounded-full bg-black text-white">
                <Plus className="size-6" />
              </div>
              <p className="text-[0.9rem] font-bold">Drop to upload</p>
            </div>
          </div>
        )}
      </section>

      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => (!open ? setPreviewAsset(null) : undefined)}>
        <DialogContent className="max-w-[90vw] border-none bg-transparent p-0 shadow-none sm:max-w-4xl">
          <div className="relative overflow-hidden rounded-[26px] bg-white shadow-2xl">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 z-10 h-10 w-10 rounded-full bg-white/80 backdrop-blur hover:bg-white"
              onClick={() => setPreviewAsset(null)}
            >
              <X className="size-5" />
            </Button>
            <div className="flex items-center justify-center p-2">
              {previewAsset?.preview_url ? (
                <img
                  src={previewAsset.preview_url}
                  alt={previewAsset.original_filename}
                  className="max-h-[85vh] w-full rounded-[20px] object-contain"
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between bg-white px-6 py-4 border-t border-black/5">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{previewAsset?.original_filename}</p>
                <p className="text-[0.7rem] font-medium text-black/40">
                  {previewAsset && formatBytes(previewAsset.size_bytes)}
                  {previewAsset?.image_width && ` · ${previewAsset.image_width}×${previewAsset.image_height}`}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <a href={previewAsset?.download_url} target="_blank" rel="noopener noreferrer">
                  <Download className="mr-2 size-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
