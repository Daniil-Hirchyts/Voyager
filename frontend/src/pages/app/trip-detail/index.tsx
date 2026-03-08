import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronRight,
  Copy,
  FileText,
  Hotel,
  Loader2,
  Map as MapIcon,
  MapPin,
  Ticket,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useTrip, useDeleteTrip, useDuplicateTrip } from '@/entities/trip/queries'
import { useDays, usePatchDay } from '@/entities/day/queries'
import { useTripOffers } from '@/entities/offer/queries'
import { config } from '@/app/config'
import { formatMoney } from '@/shared/lib/format'
import { isApiError } from '@/shared/api/client'
import type { Offer } from '@/shared/api/types'
import {
  WorkspaceHeader,
  WorkspacePage,
  WorkspaceStatCard,
  WorkspaceStatGrid,
} from '@/shared/layouts/workspace-shell'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

export default function TripDetailPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId!)
  const { data: daysData, isLoading: daysLoading } = useDays(tripId!)
  const { data: offersData } = useTripOffers(tripId!, {
    current_only: true,
    limit: 200,
    offset: 0,
  })

  const deleteTrip = useDeleteTrip()
  const duplicateTrip = useDuplicateTrip()
  const patchDay = usePatchDay(tripId!)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [editingDayId, setEditingDayId] = useState<string | null>(null)
  const [dayNotesValue, setDayNotesValue] = useState('')
  const dupKeyRef = useRef(crypto.randomUUID())

  const days = daysData?.items ?? []
  const offersCount = offersData?.items.length ?? 0

  const offersByDay = useMemo(() => {
    const grouped = new globalThis.Map<string, Offer[]>()

    for (const offer of offersData?.items ?? []) {
      if (!offer.trip_day_id) continue
      grouped.set(offer.trip_day_id, [...(grouped.get(offer.trip_day_id) ?? []), offer])
    }

    return grouped
  }, [offersData?.items])

  const metaPillClass =
    'inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-white/76 px-4 py-2 text-sm text-[var(--color-text-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]'
  const noteClass = 'text-sm leading-7 text-[var(--color-text-muted)]'
  const sectionEyebrowClass = 'w-fit'

  if (tripLoading) {
    return (
      <WorkspacePage className="gap-6">
        <div className="h-8 w-36 animate-pulse rounded-full bg-[rgba(114,174,230,0.2)]" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
          <div className="flex flex-col gap-4">
            <div className="h-6 w-28 animate-pulse rounded-full bg-[rgba(114,174,230,0.14)]" />
            <div className="h-14 w-2/3 animate-pulse rounded-[24px] bg-[rgba(114,174,230,0.2)]" />
            <div className="h-16 w-full animate-pulse rounded-[24px] bg-[rgba(114,174,230,0.14)]" />
          </div>
          <Card variant="solid">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="h-6 w-1/2 animate-pulse rounded-full bg-[rgba(114,174,230,0.14)]" />
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded-[20px] bg-[rgba(114,174,230,0.12)]"
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card variant="solid">
          <CardContent className="flex flex-col gap-4 p-6">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-[20px] bg-[rgba(114,174,230,0.12)]" />
            ))}
          </CardContent>
        </Card>
      </WorkspacePage>
    )
  }

  if (tripError || !trip) {
    return (
      <WorkspacePage className="max-w-4xl gap-4">
        <Card variant="solid">
          <CardHeader>
            <Badge variant="neutral" className="w-fit">
              Trip unavailable
            </Badge>
            <CardTitle className="text-3xl">Unable to load the trip</CardTitle>
            <CardDescription className="text-base leading-7">
              {isApiError(tripError) && tripError.status === 404
                ? 'This trip no longer exists or was never created.'
                : 'The trip could not be loaded right now.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app/trips">
                <ArrowLeft data-icon="inline-start" />
                Back to trips
              </Link>
            </Button>
          </CardContent>
        </Card>
      </WorkspacePage>
    )
  }

  const handleDelete = async () => {
    try {
      await deleteTrip.mutateAsync(tripId!)
      setShowDeleteConfirm(false)
      navigate('/app/trips')
      toast.success('Trip deleted')
    } catch {
      setShowDeleteConfirm(false)
      toast.error('Failed to delete trip')
    }
  }

  const handleDuplicate = async () => {
    try {
      const newTrip = await duplicateTrip.mutateAsync({
        tripId: tripId!,
        idempotencyKey: dupKeyRef.current,
      })
      toast.success('Trip duplicated')
      navigate(`/app/trips/${newTrip.id}`)
    } catch {
      toast.error('Failed to duplicate trip')
    }
  }

  const handleDayNotesSave = async (dayId: string) => {
    try {
      await patchDay.mutateAsync({ dayId, data: { notes: dayNotesValue } })
      setEditingDayId(null)
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    }
  }

  return (
    <>
      <WorkspacePage className="gap-6">
        <Button asChild variant="ghost" className="w-fit px-0 hover:bg-transparent">
          <Link to="/app/trips">
            <ArrowLeft data-icon="inline-start" />
            All trips
          </Link>
        </Button>

        <WorkspaceHeader
          eyebrow="Trip dossier"
          title={trip.title}
          description="Overview, day structure, offers, and shortcuts now share the same system as the landing page while keeping planning actions close at hand."
          meta={(
            <>
              <div className={metaPillClass}>
                <MapPin className="size-4 text-[var(--color-primary-foreground)]" />
                {trip.destination_text}
              </div>
              <div className={metaPillClass}>
                <Calendar className="size-4 text-[var(--color-primary-foreground)]" />
                {format(new Date(trip.start_date), 'MMM d, yyyy')} to {format(new Date(trip.end_date), 'MMM d, yyyy')}
              </div>
              {trip.budget_amount ? (
                <div className={metaPillClass}>
                  <Wallet className="size-4 text-[var(--color-primary-foreground)]" />
                  {formatMoney(trip.budget_amount, trip.budget_currency)}
                </div>
              ) : null}
            </>
          )}
          actions={(
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleDuplicate}
                disabled={duplicateTrip.isPending}
                title="Duplicate trip"
              >
                {duplicateTrip.isPending ? <Loader2 className="animate-spin" /> : <Copy />}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete trip"
              >
                <Trash2 />
              </Button>
              <Button asChild>
                <Link to={`/app/trips/${tripId}/plan`}>
                  Open Planner
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            </>
          )}
        />

        <WorkspaceStatGrid className="xl:grid-cols-3">
          <WorkspaceStatCard label="Days" value={days.length} detail="Current itinerary structure" icon={Calendar} />
          <WorkspaceStatCard label="Offers linked" value={offersCount} detail="Current flight and hotel attachments" icon={Ticket} />
          <WorkspaceStatCard label="Trip type" value={<span className="capitalize">{trip.trip_type || 'Leisure'}</span>} detail="Planning mode carried into recommendations" icon={FileText} />
        </WorkspaceStatGrid>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(21rem,0.85fr)] xl:items-start">
          <Card variant="solid" className="overflow-hidden">
            <CardHeader className="gap-3 border-b border-[var(--color-border-strong)] bg-white/54">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Badge variant="neutral" className={sectionEyebrowClass}>
                    Itinerary
                  </Badge>
                  <CardTitle className="text-[2rem] tracking-tight">Itinerary days</CardTitle>
                  <CardDescription className="text-sm leading-7">
                    Review the generated day structure, edit notes, and jump into planning where
                    needed.
                  </CardDescription>
                </div>

                {days.length > 0 ? (
                  <Badge variant="accent" className="text-sm">
                    {days.length} day{days.length !== 1 ? 's' : ''}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 pt-6">
              {daysLoading ? (
                <p className={noteClass}>Loading itinerary days…</p>
              ) : null}

              {days.length === 0 && !daysLoading ? (
                <div className="rounded-[24px] border border-dashed border-[var(--color-border-strong)] bg-white/62 p-6 text-center">
                  <FileText className="mx-auto mb-3 text-[var(--color-primary)]" />
                  <p className={noteClass}>
                    No days yet. Open the planner to generate an itinerary.
                  </p>
                  <Button asChild className="mt-4">
                    <Link to={`/app/trips/${tripId}/plan`}>
                      Open Planner
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                </div>
              ) : null}

              {days.map((day, index) => {
                const dayOffers = offersByDay.get(day.id) ?? []

                return (
                  <Card
                    key={day.id}
                    className="overflow-hidden rounded-[24px] border-[var(--color-border-strong)] bg-white/70"
                  >
                    <CardContent className="flex flex-col gap-4 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-col gap-1">
                          <p className="text-xl font-semibold text-[var(--color-text)]">Day {index + 1}</p>
                          <p className={noteClass}>
                            {format(new Date(day.date), 'EEEE, MMM d, yyyy')}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {editingDayId !== day.id ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-full px-3"
                              onClick={() => {
                                setEditingDayId(day.id)
                                setDayNotesValue(day.notes || '')
                              }}
                            >
                              Edit notes
                            </Button>
                          ) : null}

                          <Button asChild variant="ghost" size="sm" className="rounded-full px-3">
                            <Link to={`/app/trips/${tripId}/plan`}>
                              Plan
                              <ChevronRight data-icon="inline-end" />
                            </Link>
                          </Button>
                        </div>
                      </div>

                      {config.features.offersUI && dayOffers.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {dayOffers.map((offer) => (
                            <Button
                              key={offer.id}
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-auto rounded-full px-3 py-1.5 text-xs"
                            >
                              <Link to={`/app/trips/${tripId}/offers?dayId=${day.id}`}>
                                {offer.kind === 'lodging' ? (
                                  <Hotel data-icon="inline-start" />
                                ) : (
                                  <Ticket data-icon="inline-start" />
                                )}
                                {offer.title}
                              </Link>
                            </Button>
                          ))}
                        </div>
                      ) : null}

                      {editingDayId === day.id ? (
                        <div className="flex flex-col gap-3">
                          <Textarea
                            value={dayNotesValue}
                            onChange={(event) => setDayNotesValue(event.target.value)}
                            rows={3}
                            className="min-h-24 rounded-[20px] border-[var(--color-border-strong)] bg-white/88 p-4 text-sm"
                            placeholder="Notes for this day…"
                            autoFocus
                          />

                          <div className="flex flex-wrap gap-3">
                            <Button
                              type="button"
                              onClick={() => handleDayNotesSave(day.id)}
                              disabled={patchDay.isPending}
                            >
                              {patchDay.isPending ? (
                                <Loader2 className="animate-spin" data-icon="inline-start" />
                              ) : null}
                              Save notes
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setEditingDayId(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className={noteClass}>
                          {day.notes ? (
                            day.notes
                          ) : (
                            <span className="italic text-[var(--color-text-muted)]/70">No notes for this day.</span>
                          )}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6 xl:sticky xl:top-6 xl:self-start">
            <Card variant="solid" className="overflow-hidden">
              <CardHeader className="gap-3 border-b border-[var(--color-border-strong)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <Badge variant="accent" className={sectionEyebrowClass}>
                      Overview
                    </Badge>
                    <CardTitle className="text-2xl">Trip overview</CardTitle>
                  </div>

                  {trip.trip_type ? (
                    <Badge variant="accent" className="text-sm capitalize">
                      {trip.trip_type}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                  <MapPin className="text-[var(--color-primary-foreground)]" />
                  <span>{trip.destination_text}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                  <Calendar className="text-[var(--color-primary-foreground)]" />
                  <span>
                    {format(new Date(trip.start_date), 'MMM d, yyyy')} to{' '}
                    {format(new Date(trip.end_date), 'MMM d, yyyy')}
                  </span>
                </div>
                {trip.budget_amount ? (
                  <div className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
                    <Wallet className="text-[var(--color-primary-foreground)]" />
                    <span>{formatMoney(trip.budget_amount, trip.budget_currency)}</span>
                  </div>
                ) : null}

                <Separator className="bg-[var(--color-border-strong)]" />

                <div className="flex flex-col gap-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                    Preferences
                  </p>

                  {trip.preferences.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {trip.preferences.map((preference) => (
                        <Badge
                          key={preference}
                          variant="neutral"
                          className="rounded-full px-3 py-1 text-sm normal-case tracking-normal"
                        >
                          {preference}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className={noteClass}>
                      No preference profile has been attached to this trip yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {(config.features.mapUI || config.features.offersUI) && (
              <Card variant="solid" className="overflow-hidden">
                <CardHeader className="gap-3 border-b border-[var(--color-border-strong)]">
                  <Badge variant="neutral" className={sectionEyebrowClass}>
                    Shortcuts
                  </Badge>
                  <CardTitle className="text-2xl">Continue planning</CardTitle>
                  <CardDescription className="text-sm leading-7">
                    Use the map and offer views when you want to move from overview into booking
                    and routing.
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-col gap-3 pt-6">
                  <Button asChild>
                    <Link to={`/app/trips/${tripId}/plan`}>
                      Open Planner
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>

                  {config.features.mapUI ? (
                    <Button asChild variant="outline">
                      <Link to={`/app/trips/${tripId}/map`}>
                        <MapIcon data-icon="inline-start" />
                        Open Map
                      </Link>
                    </Button>
                  ) : null}

                  {config.features.offersUI ? (
                    <Button asChild variant="outline">
                      <Link to={`/app/trips/${tripId}/offers`}>
                        <Ticket data-icon="inline-start" />
                        Browse Offers
                      </Link>
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </WorkspacePage>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this trip?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible. All days, activities, and related planning data for
              {' '}
              &quot;{trip.title}&quot; will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                handleDelete()
              }}
            >
              {deleteTrip.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
              Delete trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
