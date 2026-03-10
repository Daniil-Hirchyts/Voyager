import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import PlannerBoard from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'
import {
  buildOffer,
  buildPlannerActivity,
  buildPlannerDay,
  buildPlannerResponse,
  buildTrip,
  listResponse,
} from '@/test/fixtures/api'

describe('PlannerBoard', () => {
  it('renders inbox activities separately from untimed day activities in kanban view', async () => {
    const trip = buildTrip()
    const inboxActivity = buildPlannerActivity({
      id: 'planner-activity-inbox',
      title: 'Inbox museum shortlist',
      trip_day_id: null,
      start_time: null,
    })
    const untimedDayActivity = buildPlannerActivity({
      id: 'planner-activity-untimed',
      title: 'Flexible coffee stop',
      trip_day_id: 'day-1',
      start_time: null,
      duration_min: 45,
    })
    const day = buildPlannerDay({ activities: [untimedDayActivity] })
    const planner = buildPlannerResponse({ trip, inbox_activities: [inboxActivity], days: [day] })
    const offer = buildOffer({ trip_day_id: day.id, title: 'Morning arrival flight' })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([offer])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(inboxActivity.title)).toBeInTheDocument()
    expect(screen.getByText(untimedDayActivity.title)).toBeInTheDocument()
    expect(screen.queryByText('Untimed')).not.toBeInTheDocument()
    expect(await screen.findByText('Morning arrival flight')).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
  })

  it('renders travel estimates between consecutive day activities', async () => {
    const trip = buildTrip()
    const firstActivity = buildPlannerActivity({
      id: 'activity-a',
      title: 'Old Town Square',
      trip_day_id: 'day-1',
      order_index: 0,
      place_id: 'place-a',
      place: {
        id: 'place-a',
        name: 'Old Town Square',
        category: 'landmark',
        address_text: 'Prague Old Town',
        lat: 50.087,
        lon: 14.4208,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const secondActivity = buildPlannerActivity({
      id: 'activity-b',
      title: 'Charles Bridge',
      trip_day_id: 'day-1',
      order_index: 1,
      place_id: 'place-b',
      place: {
        id: 'place-b',
        name: 'Charles Bridge',
        category: 'landmark',
        address_text: 'Prague 1',
        lat: 50.0865,
        lon: 14.4114,
        photo_count: 0,
        primary_photo: null,
      },
    })
    const day = buildPlannerDay({ id: 'day-1', activities: [firstActivity, secondActivity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText(firstActivity.title)).toBeInTheDocument()
    expect(screen.getByTestId('planner-travel-leg-activity-b')).toHaveTextContent(/min/i)
    expect(screen.getByTestId('planner-travel-leg-activity-b')).toHaveTextContent(/km/i)
    expect(screen.getByTestId('planner-day-travel-summary-day-1')).toHaveTextContent(/km/i)
  })

  it('opens the activity details drawer when a card is clicked', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity({
      id: 'planner-activity-details',
      title: 'Seine riverside walk',
      notes: 'Golden hour is best here.',
    })
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    await userEvent.click(await screen.findByRole('button', { name: activity.title }))

    expect(await screen.findByText('Summary')).toBeInTheDocument()
    expect(screen.getByText(activity.notes!)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
