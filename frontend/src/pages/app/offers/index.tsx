import { useParams } from 'react-router-dom'
import OffersWorkspace from '@/widgets/offers-workspace'

export default function OffersPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <OffersWorkspace tripId={tripId} />
}
