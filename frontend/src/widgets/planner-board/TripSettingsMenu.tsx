import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Image as ImageIcon,
  Loader2,
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
import { useTripCoverPhotoManager } from '@/entities/trip/useTripCoverPhotoManager'
import { useUploadTripAsset } from '@/entities/trip-asset/queries'
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


const sectionClassName = 'rounded-[20px] border border-black/8 bg-white p-5 shadow-[0_22px_60px_-44px_rgba(15,23,42,0.22)]'
const fieldLabelClassName = 'text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]'

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
}

export function TripSettingsMenu({ tripId, open, onOpenChange }: TripSettingsMenuProps) {
  const navigate = useNavigate()
  const { data: trip } = useTrip(tripId)
  const patchTrip = usePatchTrip(tripId)
  const uploadTripAsset = useUploadTripAsset(tripId)
  const duplicateTrip = useDuplicateTrip()
  const deleteTrip = useDeleteTrip()
  const coverUploadInputRef = useRef<HTMLInputElement | null>(null)
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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
  
  const dupKey = useMemo(() => crypto.randomUUID(), [])
  
  const {
    coverPreference,
    coverPhotoCandidates,
    selectedCoverPhoto,
    photoAttributionLabel,
    photoAttributionText,
    coverPhotoUrl,
    isCoverPhotoBusy,
    coverPhotoEmptyMessage,
    coverPhotosLoading,
    coverPhotoRefreshError,
    resolvedPlaceId,
    handlePhotoSelection,
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
        <SheetContent className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden bg-[#F3F5F7] p-0 sm:max-w-2xl border-l border-black/8">
          <SheetHeader className="shrink-0 border-b border-black/8 bg-white px-6 py-4">
            <SheetTitle className="text-xl">Trip Settings</SheetTitle>
            <SheetDescription>
              Edit trip details, cover photo, and parameters
            </SheetDescription>
          </SheetHeader>
          
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-6 max-w-xl mx-auto px-6 py-6 pb-8">
              <section className={sectionClassName}>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(114,174,230,0.14)] text-[var(--color-text)]">
                    <Settings2 className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                      Trip details
                    </h2>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 sm:col-span-2">
                    <span className={fieldLabelClassName}>Title</span>
                    <Input
                      value={form.title}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </label>

                  <label className="space-y-2 sm:col-span-2">
                    <span className={fieldLabelClassName}>Destination</span>
                    <Input
                      value={form.destination_text}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          destination_text: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClassName}>Start date</span>
                    <Input
                      type="date"
                      value={form.start_date}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, start_date: event.target.value }))
                      }
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClassName}>End date</span>
                    <Input
                      type="date"
                      value={form.end_date}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, end_date: event.target.value }))
                      }
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClassName}>Budget</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.budget_amount}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, budget_amount: event.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClassName}>Currency</span>
                    <Select
                      value={form.budget_currency}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, budget_currency: value }))
                      }
                    >
                      <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-64 rounded-[16px] border-black/8">
                        {CURRENCY_OPTIONS.map((currency) => (
                          <SelectItem key={currency.value} value={currency.value}>
                            {currency.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-2 sm:col-span-2">
                    <span className={fieldLabelClassName}>Trip type</span>
                    <Select
                      value={form.trip_type}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, trip_type: value }))
                      }
                    >
                      <SelectTrigger className="rounded-[14px] border-black/8 bg-white shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[16px] border-black/8">
                        {TRIP_TYPES.map((tripType) => (
                          <SelectItem key={tripType} value={tripType}>
                            {tripType.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-2 sm:col-span-2">
                    <span className={fieldLabelClassName}>Travel time mode</span>
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
                        className="rounded-[14px] border-black/8 bg-white shadow-none"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-[16px] border-black/8">
                        {ROUTE_TRAVEL_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[0.78rem] text-[var(--color-text-muted)]">
                      Used for day travel estimates, map routes, and itinerary optimization.
                    </p>
                  </label>
                </div>
              </section>

              <section className={sectionClassName}>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(255,140,98,0.14)] text-[var(--color-text)]">
                    <ImageIcon className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                      Cover photo
                    </h2>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-[18px] border border-black/8 bg-[var(--color-secondary-surface)]">
                  {coverPhotoUrl ? (
                    <img
                      src={coverPhotoUrl}
                      alt={photoAttributionLabel ?? trip.destination_text}
                      className="aspect-[16/10] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-center text-[var(--color-text-muted)]">
                      {isCoverPhotoBusy ? (
                        <Loader2 className="size-8 animate-spin" />
                      ) : (
                        <ImageIcon className="size-8" />
                      )}
                      <p className="text-sm">
                        {isCoverPhotoBusy ? 'Loading city photo…' : coverPhotoEmptyMessage}
                      </p>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                  {photoAttributionText || 'Destination-based cover photo'}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void handleCoverPhotoRefresh()}
                    disabled={!resolvedPlaceId || isCoverPhotoBusy}
                  >
                    Refresh city photos
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => coverUploadInputRef.current?.click()}
                    disabled={isUploadingCoverPhoto}
                  >
                    {isUploadingCoverPhoto ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 size-4" />
                    )}
                    Upload cover photo
                  </Button>
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

                <div className="mt-4">
                  {coverPhotosLoading && coverPhotoCandidates.length === 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: 4 }).map((_, index) => (
                        <div
                          key={index}
                          className="aspect-[4/3] animate-pulse rounded-[14px] bg-[var(--color-secondary-surface)]"
                        />
                      ))}
                    </div>
                  ) : coverPhotoCandidates.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {coverPhotoCandidates.map((photo) => {
                        const thumbUrl = resolvePhotoUrl(photo, 'thumb')
                        const isActive =
                          coverPreference?.assetId === photo.id ||
                          coverPreference?.photoId === photo.id ||
                          (!coverPreference?.assetId &&
                            !coverPreference?.photoId &&
                            selectedCoverPhoto?.id === photo.id)

                        return (
                          <button
                            key={photo.id}
                            type="button"
                            onClick={() => handlePhotoSelection(photo.id, photo.candidateSource)}
                            className={`relative overflow-hidden rounded-[14px] border ${
                              isActive
                                ? 'border-[rgba(0,0,0,0.18)]'
                                : 'border-black/8 hover:border-black/16'
                            }`}
                          >
                            {thumbUrl ? (
                              <img
                                src={thumbUrl}
                                alt={photoAttributionLabel ?? trip.destination_text}
                                className="aspect-[4/3] w-full object-cover"
                              />
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center bg-[var(--color-secondary-surface)] text-[var(--color-text-muted)]">
                                <ImageIcon className="size-5" />
                              </div>
                            )}
                            <span className="absolute left-2 top-2 rounded-full bg-white/88 px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                              {photo.candidateSource === 'uploaded' ? 'Uploaded' : 'City'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
                      {coverPhotoRefreshError || 'No alternative city photos are available yet.'}
                    </div>
                  )}
                </div>
              </section>

              <section className={sectionClassName}>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-[rgba(15,23,42,0.08)] text-[var(--color-text)]">
                    <Trash2 className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-[1rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
                      Trip management
                    </h2>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleDuplicate()}
                    disabled={duplicateTrip.isPending}
                  >
                    {duplicateTrip.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    Duplicate trip
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 className="size-4" />
                    Delete trip
                  </Button>
                </div>
              </section>

              <TripAssetManager
                tripId={tripId}
                title="Trip uploads"
                description="Keep tickets, PDFs, hotel confirmations, scanned notes, and extra photo references on the trip itself."
              />
            </div>
          </div>
          
          <div className="shrink-0 border-t border-black/8 bg-white px-6 py-4 flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={patchTrip.isPending}>
              {patchTrip.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Save changes
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible. All planning data for &quot;{trip.title}&quot; will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {deleteTrip.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
              Delete trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
