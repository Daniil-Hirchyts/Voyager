export type CuratedDestination = {
  id: string;
  name: string;
  destinationText: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  imageUrl: string;
  teaser: string;
  summary: string;
  highlights: string[];
  bestFor: string;
  weatherLabel: string;
  budgetAmount: number;
  budgetCurrency: string;
  startDate: string;
  endDate: string;
  tripType: string;
  routeTravelMode: 'WALK' | 'DRIVE' | 'TRANSIT' | 'BICYCLE';
  accentFrom: string;
  accentTo: string;
};

export const CURATED_DESTINATIONS: CuratedDestination[] = [
  {
    id: 'kyoto-lantern-week',
    name: 'Kyoto',
    destinationText: 'Kyoto, Japan',
    country: 'Japan',
    region: 'Asia',
    lat: 35.0116,
    lon: 135.7681,
    imageUrl: '/images/trips/kyoto-lantern-week.jpg',
    teaser: 'Lantern alleys, tea counters, and garden mornings stitched into one calm week.',
    summary:
      'A culture-first route built around temple openings, late dinners in Gion, and slower afternoons beside the Kamo River.',
    highlights: ['Fushimi dawn walk', 'Kaiseki dinner night', 'Arashiyama garden loop'],
    bestFor: 'Culture and slow city rituals',
    weatherLabel: 'Mild spring air, 14 to 21 C',
    budgetAmount: 2400,
    budgetCurrency: 'USD',
    startDate: '2026-04-18',
    endDate: '2026-04-24',
    tripType: 'culture',
    routeTravelMode: 'WALK',
    accentFrom: '#83506d',
    accentTo: '#d6a25d',
  },
  {
    id: 'marrakech-riad-edit',
    name: 'Marrakech',
    destinationText: 'Marrakech, Morocco',
    country: 'Morocco',
    region: 'Africa',
    lat: 31.6295,
    lon: -7.9811,
    imageUrl: '/images/trips/marrakech-riad-edit.jpg',
    teaser: 'A warm five-day edit of rooftop dinners, riad courtyards, and market color.',
    summary:
      'Designed for travelers who want texture over checklists, with room for hammam resets, design shops, and one desert-edge day.',
    highlights: ['Majorelle blue stop', 'Medina food crawl', 'Atlas foothill drive'],
    bestFor: 'Design hotels and sensory city breaks',
    weatherLabel: 'Dry sunshine, 19 to 29 C',
    budgetAmount: 1850,
    budgetCurrency: 'USD',
    startDate: '2026-05-14',
    endDate: '2026-05-19',
    tripType: 'city_break',
    routeTravelMode: 'DRIVE',
    accentFrom: '#9b5538',
    accentTo: '#d8aa53',
  },
  {
    id: 'reykjavik-midnight-route',
    name: 'Reykjavik',
    destinationText: 'Reykjavik, Iceland',
    country: 'Iceland',
    region: 'Europe',
    lat: 64.1466,
    lon: -21.9426,
    imageUrl: '/images/trips/reykjavik-midnight-route.jpg',
    teaser:
      'A bright-season route for geothermal swims, black-sand detours, and long golden evenings.',
    summary:
      'This one leans outdoors without feeling rugged, pairing scenic drives with soft-landings in Reykjavik restaurants and design stays.',
    highlights: ['Sky Lagoon reset', 'South Coast loop', 'Late-night harbor dinner'],
    bestFor: 'Landscapes without sacrificing comfort',
    weatherLabel: 'Cool daylight, 8 to 14 C',
    budgetAmount: 3100,
    budgetCurrency: 'USD',
    startDate: '2026-06-09',
    endDate: '2026-06-15',
    tripType: 'outdoors',
    routeTravelMode: 'DRIVE',
    accentFrom: '#295675',
    accentTo: '#88cfee',
  },
  {
    id: 'santorini-blue-hour',
    name: 'Santorini',
    destinationText: 'Santorini, Greece',
    country: 'Greece',
    region: 'Europe',
    lat: 36.3932,
    lon: 25.4615,
    imageUrl: '/images/trips/santorini-blue-hour.jpg',
    teaser:
      'Five days shaped around caldera walks, whitewashed stays, and long lunches over the water.',
    summary:
      'A polished island edit with enough downtime to actually feel the place, not just photograph it.',
    highlights: ['Oia blue-hour walk', 'Catamaran swim day', 'Winery cliff tasting'],
    bestFor: 'Couples and celebratory escapes',
    weatherLabel: 'Sunny and breezy, 23 to 28 C',
    budgetAmount: 2700,
    budgetCurrency: 'USD',
    startDate: '2026-07-03',
    endDate: '2026-07-08',
    tripType: 'leisure',
    routeTravelMode: 'WALK',
    accentFrom: '#316491',
    accentTo: '#f2d8aa',
  },
  {
    id: 'cape-town-peninsula-cut',
    name: 'Cape Town',
    destinationText: 'Cape Town, South Africa',
    country: 'South Africa',
    region: 'Africa',
    lat: -33.9249,
    lon: 18.4241,
    imageUrl: '/images/trips/cape-town-peninsula-cut.jpg',
    teaser: 'Mountain mornings, vineyard lunches, and a coastal route that rewards every turn.',
    summary:
      'An outdoors-heavy week with polished hotel stops, local wine country, and a full peninsula drive built in.',
    highlights: ['Table Mountain lift', 'Cape Peninsula day', 'Stellenbosch tasting stop'],
    bestFor: 'Scenic variety and mixed-pace travel',
    weatherLabel: 'Bright spring, 16 to 24 C',
    budgetAmount: 2550,
    budgetCurrency: 'USD',
    startDate: '2026-10-08',
    endDate: '2026-10-15',
    tripType: 'adventure',
    routeTravelMode: 'DRIVE',
    accentFrom: '#155d58',
    accentTo: '#7dbf78',
  },
  {
    id: 'buenos-aires-late-tables',
    name: 'Buenos Aires',
    destinationText: 'Buenos Aires, Argentina',
    country: 'Argentina',
    region: 'South America',
    lat: -34.6037,
    lon: -58.3816,
    imageUrl: '/images/trips/buenos-aires-late-tables.jpg',
    teaser: 'Late dinners, bookstore afternoons, and neighborhood hops with just enough chaos.',
    summary:
      'For travelers who want a social city break with texture: cafes, dance rooms, old theaters, and easy night energy.',
    highlights: ['San Telmo wander', 'Palermo late table', 'Recoleta and bookstores'],
    bestFor: 'Food-led city weekends with edge',
    weatherLabel: 'Early summer, 20 to 29 C',
    budgetAmount: 2100,
    budgetCurrency: 'USD',
    startDate: '2026-11-06',
    endDate: '2026-11-12',
    tripType: 'city_break',
    routeTravelMode: 'WALK',
    accentFrom: '#2d4a74',
    accentTo: '#f0b470',
  },
];
