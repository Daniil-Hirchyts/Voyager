import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShellLayout } from './index'

describe('AppShellLayout', () => {
  it('renders primary and trip navigation and collapses the sidebar through the shadcn provider', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/app/trips/trip-123/activities']}>
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
            <Route path="trips/trip-123/activities" element={<div>Activities Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activities' })).toBeInTheDocument()
    expect(screen.getByText('Activities Workspace')).toBeInTheDocument()
    expect(screen.getByTestId('app-shell-content')).toBeInTheDocument()

    const trigger = screen
      .getAllByRole('button', { name: /toggle sidebar/i })
      .find((button) => button.getAttribute('data-sidebar') === 'trigger') as HTMLButtonElement | undefined

    expect(trigger).toBeDefined()

    await user.click(trigger!)

    expect(screen.getByTestId('app-shell-sidebar').parentElement).toHaveAttribute('data-collapsible', 'offcanvas')
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

  it('locks document scrolling only while the app shell is mounted', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/app/trips']}>
        <Routes>
          <Route
            path="/app"
            element={(
              <AppShellLayout
                userName="Voyager User"
                userEmail="voyager_user@example.com"
                onSignOut={vi.fn()}
              />
            )}
          >
            <Route path="trips" element={<div>Trips Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(document.documentElement).toHaveClass('voyager-app-scroll-lock')
    expect(document.documentElement).toHaveClass('voyager-app-shell')
    expect(document.body).toHaveClass('voyager-app-scroll-lock')
    expect(document.body).toHaveClass('voyager-app-shell')

    unmount()

    expect(document.documentElement).not.toHaveClass('voyager-app-scroll-lock')
    expect(document.documentElement).not.toHaveClass('voyager-app-shell')
    expect(document.body).not.toHaveClass('voyager-app-scroll-lock')
    expect(document.body).not.toHaveClass('voyager-app-shell')
  })

  it('opens the sidebar in a mobile sheet', async () => {
    const user = userEvent.setup()
    const originalInnerWidth = window.innerWidth
    const originalMatchMedia = window.matchMedia

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
      writable: true,
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    render(
      <MemoryRouter initialEntries={['/app/trips']}>
        <Routes>
          <Route
            path="/app"
            element={(
              <AppShellLayout
                userName="Voyager User"
                userEmail="voyager_user@example.com"
                onSignOut={vi.fn()}
              />
            )}
          >
            <Route path="trips" element={<div>Trips Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const trigger = screen
      .getAllByRole('button', { name: /toggle sidebar/i })
      .find((button) => button.getAttribute('data-sidebar') === 'trigger') as HTMLButtonElement | undefined

    expect(trigger).toBeDefined()

    await user.click(trigger!)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
      writable: true,
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    })
  })
})
