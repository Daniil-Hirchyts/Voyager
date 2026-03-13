import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Image as ImageIcon,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { DatePicker } from '@/components/ui/date-picker'
import { Combobox } from '@/components/ui/combobox'
import { useTripCoverPhotoManager } from '@/entities/trip/useTripCoverPhotoManager'
import { useUploadTripAsset } from '@/entities/trip-asset/queries'
import { useDestinationAutocomplete } from '@/entities/place/queries'
import {
  useDeleteTrip,
  useDuplicateTrip,
  usePatchTrip,
  useTrip,
} from '@/entities/trip/queries'
import type { RouteTravelMode } from '@/shared/api/types'
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies'
import { resolvePhotoUrl } from '@/shared/lib/media'
import TripAssetManager from '@/widgets/trip-assets'
import { ROUTE_TRAVEL_MODE_OPTIONS } from './travel-modes'
import { cn } from '@/shared/lib/cn'
import { VoyagerLoader } from '@/widgets/app-shell/logo'

const fieldLabelClassName = 'text-[0.68rem] font-bold uppercase tracking-[0.12em] text-[var(--color-text-muted)]'

const TRIP_TYPES = [
  'leisure',
  'business',
  'adventure',
  'cultural',
  'family',
  'romantic',
  'solo',
  'group',
] as const

type TripSettingsForm = {
  title: string
  destination_text: string
  start_date: string
  end_date: string
  budget_amount: string
  budget_currency: string
  trip_type: string
  route_travel_mode: RouteTravelMode
}

function toTripSettingsForm(value: NonNullable<ReturnType<typeof useTrip>['data']>): TripSettingsForm {
  return {
    title: value.title,
    destination_text: value.destination_text,
    start_date: value.start_date,
    end_date: value.end_date,
    budget_amount: value.budget_amount ? String(value.budget_amount) : '',
    budget_currency: value.budget_currency ?? 'USD',
    trip_type: value.trip_type ?? 'leisure',
    route_travel_mode: value.route_travel_mode ?? 'WALK',
  }
}

interface TripSettingsMenuProps {
  tripId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  hasActivities?: boolean
  onReset?: (dayIds: string[] | undefined, idempotencyKey: string) => Promise<void>
}

export function TripSettingsMenu({ tripId, open, onOpenChange, hasActivities, onReset }: TripSettingsMenuProps) {
  const navigate = useNavigate()
  const { data: trip } = useTrip(tripId)
  const patchTrip = usePatchTrip(tripId)
  const uploadTripAsset = useUploadTripAsset(tripId)
  const duplicateTrip = useDuplicateTrip()
  const deleteTrip = useDeleteTrip()
  const coverUploadInputRef = useRef<HTMLInputElement | null>(null)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isUploadingCoverPhoto, setIsUploadingCoverPhoto] = useState(false)
  const [form, setForm] = useState<TripSettingsForm>({
    title: '',
    destination_text: '',
    start_date: '',
    end_date: '',
    budget_amount: '',
    budget_currency: 'USD',
    trip_type: 'leisure',
    route_travel_mode: 'WALK',
  })

  const [destinationSearchQuery, setDestinationSearchQuery] = useState('')
  const deferredDestinationQuery = useDeferredValue(destinationSearchQuery.trim())
  const destinationSearch = useDestinationAutocomplete(
    { q: deferredDestinationQuery, limit: 8, offset: 0 },
    deferredDestinationQuery.length >= 2,
  )
  const destinationOptions = useMemo(() => {
    const items = (destinationSearch.data?.items ?? []).map((item) => ({
      value: item.label,
      label: item.label,
      description: item.address_text ?? undefined,
    }))

    // Ensure the current value is always in the options so it shows up as selected
    if (form.destination_text && !items.find((i) => i.value === form.destination_text)) {
      items.unshift({
        value: form.destination_text,
        label: form.destination_text,
        description: undefined,
      })
    }

    return items
  }, [destinationSearch.data?.items, form.destination_text])
  
  const dupKey = useMemo(() => crypto.randomUUID(), [])
  
  const {
    coverPreference,
    coverPhotoCandidates,
    selectedCoverPhoto,
    isCoverPhotoBusy,
    coverPhotosLoading,
    coverPhotoRefreshError,
    resolvedPlaceId,
    handlePhotoSelection,
    commitPhotoSelection,
    handleCoverPhotoRefresh,
  } = useTripCoverPhotoManager(tripId, trip)

  useEffect(() => {
    if (!trip) {
      return
    }
    setForm(toTripSettingsForm(trip))
  }, [trip, open])

  async function handleSave() {
    if (!trip) {
      return
    }

    try {
      commitPhotoSelection()
      await patchTrip.mutateAsync({
        version: trip.version,
        data: {
          title: form.title.trim(),
          destination_text: form.destination_text.trim(),
          start_date: form.start_date,
          end_date: form.end_date,
          budget_amount: form.budget_amount ? Number(form.budget_amount) : null,
          budget_currency: form.budget_currency,
          trip_type: form.trip_type,
          route_travel_mode: form.route_travel_mode,
        },
      })
      toast.success('Trip settings saved')
      onOpenChange(false)
    } catch {
      toast.error('Could not save trip settings')
    }
  }

  async function handleDuplicate() {
    try {
      const duplicated = await duplicateTrip.mutateAsync({
        tripId,
        idempotencyKey: dupKey,
      })
      toast.success('Trip duplicated')
      onOpenChange(false)
      navigate(`/app/trips/${duplicated.id}`)
    } catch {
      toast.error('Could not duplicate this trip')
    }
  }

  async function handleDelete() {
    try {
      await deleteTrip.mutateAsync(tripId)
      toast.success('Trip deleted')
      onOpenChange(false)
      navigate('/app/trips')
    } catch {
      toast.error('Could not delete this trip')
    } finally {
      setShowDeleteConfirm(false)
    }
  }

  async function handleReset() {
    if (!onReset) return
    setIsResetting(true)
    try {
      await onReset(undefined, crypto.randomUUID())
      toast.success('Itinerary reset')
      setShowResetConfirm(false)
    } catch {
      toast.error('Could not reset itinerary')
    } finally {
      setIsResetting(false)
    }
  }

  async function handleCoverUpload(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) {
      return
    }

    setIsUploadingCoverPhoto(true)
    try {
      const uploaded = await uploadTripAsset.mutateAsync({ file, activityId: null })
      handlePhotoSelection(uploaded.id, 'uploaded')
      toast.success('Cover photo uploaded')
    } catch {
      toast.error('Could not upload cover photo')
    } finally {
      setIsUploadingCoverPhoto(false)
    }
  }

  if (!trip) return null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-xl border-l border-black/8">
          <SheetHeader className="shrink-0 border-b border-black/5 bg-white px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-black text-white">
                <Settings2 className="size-5" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold tracking-tight">Trip Settings</SheetTitle>
                <SheetDescription className="text-xs font-medium text-black/40">
                  Manage your journey parameters and assets
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
          
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-8 px-6 py-8 pb-12">
              {/* General Details */}
              <div className="space-y-6">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Trip Title</label>
                    <Input
                      value={form.title}
                      maxLength={100}
                      className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] focus-visible:ring-black/5"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Destination</label>
                    <Combobox
                      value={form.destination_text}
                      onValueChange={(value) => setForm(f => ({ ...f, destination_text: value }))}
                      onSearchChange={setDestinationSearchQuery}
                      options={destinationOptions}
                      placeholder="Search for a city..."
                      searchPlaceholder="Type to search..."
                      emptyText={destinationSearch.isFetching ? "Searching..." : "No destinations found"}
                      isLoading={destinationSearch.isFetching}
                      triggerClassName="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] focus:ring-black/5"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClassName}>Start Date</label>
                    <DatePicker
                      value={form.start_date}
                      onChange={(value) => setForm(f => ({ ...f, start_date: value }))}
                      className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] focus:ring-black/5"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClassName}>End Date</label>
                    <DatePicker
                      value={form.end_date}
                      onChange={(value) => setForm(f => ({ ...f, end_date: value }))}
                      className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] focus:ring-black/5"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClassName}>Budget Amount</label>
                    <Input
                      type="number"
                      min={0}
                      max={1000000000}
                      step="0.01"
                      value={form.budget_amount}
                      className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] focus-visible:ring-black/5"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, budget_amount: event.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={fieldLabelClassName}>Currency</label>
                    <Select
                      value={form.budget_currency}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, budget_currency: value }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] shadow-none focus:ring-black/5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 rounded-[18px] border-black/8 shadow-xl">
                        {CURRENCY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="rounded-[10px]">
                            {option.label}{option.description ? ` ${option.description}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Trip Type</label>
                    <Select
                      value={form.trip_type}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, trip_type: value }))
                      }
                    >
                      <SelectTrigger className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] shadow-none focus:ring-black/5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[18px] border-black/8 shadow-xl">
                        {TRIP_TYPES.map((tripType) => (
                          <SelectItem key={tripType} value={tripType} className="rounded-[10px] capitalize">
                            {tripType.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label className={fieldLabelClassName}>Travel Mode</label>
                    <Select
                      value={form.route_travel_mode}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          route_travel_mode: value as RouteTravelMode,
                        }))
                      }
                    >
                      <SelectTrigger
                        aria-label="Travel time mode"
                        className="h-11 rounded-[14px] border-black/8 bg-[var(--color-secondary-surface)] shadow-none focus:ring-black/5"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[18px] border-black/8 shadow-xl">
                        {ROUTE_TRAVEL_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="rounded-[10px]">
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[0.7rem] font-medium text-black/40 px-1">
                      Determines travel estimates and route optimization.
                    </p>
                  </div>
                </div>
              </div>

              {/* Cover Photo */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className={fieldLabelClassName}>Cover Photo</label>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[0.7rem] font-bold"
                      onClick={() => void handleCoverPhotoRefresh()}
                      disabled={!resolvedPlaceId || isCoverPhotoBusy}
                    >
                      <RefreshCw className={cn("mr-1.5 size-3.5", isCoverPhotoBusy && "")} />
                      Refresh
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3 text-[0.7rem] font-bold"
                      onClick={() => coverUploadInputRef.current?.click()}
                      disabled={isUploadingCoverPhoto}
                    >
                      {isUploadingCoverPhoto ? (
                        <VoyagerLoader className="mr-1.5 size-3.5 " />
                      ) : (
                        <Upload className="mr-1.5 size-3.5" />
                      )}
                      Upload
                    </Button>
                  </div>
                </div>

                <input
                  ref={coverUploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void handleCoverUpload(event.target.files)
                    event.target.value = ''
                  }}
                />

                <PhotoViewerProvider>
                  <div className="grid grid-cols-3 gap-2">
                    {coverPhotosLoading && coverPhotoCandidates.length === 0 ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <div
                          key={index}
                          className="aspect-square animate-pulse rounded-[16px] bg-[var(--color-secondary-surface)]"
                        />
                      ))
                    ) : coverPhotoCandidates.length > 0 ? (
                      coverPhotoCandidates.slice(0, 6).map((photo) => {
                        const thumbUrl = resolvePhotoUrl(photo, 'thumb')
                        const fullUrl = resolvePhotoUrl(photo, 'full') || thumbUrl
                        const isActive =
                          coverPreference?.assetId === photo.id ||
                          coverPreference?.photoId === photo.id ||
                          (!coverPreference?.assetId &&
                            !coverPreference?.photoId &&
                            selectedCoverPhoto?.id === photo.id)

                        return (
                          <div key={photo.id} className="relative">
                            {thumbUrl ? (
                              <PhotoViewer
                                src={fullUrl}
                                triggers={['onDoubleClick']}
                                overlay={
                                  photo.attribution_text ? (
                                    <div className="absolute inset-x-4 bottom-4 rounded-[14px] bg-black/58 px-3 py-2 text-[0.72rem] text-white shadow-sm backdrop-blur-sm">
                                      {photo.attribution_text}
                                    </div>
                                  ) : undefined
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => handlePhotoSelection(photo.id, photo.candidateSource)}
                                  className={cn(
                                    'relative aspect-square w-full overflow-hidden rounded-[16px] border-2 transition-all',
                                    isActive
                                      ? 'border-black shadow-md scale-[0.98]'
                                      : 'border-transparent opacity-60 hover:opacity-100 hover:scale-[1.02]',
                                  )}
                                >
                                  <img
                                    src={thumbUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                </button>
                              </PhotoViewer>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handlePhotoSelection(photo.id, photo.candidateSource)}
                                className={cn(
                                  'relative aspect-square w-full overflow-hidden rounded-[16px] border-2 transition-all',
                                  isActive
                                    ? 'border-black shadow-md scale-[0.98]'
                                    : 'border-transparent opacity-60 hover:opacity-100 hover:scale-[1.02]',
                                )}
                              >
                                <div className="flex h-full w-full items-center justify-center bg-[var(--color-secondary-surface)] text-black/20">
                                  <ImageIcon className="size-5" />
                                </div>
                              </button>
                            )}
                          </div>
                        )
                      })
                    ) : (
                      <div className="col-span-3 rounded-[18px] border border-dashed border-black/8 py-8 text-center text-[0.8rem] text-black/40">
                        {coverPhotoRefreshError || 'No city photos available.'}
                      </div>
                    )}
                  </div>
                </PhotoViewerProvider>
              </div>

              {/* Asset Manager */}
              <div className="space-y-4">
                <TripAssetManager
                  tripId={tripId}
                  className="border-none bg-transparent shadow-none p-0"
                />
              </div>

              {/* Management Actions */}
              <div className="space-y-4 pt-4">
                <label className={fieldLabelClassName}>Management</label>
                <div className="flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 justify-start rounded-[14px] border-black/8 px-4 font-semibold text-[0.82rem] text-[var(--color-text)] shadow-none hover:bg-black/5"
                    onClick={() => void handleDuplicate()}
                    disabled={duplicateTrip.isPending}
                  >
                    {duplicateTrip.isPending ? (
                      <VoyagerLoader className="mr-3 size-4 text-[var(--color-text-muted)]" />
                    ) : (
                      <Copy className="mr-3 size-4 text-[var(--color-text-muted)]" />
                    )}
                    Duplicate Trip
                  </Button>
                  {onReset && hasActivities && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 justify-start rounded-[14px] border-black/8 px-4 font-semibold text-[0.82rem] text-orange-600 shadow-none hover:bg-black/5 hover:text-orange-700"
                      onClick={() => setShowResetConfirm(true)}
                      disabled={isResetting}
                    >
                      {isResetting ? (
                        <VoyagerLoader className="mr-3 size-4 " />
                      ) : (
                        <RefreshCw className="mr-3 size-4" />
                      )}
                      Reset Itinerary
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 justify-start rounded-[14px] border-black/8 px-4 font-semibold text-[0.82rem] text-red-600 shadow-none hover:bg-black/5 hover:text-red-700"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="mr-3 size-4" />
                    Delete Trip Permanently
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="shrink-0 border-t border-black/5 bg-white px-6 py-5 flex items-center justify-between">
            <Button variant="ghost" className="rounded-full px-6 font-bold text-black/40 hover:text-black" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="rounded-full px-8 h-11 font-bold shadow-lg shadow-black/10 transition-transform active:scale-[0.98]" onClick={handleSave} disabled={patchTrip.isPending}>
              {patchTrip.isPending ? <VoyagerLoader className="size-4 mr-2" /> : null}
              Save Changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="rounded-[28px] border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-black/60">
              This action is irreversible. All planning data for <span className="text-black font-bold">"{trip.title}"</span> will be
              permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-full px-6 font-bold border-none bg-[var(--color-secondary-surface)]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full px-6 font-bold bg-red-600 hover:bg-red-700 text-white"
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {deleteTrip.isPending ? <VoyagerLoader className="size-4 mr-2" /> : null}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent className="rounded-[28px] border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Reset itinerary?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm font-medium text-black/60">
              All activities will be permanently removed from this trip. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-full px-6 font-bold border-none bg-[var(--color-secondary-surface)]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full px-6 font-bold bg-orange-600 hover:bg-orange-700 text-white"
              onClick={(event) => {
                event.preventDefault()
                void handleReset()
              }}
            >
              {isResetting ? <VoyagerLoader className="size-4 mr-2" /> : null}
              Confirm Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
