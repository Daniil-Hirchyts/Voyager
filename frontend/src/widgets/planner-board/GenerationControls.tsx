import { useState, useRef, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Sparkles, RefreshCw, Trash2, MoreHorizontal } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { AiLoadingText } from '@/components/ui/ai-loading-text'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import type { Day } from '@/shared/api/types'
import { VoyagerLoader } from '@/widgets/app-shell/logo'
import { useIsMobile } from '@/shared/hooks/use-mobile'

const schema = z.object({
  mode: z.enum(['replace', 'merge', 'append']),
  day_ids: z.array(z.string()).optional(),
  seed: z.number().int().optional(),
})

type FormValues = z.infer<typeof schema>

interface Props {
  days: Day[]
  hasActivities: boolean
  onGenerate: (data: FormValues, idempotencyKey: string) => Promise<void>
  onRegenerate: (data: FormValues, idempotencyKey: string) => Promise<void>
  onReset: (dayIds: string[] | undefined, idempotencyKey: string) => Promise<void>
  isGenerating?: boolean
  jobStatus?: string | null
  compact?: boolean
  /** When provided, controls the dialog open state externally (bypasses the DropdownMenu trigger) */
  controlledOpen?: boolean
  onControlledOpenChange?: (open: boolean) => void
}

const MODE_LABELS: Record<string, { label: string; desc: string }> = {
  replace: { label: 'Replace', desc: 'Replace all existing activities in selected days' },
  merge: { label: 'Merge', desc: 'Merge new activities with existing ones' },
  append: { label: 'Append', desc: 'Add new activities without removing existing ones' },
}

function GenerationForm({
  action,
  mode,
  days,
  dayIds,
  register,
  handleSubmit,
  onSubmit,
  setValue,
}: {
  action: 'generate' | 'regenerate' | 'reset'
  mode: string
  days: Day[]
  dayIds: string[]
  register: ReturnType<typeof useForm<FormValues>>['register']
  handleSubmit: ReturnType<typeof useForm<FormValues>>['handleSubmit']
  onSubmit: (values: FormValues) => Promise<void>
  setValue: ReturnType<typeof useForm<FormValues>>['setValue']
}) {
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-5 py-5">
      {action !== 'reset' && (
        <div>
          <label className="mb-2 block text-[0.72rem] font-medium text-[var(--color-text-muted)]">
            Mode
          </label>
          <div className="space-y-2">
            {(['replace', 'merge', 'append'] as const).map((m) => (
              <label
                key={m}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[10px] border border-black/8 p-3 transition-colors',
                  mode === m
                    ? 'border-[rgba(0,0,0,0.14)] bg-[var(--color-secondary-surface)]'
                    : 'bg-white hover:bg-[var(--color-secondary-surface)]',
                )}
              >
                <input
                  type="radio"
                  value={m}
                  {...register('mode')}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {MODE_LABELS[m].label}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{MODE_LABELS[m].desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {days.length > 0 && (
        <div>
          <label className="mb-2 block text-[0.72rem] font-medium text-[var(--color-text-muted)]">
            Scope to specific days (optional)
          </label>
          <div className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
            {days.map((day, i) => (
              <label
                key={day.id}
                htmlFor={`gen-day-${day.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-[8px] px-1 py-1 text-sm text-[var(--color-text)]"
              >
                <Checkbox
                  id={`gen-day-${day.id}`}
                  checked={dayIds.includes(day.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setValue('day_ids', [...dayIds, day.id])
                    } else {
                      setValue('day_ids', dayIds.filter((id) => id !== day.id))
                    }
                  }}
                />
                Day {i + 1}{day.date && ` — ${day.date}`}
              </label>
            ))}
          </div>
        </div>
      )}

      {action === 'reset' && (
        <p className="text-sm text-[var(--color-text-muted)]">
          This will remove all generated activities from the selected days. Manually
          added activities will be preserved.
        </p>
      )}
    </form>
  )
}

export function GenerationControls({
  days,
  hasActivities,
  onGenerate,
  onRegenerate,
  onReset,
  isGenerating,
  jobStatus,
  compact = false,
  controlledOpen,
  onControlledOpenChange,
}: Props) {
  const isMobile = useIsMobile()
  const isControlled = controlledOpen !== undefined
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<'generate' | 'regenerate' | 'reset'>('generate')
  const genKeyRef = useRef(crypto.randomUUID())
  const resetKeyRef = useRef(crypto.randomUUID())

  const { register, handleSubmit, watch, setValue } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'replace' },
  })

  const mode = watch('mode')
  const dayIds = watch('day_ids') ?? []

  const dialogOpen = isControlled ? (controlledOpen ?? false) : open
  const setDialogOpen = (v: boolean) => {
    if (isControlled) {
      onControlledOpenChange?.(v)
    } else {
      setOpen(v)
    }
  }

  // When controlled, always use 'generate' action
  useEffect(() => {
    if (isControlled && controlledOpen) {
      setAction('generate')
      genKeyRef.current = crypto.randomUUID()
      resetKeyRef.current = crypto.randomUUID()
    }
  }, [isControlled, controlledOpen])

  const openDialog = (act: typeof action) => {
    setAction(act)
    genKeyRef.current = crypto.randomUUID()
    resetKeyRef.current = crypto.randomUUID()
    setOpen(true)
  }

  const onSubmit = async (values: FormValues) => {
    if (action === 'generate') {
      await onGenerate(values, genKeyRef.current)
    } else if (action === 'regenerate') {
      await onRegenerate(values, genKeyRef.current)
    } else {
      await onReset(values.day_ids, resetKeyRef.current)
    }
    setDialogOpen(false)
  }

  const isRunning = isGenerating || jobStatus === 'PENDING' || jobStatus === 'RUNNING'
  const generationStatusCopy =
    jobStatus === 'RUNNING' ? 'Planning your itinerary...' : 'Preparing your itinerary...'
  const buttonClassName = compact ? 'h-8 w-8 p-0 rounded-[8px] shadow-none hover:shadow-none' : undefined
  const statusClassName = compact
    ? 'inline-flex h-8 items-center gap-2 rounded-[8px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 text-[0.84rem] text-[var(--color-text-muted)]'
    : 'flex items-center gap-2 rounded-[10px] border border-black/8 bg-[var(--color-secondary-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)]'

  return (
    <>
      {!isControlled && <div className="flex flex-wrap items-center gap-2">
        {isRunning ? (
          <div className={statusClassName}>
            <VoyagerLoader className="h-4 w-4 " />
            <AiLoadingText announce>{generationStatusCopy}</AiLoadingText>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size={compact ? 'icon' : 'default'} className={cn(buttonClassName, 'bg-white')}>
                {compact ? <MoreHorizontal className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {!compact && <span className="ml-2">Actions</span>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => openDialog('generate')} className="cursor-pointer">
                <Sparkles className="mr-2 h-4 w-4 text-[var(--color-text-muted)]" />
                <span>Generate</span>
              </DropdownMenuItem>
              {hasActivities && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openDialog('reset')} className="cursor-pointer text-[rgba(196,95,79,1)] focus:text-[rgba(196,95,79,1)] focus:bg-[rgba(196,95,79,0.06)]">
                    <Trash2 className="mr-2 h-4 w-4" />
                    <span>Reset</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {jobStatus === 'SUCCEEDED' && (
          <span className="text-[0.78rem] font-medium text-[var(--color-text-muted)]" aria-live="polite">
            Updated
          </span>
        )}
        {jobStatus === 'FAILED' && (
          <span className="text-[0.78rem] font-medium text-[var(--color-text-muted)]" aria-live="polite">
            Failed
          </span>
        )}
      </div>}

      {isMobile ? (
        <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
          <SheetContent
            side="bottom"
            className="flex h-auto max-h-[90dvh] flex-col overflow-hidden rounded-t-[24px] border-x-0 border-b-0 bg-white p-0 sm:max-w-none"
          >
            <SheetHeader className="shrink-0 border-b border-black/5 px-5 py-4">
              <SheetTitle className="font-medium tracking-normal text-left">
                {action === 'generate' && 'Generate Itinerary'}
                {action === 'regenerate' && 'Regenerate Itinerary'}
                {action === 'reset' && 'Reset Itinerary'}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {action === 'generate' ? 'Configure itinerary generation options' : action === 'reset' ? 'Reset generated activities' : 'Regenerate itinerary'}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <GenerationForm
                action={action}
                mode={mode}
                days={days}
                dayIds={dayIds}
                register={register}
                handleSubmit={handleSubmit}
                onSubmit={onSubmit}
                setValue={setValue}
              />
            </div>
            <div className="shrink-0 border-t border-black/5 flex gap-2 px-5 py-4">
              <Button variant="outline" type="button" onClick={() => setDialogOpen(false)} className="h-10 flex-1 rounded-[8px] shadow-none">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit(onSubmit)}
                variant={action === 'reset' ? 'destructive' : 'default'}
                className="h-10 flex-1 rounded-[8px] shadow-none hover:shadow-none"
              >
                {action === 'generate' && <><Sparkles className="w-4 h-4 mr-2" /> Generate</>}
                {action === 'regenerate' && <><RefreshCw className="w-4 h-4 mr-2" /> Regenerate</>}
                {action === 'reset' && <><Trash2 className="w-4 h-4 mr-2" /> Reset</>}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-[34rem] rounded-[12px] border-black/8 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur-none">
            <DialogHeader>
              <DialogTitle className="font-medium tracking-normal">
                {action === 'generate' && 'Generate Itinerary'}
                {action === 'regenerate' && 'Regenerate Itinerary'}
                {action === 'reset' && 'Reset Itinerary'}
              </DialogTitle>
            </DialogHeader>
            <GenerationForm
              action={action}
              mode={mode}
              days={days}
              dayIds={dayIds}
              register={register}
              handleSubmit={handleSubmit}
              onSubmit={onSubmit}
              setValue={setValue}
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setDialogOpen(false)} className="h-10 flex-1 rounded-[8px] shadow-none">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit(onSubmit)}
                variant={action === 'reset' ? 'destructive' : 'default'}
                className="h-10 flex-1 rounded-[8px] shadow-none hover:shadow-none"
              >
                {action === 'generate' && <><Sparkles className="w-4 h-4 mr-2" /> Generate</>}
                {action === 'regenerate' && <><RefreshCw className="w-4 h-4 mr-2" /> Regenerate</>}
                {action === 'reset' && <><Trash2 className="w-4 h-4 mr-2" /> Reset</>}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
