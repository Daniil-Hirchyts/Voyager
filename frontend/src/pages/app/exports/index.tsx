import { useParams } from 'react-router-dom'
import ExportsWorkspace from '@/widgets/exports-workspace'

export default function ExportsPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <ExportsWorkspace tripId={tripId} />
}
