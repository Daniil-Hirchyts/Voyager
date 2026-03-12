import { useEffect } from 'react'
import { Link, Outlet, useMatch } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import {
  BedDouble,
  Inbox,
  LayoutGrid,
  LogOut,
  Plane,
  Plus,
  Route,
  SlidersHorizontal,
  Sparkles,
  Settings2,
} from 'lucide-react'
import { format } from 'date-fns'
import { useProfile } from '@/entities/user/queries'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/shared/lib/cn'
import { useSideRailStore, type DayAnchor } from '@/shared/stores/side-rail.store'

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'V'
  )
}

/** Single token for every rail button — no bg, same hover, same size & rounding */
const BTN = 'flex h-9 w-9 items-center justify-center rounded-[12px] text-[#526072] transition-colors hover:bg-[#ECEEF0] hover:text-[#1D2430]'
const BTN_ACTIVE = cn(BTN, 'text-[var(--color-cta)]')

function Divider() {
  return <div className="mx-auto my-1 w-6 border-t border-black/[0.08]" />
}

function RailTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-[0.8rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function DayAnchors({
  days,
  onScrollToDay,
}: {
  days: DayAnchor[]
  onScrollToDay: (dayId: string) => void
}) {
  return (
    <div className="flex max-h-[38vh] w-full flex-col items-center overflow-y-auto">
      {days.map((day) => {
        const monthStr = !day.isInbox && day.date ? format(new Date(day.date), 'MMM').toUpperCase() : null
        const dayStr   = !day.isInbox && day.date ? format(new Date(day.date), 'd') : null

        return (
          <RailTooltip key={day.dayId} label={day.isInbox ? 'Inbox' : `Day ${day.label}`}>
            <button
              type="button"
              aria-label={day.isInbox ? 'Inbox' : `Day ${day.label} · ${monthStr} ${dayStr}`}
              onClick={() => onScrollToDay(day.dayId)}
              className={cn(BTN, 'flex-col gap-0')}
            >
              {day.isInbox ? (
                <Inbox className="size-4" />
              ) : (
                <>
                  <span className="text-[0.55rem] font-semibold uppercase leading-none tracking-[0.06em] text-[#94a3b8]">
                    {monthStr}
                  </span>
                  <span className="mt-[1px] text-[0.9rem] font-bold leading-none tracking-[-0.02em] text-[#1D2430]">
                    {dayStr}
                  </span>
                </>
              )}
            </button>
          </RailTooltip>
        )
      })}
    </div>
  )
}

function AppSideRail() {
  const auth = useAuth()
  const { data: profile } = useProfile()
  const planMatch = useMatch('/app/trips/:tripId/plan')
  const tripsExactMatch = useMatch({ path: '/app/trips', end: true })
  const newTripMatch = useMatch('/app/trips/new')
  const { plannerInstruments } = useSideRailStore()

  const isPlannerPage = Boolean(planMatch)
  const userName = (auth.user?.profile?.name as string | undefined) || 'Traveler'
  const userEmail = (auth.user?.profile?.email as string | undefined) || profile?.keycloak_sub || undefined
  const initials = getInitials(userName)

  return (
    <aside
      className="flex h-full w-[56px] shrink-0 flex-col items-center border-r border-black/[0.07] bg-white py-3"
      data-testid="app-side-rail"
    >
      {/* Logo */}
      <RailTooltip label="Voyager">
        <Link
          to="/app/trips"
          aria-label="Voyager — go to trips"
          className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#1a1a1a] text-white transition-opacity hover:opacity-80"
        >
          <VoyagerLogo className="size-[0.95rem] translate-y-[1px]" />
        </Link>
      </RailTooltip>

      <Divider />

      {/* Nav */}
      <nav className="flex flex-col items-center gap-0.5 py-1.5">
        <RailTooltip label="All trips">
          <Link
            to="/app/trips"
            aria-label="All trips"
            className={Boolean(tripsExactMatch) ? BTN_ACTIVE : BTN}
          >
            <LayoutGrid className="size-[1rem]" />
          </Link>
        </RailTooltip>
        <RailTooltip label="New trip">
          <Link
            to="/app/trips/new"
            aria-label="New trip"
            className={Boolean(newTripMatch) ? BTN_ACTIVE : BTN}
          >
            <Plus className="size-[1rem]" />
          </Link>
        </RailTooltip>
      </nav>

      {/* Planner instruments */}
      {isPlannerPage && plannerInstruments ? (
        <>
          <Divider />
          <div className="flex flex-col items-center gap-0.5 py-1.5">
            <RailTooltip label="Generate itinerary">
              <button type="button" aria-label="Generate itinerary" onClick={plannerInstruments.onGenerate} className={BTN}>
                <Sparkles className="size-[1rem]" />
              </button>
            </RailTooltip>
            <RailTooltip label="Trip settings">
              <button type="button" aria-label="Trip settings" onClick={plannerInstruments.onOpenSettings} className={BTN}>
                <SlidersHorizontal className="size-[1rem]" />
              </button>
            </RailTooltip>
          </div>

          {plannerInstruments.days.length > 0 && (
            <>
              <Divider />
              <div className="flex flex-col items-center gap-0.5 py-1.5">
                <RailTooltip label="Itinerary">
                  <button
                    type="button"
                    aria-label="Scroll to itinerary"
                    onClick={() => plannerInstruments.onScrollToSection('itinerary')}
                    className={BTN}
                  >
                    <Route className="size-[1rem]" />
                  </button>
                </RailTooltip>
                <DayAnchors
                  days={plannerInstruments.days}
                  onScrollToDay={plannerInstruments.onScrollToDay}
                />
              </div>
              <Divider />
              <div className="flex flex-col items-center gap-0.5 py-1.5">
                <RailTooltip label="Accommodation">
                  <button
                    type="button"
                    aria-label="Scroll to accommodation"
                    onClick={() => plannerInstruments.onScrollToSection('hotel')}
                    className={BTN}
                  >
                    <BedDouble className="size-[1rem]" />
                  </button>
                </RailTooltip>
                <RailTooltip label="Travel">
                  <button
                    type="button"
                    aria-label="Scroll to travel"
                    onClick={() => plannerInstruments.onScrollToSection('travel')}
                    className={BTN}
                  >
                    <Plane className="size-[1rem]" />
                  </button>
                </RailTooltip>
              </div>
            </>
          )}
        </>
      ) : null}

      <div className="flex-1" />

      <Divider />

      {/* User */}
      <DropdownMenu>
        <RailTooltip label={userName}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={userName}
              className={cn(BTN, 'mt-1.5 text-[0.7rem] font-semibold tracking-wide')}
            >
              {initials}
            </button>
          </DropdownMenuTrigger>
        </RailTooltip>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-56 rounded-[14px] border-black/8 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.1)]"
        >
          <DropdownMenuLabel className="px-2 py-1.5 normal-case tracking-normal">
            <div className="flex flex-col gap-0.5">
              <span className="text-[0.92rem] font-medium text-[var(--color-text)]">{userName}</span>
              {userEmail && <span className="text-xs font-normal text-[#6b7280]">{userEmail}</span>}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-black/8" />
          <DropdownMenuItem asChild className="rounded-[10px] px-2.5 py-2">
            <Link to="/app/settings">
              <Settings2 className="mr-2 size-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="rounded-[10px] px-2.5 py-2"
            onSelect={(e) => { e.preventDefault(); auth.signoutRedirect() }}
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  )
}

export function AppLayout() {
  useEffect(() => {
    document.documentElement.classList.add('voyager-app-shell')
    document.body.classList.add('voyager-app-shell')
    return () => {
      document.documentElement.classList.remove('voyager-app-shell')
      document.body.classList.remove('voyager-app-shell')
    }
  }, [])

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-hidden">
        <AppSideRail />
        <main
          className="flex flex-1 min-w-0 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain"
          data-testid="app-layout-content"
        >
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  )
}
