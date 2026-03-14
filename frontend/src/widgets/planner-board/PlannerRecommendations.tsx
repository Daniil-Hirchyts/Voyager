import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MapPin,
  RefreshCw,
  Sparkles,
  Star,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { AiLoadingText } from '@/components/ui/ai-loading-text'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { Button } from '@/components/ui/button'
import { PhotoViewer, PhotoViewerProvider } from '@/components/ui/photo-viewer'
import {
  CarouselContent,
  CarouselItem,
  useCarousel,
} from '@/components/ui/carousel'
import {
  Disclosure,
  DisclosureContent,
  DisclosureTrigger,
} from '@/components/ui/disclosure'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetClose } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useDiscoveredActivityDetail,
  useSavedActivityDetail,
} from '@/entities/activity-discovery/queries'
import { cn } from '@/shared/lib/cn'
import type { ActivityDiscoveryDetail } from '@/shared/api/types'
import { VoyagerLoader } from '@/widgets/app-shell/logo'
import type {
  PlannerRecommendationDestination,
  PlannerRecommendationEntry,
  PlannerRecommendationsController,
} from './usePlannerRecommendations'

const RECOMMENDATION_LOADING_COPY = 'Curating nearby picks...'

function extractTags(detail: ActivityDiscoveryDetail | undefined) {
  const payload = detail?.provider_payload
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const keys = ['categories', 'labels', 'cuisines', 'good_for', 'amenities']
  const tags: string[] = []
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) {
      tags.push(value.trim())
      continue
    }
    if (!Array.isArray(value)) {
      continue
    }
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        tags.push(item.trim())
        continue
      }
      if (item && typeof item === 'object') {
        const label =
          (item as Record<string, unknown>).name ??
          (item as Record<string, unknown>).label ??
          (item as Record<string, unknown>).text
        if (typeof label === 'string' && label.trim()) {
          tags.push(label.trim())
        }
      }
    }
  }

  return tags.filter(
    (tag, index, values) =>
      values.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index,
  )
}

function recommendationAddress(entry: PlannerRecommendationEntry) {
  return entry.matchedPlace?.address_text ?? entry.item.address_text
}

function AddDestinationMenu({
  entry,
  recommendations,
  className,
  align = 'end',
}: {
  entry: PlannerRecommendationEntry
  recommendations: PlannerRecommendationsController
  className?: string
  align?: 'start' | 'center' | 'end'
}) {
  const isAdding = recommendations.addingKey === entry.key

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            'h-8 rounded-[10px] border-black/8 bg-white px-3 text-[0.78rem] shadow-none hover:bg-[var(--color-secondary-surface)]',
            className,
          )}
          disabled={isAdding}
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          {isAdding ? <VoyagerLoader className="h-3.5 w-3.5 " /> : null}
          Add
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-[16rem]">
        <DropdownMenuLabel>Where should this go?</DropdownMenuLabel>
        {recommendations.destinations.map((destination) => (
          <DestinationMenuItem
            key={destination.id}
            destination={destination}
            onSelect={() => {
              void recommendations.addEntryToDestination(entry, destination.id)
            }}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ITINERARY_ACTION_BUTTON_CLASS =
  'h-7.5 w-7.5 rounded-full p-0 text-[var(--color-text-muted)] hover:bg-black/5 hover:text-[var(--color-text)]'

export function CompactCarouselActions() {
  const { index, itemsCount, setIndex } = useCarousel()

  if (itemsCount <= 1) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={ITINERARY_ACTION_BUTTON_CLASS}
        onClick={(e) => {
          e.stopPropagation()
          if (index > 0) {
            setIndex(index - 1)
          }
        }}
        disabled={index === 0}
        aria-label="Previous recommendation"
        title="Previous recommendation"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={ITINERARY_ACTION_BUTTON_CLASS}
        onClick={(e) => {
          e.stopPropagation()
          if (index < itemsCount - 1) {
            setIndex(index + 1)
          }
        }}
        disabled={index + 1 >= itemsCount}
        aria-label="Next recommendation"
        title="Next recommendation"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function CompactRefreshButton({
  recommendations,
  disabled = false,
}: {
  recommendations: PlannerRecommendationsController
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={ITINERARY_ACTION_BUTTON_CLASS}
      onClick={(e) => {
        e.stopPropagation()
        void recommendations.refresh()
      }}
      disabled={disabled || recommendations.isRefreshing}
      aria-label="Refresh recommendations"
      title="Refresh recommendations"
    >
      <RefreshCw className={cn('h-4 w-4', recommendations.isRefreshing && '')} />
    </Button>
  )
}

function DestinationMenuItem({
  destination,
  onSelect,
}: {
  destination: PlannerRecommendationDestination
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-[var(--color-text)]">{destination.shortLabel}</span>
        <span className="text-xs text-[var(--color-text-muted)]">{destination.description}</span>
      </div>
    </DropdownMenuItem>
  )
}

function RecommendationCard({
  entry,
  recommendations,
  selected = false,
  onSelect,
}: {
  entry: PlannerRecommendationEntry
  recommendations: PlannerRecommendationsController
  selected?: boolean
  onSelect?: (entry: PlannerRecommendationEntry) => void
}) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-[22px] border bg-white p-3 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.22)] transition-colors',
        onSelect && 'cursor-pointer',
        selected
          ? 'border-[var(--color-text)]/22 ring-1 ring-[var(--color-text)]/10'
          : 'border-black/8',
      )}
      onClick={() => onSelect?.(entry)}
    >
      <div className="flex gap-3">
        {entry.item.image_url ? (
          <PhotoViewerProvider>
            <PhotoViewer src={entry.item.image_url}>
              <button
                type="button"
                className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] text-left"
                aria-label={`Preview ${entry.item.title}`}
                onClick={(event) => {
                  event.stopPropagation()
                }}
              >
                <img
                  src={entry.item.image_url}
                  alt={entry.item.title}
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
                />
              </button>
            </PhotoViewer>
          </PhotoViewerProvider>
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,rgba(255,140,98,0.14),rgba(114,174,230,0.14))] text-[var(--color-text-muted)]">
            <Sparkles className="h-5 w-5" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 line-clamp-2 text-[0.98rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
              {entry.item.title}
            </h3>
            {entry.item.rating != null ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(250,180,56,0.14)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text)]">
                <Star className="h-3.5 w-3.5 text-[#F59E0B]" />
                {entry.item.rating.toFixed(1)}
              </span>
            ) : null}
          </div>

          {recommendationAddress(entry) ? (
            <p className="mt-2 line-clamp-2 flex items-start gap-2 text-[0.82rem] leading-5 text-[var(--color-text-muted)]">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{recommendationAddress(entry)}</span>
            </p>
          ) : null}

          {entry.item.summary ? (
            <p className="mt-2 line-clamp-2 text-[0.82rem] leading-5 text-[var(--color-text-muted)]">
              {entry.item.summary}
            </p>
          ) : null}

          <div className="mt-3 flex justify-end">
            <AddDestinationMenu
              entry={entry}
              recommendations={recommendations}
              className="min-w-[8rem] justify-between"
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function CompactRecommendationCard({
  entry,
  recommendations,
  selected = false,
  onSelect,
}: {
  entry: PlannerRecommendationEntry
  recommendations: PlannerRecommendationsController
  selected?: boolean
  onSelect?: (entry: PlannerRecommendationEntry) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const entityLabel = entry.item.entity_type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

  const imageVariants = {
    collapsed: { scale: 1, filter: 'blur(0px)' },
    expanded: { scale: 1.03, filter: 'blur(1.5px)' },
  }
  const contentVariants = {
    collapsed: { opacity: 0, y: -6 },
    expanded: { opacity: 1, y: 0 },
  }
  const transition = {
    type: 'spring',
    stiffness: 150,
    damping: 20,
    mass: 0.65,
  } as const

  return (
    <article
      className={cn(
        'relative h-[204px] overflow-hidden rounded-[18px] border bg-white shadow-[0_14px_30px_-26px_rgba(15,23,42,0.18)] transition-colors',
        onSelect && 'cursor-pointer',
        selected
          ? 'border-[var(--color-text)]/24 ring-1 ring-[var(--color-text)]/10'
          : 'border-black/8',
      )}
      onClick={() => onSelect?.(entry)}
    >
      <motion.div
        className="absolute inset-0"
        animate={isOpen ? 'expanded' : 'collapsed'}
        variants={imageVariants}
        transition={transition}
      >
        {entry.item.image_url ? (
          <img
            src={entry.item.image_url}
            alt={entry.item.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(145deg,rgba(255,140,98,0.18),rgba(114,174,230,0.14),rgba(255,255,255,0.82))] text-[var(--color-text-muted)]">
            <Sparkles className="h-6 w-6" />
          </div>
        )}
      </motion.div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_10%,rgba(255,255,255,0.12)_34%,rgba(255,255,255,0.72)_62%,#ffffff_100%)]" />

      <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
        <span className="rounded-full border border-white/70 bg-white/88 px-2 py-1 text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)] backdrop-blur">
          {entry.source === 'discover' ? 'Nearby pick' : 'Recommendation'}
        </span>
        {entry.item.rating != null ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/84 px-2 py-1 text-[0.64rem] font-medium text-[var(--color-text)] backdrop-blur">
            <Star className="h-3 w-3 text-[#F59E0B]" />
            {entry.item.rating.toFixed(1)}
          </span>
        ) : null}
      </div>
      <Disclosure
        open={isOpen}
        onOpenChange={setIsOpen}
        className="absolute inset-x-0 bottom-0 m-2 overflow-hidden rounded-[15px] border border-white/80 bg-white/90 shadow-[0_12px_24px_-20px_rgba(15,23,42,0.2)] backdrop-blur"
        variants={contentVariants}
        transition={transition}
      >
        <DisclosureTrigger>
          <button
            type="button"
            className={cn(
              'w-full px-2.5 py-2 text-left transition-colors',
              isOpen && 'bg-white/32',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <h3
                className={cn(
                  'min-w-0 text-[0.82rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]',
                  isOpen ? 'line-clamp-2' : 'line-clamp-1',
                )}
              >
                {entry.item.title}
              </h3>
              <ChevronDown
                className={cn(
                  'mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform',
                  isOpen && 'rotate-180',
                )}
              />
            </div>

            {recommendationAddress(entry) ? (
              <p className="mt-1 line-clamp-1 flex items-center gap-1 text-[0.68rem] text-[var(--color-text-muted)]">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{recommendationAddress(entry)}</span>
              </p>
            ) : null}
          </button>
        </DisclosureTrigger>

        <DisclosureContent>
          <div className="px-2.5 pb-2.5 pt-1">
            <p className="line-clamp-2 text-[0.7rem] leading-[1.15rem] text-[var(--color-text-muted)]">
              {entry.item.summary || 'Open this card to add the place to a day or keep it in your inbox.'}
            </p>

            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                {entityLabel}
              </span>
              <AddDestinationMenu
                entry={entry}
                recommendations={recommendations}
                align="start"
                className="min-w-[5.6rem] justify-between"
              />
            </div>
          </div>
        </DisclosureContent>
      </Disclosure>
    </article>
  )
}

function RecommendationSection({
  title,
  description,
  entries,
  recommendations,
  onSelectEntry,
  selectedEntryKey,
}: {
  title: string
  description: string
  entries: PlannerRecommendationEntry[]
  recommendations: PlannerRecommendationsController
  onSelectEntry?: (entry: PlannerRecommendationEntry) => void
  selectedEntryKey?: string | null
}) {
  return (
    <section className="space-y-3">
      <div>
        <div>
          <h3 className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--color-text)]">
            {title}
          </h3>
          <p className="mt-1 text-[0.82rem] text-[var(--color-text-muted)]">{description}</p>
        </div>
      </div>

      {!entries.length ? (
        <div className="rounded-[18px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
          No recommendations are available right now.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <RecommendationCard
              key={entry.key}
              entry={entry}
              recommendations={recommendations}
              selected={selectedEntryKey === entry.key}
              onSelect={onSelectEntry}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export function PlannerRecommendationsCompactSection({
  recommendations,
  maxItems = Infinity,
  onSelectEntry,
  selectedEntryKey,
}: {
  recommendations: PlannerRecommendationsController
  maxItems?: number
  onSelectEntry?: (entry: PlannerRecommendationEntry) => void
  selectedEntryKey?: string | null
}) {
  const visibleEntries = recommendations.discoverEntries.slice(0, maxItems)

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="planner-compact-recommendations"
    >
      {!recommendations.enabled ? (
        <div className="rounded-[18px] border border-dashed border-black/8 px-4 py-5 text-sm text-[var(--color-text-muted)]">
          Turn recommendations back on to see nearby places Voyager can add for you.
        </div>
      ) : recommendations.isLoadingDiscover ? (
        <div className="flex flex-col gap-3">
          <AiLoadingText className="px-1" size="md">
            {RECOMMENDATION_LOADING_COPY}
          </AiLoadingText>
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: Math.min(maxItems, 3) }).map((_, index) => (
              <Skeleton
                key={index}
                className="h-[204px] min-w-[68%] rounded-[18px] sm:min-w-[46%]"
              />
            ))}
          </div>
        </div>
      ) : visibleEntries.length ? (
        <CarouselContent className="mt-0.5 items-stretch">
          {visibleEntries.map((entry) => (
            <CarouselItem
              key={entry.key}
              className="basis-[68%] px-1 sm:basis-[44%] xl:basis-[52%]"
            >
              <CompactRecommendationCard
                entry={entry}
                recommendations={recommendations}
                selected={selectedEntryKey === entry.key}
                onSelect={onSelectEntry}
              />
            </CarouselItem>
          ))}
        </CarouselContent>
      ) : (
        <div className="rounded-[18px] border border-dashed border-black/8 px-4 py-5 text-sm text-[var(--color-text-muted)]">
          No recommendations are available right now.
        </div>
      )}
    </div>
  )
}

export function PlannerRecommendationsPanel({
  recommendations,
  showCloseButton = false,
  onSelectEntry,
  selectedEntryKey,
}: {
  recommendations: PlannerRecommendationsController
  showCloseButton?: boolean
  onSelectEntry?: (entry: PlannerRecommendationEntry) => void
  selectedEntryKey?: string | null
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F3F5F7]" data-testid="planner-recommendations-sheet">
      <div className="border-b border-black/8 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
              Recommendations
            </p>
            <h2 className="mt-2 text-[1.05rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
              Attractions to add
            </h2>
            <p className="mt-1 text-[0.82rem] leading-5 text-[var(--color-text-muted)]">
              Compact suggestions for this trip. Add directly to a day or keep them in inbox.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-full border-black/8 bg-white"
              onClick={() => {
                void recommendations.refresh()
              }}
              disabled={recommendations.isRefreshing}
              aria-label="Refresh recommendations"
              title="Refresh recommendations"
            >
              <RefreshCw className={cn('h-4 w-4', recommendations.isRefreshing && '')} />
            </Button>
            {showCloseButton ? (
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full border-black/8 bg-white"
                  aria-label="Close recommendations"
                  title="Close recommendations"
                >
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {recommendations.isLoadingDiscover ? (
          <div className="flex flex-col gap-3">
            <AiLoadingText size="md">{RECOMMENDATION_LOADING_COPY}</AiLoadingText>
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-[22px]" />
            ))}
          </div>
        ) : (
          <RecommendationSection
            title="Discover"
            description="Fresh attractions that are not already on the planner."
            entries={recommendations.discoverEntries}
            recommendations={recommendations}
            onSelectEntry={onSelectEntry}
            selectedEntryKey={selectedEntryKey}
          />
        )}
      </div>
    </div>
  )
}

function RecommendationLinkList({ detail }: { detail: ActivityDiscoveryDetail | undefined }) {
  const links = [
    ...(detail?.booking_links ?? []),
    ...(detail?.detail_url
      ? [{ label: 'Provider page', url: detail.detail_url }]
      : []),
  ]

  if (!links.length) {
    return (
      <p className="rounded-[18px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
        No provider links are available yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <a
          key={`${link.label}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-[18px] border border-black/8 bg-white px-4 py-3 text-sm text-[var(--color-text)]"
        >
          <span>{link.label}</span>
          <ChevronRight className="h-4 w-4 text-[var(--color-text-muted)]" />
        </a>
      ))}
    </div>
  )
}

export function PlannerRecommendationDetailPanel({
  tripId,
  locale,
  entry,
  recommendations,
  onBack,
  onClose,
}: {
  tripId: string
  locale: string
  entry: PlannerRecommendationEntry
  recommendations: PlannerRecommendationsController
  onBack?: () => void
  onClose?: () => void
}) {
  const [activeTab, setActiveTab] = useState('about')

  useEffect(() => {
    setActiveTab('about')
  }, [entry.key])

  const savedDetailQuery = useSavedActivityDetail(entry.item.snapshot_id, locale)
  const discoveredDetailQuery = useDiscoveredActivityDetail(
    tripId,
    entry.item.snapshot_id
      ? null
      : {
          entity_type: entry.item.entity_type,
          provider: entry.item.provider,
          provider_ref: entry.item.provider_ref,
          locale,
        },
  )
  const detail = entry.item.snapshot_id
    ? savedDetailQuery.data
    : discoveredDetailQuery.data
  const isLoading =
    entry.item.snapshot_id ? savedDetailQuery.isLoading : discoveredDetailQuery.isLoading
  const tags = useMemo(() => extractTags(detail), [detail])

  if (isLoading) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-5 top-5 z-[2] rounded-full border border-black/8 bg-white/90 p-2 text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-white hover:text-[var(--color-text)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <div className="space-y-4 p-5">
          <Skeleton className="h-10 w-48 rounded-full" />
          <Skeleton className="h-56 w-full rounded-[22px]" />
          <Skeleton className="h-40 w-full rounded-[22px]" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-[2] rounded-full border border-black/8 bg-white/90 p-2 text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-white hover:text-[var(--color-text)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      <div className={cn('shrink-0 border-b border-black/8 bg-white px-5 py-5', onClose && 'pr-16')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {onBack ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-0.5 h-10 w-10 rounded-full border border-black/8 bg-[var(--color-secondary-surface)]"
                onClick={onBack}
                aria-label="Back to recommendations"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : null}

            <div className="min-w-0">
              {detail?.rating != null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(250,180,56,0.14)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text)]">
                  <Star className="h-3.5 w-3.5 text-[#F59E0B]" />
                  <AnimatedNumber
                    value={detail.rating}
                    formatOptions={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
                  />
                  {detail.review_count != null ? (
                    <span className="inline-flex items-baseline gap-0.5">
                      <span aria-hidden="true">·</span>
                      <AnimatedNumber value={detail.review_count} />
                    </span>
                  ) : null}
                </span>
              ) : null}
              <h2 className="mt-3 text-[1.2rem] font-semibold tracking-[-0.03em] text-[var(--color-text)]">
                {detail?.title ?? entry.item.title}
              </h2>
              {detail?.address_text || recommendationAddress(entry) ? (
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
                  {detail?.address_text || recommendationAddress(entry)}
                </p>
              ) : null}
            </div>
          </div>

          {detail?.detail_url ? (
            <a
              href={detail.detail_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/8 bg-[var(--color-secondary-surface)] text-[var(--color-text-muted)]"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 flex h-auto w-full flex-wrap justify-start gap-2 rounded-none border-b border-black/8 bg-white/94 px-4 py-3 backdrop-blur">
          <TabsTrigger value="about" className="h-9 rounded-full px-3.5 text-[0.76rem] font-medium data-[state=active]:bg-[var(--color-text)] data-[state=active]:text-white">
            About
          </TabsTrigger>
          <TabsTrigger value="reserve" className="h-9 rounded-full px-3.5 text-[0.76rem] font-medium data-[state=active]:bg-[var(--color-text)] data-[state=active]:text-white">
            Reserve
          </TabsTrigger>
          <TabsTrigger value="reviews" className="h-9 rounded-full px-3.5 text-[0.76rem] font-medium data-[state=active]:bg-[var(--color-text)] data-[state=active]:text-white">
            Reviews
          </TabsTrigger>
          <TabsTrigger value="photos" className="h-9 rounded-full px-3.5 text-[0.76rem] font-medium data-[state=active]:bg-[var(--color-text)] data-[state=active]:text-white">
            Photos
          </TabsTrigger>
          <TabsTrigger value="links" className="h-9 rounded-full px-3.5 text-[0.76rem] font-medium data-[state=active]:bg-[var(--color-text)] data-[state=active]:text-white">
            Links
          </TabsTrigger>
        </TabsList>

        <div key={activeTab} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="about" className="mt-0 space-y-4">
            {detail?.photos[0]?.image_url || entry.item.image_url ? (
              <PhotoViewerProvider>
                <PhotoViewer src={detail?.photos[0]?.image_url || entry.item.image_url}>
                  <button
                    type="button"
                    className="group relative block w-full overflow-hidden rounded-[22px] text-left"
                    aria-label={`Preview ${detail?.title ?? entry.item.title}`}
                  >
                    <img
                      src={detail?.photos[0]?.image_url || entry.item.image_url || undefined}
                      alt={detail?.title ?? entry.item.title}
                      className="h-56 w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  </button>
                </PhotoViewer>
              </PhotoViewerProvider>
            ) : null}
            <div className="rounded-[22px] border border-black/8 bg-white p-5">
              <p className="text-sm leading-7 text-[var(--color-text)]">
                {detail?.summary || entry.item.summary || 'No provider summary is available yet.'}
              </p>
            </div>
            {entry.rationale ? (
              <div className="rounded-[22px] border border-[rgba(114,174,230,0.18)] bg-[rgba(114,174,230,0.08)] p-5">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  Why it fits
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--color-text)]">{entry.rationale}</p>
              </div>
            ) : null}
            {tags.length ? (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[var(--color-secondary-surface)] px-3 py-1.5 text-[0.76rem] text-[var(--color-text-muted)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </TabsContent>

          <TabsContent value="reserve" className="mt-0">
            <RecommendationLinkList detail={detail} />
          </TabsContent>

          <TabsContent value="reviews" className="mt-0 space-y-3">
            {detail?.reviews.length ? (
              detail.reviews.slice(0, 4).map((review) => (
                <div key={review.review_id} className="rounded-[18px] border border-black/8 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[var(--color-text)]">
                      {review.title || review.reviewer_name || 'Review'}
                    </p>
                    {review.rating != null ? (
                      <span className="rounded-full bg-[var(--color-secondary-surface)] px-2.5 py-1 text-[0.72rem] font-medium text-[var(--color-text-muted)]">
                        {review.rating.toFixed(1)}
                      </span>
                    ) : null}
                  </div>
                  {review.text ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{review.text}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="rounded-[18px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
                No cached reviews are available for this place yet.
              </p>
            )}
          </TabsContent>

          <TabsContent value="photos" className="mt-0">
            {detail?.photos.length ? (
              <PhotoViewerProvider>
                <div className="grid gap-3 sm:grid-cols-2">
                  {detail.photos.map((photo, index) => (
                    <PhotoViewer key={`${photo.image_url}-${index}`} src={photo.image_url}>
                      <button
                        type="button"
                        className="group block overflow-hidden rounded-[18px] border border-black/8 bg-white text-left"
                        aria-label={`Preview ${photo.caption || detail.title}`}
                      >
                        <div className="relative overflow-hidden">
                          <img
                            src={photo.image_url}
                            alt={photo.caption || detail.title}
                            className="h-40 w-full object-cover transition-transform group-hover:scale-[1.03]"
                          />
                        </div>
                        {photo.caption ? (
                          <span className="block px-3 py-2 text-xs text-[var(--color-text-muted)]">
                            {photo.caption}
                          </span>
                        ) : null}
                      </button>
                    </PhotoViewer>
                  ))}
                </div>
              </PhotoViewerProvider>
            ) : (
              <p className="rounded-[18px] border border-dashed border-black/8 px-4 py-6 text-sm text-[var(--color-text-muted)]">
                Photos will appear here when provider imagery is available.
              </p>
            )}
          </TabsContent>

          <TabsContent value="links" className="mt-0">
            <RecommendationLinkList detail={detail} />
          </TabsContent>
        </div>
      </Tabs>

      <div className="shrink-0 border-t border-black/8 bg-white px-4 py-4">
        <div className="flex flex-col gap-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
            Add this recommendation
          </p>
          <AddDestinationMenu
            entry={entry}
            recommendations={recommendations}
            className="h-11 w-full justify-between rounded-[14px] border-black/8"
            align="start"
          />
        </div>
      </div>
    </div>
  )
}
