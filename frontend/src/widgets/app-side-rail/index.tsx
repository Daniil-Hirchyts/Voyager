import {
  Children,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
  useEffect,
} from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import {
  BedDouble,
  Inbox,
  LayoutGrid,
  LayoutList,
  LogOut,
  Map,
  Plane,
  Plus,
  Share2,
  SlidersHorizontal,
  Settings2,
  Bot,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  AnimatedBackground,
  type AnimatedBackgroundProps,
} from '@/components/ui/animated-background';
import { useProfile } from '@/entities/user/queries';
import { VoyagerLogo } from '@/widgets/app-shell/logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/shared/lib/cn';
import { useSideRailStore, type DayAnchor } from '@/shared/stores/side-rail.store';
import { usePlannerStore } from '@/shared/stores/planner.store';

function getInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'V'
  );
}

const BTN =
  'flex size-9 items-center justify-center rounded-[12px] text-[var(--color-text-muted)] transition-colors duration-300';
const BTN_RAIL = cn(
  BTN,
  'hover:text-[var(--color-text)] data-[checked=true]:text-[var(--color-text)]',
);
const BTN_ACTIVE = cn(
  BTN_RAIL,
  'text-[var(--color-cta)] data-[checked=true]:text-[var(--color-cta)]',
);
const BTN_STANDALONE = cn(BTN, 'hover:bg-[var(--color-accent)] hover:text-[var(--color-text)]');
const BTN_ASSISTANT = cn(
  BTN,
  'relative rounded-[12px] bg-[var(--color-primary)] text-white transition-all duration-300 hover:bg-[#2A2A2A] active:scale-95',
);
const RAIL_HOVER_TRANSITION = {
  type: 'spring',
  bounce: 0.2,
  duration: 0.3,
} satisfies NonNullable<AnimatedBackgroundProps['transition']>;

function Divider({ className }: { className?: string }) {
  return (
    <div className={cn('mx-auto my-1 w-6 border-t border-[var(--color-border)]', className)} />
  );
}

function RailTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-[0.8rem]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

type RailActionLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  tooltip: string;
};

function RailActionLink({ tooltip, className, children, ...props }: RailActionLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link {...props} className={className}>
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-[0.8rem]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

type RailActionButtonProps = ComponentPropsWithoutRef<'button'> & {
  tooltip: string;
};

function RailActionButton({ tooltip, className, children, ...props }: RailActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button {...props} className={className}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="text-[0.8rem]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function RailAnimatedColumn({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children) as ReactElement[];

  return (
    <div className={cn('flex flex-col items-center gap-0.5 py-1.5', className)}>
      <AnimatedBackground
        className="rounded-[12px] bg-[var(--color-secondary-surface)]"
        transition={RAIL_HOVER_TRANSITION}
        enableHover
      >
        {items as AnimatedBackgroundProps['children']}
      </AnimatedBackground>
    </div>
  );
}

function renderDayAnchors({
  days,
  onScrollToDay,
}: {
  days: DayAnchor[];
  onScrollToDay: (dayId: string) => void;
}) {
  const renderDay = (day: DayAnchor) => {
    const monthStr =
      !day.isInbox && day.date ? format(new Date(day.date), 'MMM').toUpperCase() : null;
    const dayStr = !day.isInbox && day.date ? format(new Date(day.date), 'd') : null;

    return (
      <RailActionButton
        key={day.dayId}
        data-id={day.dayId}
        tooltip={day.isInbox ? 'Inbox' : `Day ${day.label}`}
        type="button"
        aria-label={day.isInbox ? 'Inbox' : `Day ${day.label} · ${monthStr} ${dayStr}`}
        onClick={() => onScrollToDay(day.dayId)}
        className={cn(BTN_RAIL, 'flex-col gap-0')}
      >
        {day.isInbox ? (
          <Inbox className="size-4" />
        ) : (
          <span className="flex flex-col items-center gap-0">
            <span className="text-[0.55rem] leading-none font-semibold tracking-[0.06em] text-[var(--color-text-muted)] uppercase">
              {monthStr}
            </span>
            <span className="mt-[1px] text-[0.9rem] leading-none font-bold tracking-[-0.02em] text-[var(--color-text)]">
              {dayStr}
            </span>
          </span>
        )}
      </RailActionButton>
    );
  };

  if (days.length <= 6) {
    return days.map(renderDay);
  }

  const firstDays = days.slice(0, 3);
  const lastDays = days.slice(-2);
  const middleDays = days.slice(3, -2);

  const middleDay = middleDays[Math.floor(middleDays.length / 2)];

  const result: ReactElement[] = [...firstDays.map(renderDay)];
  if (middleDay) {
    result.push(
      <RailActionButton
        key={`dot-${middleDay.dayId}`}
        data-id={`dot-${middleDay.dayId}`}
        tooltip={middleDay.isInbox ? 'Inbox' : `Day ${middleDay.label}`}
        type="button"
        aria-label={middleDay.isInbox ? 'Inbox' : `Day ${middleDay.label}`}
        onClick={() => onScrollToDay(middleDay.dayId)}
        className={cn(BTN_RAIL, 'group')}
      >
        <div className="size-1.5 rounded-full bg-[var(--color-text-muted)] transition-all group-hover:scale-125 group-hover:bg-[var(--color-text)]" />
      </RailActionButton>,
    );
  }
  result.push(...lastDays.map(renderDay));
  return result;
}

function AppSideRail() {
  const auth = useAuth();
  const { data: profile } = useProfile();
  const planMatch = useMatch('/app/trips/:tripId/plan');
  const tripsExactMatch = useMatch({ path: '/app/trips', end: true });
  const newTripMatch = useMatch('/app/trips/new');
  const anyTripMatch = useMatch('/app/trips/:tripId/*');
  const { plannerInstruments, mobilePlannerView, setMobilePlannerView } = useSideRailStore();

  const isPlannerPage = Boolean(planMatch);
  const tripId = planMatch?.params.tripId || anyTripMatch?.params.tripId;
  const isSpecificTripOpen = Boolean(tripId) && tripId !== 'new';
  const assistantPanelOpenByTrip = usePlannerStore((s) => s.assistantPanelOpenByTrip);
  const isAssistantOpen = tripId ? (assistantPanelOpenByTrip[tripId] ?? false) : false;
  const userName =
    profile?.display_name || (auth.user?.profile?.name as string | undefined) || 'Traveler';
  const userEmail =
    profile?.email ||
    (auth.user?.profile?.email as string | undefined) ||
    profile?.keycloak_sub ||
    undefined;
  const avatarUrl =
    profile?.avatar_thumbnail_url ||
    profile?.avatar_url ||
    (auth.user?.profile?.picture as string | undefined);
  const initials = getInitials(userName);

  return (
    <aside
      className="relative z-30 flex h-full w-[56px] shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-white py-3 lg:z-[60]"
      data-testid="app-side-rail"
    >
      <RailTooltip label="Voyager">
        <Link
          to="/app/trips"
          aria-label="Voyager — go to trips"
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#171717] text-white transition-opacity hover:opacity-80"
        >
          <VoyagerLogo className="size-[0.95rem] translate-y-[1px]" />
        </Link>
      </RailTooltip>

      <Divider />

      <nav>
        <RailAnimatedColumn>
          <RailActionLink
            data-id="all-trips"
            tooltip="All trips"
            to="/app/trips"
            aria-label="All trips"
            className={tripsExactMatch ? BTN_ACTIVE : BTN_RAIL}
          >
            <LayoutGrid className="size-[1rem]" />
          </RailActionLink>
          {!isSpecificTripOpen && (
            <RailActionLink
              data-id="new-trip"
              tooltip="New trip"
              to="/app/trips/new"
              aria-label="New trip"
              className={newTripMatch ? BTN_ACTIVE : BTN_RAIL}
            >
              <Plus className="size-[1rem]" />
            </RailActionLink>
          )}
        </RailAnimatedColumn>
      </nav>

      {isPlannerPage && plannerInstruments ? (
        <>
          <Divider />

          <RailAnimatedColumn>
            <RailActionButton
              data-id="share-trip"
              tooltip="Collaboration & Share"
              type="button"
              aria-label="Share trip"
              onClick={() => {
                plannerInstruments.onCloseAssistant();
                plannerInstruments.onShare();
              }}
              className={BTN_RAIL}
            >
              <Share2 className="size-[1rem]" />
            </RailActionButton>
            <RailActionButton
              data-id="trip-settings"
              tooltip="Trip settings"
              type="button"
              aria-label="Trip settings"
              onClick={() => {
                plannerInstruments.onCloseAssistant();
                plannerInstruments.onOpenSettings();
              }}
              className={BTN_RAIL}
            >
              <SlidersHorizontal className="size-[1rem]" />
            </RailActionButton>
          </RailAnimatedColumn>

          <div className="flex w-full flex-col items-center lg:hidden">
            <Divider />
            <div className="flex flex-col items-center gap-0.5 py-1.5">
              <RailActionButton
                data-id="mobile-view-toggle"
                tooltip={mobilePlannerView === 'cards' ? 'Show map' : 'Show itinerary'}
                type="button"
                aria-label={
                  mobilePlannerView === 'cards' ? 'Switch to map view' : 'Switch to itinerary view'
                }
                onClick={() => {
                  plannerInstruments.onCloseAssistant();
                  setMobilePlannerView(mobilePlannerView === 'cards' ? 'map' : 'cards');
                }}
                className={cn(BTN_RAIL, mobilePlannerView === 'map' && 'text-[var(--color-cta)]')}
              >
                {mobilePlannerView === 'cards' ? (
                  <Map className="size-[1rem]" />
                ) : (
                  <LayoutList className="size-[1rem]" />
                )}
              </RailActionButton>
            </div>
          </div>

          {plannerInstruments.days.length > 0 && (
            <>
              <Divider />
              <RailAnimatedColumn className="max-h-[38vh] w-full overflow-y-auto">
                {renderDayAnchors({
                  days: plannerInstruments.days,
                  onScrollToDay: (dayId) => {
                    plannerInstruments.onCloseAssistant();
                    plannerInstruments.onScrollToDay(dayId);
                  },
                })}
              </RailAnimatedColumn>
              <Divider />
              <RailAnimatedColumn>
                <RailActionButton
                  data-id="accommodation"
                  tooltip="Accommodation"
                  type="button"
                  aria-label="Scroll to accommodation"
                  onClick={() => {
                    plannerInstruments.onCloseAssistant();
                    plannerInstruments.onScrollToSection('hotel');
                  }}
                  className={BTN_RAIL}
                >
                  <BedDouble className="size-[1rem]" />
                </RailActionButton>
                <RailActionButton
                  data-id="travel"
                  tooltip="Travel"
                  type="button"
                  aria-label="Scroll to travel"
                  onClick={() => {
                    plannerInstruments.onCloseAssistant();
                    plannerInstruments.onScrollToSection('travel');
                  }}
                  className={BTN_RAIL}
                >
                  <Plane className="size-[1rem]" />
                </RailActionButton>
              </RailAnimatedColumn>
            </>
          )}
          <Divider />
          <div className="relative z-30 flex flex-col items-center py-1.5">
            <RailTooltip label={isAssistantOpen ? 'Close assistant' : 'Open assistant'}>
              <div className="relative">
                <button
                  data-id="planner-assistant"
                  type="button"
                  aria-label={
                    isAssistantOpen ? 'Close planner assistant' : 'Open planner assistant'
                  }
                  onClick={plannerInstruments.onToggleAssistant}
                  className={cn(BTN_ASSISTANT, isAssistantOpen && 'bg-[#2A2A2A]')}
                >
                  <Bot className="size-[1.05rem]" />
                </button>
              </div>
            </RailTooltip>
          </div>
        </>
      ) : null}

      <div className="flex-1" />

      <Divider />

      <DropdownMenu>
        <RailTooltip label={userName}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={userName}
              className={cn(
                BTN_STANDALONE,
                'mt-1.5 overflow-hidden p-0 text-[0.7rem] font-semibold tracking-wide',
              )}
            >
              <Avatar className="size-9 rounded-[12px] border-0 bg-[var(--color-accent)]">
                <AvatarImage src={avatarUrl} alt={userName} />
                <AvatarFallback className="rounded-[12px] bg-[var(--color-accent)] text-[0.7rem] font-semibold tracking-wide text-[var(--color-text-muted)]">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
        </RailTooltip>

        <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-56">
          <DropdownMenuLabel className="px-3 py-2 tracking-normal normal-case">
            <div className="flex flex-col gap-0.5">
              <span className="text-[0.92rem] font-medium text-[var(--color-text)]">
                {userName}
              </span>
              {userEmail && (
                <span className="text-xs font-normal text-[var(--color-text-muted)]">
                  {userEmail}
                </span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-[var(--color-border)]" />
          <DropdownMenuItem asChild>
            <Link to="/app/settings">
              <Settings2 className="mr-3 size-[1.1rem] opacity-70" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              auth.signoutRedirect();
            }}
          >
            <LogOut className="mr-3 size-[1.1rem] opacity-70" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}

export function AppLayout() {
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.add('voyager-app-shell');
    document.body.classList.add('voyager-app-shell');
    return () => {
      document.documentElement.classList.remove('voyager-app-shell');
      document.body.classList.remove('voyager-app-shell');
    };
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-dvh overflow-hidden">
        <AppSideRail />
        <main
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-x-hidden overscroll-y-contain bg-[#F3F5F7]',
            location.pathname.endsWith('/plan') ? 'overflow-y-hidden' : 'overflow-y-auto',
          )}
          data-testid="app-layout-content"
        >
          <div className="flex h-full min-h-0 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
