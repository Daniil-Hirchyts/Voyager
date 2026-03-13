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
              <div className="flex h-[100dvh] min-h-0 flex-col bg-white" data-testid="planner-harness-shell">
                <div
                  className="flex h-12 shrink-0 items-center border-b border-black/8 px-4 text-sm font-medium text-[var(--color-text)]"
                  data-testid="planner-harness-header"
                >
                  Planner harness
                </div>
                <div className="flex min-h-0 flex-1 flex-col" data-testid="planner-harness-content">
                  <PlannerBoard tripId="trip-e2e" />
                </div>
              </div>
            )}
          />
        </Routes>
      </MemoryRouter>
    </GoogleMapsProvider>
  </QueryClientProvider>,
)
