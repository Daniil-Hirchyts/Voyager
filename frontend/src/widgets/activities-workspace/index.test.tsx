import { useState, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import ActivitiesWorkspace from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildActivity,
  buildActivityDiscoveryDetail,
  buildActivityDiscoveryItem,
  buildActivityRecommendationItem,
  buildDay,
  buildJob,
  buildProposal,
  buildProposalActivity,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

function renderWorkspace(route = '/app/trips/trip-1/activities') {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/app/trips/:tripId/activities" element={<ActivitiesWorkspace tripId="trip-1" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function ShellHarness() {
  const [actions, setActions] = useState<ReactNode | null>(null)
  const [meta, setMeta] = useState<ReactNode | null>(null)

  return (
    <div>
      <div data-testid="shell-meta">{meta}</div>
      <div data-testid="shell-actions">{actions}</div>
      <Outlet context={{ setHeaderActions: setActions, setHeaderMeta: setMeta }} />
    </div>
  )
}

function renderWorkspaceInShell(route = '/app/trips/trip-1/activities') {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<ShellHarness />}>
          <Route path="/app/trips/:tripId/activities" element={<ActivitiesWorkspace tripId="trip-1" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function mockWorkspaceRequests({
  trip = buildTrip(),
  days = [buildDay()],
  discoveryItems = [buildActivityDiscoveryItem()],
  shortlistItems = [] as ReturnType<typeof buildActivityDiscoveryItem>[],
  proposals = [] as ReturnType<typeof buildProposal>[],
} = {}) {
  server.use(
    http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(trip)),
    http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse(days))),
    http.get('http://localhost:8000/trips/trip-1/activities/discover', () =>
      HttpResponse.json({
        total: discoveryItems.length,
        limit: 12,
        offset: 0,
        page: 1,
        entity_type: 'attraction',
        items: discoveryItems,
      }),
    ),
    http.get('http://localhost:8000/trips/trip-1/activities', () =>
      HttpResponse.json(listResponse(shortlistItems)),
    ),
    http.get('http://localhost:8000/trips/trip-1/proposals', () =>
      HttpResponse.json(listResponse(proposals)),
    ),
    http.get('http://localhost:8000/trips/trip-1/map-layers', () =>
      HttpResponse.json(listResponse([])),
    ),
  )
}

describe('ActivitiesWorkspace', () => {
  it('saves a discovery result into the shortlist and loads saved detail', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const discoveryItem = buildActivityDiscoveryItem()
    const savedItem = buildActivityDiscoveryItem({
      id: 'snapshot-1',
      snapshot_id: 'snapshot-1',
    })
    let shortlist = listResponse<typeof savedItem>([])

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/trip-1/activities/discover', () =>
        HttpResponse.json({
          total: 1,
          limit: 12,
          offset: 0,
          page: 1,
          entity_type: 'attraction',
          items: [discoveryItem],
        }),
      ),
      http.get('http://localhost:8000/trips/trip-1/activities', () => HttpResponse.json(shortlist)),
      http.get('http://localhost:8000/trips/trip-1/map-layers', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.post('http://localhost:8000/trips/trip-1/activities/save', async () => {
        shortlist = listResponse([savedItem])
        return HttpResponse.json(savedItem, { status: 201 })
      }),
      http.get('http://localhost:8000/activities/snapshot-1', () =>
        HttpResponse.json(
          buildActivityDiscoveryDetail({
            id: 'snapshot-1',
            snapshot_id: 'snapshot-1',
          }),
        ),
      ),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([]))),
    )

    renderWorkspace()

    expect(await screen.findAllByText('Louvre Museum')).not.toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: /save to shortlist/i }))

    expect(await screen.findByText('Excellent curation')).toBeInTheDocument()
    expect(await screen.findByText('Shortlist')).toBeInTheDocument()
  })

  it('runs quick-add recommendations and attaches the suggested shortlist item', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const savedItem = buildActivityDiscoveryItem({
      id: 'snapshot-1',
      snapshot_id: 'snapshot-1',
    })
    const recommendation = buildActivityRecommendationItem({
      snapshot_id: 'snapshot-1',
      trip_day_id: day.id,
      item: savedItem,
    })
    let attachBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/trip-1/activities/discover', () =>
        HttpResponse.json({
          total: 1,
          limit: 12,
          offset: 0,
          page: 1,
          entity_type: 'attraction',
          items: [savedItem],
        }),
      ),
      http.get('http://localhost:8000/trips/trip-1/activities', () =>
        HttpResponse.json(listResponse([savedItem])),
      ),
      http.get('http://localhost:8000/trips/trip-1/map-layers', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.get('http://localhost:8000/activities/snapshot-1', () =>
        HttpResponse.json(buildActivityDiscoveryDetail({ id: 'snapshot-1', snapshot_id: 'snapshot-1' })),
      ),
      http.get('http://localhost:8000/trips/trip-1/proposals', () => HttpResponse.json(listResponse([]))),
      http.post('http://localhost:8000/trips/trip-1/activities/recommendations', () =>
        HttpResponse.json({ total: 1, items: [recommendation] }),
      ),
      http.post('http://localhost:8000/trips/trip-1/activities/snapshot-1/attach-day', async ({ request }) => {
        attachBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          buildActivity({
            event_snapshot_id: 'snapshot-1',
            title: savedItem.title,
          }),
        )
      }),
    )

    renderWorkspace('/app/trips/trip-1/activities?ai=quick-add')

    await userEvent.click(screen.getByRole('button', { name: /generate quick-add suggestions/i }))

    expect(await screen.findByText(/high rating, central location/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /add to planner/i }))

    await waitFor(() => {
      expect(attachBody).toEqual({ trip_day_id: day.id })
    })
  })

  it('generates and applies an embedded proposal from the shortlist', async () => {
    const trip = buildTrip()
    const day = buildDay()
    const savedItem = buildActivityDiscoveryItem({
      id: 'snapshot-1',
      snapshot_id: 'snapshot-1',
    })
    const proposal = buildProposal({
      items: [
        buildProposalActivity({
          event_snapshot_id: 'snapshot-1',
          title: 'After-hours museum circuit',
        }),
      ],
    })
    let optimizeBody: Record<string, unknown> | null = null
    let applyCalled = false

    server.use(
      http.get('http://localhost:8000/trips/trip-1', () => HttpResponse.json(trip)),
      http.get('http://localhost:8000/trips/trip-1/days', () => HttpResponse.json(listResponse([day]))),
      http.get('http://localhost:8000/trips/trip-1/activities/discover', () =>
        HttpResponse.json({
          total: 1,
          limit: 12,
          offset: 0,
          page: 1,
          entity_type: 'attraction',
          items: [savedItem],
        }),
      ),
      http.get('http://localhost:8000/trips/trip-1/activities', () =>
        HttpResponse.json(listResponse([savedItem])),
      ),
      http.get('http://localhost:8000/trips/trip-1/map-layers', () =>
        HttpResponse.json(listResponse([])),
      ),
      http.get('http://localhost:8000/activities/snapshot-1', () =>
        HttpResponse.json(buildActivityDiscoveryDetail({ id: 'snapshot-1', snapshot_id: 'snapshot-1' })),
      ),
      http.get('http://localhost:8000/trips/trip-1/proposals', () =>
        HttpResponse.json(listResponse([proposal])),
      ),
      http.post('http://localhost:8000/trips/trip-1/optimize', async ({ request }) => {
        optimizeBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ job_id: 'job-optim-1', status: 'PENDING', poll_url: '/jobs/job-optim-1' }, { status: 202 })
      }),
      http.get('http://localhost:8000/jobs/job-optim-1', () =>
        HttpResponse.json(buildJob({ id: 'job-optim-1', status: 'SUCCEEDED' })),
      ),
      http.post('http://localhost:8000/proposals/proposal-1/apply', () => {
        applyCalled = true
        return HttpResponse.json({
          proposal_id: 'proposal-1',
          trip_id: trip.id,
          status: 'APPLIED',
          version: trip.version + 1,
          applied_day_ids: [day.id],
        })
      }),
    )

    renderWorkspace('/app/trips/trip-1/activities?ai=proposal')

    await userEvent.click(screen.getByRole('button', { name: /generate reviewable proposal/i }))

    await waitFor(() => {
      expect(optimizeBody).toMatchObject({
        activity_snapshot_ids: ['snapshot-1'],
        objective: 'balanced_flow',
      })
    })

    expect(await screen.findByText('After-hours museum circuit')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /apply proposal/i }))

    await waitFor(() => {
      expect(applyCalled).toBe(true)
    })
  })

  it('registers shell header meta and actions when app-shell context is available', async () => {
    const trip = buildTrip({ destination_text: 'Lisbon, Portugal' })
    const day = buildDay()

    mockWorkspaceRequests({
      trip,
      days: [day],
      discoveryItems: [buildActivityDiscoveryItem()],
    })

    renderWorkspaceInShell()

    await waitFor(() => {
      expect(screen.getByTestId('shell-meta')).toHaveTextContent('Lisbon, Portugal')
      expect(screen.getByTestId('shell-meta')).toHaveTextContent('Entire trip')
      expect(screen.getByTestId('shell-meta')).toHaveTextContent('0 saved')
      expect(screen.getByTestId('shell-meta')).toHaveTextContent('1 results')
    })

    const shellActions = screen.getByTestId('shell-actions')
    expect(within(shellActions).getByRole('button', { name: /refresh search/i })).toBeInTheDocument()
    expect(within(shellActions).getByRole('button', { name: /^quick add$/i })).toBeInTheDocument()
    expect(within(shellActions).getByRole('button', { name: /generate proposal/i })).toBeInTheDocument()
    expect(screen.queryByTestId('activities-fallback-actions')).not.toBeInTheDocument()
  })

  it('renders fallback page actions when shell header context is unavailable', async () => {
    mockWorkspaceRequests()

    renderWorkspace()

    const fallbackActions = await screen.findByTestId('activities-fallback-actions')
    expect(within(fallbackActions).getByRole('button', { name: /refresh search/i })).toBeInTheDocument()
    expect(within(fallbackActions).getByRole('button', { name: /^quick add$/i })).toBeInTheDocument()
    expect(within(fallbackActions).getByRole('button', { name: /generate proposal/i })).toBeInTheDocument()
  })
})
