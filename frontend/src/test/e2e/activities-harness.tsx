import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { GoogleMapsProvider } from '@/shared/layouts/google-maps'
import ActivitiesWorkspace from '@/widgets/activities-workspace'
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
      <MemoryRouter initialEntries={['/app/trips/trip-e2e/activities']}>
        <Routes>
          <Route
            path="/app/trips/:tripId/activities"
            element={<ActivitiesWorkspace tripId="trip-e2e" />}
          />
        </Routes>
      </MemoryRouter>
    </GoogleMapsProvider>
  </QueryClientProvider>,
)
