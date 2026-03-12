import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ActivityDetailsDrawer } from './ActivityDetailsDrawer'
import { buildPlannerActivity, buildTripAsset } from '@/test/fixtures/api'
import { server } from '@/test/msw/server'
import { renderWithQueryClient } from '@/test/utils'

describe('ActivityDetailsDrawer', () => {
  it('renders the activity attachments section', async () => {
    const activity = buildPlannerActivity({ id: 'activity-99' })
    const assets = [
      buildTripAsset({
        id: 'asset-activity-1',
        activity_id: activity.id,
        original_filename: 'museum-ticket.pdf',
      }),
    ]

    server.use(
      http.get('http://localhost:8000/trips/:tripId/assets', ({ request }) => {
        const activityId = new URL(request.url).searchParams.get('activity_id')
        const items = assets.filter((item) => item.activity_id === activityId)
        return HttpResponse.json({
          total: items.length,
          items,
        })
      }),
    )

    renderWithQueryClient(
      <ActivityDetailsDrawer
        open
        tripId="trip-1"
        activity={activity}
        dayLabel="Day 1"
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(await screen.findByText('Attachments')).toBeInTheDocument()
  })
})
