import { Route } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { formatTravelDistance, formatTravelDuration } from './travel-estimates';

interface TravelConnectorProps {
  durationMin: number | null | undefined;
  distanceKm: number | null | undefined;
  testId?: string;
}

export function TravelConnector({ durationMin, distanceKm, testId }: TravelConnectorProps) {
  const hasEstimate = durationMin != null && distanceKm != null;

  return (
    <div data-testid={testId} className="relative px-1 py-0.5">
      <div className="pointer-events-none absolute top-0 bottom-0 left-[1.05rem] border-l border-dashed border-[var(--color-border)]" />
      <div
        className={cn(
          'ml-6 flex items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-[0.72rem] text-[var(--color-text-muted)]')}
      >
        <Route className="h-3.5 w-3.5 shrink-0" />
        {hasEstimate ? (
          <>
            <span className="font-medium text-[var(--color-text)]">
              {formatTravelDuration(durationMin)}
            </span>
            <span>&middot;</span>
            <span>{formatTravelDistance(distanceKm)}</span>
          </>
        ) : (
          <span>Add places to estimate travel</span>
        )}
      </div>
    </div>
  );
}
