import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SettingsPage from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'

describe('SettingsPage', () => {
  it('loads and saves voyager preferences through the profile API', async () => {
    const user = userEvent.setup()
    let patchedBody: Record<string, unknown> | null = null

    server.use(
      http.get('http://localhost:8000/users/profile', () =>
        HttpResponse.json({
          id: 'user-profile-1',
          keycloak_sub: 'voyager-user',
          preferences: {
            voyager: {
              recommendations: {
                resultLimit: 8,
                minRating: 5,
                audience: 'families',
                useLlmRationale: false,
              },
              map: {
                defaultPlannerView: 'map',
                showRoutesByDefault: false,
                showCustomLayersByDefault: true,
              },
              regional: {
                locale: 'fr-FR',
                region: 'FR',
                currency: 'EUR',
              },
            },
          },
          created_at: '2026-03-06T09:00:00.000Z',
        }),
      ),
      http.patch('http://localhost:8000/users/profile', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: 'user-profile-1',
          keycloak_sub: 'voyager-user',
          preferences: patchedBody?.preferences ?? {},
          created_at: '2026-03-06T09:00:00.000Z',
        })
      }),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/settings']}>
        <Routes>
          <Route path="/app/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const resultLimit = (await screen.findByDisplayValue('8')) as HTMLInputElement
    fireEvent.change(resultLimit, { target: { value: '9' } })
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => {
      expect(patchedBody).not.toBeNull()
    })
    if (!patchedBody) {
      throw new Error('Expected patched settings payload')
    }

    const payload = patchedBody as unknown as {
      preferences: { voyager: Record<string, unknown> }
    }
    const preferences = payload.preferences.voyager

    expect(preferences).toMatchObject({
      recommendations: {
        resultLimit: 9,
        minRating: 5,
        audience: 'families',
        useLlmRationale: false,
      },
      regional: {
        locale: 'fr-FR',
        region: 'FR',
        currency: 'EUR',
      },
    })
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })
})
