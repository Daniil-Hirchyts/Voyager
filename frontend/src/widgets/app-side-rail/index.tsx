import { useEffect } from 'react'
import { Link, Outlet, useMatch } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { LayoutGrid, LogOut, Plus, Settings2 } from 'lucide-react'
import { useProfile } from '@/entities/user/queries'
import { VoyagerLogo } from '@/widgets/app-shell/logo'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { useSideRailStore } from '@/shared/stores/side-rail.store'

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

const ICON_BTN =
  'flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors text-[#64748b] hover:bg-black/5 hover:text-[var(--color-text)]'

const ICON_BTN_ACTIVE =
  'flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors bg-[rgba(47,111,115,0.1)] text-[var(--color-cta)]'

function RailLink({
  to,
  label,
  isActive,
  children,
}: {
  to: string
  label: string
  isActive?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={to} aria-label={label} className={isActive ? ICON_BTN_ACTIVE : ICON_BTN}>
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="text-[0.8rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function RailButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={cn(ICON_BTN, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="text-[0.8rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

function Divider() {
  return <div className="mx-auto w-6 border-t border-black/[0.07]" />
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
  const userEmail =
    (auth.user?.profile?.email as string | undefined) || profile?.keycloak_sub || undefined
  const initials = getInitials(userName)

  return (
    <aside
      className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-black/[0.07] bg-white py-2"
      data-testid="app-side-rail"
    >
      {/* Brand */}
      <div className="flex flex-col items-center pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to="/app/trips"
              aria-label="Voyager — go to trips"
              className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--color-cta)] text-white transition-opacity hover:opacity-85"
            >
              <VoyagerLogo className="size-[1rem] translate-y-[1px]" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6} className="text-[0.8rem]">
            Voyager
          </TooltipContent>
        </Tooltip>
      </div>

      <Divider />

      {/* Primary nav */}
      <nav className="flex flex-col items-center gap-1 py-2">
        <RailLink to="/app/trips" label="All trips" isActive={Boolean(tripsExactMatch)}>
          <LayoutGrid className="size-[1.05rem]" />
        </RailLink>
        <RailLink to="/app/trips/new" label="New trip" isActive={Boolean(newTripMatch)}>
          <Plus className="size-[1.05rem]" />
        </RailLink>
      </nav>

      {/* Planner instruments — only on the plan page when registered */}
      {isPlannerPage && plannerInstruments ? (
        <>
          <Divider />
          <div className="flex flex-col items-center gap-1 py-2">
            <RailButton label="Trip settings" onClick={plannerInstruments.onOpenSettings}>
              <Settings2 className="size-[1.05rem]" />
            </RailButton>
          </div>
        </>
      ) : null}

      {/* Spacer */}
      <div className="flex-1" />

      <Divider />

      {/* User menu */}
      <div className="flex flex-col items-center pt-2">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={userName}
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors hover:bg-black/5"
                >
                  <Avatar className="size-7 rounded-[8px] border border-black/10">
                    <AvatarFallback className="rounded-[8px] bg-[rgba(47,111,115,0.12)] text-[0.6rem] font-semibold text-[var(--color-cta)]">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6} className="text-[0.8rem]">
              {userName}
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            side="right"
            align="end"
            sideOffset={10}
            className="w-56 rounded-[14px] border-black/8 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.1)]"
          >
            <DropdownMenuLabel className="px-2 py-1.5 normal-case tracking-normal">
              <div className="flex flex-col gap-0.5">
                <span className="text-[0.92rem] font-medium text-[var(--color-text)]">{userName}</span>
                {userEmail ? (
                  <span className="text-xs font-normal text-[#6b7280]">{userEmail}</span>
                ) : null}
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
              onSelect={(e) => {
                e.preventDefault()
                auth.signoutRedirect()
              }}
            >
              <LogOut className="mr-2 size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
    <TooltipProvider delayDuration={400}>
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
