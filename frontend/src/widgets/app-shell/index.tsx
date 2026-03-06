import { Outlet, Link, useParams, NavLink } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useUIStore } from '@/shared/stores/ui.store'
import { useProfile } from '@/entities/user/queries'
import { config } from '@/app/config'
import {
  Map,
  Calendar,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
  Plus,
  Compass,
  Ticket,
} from 'lucide-react'
import { cn } from '@/shared/lib/cn'

export default function AppShell() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const auth = useAuth()
  const { data: profile } = useProfile()
  const { tripId } = useParams()

  const navItems = [{ to: '/app/trips', icon: LayoutGrid, label: 'Trips' }]

  const tripNavItems = tripId
    ? [
        { to: `/app/trips/${tripId}`, icon: Compass, label: 'Overview', hidden: false },
        { to: `/app/trips/${tripId}/plan`, icon: Calendar, label: 'Planner', hidden: false },
        { to: `/app/trips/${tripId}/map`, icon: Map, label: 'Map', hidden: !config.features.mapUI },
        { to: `/app/trips/${tripId}/offers`, icon: Ticket, label: 'Offers', hidden: !config.features.offersUI },
      ].filter((item) => !item.hidden)
    : []

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col shrink-0 border-r transition-all duration-300',
          sidebarCollapsed ? 'w-16' : 'w-60',
        )}
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        {/* Logo */}
        <div
          className="flex items-center justify-between px-4 py-4 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          {!sidebarCollapsed && (
            <Link to="/" className="font-display text-xl text-[#2F6F73] tracking-tight">
              Voyager
            </Link>
          )}
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-lg hover:bg-[#F4EBDD] transition-colors ml-auto"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4 text-[#526072]" />
            ) : (
              <ChevronLeft className="w-4 h-4 text-[#526072]" />
            )}
          </button>
        </div>

        {/* New Trip button */}
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <Link
            to="/app/trips/new"
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-[10px] bg-[#2F6F73] text-white text-sm font-medium hover:bg-[#266063] transition-colors',
              sidebarCollapsed && 'justify-center px-2',
            )}
          >
            <Plus className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && 'New Trip'}
          </Link>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm transition-colors',
                  isActive
                    ? 'bg-[#2F6F73]/10 text-[#2F6F73] font-medium'
                    : 'text-[#526072] hover:bg-[#F4EBDD] hover:text-[#1D2430]',
                  sidebarCollapsed && 'justify-center px-2',
                )
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && item.label}
            </NavLink>
          ))}

          {/* Trip-scoped nav */}
          {tripNavItems.length > 0 && (
            <>
              {!sidebarCollapsed && (
                <p className="px-3 pt-4 pb-1 text-xs font-medium text-[#526072] uppercase tracking-wider">
                  Current Trip
                </p>
              )}
              {tripNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    cn(
                  'flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm transition-colors',
                      isActive
                        ? 'bg-[#2F6F73]/10 text-[#2F6F73] font-medium'
                        : 'text-[#526072] hover:bg-[#F4EBDD] hover:text-[#1D2430]',
                      sidebarCollapsed && 'justify-center px-2',
                    )
                  }
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* User menu */}
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <div className={cn('flex items-center gap-2.5', sidebarCollapsed && 'justify-center')}>
            <div className="w-8 h-8 rounded-full bg-[#2F6F73]/20 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-[#2F6F73]" />
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1D2430] truncate">
                  {(auth.user?.profile?.name as string | undefined) || 'Traveler'}
                </p>
                <p className="text-xs text-[#526072] truncate">
                  {(auth.user?.profile?.email as string | undefined) || profile?.keycloak_sub}
                </p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              onClick={() => auth.signoutRedirect()}
              className="mt-2 flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[#526072] hover:text-[#1D2430] hover:bg-[#F4EBDD] rounded-[10px] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
