import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = createTestQueryClient()

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>,
    ),
  }
}

export function withQueryClient(ui: ReactNode) {
  const queryClient = createTestQueryClient()

  return {
    queryClient,
    wrapper: (
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    ),
  }
}
