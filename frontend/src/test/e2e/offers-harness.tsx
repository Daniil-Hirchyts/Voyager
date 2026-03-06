import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import OffersWorkspace from '@/widgets/offers-workspace'
import '@/app/styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/app/trips/trip-e2e/offers']}>
      <Routes>
        <Route path="/app/trips/:tripId/offers" element={<OffersWorkspace tripId="trip-e2e" />} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)
