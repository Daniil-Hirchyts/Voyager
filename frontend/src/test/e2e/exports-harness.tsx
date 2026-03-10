import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import ExportsWorkspace from '@/widgets/exports-workspace'

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })

export function ExportsHarness() {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/trips/trip-e2e/exports']}>
        <Routes>
          <Route
            path="/app/trips/:tripId/exports"
            element={<ExportsWorkspace tripId="trip-e2e" />}
          />
        </Routes>
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>
  )
}

