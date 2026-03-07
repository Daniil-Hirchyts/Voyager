import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './msw/server'
import { useMapStore } from '@/shared/stores/map.store'
import { useOffersStore } from '@/shared/stores/offers.store'
import { usePlannerStore } from '@/shared/stores/planner.store'
import { useExportsStore } from '@/shared/stores/exports.store'
import { useEventsStore } from '@/shared/stores/events.store'
import { useProposalsStore } from '@/shared/stores/proposals.store'

const initialMapState = useMapStore.getState()
const initialOffersState = useOffersStore.getState()
const initialPlannerState = usePlannerStore.getState()
const initialExportsState = useExportsStore.getState()
const initialEventsState = useEventsStore.getState()
const initialProposalsState = useProposalsStore.getState()

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )

  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    })
  }

  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  }

  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    })
  }

  if (!HTMLElement.prototype.scrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
  }
})

afterEach(() => {
  cleanup()
  server.resetHandlers()
  useMapStore.setState(initialMapState, true)
  useOffersStore.setState(initialOffersState, true)
  usePlannerStore.setState(initialPlannerState, true)
  useExportsStore.setState(initialExportsState, true)
  useEventsStore.setState(initialEventsState, true)
  useProposalsStore.setState(initialProposalsState, true)
})

afterAll(() => {
  server.close()
})
