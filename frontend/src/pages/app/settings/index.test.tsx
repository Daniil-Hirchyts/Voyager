import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'

function buildProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-profile-1',
    keycloak_sub: 'voyager-user',
    email: 'voyager_user@example.com',
    first_name: 'Voyager',
    last_name: 'User',
    display_name: 'Voyager User',
    avatar_url: null,
    avatar_thumbnail_url: null,
    preferences: {},
    created_at: '2026-03-06T09:00:00.000Z',
    updated_at: '2026-03-06T09:00:00.000Z',
    ...overrides,
  }
}

function renderSettingsPage() {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={['/app/settings']}>
      <Routes>
        <Route path="/app/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SettingsPage', () => {
  it('loads and saves voyager preferences through the profile API', async () => {
    const user = userEvent.setup()
    let patchedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/users/profile', () =>
        HttpResponse.json(
          buildProfile({
            preferences: {
              voyager: {
                recommendations: {
                  resultLimit: 8,
                  minRating: 5,
                  audience: 'families',
                },
                map: {
                  showRoutesByDefault: false,
                  showCustomLayersByDefault: true,
                },
              },
            },
          }),
        ),
      ),
      http.patch('http://localhost:8000/users/profile', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          buildProfile({
            preferences: patchedBody?.preferences ?? {},
          }),
        )
      }),
    )

    renderSettingsPage()

    const resultLimit = (await screen.findByDisplayValue('8')) as HTMLInputElement
    fireEvent.change(resultLimit, { target: { value: '9' } })
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(patchedBody).not.toBeNull()
    })
    if (!patchedBody) {
      throw new Error('Expected patched settings payload')
    }

    const payload = patchedBody as {
      preferences: { voyager: Record<string, unknown> }
    }
    const preferences = payload.preferences.voyager

    expect(preferences).toMatchObject({
      recommendations: {
        resultLimit: 9,
        minRating: 5,
        audience: 'families',
      },
    })
    expect(preferences.recommendations).not.toHaveProperty('useLlmRationale')
    expect(preferences.map).not.toHaveProperty('defaultPlannerView')
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('saves first and last name without dropping preferences', async () => {
    const user = userEvent.setup()
    let patchedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/users/profile', () =>
        HttpResponse.json(
          buildProfile({
            first_name: 'Old',
            last_name: 'Name',
            display_name: 'Old Name',
            preferences: {
              voyager: {},
            },
          }),
        ),
      ),
      http.patch('http://localhost:8000/users/profile', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          buildProfile({
            first_name: patchedBody?.first_name ?? 'Old',
            last_name: patchedBody?.last_name ?? 'Name',
            display_name: `${patchedBody?.first_name ?? 'Old'} ${patchedBody?.last_name ?? 'Name'}`,
            preferences: {
              voyager: {},
            },
          }),
        )
      }),
    )

    renderSettingsPage()

    const firstName = (await screen.findByDisplayValue('Old')) as HTMLInputElement
    const lastName = screen.getByDisplayValue('Name') as HTMLInputElement
    fireEvent.change(firstName, { target: { value: 'Captain' } })
    fireEvent.change(lastName, { target: { value: 'Atlas' } })
    await user.click(screen.getByRole('button', { name: /save account/i }))

    await waitFor(() => {
      expect(patchedBody).toEqual({
        first_name: 'Captain',
        last_name: 'Atlas',
      })
    })
    expect(await screen.findByText('Captain Atlas')).toBeInTheDocument()
  })

  it('uploads and removes the avatar through the profile avatar endpoints', async () => {
    const user = userEvent.setup()
    let uploaded = false
    let removed = false

    server.use(
      http.get('http://localhost:8000/users/profile', () => HttpResponse.json(buildProfile())),
      http.post('http://localhost:8000/users/profile/avatar', async ({ request }) => {
        const formData = await request.formData()
        uploaded = formData.get('file') instanceof File
        return HttpResponse.json(
          buildProfile({
            avatar_url: 'http://localhost:9000/voyager-media/avatar-full?signature=test',
            avatar_thumbnail_url: 'http://localhost:9000/voyager-media/avatar-thumb?signature=test',
          }),
        )
      }),
      http.delete('http://localhost:8000/users/profile/avatar', () => {
        removed = true
        return HttpResponse.json(buildProfile())
      }),
    )

    renderSettingsPage()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement | null
    expect(fileInput).not.toBeNull()

    fireEvent.change(fileInput!, {
      target: {
        files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => {
      expect(uploaded).toBe(true)
    })
    expect(await screen.findByRole('button', { name: /replace/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /remove/i }))

    await waitFor(() => {
      expect(removed).toBe(true)
    })
    expect(await screen.findByRole('button', { name: /upload/i })).toBeInTheDocument()
  })
})
