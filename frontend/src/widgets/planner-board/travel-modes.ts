import type { RouteTravelMode } from '@/shared/api/types';

export const ROUTE_TRAVEL_MODE_OPTIONS: Array<{
  value: RouteTravelMode;
  label: string;
  description: string;
}> = [
  {
    value: 'WALK',
    label: 'Walking',
    description: 'Best for dense city days and short connections.',
  },
  {
    value: 'DRIVE',
    label: 'Driving',
    description: 'Use road travel times for road trips and suburban plans.',
  },
  {
    value: 'BICYCLE',
    label: 'Cycling',
    description: 'Estimate routes for bike-first itineraries.',
  },
  {
    value: 'TRANSIT',
    label: 'Transit',
    description: 'Use public transport timings where available.',
  },
];

export function routeTravelModeLabel(mode: RouteTravelMode | null | undefined) {
  return ROUTE_TRAVEL_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'Walking';
}

export function routeTravelModeDescriptor(mode: RouteTravelMode | null | undefined) {
  switch (mode) {
    case 'DRIVE':
      return 'driving';
    case 'BICYCLE':
      return 'cycling';
    case 'TRANSIT':
      return 'transit';
    case 'WALK':
    default:
      return 'walking';
  }
}
