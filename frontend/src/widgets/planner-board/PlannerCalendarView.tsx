import { format } from 'date-fns'
import { Clock3, MapPin } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import type { PlannerActivity, PlannerDay } from '@/shared/api/types'
import {
  calculatePositionedActivities,
  toCalendarActivityEvent,
} from './calendar-utils'

const HOURS = Array.from({ length: 17 }, (_, index) => index + 6)
const HOUR_HEIGHT = 72

interface Props {
  days: PlannerDay[]
  selectedActivityId: string | null
  onSelectActivity: (activity: PlannerActivity) => void
}

export function PlannerCalendarView({ days, selectedActivityId, onSelectActivity }: Props) {
  if (!days.length) {
    return (
      <div className="rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-text-muted)]">
        No trip days available for this calendar window.
      </div>
    )
  }

  const gridHeight = HOURS.length * HOUR_HEIGHT

  return (
    <div className="rounded-[28px] border border-[var(--color-border)] bg-[var(--color-surface)]/96 shadow-[0_24px_80px_rgba(14,25,35,0.08)]">
      <div className="overflow-x-auto">
        <div className="min-w-[960px]">
          <div
            className="grid border-b border-[var(--color-border)]"
            style={{ gridTemplateColumns: `84px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="px-4 py-4 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
              Time
            </div>
            {days.map((day) => {
              const unscheduledCount = day.activities.filter((activity) => !activity.start_time).length
              return (
                <div
                  key={day.id}
                  className="border-l border-[var(--color-border)] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                        {format(new Date(day.date), 'EEE')}
                      </p>
                      <p className="text-lg font-semibold text-[var(--color-text)]">
                        {format(new Date(day.date), 'MMM d')}
                      </p>
                    </div>
                    <div className="rounded-full border border-[var(--color-border)] bg-white/70 px-3 py-1 text-xs text-[var(--color-text-muted)]">
                      {day.activities.length} items
                    </div>
                  </div>
                  {unscheduledCount > 0 ? (
                    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                      {unscheduledCount} unscheduled
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div
            className="grid"
            style={{ gridTemplateColumns: `84px repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div className="relative border-r border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(246,240,230,0.72))]">
              {HOURS.map((hour, index) => (
                <div
                  key={hour}
                  className="relative border-b border-dashed border-[var(--color-border)]/70 px-3"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="absolute -top-2 left-3 bg-[var(--color-surface)] px-1 text-[11px] text-[var(--color-text-muted)]">
                    {index === 0 ? format(new Date().setHours(hour, 0, 0, 0), 'ha') : format(new Date().setHours(hour, 0, 0, 0), 'ha')}
                  </span>
                </div>
              ))}
            </div>

            {days.map((day) => {
              const dayDate = new Date(day.date)
              const scheduledEvents = day.activities
                .map((activity) => toCalendarActivityEvent(day.date, activity))
                .filter((event): event is NonNullable<typeof event> => Boolean(event))
              const unscheduledActivities = day.activities.filter((activity) => !activity.start_time)
              const positioned = calculatePositionedActivities(scheduledEvents, dayDate, {
                startHour: 6,
                endHour: 23,
              })

              return (
                <div
                  key={day.id}
                  className="relative border-l border-[var(--color-border)]"
                >
                  <div className="border-b border-[var(--color-border)] bg-[rgba(245,239,228,0.7)] p-3">
                    {unscheduledActivities.length ? (
                      <div className="space-y-2">
                        {unscheduledActivities.map((activity) => (
                          <button
                            key={activity.id}
                            type="button"
                            onClick={() => onSelectActivity(activity)}
                            className={cn(
                              'w-full rounded-[18px] border px-3 py-2 text-left transition-all',
                              selectedActivityId === activity.id
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8 shadow-[0_10px_24px_rgba(47,111,115,0.16)]'
                                : 'border-[var(--color-border)] bg-white/80 hover:border-[var(--color-primary)]/40 hover:bg-white',
                            )}
                          >
                            <p className="text-sm font-medium text-[var(--color-text)]">
                              {activity.title}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                              Anytime
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[18px] border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
                        No unscheduled activities
                      </div>
                    )}
                  </div>

                  <div className="relative" style={{ height: gridHeight }}>
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-dashed border-[var(--color-border)]/70"
                        style={{ height: HOUR_HEIGHT }}
                      />
                    ))}

                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(47,111,115,0.02))]" />

                    {positioned.map((item) => {
                      const photo = item.event.activity.place?.primary_photo
                      return (
                        <button
                          key={item.event.activity.id}
                          type="button"
                          onClick={() => onSelectActivity(item.event.activity)}
                          className={cn(
                            'absolute overflow-hidden rounded-[22px] border text-left shadow-[0_18px_40px_rgba(22,38,54,0.18)] transition-all',
                            selectedActivityId === item.event.activity.id
                              ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/25'
                              : 'border-white/70 hover:-translate-y-0.5',
                          )}
                          style={{
                            top: `${item.top}%`,
                            height: `${Math.max(item.height, 7)}%`,
                            left: `${item.left}%`,
                            width: `${item.width}%`,
                            background:
                              photo?.thumbnail_url || photo?.image_url
                                ? `linear-gradient(180deg, rgba(13,20,28,0.08), rgba(13,20,28,0.8)), url(${photo.thumbnail_url || photo.image_url}) center/cover`
                                : 'linear-gradient(180deg, rgba(243,236,224,0.95), rgba(230,219,201,0.95))',
                          }}
                        >
                          <div className="flex h-full flex-col justify-between p-3">
                            <div>
                              <p
                                className={cn(
                                  'max-w-full text-[11px] uppercase tracking-[0.16em]',
                                  photo ? 'text-white/70' : 'text-[var(--color-text-muted)]',
                                )}
                              >
                                {item.event.activity.source === 'manual' ? 'Manual' : 'Generated'}
                              </p>
                              <p
                                className={cn(
                                  'mt-1 line-clamp-2 text-sm font-semibold',
                                  photo ? 'text-white' : 'text-[var(--color-text)]',
                                )}
                              >
                                {item.event.activity.title}
                              </p>
                            </div>
                            <div
                              className={cn(
                                'space-y-1 text-xs',
                                photo ? 'text-white/80' : 'text-[var(--color-text-muted)]',
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <Clock3 className="h-3.5 w-3.5" />
                                {item.event.activity.start_time}
                                {item.event.activity.duration_min
                                  ? ` · ${item.event.activity.duration_min}m`
                                  : ''}
                              </div>
                              {item.event.activity.place?.name ? (
                                <div className="flex items-center gap-1.5">
                                  <MapPin className="h-3.5 w-3.5" />
                                  <span className="line-clamp-1">
                                    {item.event.activity.place.name}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
