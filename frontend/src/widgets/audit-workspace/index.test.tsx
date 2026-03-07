import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AuditWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import { apiError, buildAuditEntry, listResponse } from '@/test/fixtures/api'

function setup(searchString = '') {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[`/app/trips/trip-1/audit${searchString}`]}>
      <Routes>
        <Route path="/app/trips/:tripId/audit" element={<AuditWorkspace tripId="trip-1" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuditWorkspace', () => {
  it('renders audit entries from the backend', async () => {
    const entries = [
      buildAuditEntry({ id: 'audit-1', entity_type: 'activity', action: 'create' }),
      buildAuditEntry({ id: 'audit-2', entity_type: 'trip', action: 'update' }),
    ]

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () =>
        HttpResponse.json(listResponse(entries)),
      ),
    )

    setup()

    expect(await screen.findByText('activity')).toBeInTheDocument()
    expect(screen.getByText('create')).toBeInTheDocument()
    expect(screen.getByText('trip')).toBeInTheDocument()
    expect(screen.getByText('update')).toBeInTheDocument()
  })

  it('applies entity_type filter to query string', async () => {
    let capturedUrl = ''

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(listResponse([]))
      }),
    )

    setup()
    await screen.findByLabelText(/entity type/i)

    const input = screen.getByLabelText(/entity type/i)
    await userEvent.type(input, 'activity')
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => {
      expect(capturedUrl).toContain('entity_type=activity')
    })
  })

  it('applies action filter to query string', async () => {
    let capturedUrl = ''

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(listResponse([]))
      }),
    )

    setup()
    await screen.findByLabelText(/action/i)

    const input = screen.getByLabelText(/action/i)
    await userEvent.type(input, 'create')
    await userEvent.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => {
      expect(capturedUrl).toContain('action=create')
    })
  })

  it('shows empty state when no audit entries found', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    setup()

    expect(await screen.findByText(/no audit entries found/i)).toBeInTheDocument()
  })

  it('shows empty state filter guidance when filters are active', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    setup('?entity_type=activity')

    expect(await screen.findByText(/adjusting or clearing your filters/i)).toBeInTheDocument()
  })

  it('opens detail drawer on entry click and shows before/after', async () => {
    const entry = buildAuditEntry({
      id: 'audit-1',
      before: { title: 'Old title' },
      after: { title: 'New title' },
    })

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () =>
        HttpResponse.json(listResponse([entry])),
      ),
    )

    setup()

    expect(await screen.findByText('activity')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /activity/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/old title/i)).toBeInTheDocument()
      expect(screen.getByText(/new title/i)).toBeInTheDocument()
    })
  })

  it('closes detail drawer on X click', async () => {
    const entry = buildAuditEntry({ id: 'audit-1' })

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () =>
        HttpResponse.json(listResponse([entry])),
      ),
    )

    setup()
    await screen.findByText('activity')
    await userEvent.click(screen.getByRole('button', { name: /activity/i }))
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: /close detail drawer/i }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('shows error state when audit fetch fails', async () => {
    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', () => {
        const err = apiError(500, 'INTERNAL_ERROR', 'Server exploded')
        return HttpResponse.json(err.body, { status: err.status })
      }),
    )

    setup()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  it('hydrates filters from URL search params on load', async () => {
    let capturedUrl = ''

    server.use(
      http.get('http://localhost:8000/trips/trip-1/audit', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(listResponse([]))
      }),
    )

    setup('?entity_type=trip&action=update')

    await waitFor(() => {
      expect(capturedUrl).toContain('entity_type=trip')
      expect(capturedUrl).toContain('action=update')
    })
  })
})
