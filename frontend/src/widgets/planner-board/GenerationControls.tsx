import { useState, useRef } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Sparkles, RefreshCw, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Day } from '@/shared/api/types'

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
}

const MODE_LABELS: Record<string, { label: string; desc: string }> = {
  replace: { label: 'Replace', desc: 'Replace all existing activities in selected days' },
  merge: { label: 'Merge', desc: 'Merge new activities with existing ones' },
  append: { label: 'Append', desc: 'Add new activities without removing existing ones' },
}

export function GenerationControls({
  days,
  hasActivities,
  onGenerate,
  onRegenerate,
  onReset,
  isGenerating,
  jobStatus,
}: Props) {
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
    setOpen(false)
  }

  const isRunning = isGenerating || jobStatus === 'PENDING' || jobStatus === 'RUNNING'

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center gap-2">
        {isRunning ? (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-[#2F6F73]/10 border border-[#2F6F73]/30 text-sm text-[#2F6F73]"
            aria-live="polite"
            aria-label={`Generation in progress: ${jobStatus}`}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {jobStatus === 'RUNNING' ? 'Generating...' : 'Queued...'}
          </div>
        ) : (
          <>
            <Button onClick={() => openDialog('generate')}>
              <Sparkles className="w-4 h-4" />
              Generate
            </Button>
            {hasActivities && (
              <>
                <Button variant="outline" onClick={() => openDialog('regenerate')}>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openDialog('reset')}
                  className="hover:bg-[#C56A3D]/10 hover:border-[#C56A3D]/30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Reset
                </Button>
              </>
            )}
          </>
        )}

        {/* Job terminal states */}
        {jobStatus === 'SUCCEEDED' && (
          <span className="text-xs text-[#6B7A4B] font-medium" aria-live="polite">
            Generation complete
          </span>
        )}
        {jobStatus === 'FAILED' && (
          <span className="text-xs text-[#C56A3D] font-medium" aria-live="polite">
            Generation failed
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === 'generate' && 'Generate Itinerary'}
              {action === 'regenerate' && 'Regenerate Itinerary'}
              {action === 'reset' && 'Reset Itinerary'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="px-5 py-4 space-y-4">
            {action !== 'reset' && (
              <div>
                <label className="block text-xs font-medium text-[#526072] uppercase tracking-wider mb-2">
                  Mode
                </label>
                <div className="space-y-2">
                  {(['replace', 'merge', 'append'] as const).map((m) => (
                    <label
                      key={m}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-[10px] border cursor-pointer transition-colors',
                        mode === m ? 'border-[#2F6F73] bg-[#2F6F73]/5' : 'hover:bg-[#F4EBDD]',
                      )}
                      style={{ borderColor: mode === m ? '#2F6F73' : 'var(--color-border)' }}
                    >
                      <input
                        type="radio"
                        value={m}
                        {...register('mode')}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-sm font-medium text-[#1D2430]">
                          {MODE_LABELS[m].label}
                        </p>
                        <p className="text-xs text-[#526072]">{MODE_LABELS[m].desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Day selection */}
            {days.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[#526072] uppercase tracking-wider mb-2">
                  Scope to specific days (optional)
                </label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto">
                  {days.map((day, i) => (
                    <label
                      key={day.id}
                      htmlFor={`day-${day.id}`}
                      className="flex items-center gap-2 text-sm text-[#1D2430] cursor-pointer"
                    >
                      <Checkbox
                        id={`day-${day.id}`}
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
              <p className="text-sm text-[#526072]">
                This will remove all generated activities from the selected days. Manually
                added activities will be preserved.
              </p>
            )}
          </form>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit(onSubmit)}
              variant={action === 'reset' ? 'destructive' : 'default'}
              className="flex-1"
            >
              {action === 'generate' && <><Sparkles className="w-4 h-4" /> Generate</>}
              {action === 'regenerate' && <><RefreshCw className="w-4 h-4" /> Regenerate</>}
              {action === 'reset' && <><Trash2 className="w-4 h-4" /> Reset</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
