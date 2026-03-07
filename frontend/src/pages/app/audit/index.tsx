import { useParams } from 'react-router-dom'
import AuditWorkspace from '@/widgets/audit-workspace'

export default function AuditPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return <AuditWorkspace tripId={tripId} />
}
