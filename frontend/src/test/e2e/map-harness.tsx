import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GoogleMapsProvider } from '@/shared/layouts/google-maps'
import MapWorkspace from '@/widgets/map-workspace'
import '@/app/styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <GoogleMapsProvider>
      <MemoryRouter
        initialEntries={[
          '/app/trips/trip-e2e/map?activityId=activity-e2e&placeId=place-1&returnTo=/app/trips/trip-e2e/plan',
        ]}
      >
        <Routes>
          <Route path="/app/trips/:tripId/map" element={<MapWorkspace tripId="trip-e2e" />} />
          <Route path="/app/trips/:tripId/plan" element={<div data-testid="planner-return">Planner return</div>} />
        </Routes>
      </MemoryRouter>
    </GoogleMapsProvider>
  </QueryClientProvider>,
)
