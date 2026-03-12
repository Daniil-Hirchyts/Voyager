import { useParams } from 'react-router-dom'
import PlannerBoard from '@/widgets/planner-board'

export default function PlanPage() {
  const { tripId } = useParams<{ tripId: string }>()

  if (!tripId) return null

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      <PlannerBoard tripId={tripId} />
    </div>
  )
}
