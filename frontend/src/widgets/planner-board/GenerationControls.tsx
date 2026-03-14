import { useMemo, useRef } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Sparkles, Trash2 } from 'lucide-react'
import type { Day } from '@/shared/api/types'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

const plannerGenerationSchema = z.object({
  mode: z.enum(['replace', 'merge', 'append']),
  day_ids: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
})

export type PlannerGenerationAction = 'generate' | 'reset'
export type PlannerGenerationFormValues = z.infer<typeof plannerGenerationSchema>

type PlannerGenerationInlineCardProps = {
  action: PlannerGenerationAction
  days: Day[]
  isSubmitting?: boolean
  onCancel: () => void
  onSubmit: (
    action: PlannerGenerationAction,
    values: PlannerGenerationFormValues,
    idempotencyKey: string,
  ) => Promise<void>
}

const MODE_LABELS: Record<
  PlannerGenerationFormValues['mode'],
  { label: string; description: string }
> = {
  replace: {
    label: 'Replace',
    description: 'Replace generated activities in the selected days.',
  },
  merge: {
    label: 'Merge',
    description: 'Blend new suggestions with the current itinerary.',
  },
  append: {
    label: 'Append',
    description: 'Add more generated activities without removing the current ones.',
  },
}

export function PlannerGenerationInlineCard({
  action,
  days,
  isSubmitting = false,
  onCancel,
  onSubmit,
}: PlannerGenerationInlineCardProps) {
  const submissionKeyRef = useRef(crypto.randomUUID())
  const { register, handleSubmit, watch, setValue } = useForm<PlannerGenerationFormValues>({
    resolver: zodResolver(plannerGenerationSchema),
    defaultValues: {
      mode: action === 'reset' ? 'replace' : 'replace',
      day_ids: [],
    },
  })

  const mode = watch('mode')
  const dayIds = watch('day_ids') ?? []
  const selectedDayCount = dayIds.length > 0 ? dayIds.length : days.length

  const submitLabel = useMemo(() => {
    if (action === 'reset') {
      return 'Queue reset'
    }
    return selectedDayCount === 1 ? 'Generate 1 day' : `Generate ${selectedDayCount} days`
  }, [action, selectedDayCount])

  const handleDaySelection = (dayId: string, checked: boolean) => {
    if (checked) {
      setValue('day_ids', [...dayIds, dayId], { shouldDirty: true })
      return
    }
    setValue(
      'day_ids',
      dayIds.filter((id) => id !== dayId),
      { shouldDirty: true },
    )
  }

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit(action, values, submissionKeyRef.current)
    submissionKeyRef.current = crypto.randomUUID()
  })

  return (
    <div className="rounded-[18px] border border-black/7 bg-white px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
            {action === 'generate' ? 'Itinerary setup' : 'Reset generated itinerary'}
          </p>
          <h3 className="mt-1 text-[0.9rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {action === 'generate'
              ? 'Choose how the assistant should build the itinerary.'
              : 'Pick the days that should be cleared.'}
          </h3>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 text-[0.76rem]"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>

      <form onSubmit={handleFormSubmit} className="mt-3 flex flex-col gap-3">
        {action === 'generate' ? (
          <div className="flex flex-col gap-2">
            <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">Mode</p>
            <div className="grid gap-2">
              {(['replace', 'merge', 'append'] as const).map((option) => (
                <label
                  key={option}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-[14px] border px-3 py-2.5 transition-colors',
                    mode === option
                      ? 'border-black/14 bg-[rgba(244,246,248,0.7)]'
                      : 'border-black/8 bg-white hover:bg-[rgba(244,246,248,0.45)]',
                  )}
                >
                  <input
                    type="radio"
                    value={option}
                    {...register('mode')}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="text-[0.82rem] font-medium text-[var(--color-text)]">
                      {MODE_LABELS[option].label}
                    </p>
                    <p className="mt-1 text-[0.74rem] leading-5 text-[var(--color-text-muted)]">
                      {MODE_LABELS[option].description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-[14px] border border-[rgba(196,95,79,0.16)] bg-[rgba(196,95,79,0.05)] px-3 py-2.5 text-[0.77rem] leading-6 text-[var(--color-text)]">
            Reset only removes generated activities from the selected days. Manual edits stay in place.
          </p>
        )}

        {days.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[0.72rem] font-medium text-[var(--color-text-muted)]">
              Days
            </p>
            <div className="max-h-44 overflow-y-auto rounded-[14px] border border-black/8 bg-[rgba(244,246,248,0.28)] p-2">
              <div className="flex flex-col gap-1">
                {days.map((day, index) => (
                  <label
                    key={day.id}
                    htmlFor={`assistant-generation-day-${day.id}`}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[0.8rem] text-[var(--color-text)] transition-colors hover:bg-white"
                  >
                    <Checkbox
                      id={`assistant-generation-day-${day.id}`}
                      checked={dayIds.includes(day.id)}
                      onCheckedChange={(checked) => handleDaySelection(day.id, checked === true)}
                    />
                    <span className="min-w-0 truncate">
                      Day {index + 1}
                      {day.date ? ` · ${day.date}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[0.72rem] text-[var(--color-text-muted)]">
              Leave empty to apply to every day in the trip.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-full px-3.5 text-[0.76rem]"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            variant={action === 'reset' ? 'destructive' : 'default'}
            className="h-8 rounded-full px-3.5 text-[0.76rem]"
            disabled={isSubmitting}
          >
            {action === 'generate' ? <Sparkles data-icon="inline-start" /> : null}
            {action === 'reset' ? <Trash2 data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
