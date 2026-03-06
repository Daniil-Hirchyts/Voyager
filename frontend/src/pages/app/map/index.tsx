import { useParams } from 'react-router-dom'
import MapWorkspace from '@/widgets/map-workspace'

export default function MapPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <MapWorkspace tripId={tripId} />
}
