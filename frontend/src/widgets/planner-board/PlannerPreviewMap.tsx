import { useMemo } from "react";
import { config } from "@/app/config";
import {
  GoogleMapCanvas,
  GooglePolyline,
  MapFitBounds,
  MapPanTo,
  VoyagerMarker,
} from "@/shared/layouts/google-maps";

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
    <div className="transition-transform origin-bottom pb-1">
      <div className="relative flex items-center justify-center h-7 w-7 rounded-[50%_50%_50%_10%] -rotate-45 backdrop-blur-md border-[1.5px] border-white/80 shadow-[0_6px_12px_rgba(0,0,0,0.15)] bg-zinc-900/85">
        <div className="rotate-45 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-white shadow-sm" />
        </div>
        <span className="sr-only">{title}</span>
      </div>
    </div>
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
        (point): point is PreviewPoint =>
          Number.isFinite(point.lat) && Number.isFinite(point.lon),
      ),
    [routePoints],
  );
  const hasPrimaryPoint =
    primaryPoint != null &&
    Number.isFinite(primaryPoint.lat) &&
    Number.isFinite(primaryPoint.lon);
  const primaryLatLng = hasPrimaryPoint ? toLatLng(primaryPoint) : null;
  const routeLatLngs = useMemo(
    () => normalizedRoute.map(toLatLng),
    [normalizedRoute],
  );
  const points = useMemo(
    () => [...(primaryLatLng ? [primaryLatLng] : []), ...routeLatLngs],
    [primaryLatLng, routeLatLngs],
  );
  const mapSignature = useMemo(
    () => points.map((point) => `${point.lat}:${point.lng}`).join("|"),
    [points],
  );

  if (!points.length) {
    return null;
  }

  if (!config.map.apiKey) {
    return (
      <div className="rounded-[14px] border border-black/8 bg-white px-4 py-4 text-sm text-[var(--color-text-muted)]">
        Map preview is unavailable without a Google Maps API key.
      </div>
    );
  }

  const defaultCenter = points[0] ?? null;
  const hasRoute = normalizedRoute.length >= 2;

  return (
    <div className="overflow-hidden rounded-[14px] border border-black/8 bg-white">
      <div style={{ height: heightPx }}>
        <GoogleMapCanvas
          key={mapSignature}
          reuseMaps={false}
          defaultCenter={defaultCenter ?? { lat: 48.8566, lng: 2.3522 }}
          defaultZoom={hasRoute ? 10.8 : 13.8}
          style={{ width: "100%", height: "100%" }}
          disableDefaultUI
          mapTypeControl={false}
          fullscreenControl={false}
          streetViewControl={false}
          gestureHandling="cooperative"
        >
          {hasRoute ? (
            <MapFitBounds
              points={points}
              padding={48}
              maxZoom={13}
              singlePointZoom={13.8}
            />
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
            <VoyagerMarker
              position={primaryLatLng}
              title={primaryPoint.title}
              selected
              zIndex={3}
            >
              <PlannerMapMarker title={primaryPoint.title} />
            </VoyagerMarker>
          ) : null}
          {normalizedRoute.map((point, index) => (
            <VoyagerMarker
              key={`${point.title}-${index}`}
              position={routeLatLngs[index]}
              title={point.title}
              label={
                index === 0
                  ? "Origin"
                  : index === normalizedRoute.length - 1
                    ? "Destination"
                    : undefined
              }
              selected
              zIndex={3}
            />
          ))}
        </GoogleMapCanvas>
      </div>
    </div>
  );
}
