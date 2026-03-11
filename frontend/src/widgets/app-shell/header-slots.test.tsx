import { render, screen, within } from '@testing-library/react'
import { useMemo } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShellLayout, useAppShellHeaderActions, useAppShellHeaderLeadingActions } from './index'

function HeaderSlotProbe() {
  const leadingAction = useMemo(() => <button type="button">Recommendations</button>, [])
  const trailingAction = useMemo(() => <button type="button">Board</button>, [])

  useAppShellHeaderLeadingActions(leadingAction)
  useAppShellHeaderActions(trailingAction)

  return <div>Planner probe</div>
}

describe('App shell header slots', () => {
  it('renders leading header actions separately from trailing header actions', async () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
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
            <Route index element={<HeaderSlotProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const leadingSlot = await screen.findByTestId('app-shell-header-leading-actions')
    expect(within(leadingSlot).getByRole('button', { name: 'Recommendations' })).toBeInTheDocument()

    const trailingSlot = screen.getByTestId('app-shell-header-actions')
    expect(within(trailingSlot).getByRole('button', { name: 'Board' })).toBeInTheDocument()
    expect(
      within(trailingSlot).queryByRole('button', { name: 'Recommendations' }),
    ).not.toBeInTheDocument()
  })
})
