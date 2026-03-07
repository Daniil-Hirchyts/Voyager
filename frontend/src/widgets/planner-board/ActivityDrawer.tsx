import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { config } from '@/app/config'
import { useCreatePlace, usePlace, usePlaceSearch } from '@/entities/place/queries'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  is_favorite: z.boolean().default(false),
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
    is_favorite: activity.is_favorite,
  }
}

export function ActivityDrawer({
  open,
  tripId,
  activity,
  onClose,
  onSave,
  isSaving,
}: Props) {
  const navigate = useNavigate()
  const isCreate = !activity
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
    defaultValues: activity ? activityToForm(activity) : { is_favorite: false, estimated_cost_currency: 'USD' },
  })

  const placeForm = useForm<PlaceFormValues>({
    resolver: zodResolver(createPlaceSchema),
    defaultValues: {
      category: 'poi',
    },
  })

  useEffect(() => {
    if (!open) return
    reset(activity ? activityToForm(activity) : { is_favorite: false, estimated_cost_currency: 'USD' })
    setSelectedPlaceId(activity?.place_id ?? null)
    setSearchQuery('')
    setShowCreatePlace(false)
    placeForm.reset({ category: 'poi' })
  }, [activity, open, placeForm, reset])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose, open])

  const submitActivity = async (values: ActivityFormValues) => {
    await onSave({
      title: values.title,
      description: values.description || null,
      start_time: values.start_time || null,
      duration_min: values.duration_min ?? null,
      tags: values.tags ? values.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
      estimated_cost_amount: values.estimated_cost_amount ?? null,
      estimated_cost_currency: values.estimated_cost_currency || null,
      place_id: selectedPlaceId ?? null,
      notes: values.notes || null,
      is_favorite: values.is_favorite,
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
    if (!activity) return
    const params = new URLSearchParams({
      activityId: activity.id,
      returnTo: `/app/trips/${tripId}/plan`,
    })
    if (selectedPlaceId) {
      params.set('placeId', selectedPlaceId)
    }
    navigate(`/app/trips/${tripId}/map?${params.toString()}`)
  }

  const labelClass = 'block text-xs font-medium text-[#526072] mb-1 uppercase tracking-wider'

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#1D2430]/30" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-modal
        aria-label={isCreate ? 'Create activity' : 'Edit activity'}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ background: 'var(--color-surface)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h2 className="font-semibold text-[#1D2430]">
            {isCreate ? 'Add Activity' : 'Edit Activity'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit(submitActivity)} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <div>
            <Label className={labelClass}>Title *</Label>
            <Input
              {...register('title')}
              placeholder="Activity title"
              className={errors.title ? 'border-[#C56A3D]' : ''}
              style={{ background: 'var(--color-bg)' }}
            />
            {errors.title && <p className="mt-1 text-xs text-[#C56A3D]">{errors.title.message}</p>}
          </div>

          <div>
            <Label className={labelClass}>Description</Label>
            <Textarea
              {...register('description')}
              rows={2}
              placeholder="Brief description..."
              style={{ background: 'var(--color-bg)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelClass}>Start Time</Label>
              <Input
                type="time"
                {...register('start_time')}
                style={{ background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <Label className={labelClass}>Duration (min)</Label>
              <Input
                type="number"
                {...register('duration_min', { valueAsNumber: true })}
                min={1}
                max={1440}
                placeholder="60"
                style={{ background: 'var(--color-bg)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelClass}>Est. Cost</Label>
              <Input
                type="number"
                {...register('estimated_cost_amount', { valueAsNumber: true })}
                min={0}
                step={0.01}
                placeholder="0.00"
                style={{ background: 'var(--color-bg)' }}
              />
            </div>
            <div>
              <Label className={labelClass}>Currency</Label>
              <Controller
                control={control}
                name="estimated_cost_currency"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger style={{ background: 'var(--color-bg)' }}>
                      <SelectValue placeholder="Currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map((currency) => (
                        <SelectItem key={currency} value={currency}>{currency}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div>
            <Label className={labelClass}>Tags (comma-separated)</Label>
            <Input
              {...register('tags')}
              placeholder="food, outdoor, culture"
              style={{ background: 'var(--color-bg)' }}
            />
          </div>

          <div>
            <Label className={labelClass}>Notes</Label>
            <Textarea
              {...register('notes')}
              rows={3}
              placeholder="Personal notes..."
              style={{ background: 'var(--color-bg)' }}
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Controller
              control={control}
              name="is_favorite"
              render={({ field }) => (
                <Checkbox
                  id="is_favorite"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  className="data-[state=checked]:bg-[#C56A3D] data-[state=checked]:border-[#C56A3D]"
                />
              )}
            />
            <label htmlFor="is_favorite" className="text-sm text-[#1D2430] cursor-pointer">
              Mark as favorite
            </label>
          </div>

          <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#1D2430]">Place</p>
                <p className="text-xs text-[#526072]">
                  Search the catalog, create a custom place, or continue in the map workspace.
                </p>
              </div>
              {selectedPlaceId && (
                <button
                  type="button"
                  onClick={() => setSelectedPlaceId(null)}
                  className="inline-flex items-center gap-1 text-xs text-[#C56A3D] hover:underline"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {selectedPlace && (
              <div
                className="rounded-[14px] border overflow-hidden"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                {selectedPlace.primary_photo?.thumbnail_url || selectedPlace.primary_photo?.image_url ? (
                  <img
                    src={selectedPlace.primary_photo?.thumbnail_url || selectedPlace.primary_photo?.image_url || ''}
                    alt={selectedPlace.name}
                    className="w-full h-28 object-cover"
                  />
                ) : null}
                <div className="p-3">
                  <div className="flex items-center gap-1.5 text-[#2F6F73] text-xs font-medium mb-1">
                    <MapPin className="w-3 h-3" />
                    Selected place
                  </div>
                  <p className="text-sm font-medium text-[#1D2430]">{selectedPlace.name}</p>
                  {selectedPlace.address_text && (
                    <p className="text-xs text-[#526072] mt-1">{selectedPlace.address_text}</p>
                  )}
                </div>
              </div>
            )}

            <div>
              <Label className={labelClass}>Search Places</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#526072]" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Louvre Museum, brunch, viewpoint..."
                  className="pl-9"
                  style={{ background: 'var(--color-bg)' }}
                />
              </div>
            </div>

            {searchQuery.trim().length >= 2 && (
              <div
                className="max-h-44 overflow-y-auto rounded-[14px] border"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                {isSearchingPlaces ? (
                  <div className="p-3 text-sm text-[#526072]">Searching places…</div>
                ) : placeResults?.items.length ? (
                  <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                    {placeResults.items.map((place) => (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => setSelectedPlaceId(place.id)}
                        className="w-full text-left p-3 hover:bg-[#F4EBDD] transition-colors"
                      >
                        <p className="text-sm font-medium text-[#1D2430]">{place.name}</p>
                        <p className="text-xs text-[#526072]">
                          {place.category || 'place'}
                          {place.address_text ? ` · ${place.address_text}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 text-sm text-[#526072]">
                    No places found. Try a broader query or create a custom place.
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowCreatePlace((value) => !value)}
              >
                <Plus className="w-4 h-4 text-[#2F6F73]" />
                {showCreatePlace ? 'Hide Custom Place Form' : 'Create Custom Place'}
              </Button>
              {config.features.mapUI && activity && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openInMap}
                >
                  <ExternalLink className="w-4 h-4 text-[#2F6F73]" />
                  Browse on Map
                </Button>
              )}
            </div>

            {showCreatePlace && (
              <div
                className="rounded-[14px] border p-3 space-y-3"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                <div>
                  <Label className={labelClass}>Place Name *</Label>
                  <Input
                    {...placeForm.register('name')}
                    className={placeForm.formState.errors.name ? 'border-[#C56A3D]' : ''}
                    style={{ background: 'var(--color-surface)' }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={labelClass}>Category</Label>
                    <Input
                      {...placeForm.register('category')}
                      style={{ background: 'var(--color-surface)' }}
                    />
                  </div>
                  <div>
                    <Label className={labelClass}>Address</Label>
                    <Input
                      {...placeForm.register('address_text')}
                      style={{ background: 'var(--color-surface)' }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={labelClass}>Latitude</Label>
                    <Input
                      type="number"
                      step="any"
                      {...placeForm.register('lat', { valueAsNumber: true })}
                      style={{ background: 'var(--color-surface)' }}
                    />
                  </div>
                  <div>
                    <Label className={labelClass}>Longitude</Label>
                    <Input
                      type="number"
                      step="any"
                      {...placeForm.register('lon', { valueAsNumber: true })}
                      style={{ background: 'var(--color-surface)' }}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={placeForm.handleSubmit(submitCreatePlace)}
                  disabled={createPlaceMutation.isPending}
                >
                  {createPlaceMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Custom Place
                </Button>
              </div>
            )}
          </div>
        </form>

        <div className="px-5 py-4 border-t flex gap-3" style={{ borderColor: 'var(--color-border)' }}>
          <Button type="button" variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit(submitActivity)}
            disabled={isSaving}
            className="flex-1"
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isCreate ? 'Add Activity' : 'Save Changes'}
          </Button>
        </div>
      </aside>
    </>
  )
}
