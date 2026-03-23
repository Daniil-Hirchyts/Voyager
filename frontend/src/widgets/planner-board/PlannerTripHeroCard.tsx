import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatedMoney, AnimatedNumber } from '@/components/ui/animated-number';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ProgressiveBlur } from '@/components/ui/progressive-blur';
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePatchTrip } from '@/entities/trip/queries';
import { useTripSharing } from '@/entities/trip-sharing/queries';
import { useProfile } from '@/entities/user/queries';
import type { PlannerActivity, Trip, TripCollaborator } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import { CURRENCY_OPTIONS } from '@/shared/lib/currencies';
import {
  asFiniteNumber,
  buildBudgetOverview,
  formatTripDateRangeLabel,
  formatTripTypeLabel,
} from './planner-map-view.utils';

export function PlannerTripHeroCard({
  trip,
  tripId,
  coverPhotoUrl,
  onOpenCollaboration,
  onOpenGeneration,
}: {
  trip: Trip;
  tripId: string;
  coverPhotoUrl: string | null;
  onOpenCollaboration?: () => void;
  onOpenGeneration?: () => void;
}) {
  const tripTypeLabel = formatTripTypeLabel(trip.trip_type);
  const dateLabel = formatTripDateRangeLabel(trip.start_date, trip.end_date);
  const { data: profile } = useProfile();
  const sharing = useTripSharing(tripId);
  const collaborators = sharing.data?.collaborators ?? [];

  const myName = profile?.display_name || 'Me';
  const myAvatar = profile?.avatar_thumbnail_url || profile?.avatar_url || null;
  const myInitials =
    myName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase())
      .join('') || 'M';

  function getCollaboratorName(c: TripCollaborator) {
    return c.display_name || c.email || 'Traveler';
  }

  const visibleCollaborators = collaborators
    .filter((c) => c.user_id !== trip.user_id && c.user_id !== profile?.keycloak_sub)
    .slice(0, 3);

  return (
    <section className="overflow-hidden rounded-[26px] bg-white" data-testid="planner-trip-hero">
      <div className="relative overflow-hidden rounded-[22px]">
        <div className="relative h-36 bg-[linear-gradient(135deg,#d6e3ee_0%,#9fb5c6_52%,#6d879e_100%)] sm:h-40">
          {coverPhotoUrl ? (
            <PhotoViewerProvider>
              <PhotoViewer src={coverPhotoUrl}>
                <button
                  type="button"
                  className="group relative block h-full w-full text-left"
                  aria-label={`Preview cover photo for ${trip.title}`}
                >
                  <img
                    src={coverPhotoUrl}
                    alt={trip.destination_text}
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                  <ProgressiveBlur
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%]"
                    blurIntensity={0.85}
                  />
                </button>
              </PhotoViewer>
            </PhotoViewerProvider>
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,20,32,0.08)_0%,rgba(10,20,32,0.14)_42%,rgba(255,255,255,0.68)_82%,#ffffff_100%)]" />
          <div className="absolute top-3 left-3 flex flex-wrap gap-2">
            {tripTypeLabel ? (
              <span className="rounded-full border border-white/45 bg-white/16 px-2.5 py-1 text-[0.64rem] font-medium text-white/92 backdrop-blur">
                {tripTypeLabel}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="absolute top-3 right-3 flex items-center"
            onClick={onOpenCollaboration}
            aria-label="Open collaboration"
          >
            <div className="flex -space-x-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/80 bg-white/20 backdrop-blur">
                <span className="text-[1rem] leading-none font-light text-white">+</span>
              </div>

              {visibleCollaborators.map((c) => {
                const name = getCollaboratorName(c);
                const initials =
                  name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((p: string) => p[0]?.toUpperCase())
                    .join('') || 'T';
                return (
                  <Avatar key={c.user_id} className="h-8 w-8 rounded-full border-2 border-white">
                    <AvatarImage
                      src={
                        (c as TripCollaborator & { avatar_url?: string }).avatar_url ?? undefined
                      }
                      alt={name}
                    />
                    <AvatarFallback className="rounded-full bg-[#ECEEF0] text-[0.6rem] font-semibold text-[var(--color-text-muted)]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                );
              })}

              <Avatar className="h-8 w-8 rounded-full border-2 border-white">
                <AvatarImage src={myAvatar ?? undefined} alt={myName} />
                <AvatarFallback className="rounded-full bg-[#ECEEF0] text-[0.6rem] font-semibold text-[var(--color-text-muted)]">
                  {myInitials}
                </AvatarFallback>
              </Avatar>
            </div>
          </button>
          {!coverPhotoUrl ? (
            <div className="absolute inset-x-4 bottom-5">
              <p className="text-[0.66rem] font-semibold tracking-[0.22em] text-white/80 uppercase">
                Destination
              </p>
              <p className="mt-1.5 text-[1rem] font-semibold tracking-[-0.03em] text-white">
                {trip.destination_text}
              </p>
            </div>
          ) : null}
        </div>

        <div className="relative mx-3 -mt-6 mb-3 rounded-[20px] border border-white/80 bg-white/94 px-4 py-3.5 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.62rem] font-semibold tracking-[0.2em] text-[var(--color-text-muted)] uppercase">
              Trip overview
            </p>
            {onOpenGeneration ? (
              <Button
                type="button"
                variant="outline"
                className="h-7 rounded-full bg-white px-2.5 text-[0.7rem] font-semibold transition-all hover:bg-white/90 active:scale-95"
                onClick={onOpenGeneration}
              >
                <Sparkles className="size-3" />
                Generate
              </Button>
            ) : null}
          </div>
          <h1 className="mt-1.5 text-[1.55rem] leading-none font-semibold tracking-[-0.05em] text-[var(--color-text)]">
            {trip.title}
          </h1>

          <div className="mt-3 flex flex-col gap-1.5">
            <span className="inline-flex min-w-0 items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)]">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{dateLabel}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-2 text-[0.8rem] text-[var(--color-text-muted)]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{trip.destination_text}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlannerBudgetOverview({
  trip,
  activities,
}: {
  trip: Trip;
  activities: PlannerActivity[];
}) {
  const patchTrip = usePatchTrip(trip.id);
  const budgetOverview = useMemo(() => buildBudgetOverview(trip, activities), [activities, trip]);
  const [draftAmount, setDraftAmount] = useState(
    trip.budget_amount == null || trip.budget_amount === ''
      ? ''
      : String(Number(trip.budget_amount)),
  );
  const [draftCurrency, setDraftCurrency] = useState(trip.budget_currency ?? 'USD');
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);

  const persistedBudgetAmount =
    trip.budget_amount == null || trip.budget_amount === '' ? null : Number(trip.budget_amount);
  const persistedBudgetCurrency = trip.budget_currency ?? 'USD';

  useEffect(() => {
    setDraftAmount(
      trip.budget_amount == null || trip.budget_amount === ''
        ? ''
        : String(Number(trip.budget_amount)),
    );
    setDraftCurrency(trip.budget_currency ?? 'USD');
  }, [trip.budget_amount, trip.budget_currency, trip.version]);

  async function handleSaveBudget(nextAmount = draftAmount, nextCurrency = draftCurrency) {
    const nextParsedAmount = nextAmount.trim() ? Number(nextAmount) : null;
    const nextHasValidBudget =
      nextParsedAmount == null || (!Number.isNaN(nextParsedAmount) && nextParsedAmount >= 0);
    const nextIsDirty =
      (nextParsedAmount ?? null) !== persistedBudgetAmount ||
      nextCurrency !== persistedBudgetCurrency;

    if (!nextIsDirty || patchTrip.isPending) {
      return;
    }

    if (!nextHasValidBudget) {
      toast.error('Enter a valid budget amount');
      return;
    }

    try {
      await patchTrip.mutateAsync({
        version: trip.version,
        data: {
          budget_amount: nextParsedAmount,
          budget_currency: nextCurrency,
        },
      });
    } catch {
      toast.error('Could not update the budget');
    }
  }

  const initialBudgetAmount = asFiniteNumber(trip.budget_amount);
  const spentAmount = asFiniteNumber(budgetOverview.comparableSpent);
  const currentBudgetAmount = asFiniteNumber(budgetOverview.currentBudgetAmount);

  return (
    <div className="flex flex-col gap-3" data-testid="planner-budget-summary">
      <div className="rounded-[22px] bg-white px-5 py-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[0.68rem] font-bold tracking-[0.12em] text-[var(--color-text-muted)] uppercase">
                Initial Budget
              </span>
              <span className="text-[1.4rem] font-bold tracking-tight text-[var(--color-text)]">
                {initialBudgetAmount != null ? (
                  <AnimatedMoney value={initialBudgetAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>

            <div className="flex w-full items-center sm:w-auto">
              <div
                className="relative flex h-11 w-full items-center overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-secondary-surface)] focus-within:ring-2 focus-within:ring-[var(--color-border)] sm:w-auto"
                aria-busy={patchTrip.isPending}
                onBlur={(event) => {
                  const nextFocused = event.relatedTarget;

                  if (isCurrencyMenuOpen) {
                    return;
                  }

                  if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
                    return;
                  }

                  void handleSaveBudget();
                }}
              >
                <Select
                  value={draftCurrency}
                  disabled={patchTrip.isPending}
                  onOpenChange={setIsCurrencyMenuOpen}
                  onValueChange={(nextCurrency) => {
                    setDraftCurrency(nextCurrency);
                    void handleSaveBudget(draftAmount, nextCurrency);
                  }}
                >
                  <SelectTrigger className="h-full border-none bg-transparent px-3 text-[0.8rem] font-bold focus:ring-0 focus:ring-offset-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-56 overflow-y-auto">
                    {CURRENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-sm">
                        {option.label}
                        {option.description ? ` ${option.description}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="h-5 w-px bg-[var(--color-border)]" />
                <Input
                  aria-label="Trip budget amount"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="any"
                  inputMode="decimal"
                  disabled={patchTrip.isPending}
                  placeholder="0"
                  value={draftAmount}
                  onChange={(event) => setDraftAmount(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') {
                      return;
                    }
                    event.preventDefault();
                    void handleSaveBudget();
                  }}
                  className="h-full w-full border-none bg-transparent px-3 text-right text-[0.95rem] font-semibold focus-visible:ring-0 sm:w-24"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-5">
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] font-bold tracking-[0.1em] text-[var(--color-text-muted)] uppercase">
                Spent
              </span>
              <span className="text-[1.1rem] font-bold text-[var(--color-text)]">
                {spentAmount != null ? (
                  <AnimatedMoney value={spentAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[0.65rem] font-bold tracking-[0.1em] text-[var(--color-text-muted)] uppercase">
                Current Budget
              </span>
              <span
                className={cn(
                  'text-[1.1rem] font-bold',
                  budgetOverview.currentBudgetAmount !== null &&
                    budgetOverview.currentBudgetAmount < 0
                    ? 'text-[var(--color-danger)]'
                    : 'text-[var(--color-success)]',
                )}
              >
                {currentBudgetAmount != null ? (
                  <AnimatedMoney value={currentBudgetAmount} currency={trip.budget_currency} />
                ) : (
                  '—'
                )}
              </span>
            </div>
          </div>

          {budgetOverview.pricedActivityCount > 0 && (
            <p className="text-[0.7rem] leading-relaxed text-[var(--color-text-muted)] opacity-80">
              Tracking costs for <AnimatedNumber value={budgetOverview.pricedActivityCount} />{' '}
              activities.
              {budgetOverview.unpricedActivityCount > 0 ? (
                <>
                  {' '}
                  <AnimatedNumber value={budgetOverview.unpricedActivityCount} /> more are still
                  pending.
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
