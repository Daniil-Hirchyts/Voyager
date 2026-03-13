import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './index'
import { renderWithQueryClient } from '@/test/utils'
import { server } from '@/test/msw/server'

describe('AppLayout', () => {
  it('uses the Voyager profile display name and avatar in the side rail', async () => {
    server.use(
      http.get('http://localhost:8000/users/profile', () =>
        HttpResponse.json({
          id: 'user-profile-1',
          keycloak_sub: 'voyager-user',
          email: 'captain@example.com',
          first_name: 'Captain',
          last_name: 'Atlas',
          display_name: 'Captain Atlas',
          avatar_url: 'http://localhost:9000/voyager-media/avatar-full?signature=test',
          avatar_thumbnail_url: 'http://localhost:9000/voyager-media/avatar-thumb?signature=test',
          preferences: {},
          created_at: '2026-03-06T09:00:00.000Z',
          updated_at: '2026-03-06T09:00:00.000Z',
        }),
      ),
    )

    renderWithQueryClient(
      <MemoryRouter initialEntries={['/app/trips']}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="trips" element={<div>Trips Workspace</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Captain Atlas' })).toBeInTheDocument()
    const avatar = document.querySelector('img[src*="avatar-thumb"]') as HTMLImageElement | null
    expect(avatar).not.toBeNull()
  })
})
