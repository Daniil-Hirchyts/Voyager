import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './msw/server'
import { useMapStore } from '@/shared/stores/map.store'
import { useOffersStore } from '@/shared/stores/offers.store'
import { usePlannerStore } from '@/shared/stores/planner.store'

const initialMapState = useMapStore.getState()
const initialOffersState = useOffersStore.getState()
const initialPlannerState = usePlannerStore.getState()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.stubGlobal('scrollTo', vi.fn())
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  useMapStore.setState(initialMapState, true)
  useOffersStore.setState(initialOffersState, true)
  usePlannerStore.setState(initialPlannerState, true)
})

afterAll(() => {
  server.close()
})
