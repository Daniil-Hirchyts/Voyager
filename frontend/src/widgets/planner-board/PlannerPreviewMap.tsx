import { useMemo } from 'react';
import { motion } from 'motion/react';
import { config } from '@/app/config';
import {
  VoyagerMap,
  GooglePolyline,
  MapFitBounds,
  MapPanTo,
  VoyagerMarker,
} from '@/shared/layouts/google-maps';

type PreviewPoint = {
  lat: number;
  lon: number;
  title: string;
};

function toLatLng(point: PreviewPoint) {
  return { lat: point.lat, lng: point.lon };
}

function PlannerMapMarker({ title }: { title: string }) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0, scale: 0.5 }}
      animate={{
        y: 0,
        opacity: 1,
        scale: 1,
        scaleX: [1, 0.8, 1.25, 0.9, 1.1, 1],
        scaleY: [1, 1.3, 0.75, 1.15, 0.95, 1],
      }}
      whileHover={{ scale: 1.05 }}
      transition={{
        y: { type: 'spring', stiffness: 300, damping: 15 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
        scaleX: { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
        scaleY: { duration: 0.6, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
      }}
      className="origin-bottom pb-1"
    >
      <div className="relative flex h-7 w-7 -rotate-45 items-center justify-center rounded-[50%_50%_50%_10%] border-[1.5px] border-white bg-[var(--color-primary)]">
        <div className="flex rotate-45 items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-white" />
        </div>
        <span className="sr-only">{title}</span>
      </div>
    </motion.div>
  );
}

export function PlannerPreviewMap({
  primaryPoint,
  routePoints = [],
  heightPx = 208,
}: {
  primaryPoint?: PreviewPoint | null;
  routePoints?: PreviewPoint[];
  heightPx?: number;
}) {
  const normalizedRoute = useMemo(
    () =>
      routePoints.filter(
        (point): point is PreviewPoint => Number.isFinite(point.lat) && Number.isFinite(point.lon),
      ),
    [routePoints],
  );
  const hasPrimaryPoint =
    primaryPoint != null && Number.isFinite(primaryPoint.lat) && Number.isFinite(primaryPoint.lon);
  const primaryLatLng = hasPrimaryPoint ? toLatLng(primaryPoint) : null;
  const routeLatLngs = useMemo(() => normalizedRoute.map(toLatLng), [normalizedRoute]);
  const points = useMemo(
    () => [...(primaryLatLng ? [primaryLatLng] : []), ...routeLatLngs],
    [primaryLatLng, routeLatLngs],
  );
  const mapSignature = useMemo(
    () => points.map((point) => `${point.lat}:${point.lng}`).join('|'),
    [points],
  );

  if (!points.length) {
    return null;
  }

  if (!config.map.apiKey) {
    return (
      <div className="border border-[var(--color-border)] bg-white px-4 py-4 text-sm text-[var(--color-text-muted)]">
        Map preview is unavailable without a Google Maps API key.
      </div>
    );
  }

  const defaultCenter = points[0] ?? null;
  const hasRoute = normalizedRoute.length >= 2;

  return (
    <div className="overflow-hidden border border-[var(--color-border)] bg-white">
      <div style={{ height: heightPx }}>
        <VoyagerMap
          key={mapSignature}
          reuseMaps={false}
          defaultCenter={defaultCenter ?? { lat: 48.8566, lng: 2.3522 }}
          defaultZoom={hasRoute ? 10.8 : 13.8}
          style={{ width: '100%', height: '100%' }}
          disableDefaultUI
          mapTypeControl={false}
          fullscreenControl={false}
          streetViewControl={false}
          gestureHandling="cooperative"
        >
          {hasRoute ? (
            <MapFitBounds points={points} padding={48} maxZoom={13} singlePointZoom={13.8} />
          ) : defaultCenter ? (
            <MapPanTo point={defaultCenter} zoom={13.8} />
          ) : null}
          {hasRoute ? (
            <GooglePolyline
              path={routeLatLngs}
              strokeColor="#17344C"
              strokeOpacity={0.78}
              strokeWeight={3}
            />
          ) : null}
          {hasPrimaryPoint && primaryLatLng && !hasRoute ? (
            <VoyagerMarker position={primaryLatLng} title={primaryPoint.title} selected zIndex={3}>
              <PlannerMapMarker title={primaryPoint.title} />
            </VoyagerMarker>
          ) : null}
          {normalizedRoute.map((point, index) => {
            const position = routeLatLngs[index];
            if (!position) {
              return null;
            }
            return (
              <VoyagerMarker
                key={`${point.title}-${index}`}
                position={position}
                title={point.title}
                label={
                  index === 0
                    ? 'Origin'
                    : index === normalizedRoute.length - 1
                      ? 'Destination'
                      : undefined
                }
                selected
                zIndex={3}
              />
            );
          })}
        </VoyagerMap>
      </div>
    </div>
  );
}
