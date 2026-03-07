import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TripCreatePage from '@/pages/app/trips/new'
import { AppShellLayout } from '@/widgets/app-shell'
import '@/app/styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
})

function TallTripCreatePage() {
  return (
    <div className="min-h-[1600px]">
      <TripCreatePage />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/app/trips/new']}>
      <Routes>
        <Route
          path="/app"
          element={(
            <AppShellLayout
              userName="Voyager User"
              userEmail="voyager_user@example.com"
              onSignOut={() => undefined}
            />
          )}
        >
          <Route path="trips/new" element={<TallTripCreatePage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>,
)
