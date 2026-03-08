import { useParams } from 'react-router-dom'
import ActivitiesWorkspace from '@/widgets/activities-workspace'

export default function ActivitiesPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <ActivitiesWorkspace tripId={tripId} />
}
