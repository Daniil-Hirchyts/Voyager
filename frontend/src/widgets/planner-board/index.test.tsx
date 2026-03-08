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
  it('shows real planner activities and attached offer chips in kanban view', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity()
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })
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

    expect(await screen.findByText(activity.title)).toBeInTheDocument()
    expect(await screen.findByText('Morning arrival flight')).toBeInTheDocument()
    expect(screen.getByText('Generated')).toBeInTheDocument()
  })

  it('renders the calendar view when the query param selects it', async () => {
    const trip = buildTrip()
    const activity = buildPlannerActivity({ title: 'Pantheon morning visit' })
    const day = buildPlannerDay({ activities: [activity] })
    const planner = buildPlannerResponse({ trip, days: [day] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/?view=calendar&date=2026-04-10']}>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Pantheon morning visit')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /calendar/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('supports day and week calendar modes and renders unscheduled activities in the flexible lane', async () => {
    const trip = buildTrip({
      start_date: '2026-04-06',
      end_date: '2026-04-12',
    })
    const scheduled = buildPlannerActivity({
      id: 'planner-activity-scheduled',
      title: 'Pantheon morning visit',
      trip_day_id: 'day-1',
      start_time: '09:30',
      end_time: '11:00',
      duration_min: 90,
    })
    const unscheduled = buildPlannerActivity({
      id: 'planner-activity-unscheduled',
      title: 'Flexible coffee stop',
      trip_day_id: 'day-2',
      start_time: null,
      end_time: null,
      duration_min: 45,
    })
    const dayOne = buildPlannerDay({
      id: 'day-1',
      date: '2026-04-10',
      activities: [scheduled],
    })
    const dayTwo = buildPlannerDay({
      id: 'day-2',
      day_index: 1,
      date: '2026-04-11',
      activities: [unscheduled],
    })
    const planner = buildPlannerResponse({ trip, days: [dayOne, dayTwo] })

    server.use(
      http.get('http://localhost:8000/trips/:tripId/planner', () => HttpResponse.json(planner)),
      http.get('http://localhost:8000/trips/:tripId/offers', () =>
        HttpResponse.json(listResponse([])),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/?view=calendar&date=2026-04-10&calendarView=day']}>
        <PlannerBoard tripId={trip.id} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('CalendarCN-inspired schedule')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^day$/i })).toHaveAttribute('aria-selected', 'true')

    await userEvent.click(screen.getByRole('tab', { name: /^week$/i }))

    expect(screen.getByRole('tab', { name: /^week$/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Flexible coffee stop')).toBeInTheDocument()
    expect(screen.getByText(/April 7 - 13, 2026|April 6 - 12, 2026/i)).toBeInTheDocument()
  })
})
