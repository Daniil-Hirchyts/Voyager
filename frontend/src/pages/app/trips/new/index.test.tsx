import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const {
  mockNavigate,
  mockCreateTrip,
  mockCreatePlace,
  mockUseDestinationAutocomplete,
  mockMergeTripCoverPhotoPreference,
  toastSuccess,
  toastError,
  toastInfo,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockCreateTrip: vi.fn(),
  mockCreatePlace: vi.fn(),
  mockUseDestinationAutocomplete: vi.fn(),
  mockMergeTripCoverPhotoPreference: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')

  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('@/entities/trip/api', () => ({
  createTrip: (...args: unknown[]) => mockCreateTrip(...args),
}))

vi.mock('@/entities/place/api', () => ({
  createPlace: (...args: unknown[]) => mockCreatePlace(...args),
}))

vi.mock('@/entities/trip/cover-photo', () => ({
  mergeTripCoverPhotoPreference: (...args: unknown[]) => mockMergeTripCoverPhotoPreference(...args),
}))

vi.mock('@/entities/place/queries', () => ({
  useDestinationAutocomplete: (...args: unknown[]) => mockUseDestinationAutocomplete(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
  },
}))

vi.mock('@/components/ui/date-picker', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
    placeholder,
    invalid,
  }: {
    id?: string
    value?: string
    onChange?: (value: string) => void
    placeholder?: string
    invalid?: boolean
  }) => (
    <input
      id={id}
      aria-label={placeholder}
      data-invalid={invalid ? 'true' : undefined}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

import TripCreatePage from './index'

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TripCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TripCreatePage', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    mockCreateTrip.mockReset()
    mockCreatePlace.mockReset()
    mockUseDestinationAutocomplete.mockReset()
    mockMergeTripCoverPhotoPreference.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    toastInfo.mockReset()
    mockUseDestinationAutocomplete.mockReturnValue({
      data: { items: [] },
      isFetching: false,
    })
  })

  it('shows required field validation before submitting', async () => {
    const user = userEvent.setup()
    mockCreateTrip.mockResolvedValue({ id: 'trip-created' })

    renderPage()

    await user.click(screen.getByRole('button', { name: /^create trip$/i }))

    expect(await screen.findByText('Trip title is required')).toBeInTheDocument()
    expect(screen.getByText('Destination is required')).toBeInTheDocument()
    expect(screen.getByText('Start date is required')).toBeInTheDocument()
    expect(screen.getByText('End date is required')).toBeInTheDocument()
    expect(mockCreateTrip).not.toHaveBeenCalled()
  })

  it('validates that the end date is after the start date', async () => {
    const user = userEvent.setup()
    mockCreateTrip.mockResolvedValue({ id: 'trip-created' })

    renderPage()

    await user.type(screen.getByLabelText(/trip title/i), 'Weekend in Paris')
    await user.type(screen.getByLabelText(/destination/i), 'Paris, France')
    await user.type(screen.getByLabelText(/select start date/i), '2026-04-12')
    await user.type(screen.getByLabelText(/select end date/i), '2026-04-10')
    await user.click(screen.getByRole('button', { name: /^create trip$/i }))

    expect(await screen.findByText('End date must be after start date')).toBeInTheDocument()
    expect(mockCreateTrip).not.toHaveBeenCalled()
  })

  it('shows destination suggestions and fills the field from a selected place', async () => {
    const user = userEvent.setup()

    mockUseDestinationAutocomplete.mockReturnValue({
      data: {
        items: [
          {
            id: 'photon:city:123',
            label: 'Paris, France',
            name: 'Paris',
            country: 'France',
            region: 'Ile-de-France',
            lat: 48.8566,
            lon: 2.3522,
          },
        ],
      },
      isFetching: false,
    })

    renderPage()

    await user.type(screen.getByLabelText(/destination/i), 'Par')

    await user.click(await screen.findByRole('button', { name: /^paris, france$/i }))

    expect(screen.getByLabelText(/destination/i)).toHaveValue('Paris, France')
  })

  it('creates a backend place record for a selected destination before storing the cover photo preference', async () => {
    const user = userEvent.setup()
    mockCreateTrip.mockResolvedValue({ id: 'trip-created' })
    mockCreatePlace.mockResolvedValue({ id: 'place-created' })

    mockUseDestinationAutocomplete.mockReturnValue({
      data: {
        items: [
          {
            id: 'photon:city:123',
            label: 'Paris, France',
            name: 'Paris',
            country: 'France',
            region: 'Ile-de-France',
            lat: 48.8566,
            lon: 2.3522,
          },
        ],
      },
      isFetching: false,
    })

    renderPage()

    await user.type(screen.getByLabelText(/trip title/i), 'Weekend in Paris')
    await user.type(screen.getByLabelText(/destination/i), 'Par')
    await user.click(await screen.findByRole('button', { name: /^paris, france$/i }))
    await user.type(screen.getByLabelText(/select start date/i), '2026-04-12')
    await user.type(screen.getByLabelText(/select end date/i), '2026-04-14')
    await user.click(screen.getByRole('button', { name: /^create trip$/i }))

    await waitFor(() => expect(mockCreatePlace).toHaveBeenCalledTimes(1))

    expect(mockCreatePlace).toHaveBeenCalledWith(
      {
        source: 'photon',
        external_id: 'photon:city:123',
        name: 'Paris',
        category: 'city',
        address_text: 'Paris, France',
        lat: 48.8566,
        lon: 2.3522,
        metadata: {
          country: 'France',
          region: 'Ile-de-France',
          autocomplete_id: 'photon:city:123',
        },
      },
      expect.any(String),
    )

    expect(mockMergeTripCoverPhotoPreference).toHaveBeenCalledWith('trip-created', {
      placeId: 'place-created',
      placeLabel: 'Paris, France',
      photoId: null,
    })
  })

  it('submits the shaped payload for trip creation', async () => {
    const user = userEvent.setup()
    mockCreateTrip.mockResolvedValue({ id: 'trip-created' })

    renderPage()

    await user.type(screen.getByLabelText(/trip title/i), 'Tokyo Adventure 2026')
    await user.type(screen.getByLabelText(/destination/i), 'Tokyo, Japan')
    await user.type(screen.getByLabelText(/select start date/i), '2026-04-10')
    await user.type(screen.getByLabelText(/select end date/i), '2026-04-16')
    await user.type(screen.getByLabelText(/budget/i), '3200')

    await user.click(screen.getByLabelText(/currency/i))
    await user.click(screen.getByRole('option', { name: 'EUR' }))

    await user.click(screen.getByLabelText(/trip type/i))
    await user.click(screen.getByRole('option', { name: 'Adventure' }))

    await user.type(
      screen.getByLabelText(/preferences/i),
      'Good food near museums and walkable neighborhoods',
    )
    await user.click(screen.getByRole('button', { name: /^create trip$/i }))

    await waitFor(() => expect(mockCreateTrip).toHaveBeenCalledTimes(1))

    expect(mockCreateTrip).toHaveBeenCalledWith(
      {
        title: 'Tokyo Adventure 2026',
        destination_text: 'Tokyo, Japan',
        start_date: '2026-04-10',
        end_date: '2026-04-16',
        budget_amount: 3200,
        budget_currency: 'EUR',
        trip_type: 'adventure',
        preferences: ['food', 'museums', 'walkable neighborhoods'],
      },
      expect.any(String),
    )

    expect(mockMergeTripCoverPhotoPreference).toHaveBeenCalledWith('trip-created', {
      placeId: null,
      placeLabel: 'Tokyo, Japan',
      photoId: null,
    })

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/trips/trip-created'))
    expect(toastSuccess).toHaveBeenCalledWith('Trip created successfully')
  })
})
