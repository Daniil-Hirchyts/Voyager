import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { PlannerDay } from '@/shared/api/types';
import { usePlannerStore } from '@/shared/stores/planner.store';
import { useSideRailStore, type DayAnchor } from '@/shared/stores/side-rail.store';
import { PLANNER_MAP_DAY_COLORS } from './planner-map-utils';

type UsePlannerBoardInstrumentsOptions = {
  tripId: string;
  plannerDays: PlannerDay[] | null;
  openRailSectionRef: MutableRefObject<((sectionKey: string) => void) | null>;
  setSettingsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setCollaborationMenuOpen: Dispatch<SetStateAction<boolean>>;
};

export function usePlannerBoardInstruments({
  tripId,
  plannerDays,
  openRailSectionRef,
  setSettingsMenuOpen,
  setCollaborationMenuOpen,
}: UsePlannerBoardInstrumentsOptions) {
  const setPlannerInstruments = useSideRailStore((state) => state.setPlannerInstruments);
  const setAssistantPanelOpen = usePlannerStore((state) => state.setAssistantPanelOpen);

  useEffect(() => {
    const days: DayAnchor[] = [
      { dayId: 'inbox', label: '+', date: '', color: '#94a3b8', isInbox: true },
      ...(plannerDays ?? []).map((day, index) => ({
        dayId: day.id,
        label: String(index + 1),
        date: day.date,
        color:
          PLANNER_MAP_DAY_COLORS[index % PLANNER_MAP_DAY_COLORS.length] ??
          PLANNER_MAP_DAY_COLORS[0],
        isInbox: false,
      })),
    ];

    function scrollIntoView(target: Element | null) {
      const scrollElement = document.querySelector('[data-planner-scroll]');
      if (scrollElement && target) {
        const offset = target.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top;
        scrollElement.scrollTo({
          top: scrollElement.scrollTop + offset - 8,
          behavior: 'smooth',
        });
      }
    }

    function onScrollToDay(dayId: string) {
      const { mobilePlannerView, setMobilePlannerView } = useSideRailStore.getState();
      const wasInMapMode = mobilePlannerView === 'map';
      if (wasInMapMode) {
        setMobilePlannerView('cards');
      }

      const { mapDayAccordionStateByTrip, setMapDayAccordionState } = usePlannerStore.getState();
      const currentAccordionState = mapDayAccordionStateByTrip[tripId] ?? {};
      const delay = wasInMapMode ? 350 : 200;

      if (!currentAccordionState[dayId]) {
        setMapDayAccordionState(tripId, { ...currentAccordionState, [dayId]: true });
        setTimeout(() => scrollIntoView(document.getElementById(`planner-day-${dayId}`)), delay);
        return;
      }

      setTimeout(
        () => scrollIntoView(document.getElementById(`planner-day-${dayId}`)),
        wasInMapMode ? delay : 0,
      );
    }

    const sectionKeyMap: Record<string, string> = { hotel: 'accommodation', travel: 'travel' };

    function onScrollToSection(section: 'itinerary' | 'hotel' | 'travel') {
      const sectionKey = sectionKeyMap[section];
      if (sectionKey) {
        openRailSectionRef.current?.(sectionKey);
        setTimeout(
          () => scrollIntoView(document.querySelector(`[data-planner-section="${section}"]`)),
          200,
        );
        return;
      }

      scrollIntoView(document.querySelector(`[data-planner-section="${section}"]`));
    }

    const { assistantPanelOpenByTrip } = usePlannerStore.getState();
    const isAssistantOpen = assistantPanelOpenByTrip[tripId] ?? false;

    setPlannerInstruments({
      isAssistantOpen,
      onToggleAssistant: () => {
        const { assistantPanelOpenByTrip: currentAssistantState } = usePlannerStore.getState();
        setAssistantPanelOpen(tripId, !(currentAssistantState[tripId] ?? false));
      },
      onCloseAssistant: () => setAssistantPanelOpen(tripId, false),
      onOpenSettings: () => setSettingsMenuOpen(true),
      onShare: () => setCollaborationMenuOpen(true),
      days,
      onScrollToDay,
      onScrollToSection,
    });

    return () => {
      setPlannerInstruments(null);
    };
  }, [
    openRailSectionRef,
    plannerDays,
    setAssistantPanelOpen,
    setCollaborationMenuOpen,
    setPlannerInstruments,
    setSettingsMenuOpen,
    tripId,
  ]);
}
