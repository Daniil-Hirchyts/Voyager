import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createTrip } from '@/entities/trip/api'
import { tripKeys } from '@/entities/trip/queries'
import { toast } from 'sonner'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { isApiError } from '@/shared/api/client'

const schema = z
  .object({
    title: z.string().min(1, 'Trip title is required').max(200, 'Title must be under 200 characters'),
    destination_text: z.string().min(1, 'Destination is required').max(200),
    start_date: z.string().min(1, 'Start date is required'),
    end_date: z.string().min(1, 'End date is required'),
    budget_amount: z
      .union([z.number().positive('Budget must be a positive number'), z.nan()])
      .optional()
      .transform((v) => (v === undefined || Number.isNaN(v) ? undefined : v)),
    budget_currency: z.string().default('USD'),
    trip_type: z
      .enum(['leisure', 'business', 'adventure', 'cultural', 'family', 'romantic', 'solo', 'group'])
      .default('leisure'),
    preferences: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.start_date && data.end_date) {
        return new Date(data.end_date) >= new Date(data.start_date)
      }
      return true
    },
    { message: 'End date must be after start date', path: ['end_date'] },
  )

type FormValues = z.infer<typeof schema>

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']
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

const inputClass =
  'w-full px-3.5 py-2.5 rounded-[10px] border text-sm outline-none transition-colors focus:border-[#2F6F73] focus:ring-2 focus:ring-[#2F6F73]/10'
const labelClass = 'block text-sm font-medium text-[#1D2430] mb-1.5'
const errorClass = 'mt-1 text-xs text-[#C56A3D]'

export default function TripCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { budget_currency: 'USD', trip_type: 'leisure' },
  })

  const mutation = useMutation({
    mutationFn: (data: FormValues) => {
      const payload = {
        title: data.title,
        destination_text: data.destination_text,
        start_date: data.start_date,
        end_date: data.end_date,
        budget_amount: data.budget_amount ?? null,
        budget_currency: data.budget_currency,
        trip_type: data.trip_type as FormValues['trip_type'],
        preferences: data.preferences
          ? data.preferences.split(',').map((item) => item.trim()).filter(Boolean)
          : [],
      }
      return createTrip(payload, idempotencyKey)
    },
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: tripKeys.all })
      navigate(`/app/trips/${trip.id}`)
      toast.success('Trip created successfully')
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 429) {
        toast.error('Too many requests. Please wait a moment before trying again.')
      } else if (isApiError(err) && err.status === 409) {
        toast.info('Trip already created. Redirecting…')
      } else {
        toast.error('Failed to create trip. Please try again.')
      }
    },
  })

  const onSubmit = (data: FormValues) => mutation.mutate(data)

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-6">
        <Link
          to="/app/trips"
          className="flex items-center gap-1.5 text-sm text-[#526072] hover:text-[#1D2430] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to trips
        </Link>
        <h1 className="text-2xl font-semibold text-[#1D2430]">New Trip</h1>
        <p className="text-sm text-[#526072] mt-0.5">Start planning your next adventure</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div
          className="p-5 rounded-[18px] border space-y-5"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {/* Title */}
          <div>
            <label className={labelClass}>Trip Title *</label>
            <input
              {...register('title')}
              placeholder="Tokyo Adventure 2025"
              className={inputClass}
              style={{
                borderColor: errors.title ? '#C56A3D' : 'var(--color-border)',
                background: 'var(--color-bg)',
              }}
            />
            {errors.title && <p className={errorClass}>{errors.title.message}</p>}
          </div>

          {/* Destination */}
          <div>
            <label className={labelClass}>Destination *</label>
            <input
              {...register('destination_text')}
              placeholder="Tokyo, Japan"
              className={inputClass}
              style={{
                borderColor: errors.destination_text ? '#C56A3D' : 'var(--color-border)',
                background: 'var(--color-bg)',
              }}
            />
            {errors.destination_text && <p className={errorClass}>{errors.destination_text.message}</p>}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start Date</label>
              <input
                type="date"
                {...register('start_date')}
                className={inputClass}
                style={{
                  borderColor: errors.start_date ? '#C56A3D' : 'var(--color-border)',
                  background: 'var(--color-bg)',
                }}
              />
              {errors.start_date && <p className={errorClass}>{errors.start_date.message}</p>}
            </div>
            <div>
              <label className={labelClass}>End Date</label>
              <input
                type="date"
                {...register('end_date')}
                className={inputClass}
                style={{
                  borderColor: errors.end_date ? '#C56A3D' : 'var(--color-border)',
                  background: 'var(--color-bg)',
                }}
              />
              {errors.end_date && <p className={errorClass}>{errors.end_date.message}</p>}
            </div>
          </div>

          {/* Budget */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Budget (optional)</label>
              <input
                type="number"
                {...register('budget_amount', { valueAsNumber: true })}
                placeholder="5000"
                min="0"
                step="any"
                className={inputClass}
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              />
              {errors.budget_amount && (
                <p className={errorClass}>{errors.budget_amount.message}</p>
              )}
            </div>
            <div>
              <label className={labelClass}>Currency</label>
              <select
                {...register('budget_currency')}
                className={inputClass}
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Trip type */}
          <div>
            <label className={labelClass}>Trip Type</label>
            <select
              {...register('trip_type')}
              className={inputClass}
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            >
              {TRIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Preferences */}
          <div>
            <label className={labelClass}>Preferences (optional)</label>
            <textarea
              {...register('preferences')}
              placeholder="food, museums, walkable neighborhoods"
              rows={3}
              className={inputClass + ' resize-none'}
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <Link
            to="/app/trips"
            className="px-5 py-2.5 text-sm text-[#526072] hover:text-[#1D2430] transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#2F6F73] text-white text-sm font-medium rounded-[10px] hover:bg-[#266063] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {(isSubmitting || mutation.isPending) && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            Create Trip
          </button>
        </div>
      </form>
    </div>
  )
}
