import type { GooglePlaceCandidate } from '@/shared/api/types'

type RecommendationPlaceSeed = {
  title: string
  addressText: string | null
  destinationText: string | null
  lat: number | null
  lon: number | null
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenize(value: string | null | undefined) {
  const normalized = normalizeText(value)
  return normalized ? normalized.split(/\s+/) : []
}

function tokenOverlapScore(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = new Set(tokenize(right))
  if (!leftTokens.size || !rightTokens.size) {
    return 0
  }

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

function haversineKm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
) {
  const radiusKm = 6371
  const deltaLat = ((latB - latA) * Math.PI) / 180
  const deltaLon = ((lonB - lonA) * Math.PI) / 180
  const aLat = (latA * Math.PI) / 180
  const bLat = (latB * Math.PI) / 180

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(deltaLon / 2) ** 2

  return radiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export function buildRecommendationPlaceQueries(seed: RecommendationPlaceSeed) {
  const candidates = [
    [seed.title, seed.addressText, seed.destinationText],
    [seed.title, seed.destinationText],
    [seed.title],
  ]

  const seen = new Set<string>()
  const queries: string[] = []

  for (const parts of candidates) {
    const query = parts
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(', ')
    if (!query) {
      continue
    }

    const key = query.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    queries.push(query)
  }

  return queries
}

export function selectBestRecommendationPlaceMatch(
  seed: RecommendationPlaceSeed,
  candidates: GooglePlaceCandidate[],
) {
  const normalizedTitle = normalizeText(seed.title)
  const referenceAddress = [seed.addressText, seed.destinationText]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(', ')

  let bestMatch: { candidate: GooglePlaceCandidate; score: number } | null = null

  for (const candidate of candidates) {
    const normalizedCandidateName = normalizeText(candidate.name)
    let score = 0

    if (normalizedTitle && normalizedCandidateName === normalizedTitle) {
      score += 90
    } else if (
      normalizedTitle &&
      normalizedCandidateName &&
      (normalizedCandidateName.includes(normalizedTitle) ||
        normalizedTitle.includes(normalizedCandidateName))
    ) {
      score += 72
    } else {
      score += Math.round(tokenOverlapScore(seed.title, candidate.name) * 60)
    }

    score += Math.round(
      tokenOverlapScore(referenceAddress, candidate.address_text ?? candidate.label) * 28,
    )

    if (
      seed.lat != null &&
      seed.lon != null &&
      candidate.lat != null &&
      candidate.lon != null
    ) {
      const distanceKm = haversineKm(seed.lat, seed.lon, candidate.lat, candidate.lon)
      if (distanceKm <= 0.2) {
        score += 40
      } else if (distanceKm <= 0.6) {
        score += 24
      } else if (distanceKm <= 1.5) {
        score += 10
      } else if (distanceKm >= 5) {
        score -= 24
      }
    }

    if (bestMatch == null || score > bestMatch.score) {
      bestMatch = { candidate, score }
    }
  }

  if (bestMatch == null) {
    return null
  }

  const minimumScore = seed.lat != null && seed.lon != null ? 72 : 84
  return bestMatch.score >= minimumScore ? bestMatch.candidate : null
}
