import { useParams } from 'react-router-dom'
import EventsWorkspace from '@/widgets/events-workspace'

export default function EventsPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <EventsWorkspace tripId={tripId} />
}
