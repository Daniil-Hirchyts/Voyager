import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { screen, waitFor } from '@testing-library/react'
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
})
