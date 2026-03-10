import type { DestinationAutocompleteItem } from './api'
import type { PlaceCreateInput } from '@/shared/api/types'

export function isBackendPlaceId(value: string | null | undefined) {
  return Boolean(value && !value.startsWith('photon:'))
}

export function buildPlaceCreateInputFromDestinationSuggestion(
  suggestion: DestinationAutocompleteItem,
): PlaceCreateInput {
  const name = suggestion.name?.trim() || suggestion.label.split(',')[0]?.trim() || suggestion.label

  return {
    source: suggestion.id.startsWith('photon:') ? 'photon' : 'destination',
    external_id: suggestion.id,
    name,
    category: suggestion.country ? 'city' : 'destination',
    address_text: suggestion.label,
    lat: suggestion.lat ?? null,
    lon: suggestion.lon ?? null,
    metadata: {
      country: suggestion.country ?? null,
      region: suggestion.region ?? null,
      autocomplete_id: suggestion.id,
    },
  }
}
