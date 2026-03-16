import { Navigate, useLocation, useParams } from 'react-router-dom';

export default function MapPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const location = useLocation();

  if (!tripId) return null;

  const params = new URLSearchParams(location.search);
  params.set('view', 'map');

  return <Navigate to={`/app/trips/${tripId}/plan?${params.toString()}`} replace />;
}
