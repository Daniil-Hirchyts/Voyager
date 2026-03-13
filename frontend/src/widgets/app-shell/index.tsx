import { Link, Outlet, useLocation, useMatch, useParams, useResolvedPath, useSearchParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import Cookies from 'js-cookie'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import {
  type LucideIcon,
  Calendar,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  MoreVertical,
  PlusCircle,
  Settings2,
} from 'lucide-react'
import { useTrips } from '@/entities/trip/queries'
import { SIDEBAR_RECENT_TRIPS_LIMIT, TRIP_LIST_PAGE_SIZE } from '@/entities/trip/constants'
import { useProfile } from '@/entities/user/queries'

import { VoyagerLogo } from './logo'
import { cn } from '@/shared/lib/cn'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import type { Trip } from '@/shared/api/types'
export {
  useAppShellHeaderActions,
  useAppShellHeaderLeadingActions,
  useAppShellHeaderMeta,
  type AppShellOutletContext,
} from './header-context'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

type AppShellLayoutProps = {
  tripId?: string
  userName: string
  userEmail?: string
  onSignOut: () => void
  recentTrips?: Trip[]
  tripsPagination?: {
    currentPage: number
    totalPages: number
    totalItems: number
    startItem: number
    endItem: number
    isFetching: boolean
    onPreviousPage: () => void
    onNextPage: () => void
  }
}

const APP_SCROLL_LOCK_CLASS = 'voyager-app-scroll-lock'
const APP_SHELL_CLASS = 'voyager-app-shell'

function getSectionLabel(pathname: string, tripId?: string) {
  if (pathname === '/app/settings') {
    return 'Settings'
  }

  if (pathname.startsWith('/app/invites/')) {
    return 'Invite'
  }

  if (pathname === '/app/trips') {
    return 'Trips'
  }

  if (pathname === '/app/trips/new') {
    return 'New Trip'
  }

  if (!tripId) {
    return 'Workspace'
  }

  const sections: Array<{ path: string; label: string }> = [
    { path: `/app/trips/${tripId}/plan`, label: 'Planner' },
    { path: `/app/trips/${tripId}/events`, label: 'Events' },
    { path: `/app/trips/${tripId}/proposals`, label: 'Proposals' },
    { path: `/app/trips/${tripId}/audit`, label: 'Audit' },
  ]

  return sections.find((section) => section.path === pathname)?.label ?? 'Trip Workspace'
}

function getInitials(userName: string) {
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return initials || 'V'
}

function getTripShareBadge(trip: Trip) {
  if (trip.current_user_role === 'editor') {
    return {
      label: 'Editor',
      variant: 'accent' as const,
    }
  }

  if (trip.collaborator_count > 0) {
    return {
      label: trip.collaborator_count > 1 ? `Shared ${trip.collaborator_count}` : 'Shared',
      variant: 'outline' as const,
    }
  }

  return null
}

function AppSidebarLink({ to, label, icon: Icon, end = false }: NavItem) {
  const resolvedPath = useResolvedPath(to)
  const match = useMatch({ path: resolvedPath.pathname, end })

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={!!match}
        className={cn(
          'h-8 rounded-[8px] px-2 text-[0.92rem] font-normal text-[#5f6b7a] transition-colors [&>svg]:size-[0.95rem]',
          'hover:bg-transparent hover:text-[var(--color-text)]',
          'data-[active=true]:bg-transparent data-[active=true]:font-medium data-[active=true]:text-[var(--color-text)] data-[active=true]:shadow-none',
        )}
      >
        <Link to={to}>
          <Icon />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function AppRecentTripLink({
  trip,
  isActive,
}: {
  trip: Trip
  isActive: boolean
}) {
  const shareBadge = getTripShareBadge(trip)

  return (
    <SidebarMenuItem>
      <Link
        to={`/app/trips/${trip.id}`}
        className={cn(
          'flex min-h-8 items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[0.84rem] transition-colors',
          'hover:bg-black/3',
          isActive ? 'bg-black/4' : 'bg-transparent',
        )}
      >
        <span className={cn('truncate text-[#5f6b7a]', isActive ? 'font-medium text-[var(--color-text)]' : 'font-normal')}>
          {trip.title}
        </span>
        {shareBadge ? <Badge variant={shareBadge.variant}>{shareBadge.label}</Badge> : null}
      </Link>
    </SidebarMenuItem>
  )
}

function AppShellPagination({
  pagination,
}: {
  pagination: NonNullable<AppShellLayoutProps['tripsPagination']>
}) {
  if (pagination.totalItems === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-[8px] border-black/8 bg-transparent px-2.5 shadow-none"
        onClick={pagination.onPreviousPage}
        disabled={pagination.currentPage <= 1 || pagination.isFetching}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="min-w-[3.5rem] text-center text-[0.78rem] font-medium text-[#5f6b7a]">
        {pagination.currentPage} / {pagination.totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-[8px] border-black/8 bg-transparent px-2.5 shadow-none"
        onClick={pagination.onNextPage}
        disabled={pagination.currentPage >= pagination.totalPages || pagination.isFetching}
        aria-label="Next page"
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

function AppShellUserMenu({
  userName,
  userEmail,
  onSignOut,
}: Pick<AppShellLayoutProps, 'userName' | 'userEmail' | 'onSignOut'>) {
  const { isMobile } = useSidebar()
  const userInitials = getInitials(userName)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={cn(
                'h-auto min-h-0 rounded-[10px] border border-transparent px-1.5 py-1.5 text-[var(--color-text)] transition-colors',
                'hover:bg-transparent hover:shadow-none',
                'data-[state=open]:bg-transparent data-[state=open]:shadow-none',
              )}
            >
              <Avatar className="size-8 rounded-[10px] border border-white/80 bg-white/80 shadow-none">
                <AvatarFallback className="rounded-[10px] text-[0.72rem] font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>

              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate text-[0.92rem] font-medium">{userName}</span>
              </div>

              <MoreVertical className="size-[0.95rem] text-[#7b8794]" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-[14px] border-black/8 p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-none"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={6}
          >
            <DropdownMenuLabel className="px-2 py-2 normal-case tracking-normal text-inherit">
              <div className="flex items-center gap-3">
                <Avatar className="size-9 rounded-[12px] border border-white/80 bg-white/80 shadow-none">
                  <AvatarFallback className="rounded-[12px] text-xs font-medium">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>

                <div className="grid min-w-0 flex-1 gap-0.5 text-left">
                  <span className="truncate text-[0.95rem] font-medium text-[var(--color-text)]">
                    {userName}
                  </span>
                  <span className="truncate text-xs font-normal normal-case tracking-normal text-[#6b7280]">
                    {userEmail || 'Signed in'}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-black/8" />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="rounded-[10px] px-2.5 py-2 font-medium">
                <Link to="/app/settings">
                  <Settings2 />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-[10px] px-2.5 py-2 font-medium"
                onSelect={(event) => {
                  event.preventDefault()
                  onSignOut()
                }}
              >
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function AppShellLayout({
  tripId,
  userName,
  userEmail,
  onSignOut,
  recentTrips = [],
  tripsPagination,
}: AppShellLayoutProps) {
  const location = useLocation()
  const currentSection = getSectionLabel(location.pathname, tripId)
  const [headerLeadingActions, setHeaderLeadingActions] = useState<ReactNode | null>(null)
  const [headerActions, setHeaderActions] = useState<ReactNode | null>(null)
  const [headerMeta, setHeaderMeta] = useState<ReactNode | null>(null)
  const previousPathnameRef = useRef(location.pathname)
  const shouldShowRecentTrips = location.pathname === '/app/trips' && recentTrips.length > 0

  useEffect(() => {
    document.documentElement.classList.add(APP_SCROLL_LOCK_CLASS)
    document.documentElement.classList.add(APP_SHELL_CLASS)
    document.body.classList.add(APP_SCROLL_LOCK_CLASS)
    document.body.classList.add(APP_SHELL_CLASS)

    return () => {
      document.documentElement.classList.remove(APP_SCROLL_LOCK_CLASS)
      document.documentElement.classList.remove(APP_SHELL_CLASS)
      document.body.classList.remove(APP_SCROLL_LOCK_CLASS)
      document.body.classList.remove(APP_SHELL_CLASS)
    }
  }, [])

  useEffect(() => {
    if (previousPathnameRef.current === location.pathname) {
      return
    }

    previousPathnameRef.current = location.pathname
    setHeaderLeadingActions(null)
    setHeaderActions(null)
    setHeaderMeta(null)
  }, [location.pathname])

  const primaryNavItems: NavItem[] = [
    { to: '/app/trips', icon: LayoutGrid, label: 'Trips', end: true },
  ]

  const tripNavItems: NavItem[] = tripId
    ? [
        { to: `/app/trips/${tripId}/plan`, icon: Calendar, label: 'Planner', end: true },
      ]
    : []

  const sidebarState = Cookies.get('sidebar_state')
  const defaultOpen = sidebarState ? sidebarState === 'true' : true

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      className="relative h-dvh overflow-hidden bg-transparent text-[var(--color-text)]"
      style={
        {
          '--sidebar-width': '14.75rem',
          '--sidebar-width-icon': '3.5rem',
        } as CSSProperties
      }
    >
      <Sidebar
        variant="inset"
        collapsible="offcanvas"
        className={cn(
          'border-none bg-transparent md:pr-0',
          '[&>div[data-sidebar=sidebar]]:border-none [&>div[data-sidebar=sidebar]]:bg-transparent',
          '[&>div[data-sidebar=sidebar]]:shadow-none [&>div[data-sidebar=sidebar]]:backdrop-blur-none',
          '[&>div[data-sidebar=sidebar]]:md:rounded-none',
        )}
        data-testid="app-shell-sidebar"
      >
        <SidebarHeader className="gap-2.5 px-1.5 py-1.5">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild className="h-auto min-h-0 rounded-[8px] px-1 py-1 hover:bg-transparent">
                <Link to="/app/trips">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--color-cta)] text-white shadow-none">
                    <VoyagerLogo className="size-[1rem] translate-y-[1px]" />
                  </span>

                  <div className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[0.98rem] font-medium tracking-[-0.01em] text-[var(--color-text)]">
                      Voyager
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="flex items-center gap-1">
            <Button asChild className="h-[2.125rem] flex-1 justify-start rounded-[10px] px-2.5 text-[0.92rem] font-medium shadow-none transition-colors duration-150 hover:bg-[var(--color-cta)] hover:text-white hover:shadow-none active:translate-y-0 [&_svg]:size-[0.95rem]">
              <Link to="/app/trips/new">
                <PlusCircle data-icon="inline-start" />
                Quick Create
              </Link>
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-3 px-1.5 pb-2.5">
          <SidebarGroup className="p-0">
            <SidebarGroupContent className="flex flex-col gap-0.5">
              <SidebarMenu className="gap-0">
                {primaryNavItems.map((item) => (
                  <AppSidebarLink key={item.to} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {shouldShowRecentTrips ? (
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="h-5 px-2 text-[0.69rem] font-medium normal-case tracking-normal text-[#8b94a3]">
                Recent trips
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {recentTrips.map((trip) => (
                    <AppRecentTripLink key={trip.id} trip={trip} isActive={trip.id === tripId} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}

          {tripNavItems.length > 0 ? (
            <SidebarGroup className="p-0">
              <SidebarGroupLabel className="h-5 px-2 text-[0.69rem] font-medium normal-case tracking-normal text-[#8b94a3]">
                Current trip
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0">
                  {tripNavItems.map((item) => (
                    <AppSidebarLink key={item.to} {...item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>

        <SidebarFooter className="px-1.5 pb-1.5 pt-1.5" data-testid="app-shell-sidebar-footer">
          <AppShellUserMenu userName={userName} userEmail={userEmail} onSignOut={onSignOut} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-0 flex-1 overflow-hidden bg-white shadow-none md:peer-data-[variant=inset]:m-2 md:peer-data-[state=collapsed]:peer-data-[variant=inset]:ml-2 md:peer-data-[variant=inset]:rounded-[12px] md:border md:border-black/8">
        <header
          className={cn(
            'relative z-20 flex shrink-0 flex-nowrap items-center justify-between gap-3 border-b border-black/8 bg-transparent px-3.5 md:px-4',
            headerMeta ? 'h-12 md:min-h-[4.25rem] md:py-2.5' : 'h-12 md:min-h-[3.25rem]',
          )}
        >
          <div className="flex min-w-0 max-w-full flex-1 shrink-0 items-center gap-2">
            <SidebarTrigger className="-ml-1 size-7 shrink-0 rounded-[8px] border-none bg-transparent text-[#5f6b7a] shadow-none hover:bg-black/4 hover:text-[var(--color-text)]" />
            <Separator orientation="vertical" className="mx-1.5 hidden h-4 shrink-0 bg-black/8 md:block" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[1rem] font-medium tracking-[-0.01em] text-[var(--color-text)]">
                {currentSection}
              </p>
              {headerMeta ? (
                <div className="mt-0.5 min-w-0 max-w-full overflow-hidden text-[0.8rem] text-[#5f6b7a] line-clamp-1 hidden md:block">
                  {headerMeta}
                </div>
              ) : null}
            </div>
            {headerLeadingActions ? (
              <div
                className={cn(
                  'hidden shrink-0 items-center gap-2 lg:flex',
                  headerMeta && 'md:self-start',
                )}
                data-testid="app-shell-header-leading-actions"
              >
                {headerLeadingActions}
              </div>
            ) : null}
          </div>
          {headerActions || tripsPagination ? (
            <div
              className={cn('flex shrink-0 items-center justify-end gap-2', headerMeta && 'md:self-start')}
              data-testid="app-shell-header-actions"
            >
              {headerActions}
              {tripsPagination ? <AppShellPagination pagination={tripsPagination} /> : null}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain" data-testid="app-shell-content">
          <div className="@container/main flex h-full min-h-0 flex-col">
            <Outlet context={{ setHeaderLeadingActions, setHeaderActions, setHeaderMeta }} />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default function AppShell() {
  const auth = useAuth()
  const { data: profile } = useProfile()
  const { tripId } = useParams()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const isTripsIndex = location.pathname === '/app/trips'
  const requestedPage = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const tripsOffset = (currentPage - 1) * TRIP_LIST_PAGE_SIZE
  const recentTripsQuery = useTrips({ limit: SIDEBAR_RECENT_TRIPS_LIMIT, offset: 0 })
  const pagedTripsQuery = useTrips(
    { limit: TRIP_LIST_PAGE_SIZE, offset: tripsOffset },
    { enabled: isTripsIndex },
  )

  const userName = (auth.user?.profile?.name as string | undefined) || 'Traveler'
  const userEmail =
    (auth.user?.profile?.email as string | undefined) ||
    profile?.keycloak_sub ||
    undefined
  const recentTrips = (recentTripsQuery.data?.items ?? []).filter((trip) => trip.id !== tripId)
  const pagedTrips = pagedTripsQuery.data
  const totalPages = Math.max(1, Math.ceil((pagedTrips?.total ?? 0) / TRIP_LIST_PAGE_SIZE))
  const startItem = pagedTrips?.total ? tripsOffset + 1 : 0
  const endItem = pagedTrips?.total ? Math.min(tripsOffset + TRIP_LIST_PAGE_SIZE, pagedTrips.total) : 0

  const updateTripsPage = (page: number) => {
    const next = new URLSearchParams(searchParams)
    if (page <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(page))
    }
    setSearchParams(next)
  }

  return (
    <AppShellLayout
      tripId={tripId}
      userName={userName}
      userEmail={userEmail}
      onSignOut={() => auth.signoutRedirect()}
      recentTrips={recentTrips}
      tripsPagination={
        isTripsIndex
          ? {
              currentPage,
              totalPages,
              totalItems: pagedTrips?.total ?? 0,
              startItem,
              endItem,
              isFetching: pagedTripsQuery.isFetching,
              onPreviousPage: () => updateTripsPage(Math.max(1, currentPage - 1)),
              onNextPage: () => updateTripsPage(Math.min(totalPages, currentPage + 1)),
            }
          : undefined
      }
    />
  )
}
