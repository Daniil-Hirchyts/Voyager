import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GoogleMapsProvider } from '@/shared/layouts/google-maps'
import PlannerBoard from '@/widgets/planner-board'
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
      <MemoryRouter initialEntries={['/app/trips/trip-e2e/plan']}>
        <Routes>
          <Route
            path="/app/trips/:tripId/plan"
            element={(
              <div className="min-h-[100dvh]">
                <PlannerBoard tripId="trip-e2e" />
              </div>
            )}
          />
        </Routes>
      </MemoryRouter>
    </GoogleMapsProvider>
  </QueryClientProvider>,
)
