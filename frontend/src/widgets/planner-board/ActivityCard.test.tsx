import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { buildPlannerActivity } from '@/test/fixtures/api'
import { ActivityCardView } from './ActivityCard'

describe('ActivityCardView', () => {
  it('renders a non-interactive drag handle placeholder for drag previews', () => {
    render(
      <ActivityCardView
        activity={buildPlannerActivity()}
        showDragHandle
      />,
    )

    expect(screen.getByTestId('activity-card-drag-handle').tagName).toBe('SPAN')
    expect(
      screen.queryByRole('button', { name: 'Drag activity' }),
    ).not.toBeInTheDocument()
  })

  it('renders the interactive drag handle for sortable cards', () => {
    render(
      <ActivityCardView
        activity={buildPlannerActivity()}
        dragHandleProps={{}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Drag activity' })).toBeInTheDocument()
  })
})
