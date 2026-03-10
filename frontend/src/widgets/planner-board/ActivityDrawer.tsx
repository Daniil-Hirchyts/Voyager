import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { useCreatePlace, usePlace, usePlaceSearch } from '@/entities/place/queries'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/shared/hooks/use-mobile'
import { cn } from '@/shared/lib/cn'
import { resolvePhotoUrl } from '@/shared/lib/media'
import type {
  Activity,
  ActivityCreateInput,
  PlaceCreateInput,
  PlannerActivity,
} from '@/shared/api/types'

const activitySchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().optional(),
  start_time: z.string().optional(),
  duration_min: z
    .union([z.number().int().positive(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  tags: z.string().optional(),
  estimated_cost_amount: z
    .union([z.number().nonnegative(), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  estimated_cost_currency: z.string().optional(),
  notes: z.string().optional(),
})

const createPlaceSchema = z.object({
  name: z.string().min(1, 'Place name is required').max(300),
  category: z.string().optional(),
  address_text: z.string().optional(),
  lat: z
    .union([z.number().min(-90).max(90), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
  lon: z
    .union([z.number().min(-180).max(180), z.nan()])
    .optional()
    .transform((value) => (value == null || Number.isNaN(value) ? undefined : value)),
})

type ActivityFormValues = z.infer<typeof activitySchema>
type PlaceFormValues = z.infer<typeof createPlaceSchema>

interface Props {
  open: boolean
  tripId: string
  activity?: Activity | PlannerActivity | null
  defaultTripDayId?: string | null
  defaultDayLabel?: string | null
  onClose: () => void
  onSave: (data: ActivityCreateInput) => Promise<void>
  isSaving?: boolean
}

function activityToForm(activity: Activity | PlannerActivity): ActivityFormValues {
  return {
    title: activity.title,
    description: activity.description ?? undefined,
    start_time: activity.start_time ?? undefined,
    duration_min: activity.duration_min ?? undefined,
    tags: activity.tags.join(', '),
    estimated_cost_amount:
      activity.estimated_cost_amount != null ? Number(activity.estimated_cost_amount) : undefined,
    estimated_cost_currency: activity.estimated_cost_currency ?? 'USD',
    notes: activity.notes ?? undefined,
  }
}

const surfaceClassName = 'rounded-[14px] border border-black/8 bg-white p-4'
const controlClassName =
  'rounded-[10px] border-black/8 bg-white shadow-none focus:border-black/20 focus:ring-[rgba(0,0,0,0.08)]'

export function ActivityDrawer({
  open,
  tripId,
  activity,
  defaultTripDayId = null,
  defaultDayLabel = null,
  onClose,
  onSave,
  isSaving,
}: Props) {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isCreate = !activity
  const canSchedule = Boolean(activity?.trip_day_id ?? defaultTripDayId)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(activity?.place_id ?? null)
  const [showCreatePlace, setShowCreatePlace] = useState(false)

  const { data: selectedPlace } = usePlace(selectedPlaceId)
  const { data: placeResults, isFetching: isSearchingPlaces } = usePlaceSearch(
    { q: searchQuery.trim(), limit: 8, offset: 0 },
    open && searchQuery.trim().length >= 2,
  )
  const createPlaceMutation = useCreatePlace()

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<ActivityFormValues>({
    resolver: zodResolver(activitySchema),
    defaultValues: activity ? activityToForm(activity) : { estimated_cost_currency: 'USD' },
  })

  const placeForm = useForm<PlaceFormValues>({
    resolver: zodResolver(createPlaceSchema),
    defaultValues: {
      category: 'poi',
    },
  })

  useEffect(() => {
    if (!open) {
      return
    }
    reset(activity ? activityToForm(activity) : { estimated_cost_currency: 'USD' })
    setSelectedPlaceId(activity?.place_id ?? null)
    setSearchQuery('')
    setShowCreatePlace(false)
    placeForm.reset({ category: 'poi' })
  }, [activity, open, placeForm, reset])

  const submitActivity = async (values: ActivityFormValues) => {
    await onSave({
      title: values.title,
      description: values.description || null,
      start_time: canSchedule ? values.start_time || null : null,
      duration_min: values.duration_min ?? null,
      tags: values.tags ? values.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      estimated_cost_amount: values.estimated_cost_amount ?? null,
      estimated_cost_currency: values.estimated_cost_currency || null,
      place_id: selectedPlaceId ?? null,
      notes: values.notes || null,
      is_favorite: activity?.is_favorite ?? false,
      source: activity?.source ?? 'manual',
    })
  }

  const submitCreatePlace = async (values: PlaceFormValues) => {
    const payload: PlaceCreateInput = {
      source: 'user_custom',
      name: values.name,
      category: values.category || null,
      address_text: values.address_text || null,
      lat: values.lat ?? null,
      lon: values.lon ?? null,
      metadata: {},
    }

    try {
      const created = await createPlaceMutation.mutateAsync({
        data: payload,
        idempotencyKey: crypto.randomUUID(),
      })
      setSelectedPlaceId(created.id)
      setShowCreatePlace(false)
      placeForm.reset({ category: 'poi' })
      toast.success('Custom place created')
    } catch {
      toast.error('Failed to create place')
    }
  }

  const openInMap = () => {
    if (!activity) {
      return
    }
    const params = new URLSearchParams({
      activityId: activity.id,
      returnTo: `/app/trips/${tripId}/plan`,
    })
    if (selectedPlaceId) {
      params.set('placeId', selectedPlaceId)
    }
    navigate(`/app/trips/${tripId}/map?${params.toString()}`)
  }

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'flex h-[94dvh] flex-col overflow-hidden rounded-t-[16px] border-x-0 border-b-0 bg-[#f6f7f8] p-0 sm:max-w-none'
            : 'flex h-full w-full max-w-[36rem] flex-col overflow-hidden bg-[#f6f7f8] p-0 sm:max-w-[36rem]'
        }
      >
        <SheetHeader className="border-b border-black/8 bg-white px-5 py-5">
          <SheetTitle>{isCreate ? 'Add activity' : 'Edit activity'}</SheetTitle>
          <SheetDescription>
            {activity?.trip_day_id == null && !defaultTripDayId
              ? 'Save this in Inbox now and drag it onto a day later.'
              : defaultDayLabel
                ? `This will be saved in ${defaultDayLabel}.`
                : 'Update the activity details and linked place.'}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(submitActivity)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-4">
            <section className={surfaceClassName}>
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Basics
              </p>
              <FieldGroup className="mt-4 gap-4">
                <Field data-invalid={Boolean(errors.title)}>
                  <FieldLabel htmlFor="activity-title">Title</FieldLabel>
                  <FieldContent>
                    <Input
                      id="activity-title"
                      placeholder="Morning walk through Le Marais"
                      aria-invalid={Boolean(errors.title)}
                      className={controlClassName}
                      {...register('title')}
                    />
                    <FieldError errors={[errors.title]} />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="activity-description">Description</FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="activity-description"
                      rows={4}
                      placeholder="Add a concise description or leave it empty."
                      className={cn(controlClassName, 'min-h-[116px] resize-none')}
                      {...register('description')}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
            </section>

            <section className={cn(surfaceClassName, 'mt-4')}>
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Schedule and budget
              </p>
              <FieldGroup className="mt-4 gap-4">
                <Field data-disabled={!canSchedule}>
                  <FieldLabel htmlFor="activity-start-time">Start time</FieldLabel>
                  <FieldContent>
                    <Input
                      id="activity-start-time"
                      type="time"
                      disabled={!canSchedule}
                      className={controlClassName}
                      {...register('start_time')}
                    />
                    {!canSchedule ? (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Inbox activities stay untimed until they are moved onto a day.
                      </p>
                    ) : null}
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="activity-duration">Duration (min)</FieldLabel>
                  <FieldContent>
                    <Input
                      id="activity-duration"
                      type="number"
                      min={1}
                      max={1440}
                      placeholder="90"
                      className={controlClassName}
                      {...register('duration_min', { valueAsNumber: true })}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="activity-cost">Estimated cost</FieldLabel>
                  <FieldContent>
                    <Input
                      id="activity-cost"
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                      className={controlClassName}
                      {...register('estimated_cost_amount', { valueAsNumber: true })}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel>Currency</FieldLabel>
                  <FieldContent>
                    <Controller
                      control={control}
                      name="estimated_cost_currency"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className={controlClassName}>
                            <SelectValue placeholder="Currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                  {currency}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
            </section>

            <section className={cn(surfaceClassName, 'mt-4')}>
              <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                Notes and tags
              </p>
              <FieldGroup className="mt-4 gap-4">
                <Field>
                  <FieldLabel htmlFor="activity-tags">Tags</FieldLabel>
                  <FieldContent>
                    <Input
                      id="activity-tags"
                      placeholder="museum, food, evening"
                      className={controlClassName}
                      {...register('tags')}
                    />
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="activity-notes">Notes</FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="activity-notes"
                      rows={4}
                      placeholder="Private notes, access tips, booking references..."
                      className={cn(controlClassName, 'min-h-[116px] resize-none')}
                      {...register('notes')}
                    />
                  </FieldContent>
                </Field>
              </FieldGroup>
            </section>

            <section className={cn(surfaceClassName, 'mt-4')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                    Place
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Search existing places, create a custom one, or continue in the map workspace.
                  </p>
                </div>
                {selectedPlaceId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-[10px] px-2.5 text-[var(--color-danger)] hover:bg-[rgba(196,95,79,0.06)] hover:text-[var(--color-danger)]"
                    onClick={() => setSelectedPlaceId(null)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear
                  </Button>
                ) : null}
              </div>

              {selectedPlace ? (
                <div className="mt-4 overflow-hidden rounded-[12px] border border-black/8 bg-[var(--color-secondary-surface)]">
                  {resolvePhotoUrl(selectedPlace.primary_photo, 'thumb') ? (
                    <img
                      src={resolvePhotoUrl(selectedPlace.primary_photo, 'thumb') || ''}
                      alt={selectedPlace.name}
                      className="h-36 w-full object-cover"
                    />
                  ) : null}
                  <div className="p-4">
                    <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                      Selected place
                    </p>
                    <p className="mt-2 text-sm font-medium text-[var(--color-text)]">{selectedPlace.name}</p>
                    {selectedPlace.address_text ? (
                      <div className="mt-2 flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{selectedPlace.address_text}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <FieldGroup className="mt-4 gap-4">
                <Field>
                  <FieldLabel htmlFor="activity-place-search">Search places</FieldLabel>
                  <FieldContent>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                      <Input
                        id="activity-place-search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Louvre Museum, rooftop bar, viewpoint..."
                        className={cn(controlClassName, 'pl-10')}
                      />
                    </div>
                  </FieldContent>
                </Field>
              </FieldGroup>

              {searchQuery.trim().length >= 2 ? (
                <div className="mt-3 overflow-hidden rounded-[12px] border border-black/8 bg-white">
                  {isSearchingPlaces ? (
                    <div className="flex items-center gap-2 px-4 py-4 text-sm text-[var(--color-text-muted)]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching places...
                    </div>
                  ) : placeResults?.items.length ? (
                    <div className="divide-y divide-black/8">
                      {placeResults.items.map((place) => (
                        <button
                          key={place.id}
                          type="button"
                          onClick={() => setSelectedPlaceId(place.id)}
                          className="w-full px-4 py-3 text-left transition-colors hover:bg-[var(--color-secondary-surface)]"
                        >
                          <p className="text-sm font-medium text-[var(--color-text)]">{place.name}</p>
                          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                            {place.category || 'place'}
                            {place.address_text ? ` · ${place.address_text}` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-sm text-[var(--color-text-muted)]">
                      No places found. Try a broader query or create a custom place.
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-[10px] border-black/8 bg-white shadow-none"
                  onClick={() => setShowCreatePlace((current) => !current)}
                >
                  <Plus className="h-4 w-4" />
                  {showCreatePlace ? 'Hide custom place' : 'Create custom place'}
                </Button>
                {config.features.mapUI && activity ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-[10px] border-black/8 bg-white shadow-none"
                    onClick={openInMap}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Browse on map
                  </Button>
                ) : null}
              </div>

              {showCreatePlace ? (
                <div className="mt-4 rounded-[12px] border border-black/8 bg-white p-4">
                  <FieldGroup className="gap-4">
                    <Field data-invalid={Boolean(placeForm.formState.errors.name)}>
                      <FieldLabel htmlFor="custom-place-name">Place name</FieldLabel>
                      <FieldContent>
                        <Input
                          id="custom-place-name"
                          className={controlClassName}
                          aria-invalid={Boolean(placeForm.formState.errors.name)}
                          {...placeForm.register('name')}
                        />
                        <FieldError errors={[placeForm.formState.errors.name]} />
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="custom-place-category">Category</FieldLabel>
                      <FieldContent>
                        <Input
                          id="custom-place-category"
                          className={controlClassName}
                          {...placeForm.register('category')}
                        />
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="custom-place-address">Address</FieldLabel>
                      <FieldContent>
                        <Input
                          id="custom-place-address"
                          className={controlClassName}
                          {...placeForm.register('address_text')}
                        />
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="custom-place-lat">Latitude</FieldLabel>
                      <FieldContent>
                        <Input
                          id="custom-place-lat"
                          type="number"
                          step="any"
                          className={controlClassName}
                          {...placeForm.register('lat', { valueAsNumber: true })}
                        />
                      </FieldContent>
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="custom-place-lon">Longitude</FieldLabel>
                      <FieldContent>
                        <Input
                          id="custom-place-lon"
                          type="number"
                          step="any"
                          className={controlClassName}
                          {...placeForm.register('lon', { valueAsNumber: true })}
                        />
                      </FieldContent>
                    </Field>
                  </FieldGroup>

                  <Button
                    type="button"
                    className="mt-4 h-10 rounded-[10px]"
                    onClick={placeForm.handleSubmit(submitCreatePlace)}
                    disabled={createPlaceMutation.isPending}
                  >
                    {createPlaceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save custom place
                  </Button>
                </div>
              ) : null}
            </section>
          </div>

          <SheetFooter className="border-t border-black/8 bg-white px-4 py-4">
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 rounded-[10px] shadow-none"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" className="h-10 flex-1 rounded-[10px]" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isCreate ? 'Add activity' : 'Save changes'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
