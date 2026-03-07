import { useParams } from 'react-router-dom'
import ProposalsWorkspace from '@/widgets/proposals-workspace'

export default function ProposalsPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <ProposalsWorkspace tripId={tripId} />
}
