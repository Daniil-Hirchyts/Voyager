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
import { GlowEffect } from '@/components/ui/glow-effect';
import { cn } from '@/shared/lib/cn';
import { useSideRailStore, type DayAnchor } from '@/shared/stores/side-rail.store';

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
  'flex size-9 items-center justify-center rounded-[12px] text-[#526072] transition-colors duration-300';
const BTN_RAIL = cn(BTN, 'hover:text-[#1D2430] data-[checked=true]:text-[#1D2430]');
const BTN_ACTIVE = cn(
  BTN_RAIL,
  'text-[var(--color-cta)] data-[checked=true]:text-[var(--color-cta)]',
);
const BTN_STANDALONE = cn(BTN, 'hover:bg-[#ECEEF0] hover:text-[#1D2430]');
const BTN_ASSISTANT = cn(
  BTN,
  'relative rounded-full border border-black/10 bg-white text-[#1D2430] transition-all duration-300 hover:border-black/15 hover:scale-105 active:scale-95',
);
const RAIL_HOVER_TRANSITION = {
  type: 'spring',
  bounce: 0.2,
  duration: 0.3,
} satisfies NonNullable<AnimatedBackgroundProps['transition']>;

function Divider() {
  return <div className="mx-auto my-1 w-6 border-t border-black/[0.08]" />;
}

function RailTooltip({ label, children }: { label: string; children: React.ReactNode }) {
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
        className="rounded-[12px] bg-[#ECEEF0]"
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
            <span className="text-[0.55rem] leading-none font-semibold tracking-[0.06em] text-[#94a3b8] uppercase">
              {monthStr}
            </span>
            <span className="mt-[1px] text-[0.9rem] leading-none font-bold tracking-[-0.02em] text-[#1D2430]">
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
        <div className="size-1.5 rounded-full bg-[#94a3b8] transition-all group-hover:scale-125 group-hover:bg-[#1D2430]" />
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
  const { plannerInstruments, mobilePlannerView, setMobilePlannerView } = useSideRailStore();

  const isPlannerPage = Boolean(planMatch);
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
      className="relative z-[60] flex h-full w-[56px] shrink-0 flex-col items-center border-r border-black/[0.07] bg-white py-3"
      data-testid="app-side-rail"
    >
      {/* Logo */}
      <RailTooltip label="Voyager">
        <Link
          to="/app/trips"
          aria-label="Voyager — go to trips"
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#1a1a1a] text-white transition-opacity hover:opacity-80"
        >
          <VoyagerLogo className="size-[0.95rem] translate-y-[1px]" />
        </Link>
      </RailTooltip>

      <Divider />

      {/* Nav */}
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
          <RailActionLink
            data-id="new-trip"
            tooltip="New trip"
            to="/app/trips/new"
            aria-label="New trip"
            className={newTripMatch ? BTN_ACTIVE : BTN_RAIL}
          >
            <Plus className="size-[1rem]" />
          </RailActionLink>
        </RailAnimatedColumn>
      </nav>

      {/* Planner instruments */}
      {isPlannerPage && plannerInstruments ? (
        <>
          <Divider />
          <div className="relative z-[60] flex flex-col items-center py-1.5">
            <RailTooltip label="Open assistant">
              <div className="relative">
                <GlowEffect
                  colors={['#818cf8', '#38bdf8', '#fb923c']}
                  mode="breathe"
                  blur="medium"
                  duration={4}
                  scale={1.1}
                  className="rounded-full opacity-45"
                />
                <button
                  data-id="planner-assistant"
                  type="button"
                  aria-label="Open planner assistant"
                  onClick={plannerInstruments.onOpenAssistant}
                  className={BTN_ASSISTANT}
                >
                  <Bot className="size-[1.05rem]" />
                </button>
              </div>
            </RailTooltip>
          </div>

          <RailAnimatedColumn>
            <RailActionButton
              data-id="share-trip"
              tooltip="Collaboration & Share"
              type="button"
              aria-label="Share trip"
              onClick={plannerInstruments.onShare}
              className={BTN_RAIL}
            >
              <Share2 className="size-[1rem]" />
            </RailActionButton>
            <RailActionButton
              data-id="trip-settings"
              tooltip="Trip settings"
              type="button"
              aria-label="Trip settings"
              onClick={plannerInstruments.onOpenSettings}
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
                onClick={() =>
                  setMobilePlannerView(mobilePlannerView === 'cards' ? 'map' : 'cards')
                }
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
                  onScrollToDay: plannerInstruments.onScrollToDay,
                })}
              </RailAnimatedColumn>
              <Divider />
              <RailAnimatedColumn>
                <RailActionButton
                  data-id="accommodation"
                  tooltip="Accommodation"
                  type="button"
                  aria-label="Scroll to accommodation"
                  onClick={() => plannerInstruments.onScrollToSection('hotel')}
                  className={BTN_RAIL}
                >
                  <BedDouble className="size-[1rem]" />
                </RailActionButton>
                <RailActionButton
                  data-id="travel"
                  tooltip="Travel"
                  type="button"
                  aria-label="Scroll to travel"
                  onClick={() => plannerInstruments.onScrollToSection('travel')}
                  className={BTN_RAIL}
                >
                  <Plane className="size-[1rem]" />
                </RailActionButton>
              </RailAnimatedColumn>
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
              className={cn(
                BTN_STANDALONE,
                'mt-1.5 overflow-hidden p-0 text-[0.7rem] font-semibold tracking-wide',
              )}
            >
              <Avatar className="size-9 rounded-[12px] border-0 bg-[#ECEEF0]">
                <AvatarImage src={avatarUrl} alt={userName} />
                <AvatarFallback className="rounded-[12px] bg-[#ECEEF0] text-[0.7rem] font-semibold tracking-wide text-[#526072]">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
        </RailTooltip>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={10}
          className="w-56 rounded-[14px] border-black/8 p-1.5"
        >
          <DropdownMenuLabel className="px-2 py-1.5 tracking-normal normal-case">
            <div className="flex flex-col gap-0.5">
              <span className="text-[0.92rem] font-medium text-[var(--color-text)]">
                {userName}
              </span>
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
            onSelect={(e) => {
              e.preventDefault();
              auth.signoutRedirect();
            }}
          >
            <LogOut className="mr-2 size-4" />
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
            'flex min-w-0 flex-1 flex-col overflow-x-hidden overscroll-y-contain',
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
