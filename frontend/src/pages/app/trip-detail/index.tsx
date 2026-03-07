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

  if (tripLoading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8 xl:px-10">
        <div className="h-8 w-36 animate-pulse rounded-full bg-[#DCCCB7]/65" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
          <div className="flex flex-col gap-4">
            <div className="h-6 w-28 animate-pulse rounded-full bg-[#DCCCB7]/50" />
            <div className="h-14 w-2/3 animate-pulse rounded-[24px] bg-[#DCCCB7]/55" />
            <div className="h-16 w-full animate-pulse rounded-[24px] bg-[#DCCCB7]/45" />
          </div>
          <Card className="border-[#D7CCBC]">
            <CardContent className="flex flex-col gap-4 p-6">
              <div className="h-6 w-1/2 animate-pulse rounded-full bg-[#DCCCB7]/50" />
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                {[1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="h-20 animate-pulse rounded-[20px] bg-[#DCCCB7]/40"
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card className="border-[#D7CCBC]">
          <CardContent className="flex flex-col gap-4 p-6">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-[20px] bg-[#DCCCB7]/40" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (tripError || !trip) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6 md:px-8 md:py-8">
        <Card className="border-[#D7CCBC] shadow-[0_28px_70px_-50px_rgba(24,33,43,0.7)]">
          <CardHeader>
            <Badge
              variant="outline"
              className="w-fit rounded-full border-[#D7CCBC] bg-white/70 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#556476]"
            >
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
      </div>
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 md:px-8 md:py-8 xl:px-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)] xl:items-start">
          <div className="flex flex-col gap-5">
            <Button
              asChild
              variant="ghost"
              className="w-fit px-0 text-[#556476] hover:bg-transparent hover:text-[#18212B]"
            >
              <Link to="/app/trips">
                <ArrowLeft data-icon="inline-start" />
                All trips
              </Link>
            </Button>

            <div className="flex flex-col gap-4">
              <Badge
                variant="outline"
                className="w-fit rounded-full border-[#D7CCBC] bg-white/72 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#556476]"
              >
                Trip dossier
              </Badge>

              <h1 className="text-[2.75rem] font-semibold leading-none tracking-tight text-[#18212B] md:text-[3.4rem]">
                {trip.title}
              </h1>

              <div className="flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#D7CCBC] bg-white/72 px-4 py-2 text-sm text-[#435366]">
                  <MapPin className="text-[#214F52]" />
                  {trip.destination_text}
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-[#D7CCBC] bg-white/72 px-4 py-2 text-sm text-[#435366]">
                  <Calendar className="text-[#214F52]" />
                  {format(new Date(trip.start_date), 'MMM d, yyyy')} to{' '}
                  {format(new Date(trip.end_date), 'MMM d, yyyy')}
                </div>

                {trip.budget_amount ? (
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#D7CCBC] bg-white/72 px-4 py-2 text-sm text-[#435366]">
                    <Wallet className="text-[#214F52]" />
                    {formatMoney(trip.budget_amount, trip.budget_currency)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <Card className="overflow-hidden border-[#D7CCBC] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,235,223,0.92))] shadow-[0_32px_80px_-48px_rgba(24,33,43,0.6)]">
            <CardHeader className="gap-3 border-b border-[#D7CCBC]">
              <Badge className="w-fit rounded-full bg-[#214F52]/10 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#214F52]">
                Trip controls
              </Badge>
              <CardTitle className="text-2xl">Keep the trip moving</CardTitle>
              <CardDescription className="text-sm leading-7">
                Duplicate the setup, delete the plan, or jump straight into the planner without
                losing context.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-5 pt-6">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[20px] border border-[#D7CCBC] bg-white/72 p-4">
                  <p className="text-[0.72rem] uppercase tracking-[0.16em] text-[#7A6A58]">Days</p>
                  <p className="mt-2 text-2xl font-semibold text-[#18212B]">{days.length}</p>
                </div>
                <div className="rounded-[20px] border border-[#D7CCBC] bg-white/72 p-4">
                  <p className="text-[0.72rem] uppercase tracking-[0.16em] text-[#7A6A58]">
                    Offers linked
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-[#18212B]">{offersCount}</p>
                </div>
                <div className="rounded-[20px] border border-[#D7CCBC] bg-white/72 p-4">
                  <p className="text-[0.72rem] uppercase tracking-[0.16em] text-[#7A6A58]">
                    Trip type
                  </p>
                  <p className="mt-2 text-lg font-semibold capitalize text-[#18212B]">
                    {trip.trip_type || 'Leisure'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 rounded-[18px]"
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
                    className="size-11 rounded-[18px]"
                    onClick={() => setShowDeleteConfirm(true)}
                    title="Delete trip"
                  >
                    <Trash2 />
                  </Button>
                </div>

                <Button asChild className="h-12 rounded-[18px] text-base">
                  <Link to={`/app/trips/${tripId}/plan`}>
                    Open Planner
                    <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(21rem,0.85fr)] xl:items-start">
          <Card className="overflow-hidden border-[#D7CCBC] shadow-[0_32px_80px_-48px_rgba(24,33,43,0.6)]">
            <CardHeader className="gap-3 border-b border-[#D7CCBC] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(253,250,245,0.98))]">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Badge
                    variant="outline"
                    className="w-fit rounded-full border-[#D7CCBC] bg-white/70 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#556476]"
                  >
                    Itinerary
                  </Badge>
                  <CardTitle className="text-[2rem] tracking-tight">Itinerary days</CardTitle>
                  <CardDescription className="text-sm leading-7">
                    Review the generated day structure, edit notes, and jump into planning where
                    needed.
                  </CardDescription>
                </div>

                {days.length > 0 ? (
                  <Badge className="rounded-full bg-[#214F52]/10 px-3 py-1 text-sm text-[#214F52]">
                    {days.length} day{days.length !== 1 ? 's' : ''}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4 pt-6">
              {daysLoading ? (
                <p className="text-sm text-[#556476]">Loading itinerary days…</p>
              ) : null}

              {days.length === 0 && !daysLoading ? (
                <div className="rounded-[22px] border border-dashed border-[#D7CCBC] bg-[rgba(255,255,255,0.6)] p-6 text-center">
                  <FileText className="mx-auto mb-3 text-[#C8BAA4]" />
                  <p className="text-sm leading-7 text-[#556476]">
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
                    className="rounded-[22px] border-[#D7CCBC] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(250,244,236,0.88))]"
                  >
                    <CardContent className="flex flex-col gap-4 p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex flex-col gap-1">
                          <p className="text-xl font-semibold text-[#18212B]">Day {index + 1}</p>
                          <p className="text-sm text-[#556476]">
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
                            className="min-h-24 rounded-[18px] bg-[rgba(244,235,221,0.78)] p-4 text-sm"
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
                        <p className="text-sm leading-7 text-[#556476]">
                          {day.notes ? (
                            day.notes
                          ) : (
                            <span className="italic text-[#B8A995]">No notes for this day.</span>
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
            <Card className="overflow-hidden border-[#D7CCBC] shadow-[0_32px_80px_-48px_rgba(24,33,43,0.6)]">
              <CardHeader className="gap-3 border-b border-[#D7CCBC]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2">
                    <Badge className="w-fit rounded-full bg-[#214F52]/10 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#214F52]">
                      Overview
                    </Badge>
                    <CardTitle className="text-2xl">Trip overview</CardTitle>
                  </div>

                  {trip.trip_type ? (
                    <Badge className="rounded-full bg-[#214F52]/10 px-3 py-1 text-sm capitalize text-[#214F52]">
                      {trip.trip_type}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4 pt-6">
                <div className="flex items-center gap-3 text-sm text-[#435366]">
                  <MapPin className="text-[#214F52]" />
                  <span>{trip.destination_text}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-[#435366]">
                  <Calendar className="text-[#214F52]" />
                  <span>
                    {format(new Date(trip.start_date), 'MMM d, yyyy')} to{' '}
                    {format(new Date(trip.end_date), 'MMM d, yyyy')}
                  </span>
                </div>
                {trip.budget_amount ? (
                  <div className="flex items-center gap-3 text-sm text-[#435366]">
                    <Wallet className="text-[#214F52]" />
                    <span>{formatMoney(trip.budget_amount, trip.budget_currency)}</span>
                  </div>
                ) : null}

                <Separator className="bg-[#D7CCBC]" />

                <div className="flex flex-col gap-3">
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[#7A6A58]">
                    Preferences
                  </p>

                  {trip.preferences.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {trip.preferences.map((preference) => (
                        <Badge
                          key={preference}
                          variant="secondary"
                          className="rounded-full bg-[#EFE4D4] px-3 py-1 text-sm text-[#435366]"
                        >
                          {preference}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-7 text-[#556476]">
                      No preference profile has been attached to this trip yet.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {(config.features.mapUI || config.features.offersUI) && (
              <Card className="overflow-hidden border-[#D7CCBC] shadow-[0_32px_80px_-48px_rgba(24,33,43,0.6)]">
                <CardHeader className="gap-3 border-b border-[#D7CCBC]">
                  <Badge
                    variant="outline"
                    className="w-fit rounded-full border-[#D7CCBC] bg-white/72 px-3 py-1 text-[0.72rem] uppercase tracking-[0.16em] text-[#556476]"
                  >
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
      </div>

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
              className="bg-[#C56A3D] hover:bg-[#B05E35]"
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
