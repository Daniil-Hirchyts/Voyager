import { Link, Outlet, useLocation, useMatch, useParams, useResolvedPath } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import Cookies from 'js-cookie'
import {
  type LucideIcon,
  Calendar,
  Compass,
  Download,
  LayoutGrid,
  LogOut,
  Map,
  Music2,
  Plus,
  ScrollText,
  Sparkles,
  Ticket,
} from 'lucide-react'
import { useProfile } from '@/entities/user/queries'
import { config } from '@/app/config'
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
} from '@/components/ui/sidebar'

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
}

function getSectionLabel(pathname: string, tripId?: string) {
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
    { path: `/app/trips/${tripId}`, label: 'Overview' },
    { path: `/app/trips/${tripId}/plan`, label: 'Planner' },
    { path: `/app/trips/${tripId}/map`, label: 'Map' },
    { path: `/app/trips/${tripId}/offers`, label: 'Offers' },
    { path: `/app/trips/${tripId}/events`, label: 'Events' },
    { path: `/app/trips/${tripId}/proposals`, label: 'Proposals' },
    { path: `/app/trips/${tripId}/exports`, label: 'Exports' },
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

function AppSidebarLink({ to, label, icon: Icon, end = false }: NavItem) {
  const resolvedPath = useResolvedPath(to)
  const match = useMatch({ path: resolvedPath.pathname, end })

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        size="lg"
        isActive={!!match}
        tooltip={label}
        className={cn(
          'h-11 rounded-[16px] border border-transparent px-3 text-[0.92rem] font-medium text-[#435366] transition-all',
          'hover:bg-[#EFE4D4]/50 hover:text-[#18212B]',
          'data-[active=true]:bg-white/40 data-[active=true]:border-white/30 data-[active=true]:shadow-sm data-[active=true]:backdrop-blur-md',
          'data-[active=true]:text-[#173E43]',
          'group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-[16px] group-data-[collapsible=icon]:!p-0',
        )}
      >
        <Link to={to}>
          <Icon />
          <span className="group-data-[collapsible=icon]:hidden">{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppShellLayout({
  tripId,
  userName,
  userEmail,
  onSignOut,
}: AppShellLayoutProps) {
  const location = useLocation()
  const currentSection = getSectionLabel(location.pathname, tripId)
  const userInitials = getInitials(userName)

  const primaryNavItems: NavItem[] = [
    { to: '/app/trips', icon: LayoutGrid, label: 'Trips', end: true },
  ]

  const tripNavItems: NavItem[] = tripId
    ? [
        { to: `/app/trips/${tripId}`, icon: Compass, label: 'Overview', end: true },
        { to: `/app/trips/${tripId}/plan`, icon: Calendar, label: 'Planner', end: true },
        { to: `/app/trips/${tripId}/map`, icon: Map, label: 'Map', end: true },
        { to: `/app/trips/${tripId}/offers`, icon: Ticket, label: 'Offers', end: true },
        { to: `/app/trips/${tripId}/events`, icon: Music2, label: 'Events', end: true },
        { to: `/app/trips/${tripId}/proposals`, icon: Sparkles, label: 'Proposals', end: true },
        { to: `/app/trips/${tripId}/exports`, icon: Download, label: 'Exports', end: true },
        { to: `/app/trips/${tripId}/audit`, icon: ScrollText, label: 'Audit', end: true },
      ].filter((item) => {
        if (item.label === 'Map') return config.features.mapUI
        if (item.label === 'Offers') return config.features.offersUI
        if (item.label === 'Events') return config.features.eventsUI
        if (item.label === 'Proposals') return config.features.proposalsUI
        if (item.label === 'Exports') return config.features.exportsUI
        if (item.label === 'Audit') return config.features.auditUI
        return true
      })
    : []

  const sidebarState = Cookies.get('sidebar_state')
  const defaultOpen = sidebarState ? sidebarState === 'true' : true

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-dvh overflow-hidden bg-transparent">
      <Sidebar
        variant="sidebar"
        collapsible="icon"
        className="border-none bg-transparent [&>div[data-sidebar=sidebar]]:bg-transparent [&>div[data-sidebar=sidebar]]:border-none"
        data-testid="app-shell-sidebar"
      >
        <SidebarHeader className="gap-6 px-4 py-6 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:pt-6">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
            <Link
              to="/"
              className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-[#214F52] text-white shadow-sm"
            >
              <VoyagerLogo className="size-[1.2rem] translate-y-[1px]" />
            </Link>

            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="text-[0.65rem] uppercase tracking-[0.25em] text-[#7A6A58]">
                Voyager
              </p>
              <p className="mt-0.5 font-display text-[1.2rem] font-medium leading-none text-[#20454A]">
                Workspace
              </p>
            </div>
          </div>

          <div className="group-data-[collapsible=icon]:hidden">
            <Button asChild className="h-11 w-full justify-start rounded-[14px] px-4 text-sm font-medium shadow-sm transition-transform active:scale-[0.98]">
              <Link to="/app/trips/new">
                <Plus data-icon="inline-start" className="mr-2 size-4" />
                New Trip
              </Link>
            </Button>
          </div>

          <div className="hidden h-11 w-full items-center justify-center group-data-[collapsible=icon]:flex">
            <Button asChild size="icon" className="size-10 rounded-[12px] shadow-sm transition-transform active:scale-[0.98]">
              <Link to="/app/trips/new" aria-label="New Trip">
                <Plus className="size-4" />
              </Link>
            </Button>
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-4 px-3 py-4">
          <SidebarGroup className="gap-2 p-0">
            <SidebarGroupLabel className="px-3 text-[#7A6A58]">Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-2">
                {primaryNavItems.map((item) => (
                  <AppSidebarLink key={item.to} {...item} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {tripNavItems.length > 0 ? (
            <SidebarGroup className="gap-2 p-0">
              <SidebarGroupLabel className="px-3 text-[#7A6A58]">Current Trip</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-2">
                  {tripNavItems.map((item) => (
                    <AppSidebarLink key={item.to} {...item} />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>

        <SidebarFooter
          className="border-t border-[#D7CCBC]/85 bg-transparent px-3 py-3"
          data-testid="app-shell-sidebar-footer"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-[20px] border border-transparent hover:border-white/30 hover:bg-white/40 px-3 py-3 text-left shadow-none transition-all hover:backdrop-blur-md hover:shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F52]/20',
                  'group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0 group-data-[collapsible=icon]:rounded-[16px]',
                  'group-data-[collapsible=icon]:hover:border-transparent group-data-[collapsible=icon]:hover:bg-transparent group-data-[collapsible=icon]:hover:shadow-none',
                )}
              >
                <Avatar className="size-10 rounded-[16px] border border-[#D7CCBC] bg-white/80">
                  <AvatarFallback className="rounded-[16px] bg-[#E6ECEA] text-xs text-[#214F52]">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                  <p className="truncate text-sm font-semibold text-[#18212B]">{userName}</p>
                  <p className="truncate text-xs text-[#5D6A7B]">{userEmail || 'Signed in'}</p>
                </div>
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent className="w-64 rounded-[18px] p-2" side="right" align="end">
              <DropdownMenuLabel className="px-2 py-2">
                <div className="grid gap-1">
                  <span className="truncate text-sm font-semibold text-[#18212B]">{userName}</span>
                  <span className="truncate text-xs font-normal text-[#5D6A7B]">
                    {userEmail || 'Signed in'}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
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
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="m-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/60 bg-[linear-gradient(180deg,rgba(255,250,242,0.9),rgba(250,244,236,0.85))] shadow-[0_12px_48px_-12px_rgba(33,79,82,0.15)] ring-1 ring-black/5 backdrop-blur-2xl transition-[margin,border-radius] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] md:m-2 md:rounded-3xl group-data-[collapsible=icon]:ml-0 group-[[data-state=collapsed]]:ml-0">
        <header className="relative z-20 flex h-[4.5rem] shrink-0 items-center justify-between gap-4 border-b border-[#E0D3C4]/60 bg-white/40 px-4 backdrop-blur-md md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="relative z-30 size-10 rounded-[14px] border border-white/60 bg-white/50 text-[#47566A] shadow-sm hover:bg-white hover:text-[#18212B]" />
            <Separator orientation="vertical" className="hidden h-8 bg-[#D7CCBC] md:block" />
            <div className="min-w-0">
              <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[#7A6A58]">
                Voyager workspace
              </p>
              <p className="truncate text-sm font-medium text-[#18212B]">{currentSection}</p>
            </div>
          </div>

          <Badge
            variant="outline"
            className="hidden rounded-full border-[#D7CCBC] bg-white/72 px-3 py-1 text-[0.68rem] uppercase tracking-[0.18em] text-[#5D6A7B] md:inline-flex"
          >
            Balanced layout
          </Badge>
        </header>

        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          data-testid="app-shell-content"
        >
          <div className="min-h-full">
            <Outlet />
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

  const userName = (auth.user?.profile?.name as string | undefined) || 'Traveler'
  const userEmail =
    (auth.user?.profile?.email as string | undefined) ||
    profile?.keycloak_sub ||
    undefined

  return (
    <AppShellLayout
      tripId={tripId}
      userName={userName}
      userEmail={userEmail}
      onSignOut={() => auth.signoutRedirect()}
    />
  )
}
