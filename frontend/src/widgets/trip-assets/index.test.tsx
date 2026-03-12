import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TripAssetManager from './index'
import { buildTripAsset } from '@/test/fixtures/api'
import { renderWithQueryClient } from '@/test/utils'

const useTripAssetsMock = vi.fn()
const useUploadTripAssetMock = vi.fn()
const useDeleteTripAssetMock = vi.fn()

vi.mock('@/entities/trip-asset/queries', () => ({
  useTripAssets: (...args: unknown[]) => useTripAssetsMock(...args),
  useUploadTripAsset: (...args: unknown[]) => useUploadTripAssetMock(...args),
  useDeleteTripAsset: (...args: unknown[]) => useDeleteTripAssetMock(...args),
}))

describe('TripAssetManager', () => {
  beforeEach(() => {
    useTripAssetsMock.mockReset()
    useUploadTripAssetMock.mockReset()
    useDeleteTripAssetMock.mockReset()
  })

  it('uploads and deletes trip assets', async () => {
    let items = [buildTripAsset()]
    const uploadMutation = vi.fn(async ({ file }: { file: File }) => {
      const next = buildTripAsset({
        id: 'asset-uploaded',
        original_filename: file.name,
      })
      items = [next, ...items]
      return next
    })
    const deleteMutation = vi.fn(async (assetId: string) => {
      items = items.filter((item) => item.id !== assetId)
    })

    useTripAssetsMock.mockImplementation(() => ({
      data: {
        total: items.length,
        items,
      },
      isLoading: false,
    }))
    useUploadTripAssetMock.mockReturnValue({
      mutateAsync: uploadMutation,
    })
    useDeleteTripAssetMock.mockReturnValue({
      mutateAsync: deleteMutation,
    })

    renderWithQueryClient(
      <TripAssetManager
        tripId="trip-1"
        title="Trip uploads"
        description="Store tickets and references."
      />,
    )

    expect(screen.getByText('boarding-pass.pdf')).toBeInTheDocument()

    fireEvent.drop(screen.getByText('Drag files and photos here').closest('div')!, {
      dataTransfer: {
        files: [new File(['voucher'], 'hotel-voucher.pdf', { type: 'application/pdf' })],
      },
    })

    await waitFor(() => {
      expect(uploadMutation).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText('hotel-voucher.pdf')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: /remove/i })[0])

    await waitFor(() => {
      expect(deleteMutation).toHaveBeenCalledWith('asset-uploaded')
    })
    await waitFor(() => {
      expect(screen.queryByText('hotel-voucher.pdf')).not.toBeInTheDocument()
    })
  })
})
