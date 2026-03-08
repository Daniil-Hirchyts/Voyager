import { Navigate, useLocation, useParams } from 'react-router-dom'

export default function ProposalsPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const location = useLocation()

  if (!tripId) return null

  const params = new URLSearchParams(location.search)
  params.set('ai', 'proposal')

  return <Navigate to={`/app/trips/${tripId}/activities?${params.toString()}`} replace />
}
