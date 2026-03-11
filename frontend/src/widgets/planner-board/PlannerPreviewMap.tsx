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
    <div className="relative flex flex-col items-center">
      <div className="relative flex size-11 items-center justify-center rounded-[15px] border border-white/90 bg-white shadow-[0_18px_34px_-18px_rgba(26,22,21,0.38)]">
        <div className="absolute inset-[7px] rounded-[11px] border border-black/8 bg-[rgba(247,248,250,0.92)]" />
        <div className="relative size-4 rounded-full border border-[rgba(201,138,55,0.32)] bg-[#C98A37]" />
      </div>
      <div className="-mt-1 h-3 w-3 rotate-45 rounded-[3px] border-r border-b border-black/8 bg-white shadow-[0_10px_18px_-14px_rgba(26,22,21,0.32)]" />
      <span className="sr-only">{title}</span>
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
