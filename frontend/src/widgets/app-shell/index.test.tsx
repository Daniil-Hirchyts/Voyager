import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShellLayout } from './index'

describe('AppShellLayout', () => {
  it('renders primary and trip navigation and collapses the sidebar through the shadcn provider', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/app/trips/trip-123/offers']}>
        <Routes>
          <Route
            path="/app"
            element={(
              <AppShellLayout
                tripId="trip-123"
                userName="Voyager User"
                userEmail="voyager_user@example.com"
                onSignOut={vi.fn()}
              />
            )}
          >
            <Route path="trips/trip-123/offers" element={<div>Offers Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Offers' })).toBeInTheDocument()
    expect(screen.getByText('Offers Workspace')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-content')).toBeInTheDocument()

    const trigger = screen
      .getAllByRole('button', { name: /toggle sidebar/i })
      .find((button) => button.getAttribute('data-sidebar') === 'trigger') as HTMLButtonElement | undefined

    expect(trigger).toBeDefined()

    await user.click(trigger!)

    expect(screen.getByTestId('app-shell-sidebar').parentElement).toHaveAttribute('data-collapsible', 'icon')
  })

  it('opens the user menu and calls sign out', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()

    render(
      <MemoryRouter initialEntries={['/app/trips']}>
        <Routes>
          <Route
            path="/app"
            element={(
              <AppShellLayout
                userName="Voyager User"
                userEmail="voyager_user@example.com"
                onSignOut={onSignOut}
              />
            )}
          >
            <Route path="trips" element={<div>Trips Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /voyager user/i }))
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }))

    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})
