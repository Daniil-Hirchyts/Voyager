import { Navigate, useLocation, useParams } from 'react-router-dom'

export default function EventsPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const location = useLocation()

  if (!tripId) return null

  return <Navigate to={`/app/trips/${tripId}/activities${location.search}`} replace />
}
