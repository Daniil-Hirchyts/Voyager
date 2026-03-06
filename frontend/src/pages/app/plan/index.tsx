import { useParams } from 'react-router-dom'
import PlannerBoard from '@/widgets/planner-board'

export default function PlanPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return (
    <div className="flex flex-col" style={{ height: '100%', minHeight: '100vh' }}>
      <PlannerBoard tripId={tripId} />
    </div>
  )
}
