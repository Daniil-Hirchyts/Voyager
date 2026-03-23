import { Fragment, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { BedDouble, Check, ChevronDown, Plane, Plus, Sparkles } from 'lucide-react';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlannerActivity, RouteTravelMode } from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';
import type { PlannerActivityBucket } from './activity-buckets';
import {
  buildPlannerMapDayMetrics,
  buildPlannerMapMetricsForActivities,
  PLANNER_MAP_DAY_COLORS,
  type PlannerMapSection,
  type PlannerMapStop,
} from './planner-map-utils';
import { ActivityCard } from './ActivityCard';
import { TravelConnector } from './TravelConnector';
import {
  type PlannerStandaloneActivityGroup,
  standaloneSectionTitle,
  standaloneSectionSummary,
  standaloneSectionEmptyCopy,
} from './planner-map-view.utils';
import { routeTravelModeDescriptor } from './travel-modes';

type PreviewPlan = {
  order: string[];
  metrics: ReturnType<typeof buildPlannerMapMetricsForActivities>;
};

function getPlannerVisualContainerId(bucket: PlannerActivityBucket, dayId: string | null) {
  return `${bucket}::${dayId ?? 'inbox'}`;
}

export function orderedSectionActivities(
  section: PlannerMapSection,
  previewOrder: string[] | null | undefined,
) {
  if (!previewOrder?.length) {
    return section.activities;
  }

  const orderLookup = new Map(previewOrder.map((id, index) => [id, index]));
  return [...section.activities].sort((left, right) => {
    const leftIndex = orderLookup.get(left.id);
    const rightIndex = orderLookup.get(right.id);
    if (leftIndex == null && rightIndex == null) return left.order_index - right.order_index;
    if (leftIndex == null) return 1;
    if (rightIndex == null) return -1;
    return leftIndex - rightIndex;
  });
}

export function buildApplyPreviewOrder(section: PlannerMapSection, markerOrder: string[]) {
  if (!markerOrder.length) {
    return section.activities.map((activity) => activity.id);
  }

  const nextMarkerIds = [...markerOrder];
  return section.activities.map((activity) => {
    const hasMarker =
      activity.category !== 'hotel' && activity.place?.lat != null && activity.place?.lon != null;
    return hasMarker ? (nextMarkerIds.shift() ?? activity.id) : activity.id;
  });
}

export function dayProgressLabel(section: PlannerMapSection, selectedStop: PlannerMapStop | null) {
  if (!selectedStop || selectedStop.dayId !== section.dayId || selectedStop.markerNumber == null) {
    return null;
  }
  const total = section.stops.filter((stop) => stop.markerNumber != null).length;
  if (!total) {
    return null;
  }
  return `${selectedStop.markerNumber} of ${total}`;
}

export function PlannerMapPin({
  label,
  color,
  selected = false,
  visited = false,
}: {
  label: ReactNode;
  color: string;
  selected?: boolean;
  visited?: boolean;
}) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.5 }}
      animate={{
        y: 0,
        opacity: 1,
        scale: selected ? 1.1 : 1,
        scaleX: [1, 0.8, 1.25, 0.9, 1.1, 1],
        scaleY: [1, 1.3, 0.75, 1.15, 0.95, 1],
      }}
      whileHover={{ scale: selected ? 1.15 : 1.05 }}
      transition={{
        y: { type: 'spring', stiffness: 300, damping: 15 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
        scaleX: { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
        scaleY: { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      }}
      className={cn('pointer-events-none relative origin-bottom pb-1')}
    >
      <div
        className="flex h-10 w-10 -rotate-45 items-center justify-center rounded-[50%_50%_50%_10%] border-[2px] border-white shadow-sm"
        style={{ backgroundColor: selected ? '#111827' : `${color}` }}
      >
        <div className="flex rotate-45 items-center justify-center">
          <span className="text-[15px] leading-none font-bold tracking-tight text-white">
            {label}
          </span>
        </div>
      </div>
      {visited ? (
        <div className="absolute -top-0 -right-0 z-20 flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-white/90 bg-[var(--color-success)]">
          <Check className="h-2.5 w-2.5 text-white" />
        </div>
      ) : null}
    </motion.div>
  );
}

export function PlannerSidebarSectionTrigger({
  icon,
  title,
  summary,
  actions,
}: {
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <span className="flex w-full items-center justify-between gap-3 pr-4">
      <span className="flex min-w-0 items-center gap-2.5 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-[var(--color-secondary-surface)] text-[var(--color-text)]">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[0.85rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-[0.74rem] text-[var(--color-text-muted)]">
            {summary}
          </span>
        </span>
      </span>
      {actions && (
        <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </span>
  );
}

export function PlannerMapDayAccordion({
  section,
  metrics,
  preview,
  travelMode,
  isSelected,
  isDragActive,
  selectedStop,
  optimizing,
  onSelectStop,
  onAddActivity,
  onPreviewOptimize,
  onApplyPreview,
  onCancelPreview,
  onToggleVisited,
}: {
  section: PlannerMapSection;
  metrics: ReturnType<typeof buildPlannerMapDayMetrics>[string] | undefined;
  preview: PreviewPlan | null | undefined;
  travelMode: RouteTravelMode;
  isSelected: boolean;
  isDragActive: boolean;
  selectedStop: PlannerMapStop | null;
  optimizing: boolean;
  onSelectStop: (stop: PlannerMapStop) => void;
  onAddActivity: (dayId: string | null, defaultCategory?: PlannerActivity['category']) => void;
  onPreviewOptimize: () => void;
  onApplyPreview: () => void;
  onCancelPreview: () => void;
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void;
}) {
  const orderedActivities = orderedSectionActivities(section, preview?.order);
  const displayMetrics = preview?.metrics ?? metrics;
  const stopByActivityId = new Map(section.stops.map((stop) => [stop.activity.id, stop]));
  const isInbox = section.dayId === 'inbox';
  const dropDayId = isInbox ? null : section.dayId;
  const containerId = getPlannerVisualContainerId('main', dropDayId);
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'container', containerId, dayId: dropDayId, bucket: 'main' },
  });
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: `${containerId}::end`,
    data: { type: 'container-end', containerId, dayId: dropDayId, bucket: 'main' },
  });

  return (
    <AccordionItem
      id={`planner-day-${section.dayId}`}
      value={section.dayId}
      ref={setNodeRef}
      className={cn(
        'overflow-hidden rounded-[18px] bg-white transition-[box-shadow,ring]',
        isSelected && '',
        isOver && 'ring-2 ring-black/6',
      )}
    >
      <AccordionPrimitive.Header className="flex">
        <AccordionPrimitive.Trigger asChild>
          <div
            data-testid={`planner-map-day-trigger-${section.dayId}`}
            className="group w-full cursor-pointer px-4 py-2.5 text-left"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.72rem] font-bold text-white"
                  style={{ backgroundColor: section.color }}
                >
                  {section.dayIndex >= 0 ? section.dayIndex + 1 : '+'}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.92rem] font-semibold tracking-[-0.01em] text-[var(--color-text)]">
                    {section.title}
                  </p>
                  <p className="text-[0.76rem] text-[var(--color-text-muted)]">
                    {section.subtitle}
                    {!isInbox ? ` · ${section.dateLabel}` : ''}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {!isInbox && section.stops.length > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                          onClick={onPreviewOptimize}
                          disabled={optimizing}
                          aria-label="Optimise itinerary"
                        >
                          <Sparkles className={cn('h-3.5 w-3.5', optimizing && 'animate-pulse')} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {optimizing ? 'Optimizing…' : 'Optimise itinerary'}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                    onClick={() => onAddActivity(dropDayId)}
                    aria-label={`Add activity to ${section.title}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </div>
          </div>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>

      {preview?.order.length ? (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-3 rounded-[16px] border border-[rgba(124,90,224,0.16)] bg-[rgba(124,90,224,0.08)] px-4 py-3">
            <Badge
              variant="outline"
              className="shrink-0 rounded-full border-[rgba(124,90,224,0.25)] bg-white px-3.5 py-1.5 text-[0.7rem] font-semibold tracking-[0.18em] text-[var(--color-text-muted)] uppercase"
            >
              Preview
            </Badge>
            <p className="min-w-0 flex-1 text-sm leading-[1.35] tracking-[-0.02em] text-[var(--color-text)]">
              Voyager found a shorter {routeTravelModeDescriptor(travelMode)} order for this day.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" className="h-10 rounded-full px-4.5" onClick={onApplyPreview}>
                Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-10 rounded-full px-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                onClick={onCancelPreview}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <AccordionContent className="px-4 pt-0 pb-3">
        <div className="border-t border-[var(--color-border)] pt-2">
          {orderedActivities.length > 0 ? (
            <>
              {displayMetrics?.hotelToFirstLeg ? (
                <TravelConnector
                  durationMin={displayMetrics.hotelToFirstLeg.durationMin}
                  distanceKm={displayMetrics.hotelToFirstLeg.distanceKm}
                  testId={`planner-map-travel-leg-hotel-to-first-${section.dayId}`}
                />
              ) : null}
              <SortableContext
                items={orderedActivities.map((activity) => activity.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedActivities.map((activity, index) => {
                  const stop = stopByActivityId.get(activity.id) ?? null;
                  const nextActivity = orderedActivities[index + 1];
                  const leg = nextActivity
                    ? (displayMetrics?.legs.find((item) => item.toActivityId === nextActivity.id) ??
                      null)
                    : null;

                  return (
                    <Fragment key={activity.id}>
                      <ActivityCard
                        activity={activity}
                        onOpen={() => {
                          if (stop) {
                            onSelectStop(stop);
                          }
                        }}
                        isSelected={selectedStop?.activity.id === activity.id}
                        onToggleVisited={() => onToggleVisited(activity.id, activity.visited_at)}
                        color={section.color}
                      />
                      {leg && nextActivity ? (
                        <TravelConnector
                          durationMin={leg.durationMin}
                          distanceKm={leg.distanceKm}
                          testId={`planner-map-travel-leg-${nextActivity.id}`}
                        />
                      ) : null}
                    </Fragment>
                  );
                })}
              </SortableContext>

              {displayMetrics?.lastToHotelLeg ? (
                <TravelConnector
                  durationMin={displayMetrics.lastToHotelLeg.durationMin}
                  distanceKm={displayMetrics.lastToHotelLeg.distanceKm}
                  testId={`planner-map-travel-leg-last-to-hotel-${section.dayId}`}
                />
              ) : null}

              <div
                ref={setEndZoneRef}
                className={cn(
                  'overflow-hidden rounded-[12px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
                  isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
                  isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
                )}
              />
            </>
          ) : (
            <div className="flex min-h-[88px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-5 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                Drop activities here or add one manually.
              </p>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function PlannerStandaloneActivityGroupCard({
  bucket,
  group,
  stopByActivityId,
  selectedStop,
  isDragActive,
  onSelectStop,
  onToggleVisited,
}: {
  bucket: 'travel' | 'accommodation';
  group: PlannerStandaloneActivityGroup;
  stopByActivityId: Map<string, PlannerMapStop>;
  selectedStop: PlannerMapStop | null;
  isDragActive: boolean;
  onSelectStop: (stop: PlannerMapStop) => void;
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void;
}) {
  const containerId = getPlannerVisualContainerId(bucket, group.dayId);
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'container', containerId, dayId: group.dayId, bucket },
  });
  const { setNodeRef: setEndZoneRef, isOver: isOverEnd } = useDroppable({
    id: `${containerId}::end`,
    data: { type: 'container-end', containerId, dayId: group.dayId, bucket },
  });
  const isUnassignedGroup = group.dayId == null;

  const cards = (
    <SortableContext
      items={group.activities.map((activity) => activity.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="flex flex-col gap-2 p-0.5">
        {group.activities.map((activity) => {
          const stop = stopByActivityId.get(activity.id) ?? null;
          const dayIndex = group.dayIndex ?? -1;
          const color =
            stop?.color ??
            (dayIndex >= 0
              ? (PLANNER_MAP_DAY_COLORS[dayIndex % PLANNER_MAP_DAY_COLORS.length] ??
                PLANNER_MAP_DAY_COLORS[0])
              : '#B59BFF');

          return (
            <ActivityCard
              key={activity.id}
              activity={activity}
              onOpen={() => {
                if (stop) {
                  onSelectStop(stop);
                }
              }}
              isSelected={selectedStop?.activity.id === activity.id}
              onToggleVisited={() => onToggleVisited(activity.id, activity.visited_at)}
              color={color}
            />
          );
        })}
      </div>
    </SortableContext>
  );

  if (isUnassignedGroup) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'transition-all',
          isOver && 'rounded-[18px] bg-[var(--color-secondary-surface)]/55 p-1.5',
        )}
        data-testid={`planner-${bucket}-group-${group.dayId ?? 'inbox'}`}
      >
        {cards}
        <div
          ref={setEndZoneRef}
          className={cn(
            'mt-2 overflow-hidden rounded-[12px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
            isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
            isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
          )}
        />
      </div>
    );
  }

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'overflow-hidden rounded-[18px] bg-white px-3.5 py-3 transition-all',
        isOver && 'ring-2 ring-black/6',
      )}
      data-testid={`planner-${bucket}-group-${group.dayId ?? 'inbox'}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] pb-2.5">
        <div className="min-w-0">
          <p className="text-[0.8rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {group.title}
          </p>
          <p className="mt-0.5 text-[0.72rem] text-[var(--color-text-muted)]">{group.subtitle}</p>
        </div>
        <Badge
          variant="outline"
          className="rounded-full border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.64rem] font-semibold tracking-[0.12em] text-[var(--color-text-muted)] uppercase"
        >
          {group.activities.length} {group.activities.length === 1 ? 'item' : 'items'}
        </Badge>
      </div>

      <div className="mt-3">
        {cards}

        <div
          ref={setEndZoneRef}
          className={cn(
            'mt-2 overflow-hidden rounded-[12px] border border-dashed border-transparent transition-[min-height,opacity,background-color,border-color]',
            isDragActive ? 'min-h-8 opacity-100' : 'min-h-0 opacity-0',
            isOverEnd && 'border-black/16 bg-[var(--color-secondary-surface)]',
          )}
        />
      </div>
    </section>
  );
}

export function PlannerStandaloneActivitySection({
  bucket,
  groups,
  isDragActive,
  stopByActivityId,
  selectedStop,
  onSelectStop,
  onAddActivity,
  onToggleVisited,
}: {
  bucket: 'travel' | 'accommodation';
  groups: PlannerStandaloneActivityGroup[];
  isDragActive: boolean;
  stopByActivityId: Map<string, PlannerMapStop>;
  selectedStop: PlannerMapStop | null;
  onSelectStop: (stop: PlannerMapStop) => void;
  onAddActivity: (dayId: string | null, defaultCategory?: PlannerActivity['category']) => void;
  onToggleVisited: (activityId: string, currentVisitedAt: string | null) => void;
}) {
  const title = standaloneSectionTitle(bucket);
  const sectionCategory = bucket === 'accommodation' ? 'hotel' : 'travel';
  const Icon = bucket === 'accommodation' ? BedDouble : Plane;

  return (
    <AccordionItem
      value={bucket}
      className="overflow-hidden rounded-[20px] bg-white px-3.5"
      data-planner-section={sectionCategory}
      data-testid={`planner-${bucket}-section`}
    >
      <AccordionTrigger className="py-3 hover:no-underline">
        <PlannerSidebarSectionTrigger
          icon={<Icon className="h-4 w-4" />}
          title={title}
          summary={standaloneSectionSummary(bucket, groups)}
          actions={
            <Button
              type="button"
              variant="ghost"
              className="h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              onClick={(event) => {
                event.stopPropagation();
                onAddActivity(null, sectionCategory);
              }}
              aria-label={`Add ${title.toLowerCase()}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          }
        />
      </AccordionTrigger>
      <AccordionContent className="pt-0 pb-3.5">
        {groups.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <PlannerStandaloneActivityGroupCard
                key={group.id}
                bucket={bucket}
                group={group}
                stopByActivityId={stopByActivityId}
                selectedStop={selectedStop}
                isDragActive={isDragActive}
                onSelectStop={onSelectStop}
                onToggleVisited={onToggleVisited}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[88px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-border)] bg-[var(--color-secondary-surface)] px-5 text-center">
            <p className="text-sm text-[var(--color-text-muted)]">
              {standaloneSectionEmptyCopy(bucket)}
            </p>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
