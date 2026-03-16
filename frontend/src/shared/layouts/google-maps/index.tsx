import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  ControlPosition,
  Map,
  MapControl,
  Marker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import type { Layer, LayersList } from '@deck.gl/core';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { GeoJsonLayer, ScatterplotLayer, ArcLayer } from '@deck.gl/layers';
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawFreehandLineStringMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from 'terra-draw';
import { TerraDrawGoogleMapsAdapter } from 'terra-draw-google-maps-adapter';
import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from 'geojson';
import { config } from '@/app/config';
import { useRoutePreview } from '@/entities/routes/queries';
import type {
  GooglePlaceCandidate,
  RoutePreviewInput,
  RoutePreviewRoute,
  TripMapFeatureCollection,
  TripMapLayer,
} from '@/shared/api/types';
import { cn } from '@/shared/lib/cn';

export type LatLngPoint = {
  lat: number;
  lng: number;
};

export type TerraDrawModeName =
  | 'select'
  | 'point'
  | 'linestring'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'freehand';

export interface MapGeometrySummary {
  featureCount: number;
  pointCount: number;
  distanceMeters: number;
  areaSquareMeters: number;
  bounds: google.maps.LatLngBoundsLiteral | null;
}

export interface ClusterMarkerRecord {
  id: string;
  position: LatLngPoint;
  title?: string;
  label?: string;
  selected?: boolean;
  color?: string;
  zIndex?: number;
}

const DEFAULT_VECTOR_MARKER_COLOR = '#17344C';
const DEFAULT_SELECTED_MARKER_COLOR = '#C98A37';

function isGoogleMapsReady() {
  return typeof google !== 'undefined' && !!google.maps;
}

function stringifyCoordinates(points: LatLngPoint[]) {
  return points.map((point) => `${point.lat}:${point.lng}`).join('|');
}

function signatureForFeatureCollection(
  featureCollection: TripMapFeatureCollection | null | undefined,
) {
  return featureCollection ? JSON.stringify(featureCollection) : '';
}

function pointFromPosition(position: Position): LatLngPoint | null {
  if (position.length < 2) return null;
  const [lng, lat] = position;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

function collectGeometryPoints(geometry: Geometry, bucket: LatLngPoint[]) {
  switch (geometry.type) {
    case 'Point': {
      const point = pointFromPosition(geometry.coordinates);
      if (point) bucket.push(point);
      return;
    }
    case 'MultiPoint':
    case 'LineString': {
      geometry.coordinates.forEach((position) => {
        const point = pointFromPosition(position);
        if (point) bucket.push(point);
      });
      return;
    }
    case 'MultiLineString':
    case 'Polygon': {
      geometry.coordinates.flat().forEach((position) => {
        const point = pointFromPosition(position);
        if (point) bucket.push(point);
      });
      return;
    }
    case 'MultiPolygon': {
      geometry.coordinates.flat(2).forEach((position) => {
        const point = pointFromPosition(position);
        if (point) bucket.push(point);
      });
      return;
    }
    case 'GeometryCollection': {
      geometry.geometries.forEach((item) => collectGeometryPoints(item, bucket));
      return;
    }
  }
}

export function featureCollectionToPoints(
  featureCollection: TripMapFeatureCollection | null | undefined,
) {
  const bucket: LatLngPoint[] = [];
  for (const feature of featureCollection?.features ?? []) {
    if (feature.geometry) {
      collectGeometryPoints(feature.geometry, bucket);
    }
  }
  return bucket;
}

function boundsLiteralFromPoints(points: LatLngPoint[]) {
  if (!points.length) return null;
  const north = Math.max(...points.map((point) => point.lat));
  const south = Math.min(...points.map((point) => point.lat));
  const east = Math.max(...points.map((point) => point.lng));
  const west = Math.min(...points.map((point) => point.lng));
  return { north, south, east, west };
}

function lineStringToPath(coordinates: Position[]) {
  return coordinates.map(pointFromPosition).filter((point): point is LatLngPoint => point != null);
}

function polygonToPaths(coordinates: Position[][]) {
  return coordinates.map((ring) => lineStringToPath(ring));
}

export function emptyFeatureCollection(): TripMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function createMarkerChip(item: ClusterMarkerRecord) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = item.label || '';
  node.title = item.title || '';
  node.style.border = '1px solid rgba(255,255,255,0.86)';
  node.style.borderRadius = item.label ? '999px' : '999px';
  node.style.padding = item.label ? '0.35rem 0.6rem' : '0.4rem';
  node.style.background = item.selected
    ? DEFAULT_SELECTED_MARKER_COLOR
    : item.color || DEFAULT_VECTOR_MARKER_COLOR;
  node.style.color = '#FFFFFF';
  node.style.fontWeight = '700';
  node.style.fontSize = item.label ? '12px' : '10px';
  node.style.cursor = 'pointer';
  return node;
}
export function GoogleMapsProvider({ children }: { children: ReactNode }) {
  if (!config.map.apiKey) {
    return <>{children}</>;
  }

  return (
    <APIProvider
      apiKey={config.map.apiKey}
      language={config.map.language || undefined}
      region={config.map.region || undefined}
      libraries={['marker', 'places', 'geometry', 'maps3d']}
    >
      {children}
    </APIProvider>
  );
}

export function useGoogleGeometryLibrary() {
  return useMapsLibrary('geometry');
}

export function fitBoundsForPoints(
  map: google.maps.Map,
  points: LatLngPoint[],
  padding: number | google.maps.Padding = 64,
  options?: {
    maxZoom?: number;
    singlePointZoom?: number;
  },
) {
  if (!points.length) return;
  const bounds = new google.maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  if (points.length === 1) {
    const firstPoint = points[0];
    if (!firstPoint) return;
    map.panTo(firstPoint);
    map.setZoom(options?.singlePointZoom ?? 13);
    return;
  }
  if (options?.maxZoom != null) {
    google.maps.event.addListenerOnce(map, 'idle', () => {
      if ((map.getZoom() ?? 0) > options.maxZoom!) {
        map.setZoom(options.maxZoom!);
      }
    });
  }
  map.fitBounds(bounds, padding);
}

export function summarizeFeatureCollection(
  featureCollection: TripMapFeatureCollection | null | undefined,
  geometryLib?: google.maps.GeometryLibrary | null,
): MapGeometrySummary {
  const points = featureCollectionToPoints(featureCollection);
  let areaSquareMeters = 0;
  let distanceMeters = 0;

  if (geometryLib && isGoogleMapsReady()) {
    for (const feature of featureCollection?.features ?? []) {
      if (!feature.geometry) continue;
      if (feature.geometry.type === 'LineString') {
        distanceMeters += geometryLib.spherical.computeLength(
          lineStringToPath(feature.geometry.coordinates),
        );
      }
      if (feature.geometry.type === 'MultiLineString') {
        distanceMeters += feature.geometry.coordinates.reduce(
          (sum, line) => sum + geometryLib.spherical.computeLength(lineStringToPath(line)),
          0,
        );
      }
      if (feature.geometry.type === 'Polygon') {
        areaSquareMeters += geometryLib.spherical.computeArea(
          polygonToPaths(feature.geometry.coordinates)[0] ?? [],
        );
      }
      if (feature.geometry.type === 'MultiPolygon') {
        areaSquareMeters += feature.geometry.coordinates.reduce((sum, polygon) => {
          return sum + geometryLib.spherical.computeArea(polygonToPaths(polygon)[0] ?? []);
        }, 0);
      }
    }
  }

  return {
    featureCount: featureCollection?.features.length ?? 0,
    pointCount: points.length,
    distanceMeters,
    areaSquareMeters,
    bounds: boundsLiteralFromPoints(points),
  };
}

export function MapBoundsSync({
  onBoundsChange,
}: {
  onBoundsChange: (bounds: google.maps.LatLngBoundsLiteral) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('idle', () => {
      const bounds = map.getBounds();
      if (!bounds) return;
      const northEast = bounds.getNorthEast();
      const southWest = bounds.getSouthWest();
      onBoundsChange({
        north: northEast.lat(),
        east: northEast.lng(),
        south: southWest.lat(),
        west: southWest.lng(),
      });
    });
    return () => listener.remove();
  }, [map, onBoundsChange]);

  return null;
}

export function MapFitBounds({
  points,
  padding = 64,
  maxZoom,
  singlePointZoom,
}: {
  points: LatLngPoint[];
  padding?: number | google.maps.Padding;
  maxZoom?: number;
  singlePointZoom?: number;
}) {
  const map = useMap();
  const signature = useMemo(() => stringifyCoordinates(points), [points]);

  useEffect(() => {
    if (!map || points.length === 0) return;
    fitBoundsForPoints(map, points, padding, { maxZoom, singlePointZoom });
  }, [map, maxZoom, padding, signature, singlePointZoom]);

  return null;
}

export function MapPanTo({ point, zoom }: { point: LatLngPoint | null; zoom?: number }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !point) return;
    map.panTo(point);
    if (zoom != null) {
      map.setZoom(zoom);
    }
  }, [map, point, zoom]);

  return null;
}

export function VoyagerMap({ className, ...props }: React.ComponentProps<typeof Map>) {
  return (
    <div className={cn('voyager-google-map h-full w-full', className)}>
      <Map
        reuseMaps
        disableDefaultUI
        gestureHandling="greedy"
        mapId={config.map.mapId || undefined}
        renderingType="RASTER"
        {...props}
      />
    </div>
  );
}

export const VoyagerMapControl = MapControl;

export function buildCircleMarkerIcon(fillColor: string, scale = 8): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor,
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 2,
    scale,
  };
}

export function VoyagerMarker({
  position,
  title,
  label,
  color = DEFAULT_VECTOR_MARKER_COLOR,
  selected = false,
  zIndex,
  useLegacyMarker = false,
  icon,
  children,
  onClick,
}: {
  position: LatLngPoint;
  title?: string;
  label?: string;
  color?: string;
  selected?: boolean;
  zIndex?: number;
  useLegacyMarker?: boolean;
  icon?: google.maps.Icon | google.maps.Symbol;
  children?: ReactNode;
  onClick?: () => void;
}) {
  if (config.map.mapId && !useLegacyMarker) {
    return (
      <AdvancedMarker position={position} title={title} zIndex={zIndex} onClick={onClick}>
        {children ?? (
          <div className="origin-bottom pb-1 transition-transform hover:scale-110">
            <div
              className={`flex -rotate-45 items-center justify-center rounded-[50%_50%_50%_10%] border-[1.5px] border-white ${label ? 'h-9 w-9' : 'h-7 w-7'}`}
              style={{
                backgroundColor: selected ? `${DEFAULT_SELECTED_MARKER_COLOR}` : `${color}`,
              }}
            >
              <div className="flex rotate-45 items-center justify-center">
                {label ? (
                  <span className="text-[14px] leading-none font-bold tracking-tight text-white">
                    {label}
                  </span>
                ) : (
                  <div className="h-2.5 w-2.5 rounded-full bg-white" />
                )}
              </div>
            </div>
          </div>
        )}
      </AdvancedMarker>
    );
  }

  return (
    <Marker
      position={position}
      title={title}
      zIndex={zIndex}
      onClick={onClick}
      label={
        label
          ? {
              text: label,
              color: '#FFFFFF',
              fontSize: '12px',
              fontWeight: '700',
            }
          : undefined
      }
      icon={
        icon ??
        buildCircleMarkerIcon(selected ? DEFAULT_SELECTED_MARKER_COLOR : color, label ? 18 : 8)
      }
    />
  );
}

export function GooglePolyline({
  path,
  strokeColor,
  strokeOpacity = 1,
  strokeWeight = 3,
  icons,
  zIndex,
}: {
  path: LatLngPoint[];
  strokeColor: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  icons?: google.maps.IconSequence[];
  zIndex?: number;
}) {
  const map = useMap();
  const signature = useMemo(() => stringifyCoordinates(path), [path]);

  useEffect(() => {
    if (!map || path.length < 2 || !isGoogleMapsReady()) return;
    const polyline = new google.maps.Polyline({
      map,
      path,
      strokeColor,
      strokeOpacity,
      strokeWeight,
      icons,
      zIndex,
    });
    return () => polyline.setMap(null);
  }, [icons, map, path, signature, strokeColor, strokeOpacity, strokeWeight, zIndex]);

  return null;
}

export function GooglePolygon({
  paths,
  strokeColor = DEFAULT_VECTOR_MARKER_COLOR,
  strokeOpacity = 0.9,
  strokeWeight = 2,
  fillColor = DEFAULT_VECTOR_MARKER_COLOR,
  fillOpacity = 0.12,
}: {
  paths: LatLngPoint[][];
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
}) {
  const map = useMap();
  const signature = useMemo(() => JSON.stringify(paths), [paths]);

  useEffect(() => {
    if (!map || !paths.length || !isGoogleMapsReady()) return;
    const polygon = new google.maps.Polygon({
      map,
      paths,
      strokeColor,
      strokeOpacity,
      strokeWeight,
      fillColor,
      fillOpacity,
    });
    return () => polygon.setMap(null);
  }, [fillColor, fillOpacity, map, paths, signature, strokeColor, strokeOpacity, strokeWeight]);

  return null;
}

export function GoogleCircle({
  center,
  radius,
  strokeColor = DEFAULT_VECTOR_MARKER_COLOR,
  strokeOpacity = 0.9,
  strokeWeight = 2,
  fillColor = DEFAULT_VECTOR_MARKER_COLOR,
  fillOpacity = 0.12,
}: {
  center: LatLngPoint;
  radius: number;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !isGoogleMapsReady()) return;
    const circle = new google.maps.Circle({
      map,
      center,
      radius,
      strokeColor,
      strokeOpacity,
      strokeWeight,
      fillColor,
      fillOpacity,
    });
    return () => circle.setMap(null);
  }, [center, fillColor, fillOpacity, map, radius, strokeColor, strokeOpacity, strokeWeight]);

  return null;
}

export function GoogleRectangle({
  bounds,
  strokeColor = DEFAULT_VECTOR_MARKER_COLOR,
  strokeOpacity = 0.9,
  strokeWeight = 2,
  fillColor = DEFAULT_VECTOR_MARKER_COLOR,
  fillOpacity = 0.12,
}: {
  bounds: google.maps.LatLngBoundsLiteral;
  strokeColor?: string;
  strokeOpacity?: number;
  strokeWeight?: number;
  fillColor?: string;
  fillOpacity?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !isGoogleMapsReady()) return;
    const rectangle = new google.maps.Rectangle({
      map,
      bounds,
      strokeColor,
      strokeOpacity,
      strokeWeight,
      fillColor,
      fillOpacity,
    });
    return () => rectangle.setMap(null);
  }, [bounds, fillColor, fillOpacity, map, strokeColor, strokeOpacity, strokeWeight]);

  return null;
}

export function GoogleGeoJsonLayer({
  featureCollection,
  style,
}: {
  featureCollection: TripMapFeatureCollection;
  style?: google.maps.Data.StylingFunction | google.maps.Data.StyleOptions;
}) {
  const map = useMap();
  const signature = useMemo(
    () => signatureForFeatureCollection(featureCollection),
    [featureCollection],
  );

  useEffect(() => {
    if (!map || !isGoogleMapsReady()) return;
    const layer = new google.maps.Data({ map });
    if (style) {
      layer.setStyle(style);
    }
    layer.addGeoJson(
      featureCollection as unknown as FeatureCollection<Geometry, GeoJsonProperties>,
    );
    return () => layer.setMap(null);
  }, [featureCollection, map, signature, style]);

  return null;
}

export function createDeckLayersForTripMapLayer(layer: TripMapLayer): Layer[] {
  const features = layer.feature_collection.features;
  const style = layer.style || {};
  const pointData = features
    .filter((feature) => feature.geometry?.type === 'Point')
    .map((feature) => {
      const point = pointFromPosition((feature.geometry as { coordinates: Position }).coordinates);
      return {
        position: point ? [point.lng, point.lat] : [0, 0],
        weight: Number((feature.properties?.weight as number | undefined) ?? 1),
      };
    });

  const deckKind = String((layer.metadata?.deckKind as string | undefined) || 'geojson');

  if (deckKind === 'heatmap') {
    return [
      new HeatmapLayer({
        id: `heatmap-${layer.id}`,
        data: pointData,
        getPosition: (item: { position: [number, number] }) => item.position,
        getWeight: (item: { weight: number }) => item.weight,
      }),
    ];
  }

  if (deckKind === 'hexagon') {
    return [
      new HexagonLayer({
        id: `hexagon-${layer.id}`,
        data: pointData,
        getPosition: (item: { position: [number, number] }) => item.position,
        colorRange: [
          [33, 79, 82, 60],
          [47, 111, 115, 140],
          [197, 106, 61, 220],
        ],
        radius: Number((layer.metadata?.radius as number | undefined) ?? 180),
        elevationScale: 4,
        extruded: false,
      }),
    ];
  }

  if (deckKind === 'scatter') {
    return [
      new ScatterplotLayer({
        id: `scatter-${layer.id}`,
        data: pointData,
        getPosition: (item: { position: [number, number] }) => item.position,
        getRadius: Number((layer.metadata?.radius as number | undefined) ?? 40),
        getFillColor: [47, 111, 115, 200],
      }),
    ];
  }

  if (deckKind === 'arc') {
    const arcData = features
      .filter((feature) => feature.geometry?.type === 'LineString')
      .map((feature) => {
        const path = lineStringToPath(
          (feature.geometry as { coordinates: Position[] }).coordinates,
        );
        return {
          sourcePosition: [path[0]?.lng ?? 0, path[0]?.lat ?? 0],
          targetPosition: [path[path.length - 1]?.lng ?? 0, path[path.length - 1]?.lat ?? 0],
        };
      });

    return [
      new ArcLayer({
        id: `arc-${layer.id}`,
        data: arcData,
        getSourcePosition: (item: { sourcePosition: [number, number] }) => item.sourcePosition,
        getTargetPosition: (item: { targetPosition: [number, number] }) => item.targetPosition,
        getSourceColor: [47, 111, 115, 220],
        getTargetColor: [197, 106, 61, 220],
        getWidth: Number((layer.metadata?.width as number | undefined) ?? 3),
      }),
    ];
  }

  return [
    new GeoJsonLayer({
      id: `geojson-${layer.id}`,
      data: layer.feature_collection,
      stroked: true,
      filled: true,
      pointType: 'circle',
      getPointRadius: Number((style.markerScale as number | undefined) ?? 6),
      getFillColor: [47, 111, 115, 70],
      getLineColor: [47, 111, 115, 230],
      getLineWidth: Number((style.strokeWeight as number | undefined) ?? 3),
      lineWidthUnits: 'pixels',
    }),
  ];
}

export function GoogleDeckOverlay({ layers }: { layers: LayersList }) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const signature = useMemo(
    () => JSON.stringify(layers.map((layer) => String((layer as { id?: string }).id))),
    [layers],
  );

  useEffect(() => {
    if (!map) return;
    if (!overlayRef.current) {
      overlayRef.current = new GoogleMapsOverlay({ layers });
      overlayRef.current.setMap(map);
      return undefined;
    }
    overlayRef.current.setProps({ layers });
    return undefined;
  }, [layers, map, signature]);

  useEffect(() => {
    return () => {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
    };
  }, []);

  return null;
}

export function VoyagerMarkerClusterLayer<T extends ClusterMarkerRecord>({
  items,
  onMarkerClick,
}: {
  items: T[];
  onMarkerClick?: (item: T) => void;
}) {
  const map = useMap();
  const markerLibrary = useMapsLibrary('marker');
  const signature = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    if (!map || !isGoogleMapsReady() || items.length === 0) return;
    const markers: Array<google.maps.Marker | google.maps.marker.AdvancedMarkerElement> = items.map(
      (item) => {
        if (config.map.mapId && markerLibrary) {
          const marker = new markerLibrary.AdvancedMarkerElement({
            position: item.position,
            title: item.title,
            content: createMarkerChip(item),
            zIndex: item.zIndex,
          });
          if (onMarkerClick) {
            marker.addListener?.('click', () => onMarkerClick(item));
          }
          return marker;
        }

        const marker = new google.maps.Marker({
          position: item.position,
          title: item.title,
          zIndex: item.zIndex,
          label: item.label
            ? {
                text: item.label,
                color: '#FFFFFF',
                fontSize: '12px',
                fontWeight: '700',
              }
            : undefined,
          icon: buildCircleMarkerIcon(
            item.selected
              ? DEFAULT_SELECTED_MARKER_COLOR
              : item.color || DEFAULT_VECTOR_MARKER_COLOR,
            item.label ? 18 : 8,
          ),
        });
        if (onMarkerClick) {
          marker.addListener('click', () => onMarkerClick(item));
        }
        return marker;
      },
    );

    const clusterer = new MarkerClusterer({ map, markers });
    return () => {
      clusterer.clearMarkers();
      markers.forEach((marker) => {
        if ('setMap' in marker) {
          marker.setMap(null);
        } else {
          marker.map = null;
        }
      });
    };
  }, [items, map, markerLibrary, onMarkerClick, signature]);

  return null;
}

export function GoogleDirectionsRoute({
  origin,
  destination,
  waypoints = [],
  travelMode = 'WALK' as const,
  computeAlternatives = false,
  activeRouteIndex = 0,
  strokeColor = DEFAULT_VECTOR_MARKER_COLOR,
  alternateStrokeColor = '#B6D6F2',
  strokeOpacity = 0.92,
  alternateStrokeOpacity = 0.48,
  strokeWeight = 5,
  alternateStrokeWeight = 3,
  onRoutesChange,
}: {
  origin: LatLngPoint | null;
  destination: LatLngPoint | null;
  waypoints?: LatLngPoint[];
  travelMode?: RoutePreviewInput['travel_mode'];
  computeAlternatives?: boolean;
  activeRouteIndex?: number;
  strokeColor?: string;
  alternateStrokeColor?: string;
  strokeOpacity?: number;
  alternateStrokeOpacity?: number;
  strokeWeight?: number;
  alternateStrokeWeight?: number;
  onRoutesChange?: (routes: RoutePreviewRoute[]) => void;
}) {
  const payload = useMemo<RoutePreviewInput | null>(
    () =>
      origin && destination
        ? {
            origin,
            destination,
            waypoints,
            travel_mode: travelMode,
            compute_alternatives: computeAlternatives,
          }
        : null,
    [computeAlternatives, destination, origin, travelMode, waypoints],
  );
  const routePreview = useRoutePreview(payload, Boolean(payload));
  const routes = routePreview.data?.routes ?? [];

  useEffect(() => {
    if (!payload) {
      onRoutesChange?.([]);
      return;
    }
    onRoutesChange?.(routes);
  }, [onRoutesChange, payload, routes]);

  return (
    <>
      {routes.map((route, index) => {
        return (
          <GooglePolyline
            key={`${route.summary || 'route'}-${index}`}
            path={route.path}
            strokeColor={index === activeRouteIndex ? strokeColor : alternateStrokeColor}
            strokeOpacity={index === activeRouteIndex ? strokeOpacity : alternateStrokeOpacity}
            strokeWeight={index === activeRouteIndex ? strokeWeight : alternateStrokeWeight}
          />
        );
      })}
    </>
  );
}

export function GoogleFeatureLayer({
  featureType,
  style,
}: {
  featureType: google.maps.FeatureType;
  style:
    | google.maps.FeatureStyleOptions
    | ((options: google.maps.FeatureStyleFunctionOptions) => google.maps.FeatureStyleOptions);
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof map.getFeatureLayer !== 'function') return;
    const layer = map.getFeatureLayer(featureType);
    const previousStyle = layer.style;
    layer.style = style;
    return () => {
      layer.style = previousStyle;
    };
  }, [featureType, map, style]);

  return null;
}

export function GoogleDatasetLayer({
  datasetId,
  style,
}: {
  datasetId: string;
  style:
    | google.maps.FeatureStyleOptions
    | ((options: google.maps.FeatureStyleFunctionOptions) => google.maps.FeatureStyleOptions);
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || typeof map.getDatasetFeatureLayer !== 'function' || !datasetId) return;
    const layer = map.getDatasetFeatureLayer(datasetId);
    const previousStyle = layer.style;
    layer.style = style;
    return () => {
      layer.style = previousStyle;
    };
  }, [datasetId, map, style]);

  return null;
}

export function featureCollectionFromSnapshot(
  snapshot: GeoJSONStoreFeatures[],
): TripMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: snapshot as unknown as TripMapFeatureCollection['features'],
  };
}

export function TerraDrawEditor({
  enabled,
  mode,
  value,
  onChange,
}: {
  enabled: boolean;
  mode: TerraDrawModeName;
  value?: TripMapFeatureCollection | null;
  onChange?: (featureCollection: TripMapFeatureCollection, summary: MapGeometrySummary) => void;
}) {
  const map = useMap();
  const geometryLib = useGoogleGeometryLibrary();
  const drawRef = useRef<TerraDraw | null>(null);
  const latestValueRef = useRef<string>('');
  const modeMap = useMemo(
    () =>
      ({
        select: 'select',
        point: 'point',
        linestring: 'linestring',
        polygon: 'polygon',
        rectangle: 'rectangle',
        circle: 'circle',
        freehand: 'freehand-linestring',
      }) satisfies Record<TerraDrawModeName, string>,
    [],
  );
  const valueSignature = useMemo(() => signatureForFeatureCollection(value || undefined), [value]);

  useEffect(() => {
    if (!enabled || !map || !isGoogleMapsReady()) return;
    const draw = new TerraDraw({
      adapter: new TerraDrawGoogleMapsAdapter({
        map,
        lib: google.maps,
      }),
      modes: [
        new TerraDrawSelectMode(),
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode(),
        new TerraDrawRectangleMode(),
        new TerraDrawCircleMode(),
        new TerraDrawFreehandLineStringMode(),
      ],
    });
    draw.start();
    draw.setMode(modeMap[mode]);

    const emit = () => {
      const featureCollection = featureCollectionFromSnapshot(draw.getSnapshot());
      latestValueRef.current = JSON.stringify(featureCollection);
      onChange?.(featureCollection, summarizeFeatureCollection(featureCollection, geometryLib));
    };

    draw.on('change', emit);
    draw.on('finish', emit);
    drawRef.current = draw;

    if (value?.features.length) {
      draw.addFeatures(value.features as unknown as GeoJSONStoreFeatures[]);
      latestValueRef.current = JSON.stringify(value);
    }

    return () => {
      draw.stop();
      drawRef.current = null;
    };
  }, [enabled, geometryLib, map, modeMap, onChange]);

  useEffect(() => {
    if (!enabled) return;
    drawRef.current?.setMode(modeMap[mode]);
  }, [enabled, mode, modeMap]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    if (latestValueRef.current === valueSignature) return;
    draw.clear();
    if (value?.features.length) {
      draw.addFeatures(value.features as unknown as GeoJSONStoreFeatures[]);
    }
    latestValueRef.current = valueSignature;
  }, [value, valueSignature]);

  return null;
}

export function GooglePlacesExperimentPanel({
  selectedPlaceId,
  onPlacePicked,
  placeholder = 'Search Google Places',
}: {
  selectedPlaceId?: string | null;
  placeholder?: string;
  onPlacePicked?: (payload: GooglePlaceCandidate | null) => void;
}) {
  const [components, setComponents] = useState<null | {
    PlacePicker: React.ComponentType<Record<string, unknown>>;
    PlaceOverview: React.ComponentType<Record<string, unknown>>;
  }>(null);

  useEffect(() => {
    if (!config.features.mapExperiments || !config.map.apiKey) return;
    let active = true;
    import('@googlemaps/extended-component-library/react').then((mod) => {
      if (!active) return;
      setComponents({
        PlacePicker: mod.PlacePicker as React.ComponentType<Record<string, unknown>>,
        PlaceOverview: mod.PlaceOverview as React.ComponentType<Record<string, unknown>>,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  if (!components) return null;

  const { PlaceOverview, PlacePicker } = components;

  return (
    <div className="flex flex-col gap-3">
      <PlacePicker
        placeholder={placeholder}
        onPlaceChange={(event: Event) => {
          const target = event.target as {
            value?: {
              id?: string;
              placeId?: string;
              formattedAddress?: string;
              name?: string;
              displayName?: string | { text?: string };
              location?: {
                lat?: number | (() => number);
                lng?: number | (() => number);
              };
              types?: string[];
            } | null;
          };
          const place = target.value ?? null;
          const placeId = place?.id ?? place?.placeId ?? null;
          if (!placeId || !place) {
            onPlacePicked?.(null);
            return;
          }
          const selectedPlace = place;
          const location = selectedPlace.location;
          const lat =
            typeof location?.lat === 'function'
              ? location.lat()
              : typeof location?.lat === 'number'
                ? location.lat
                : null;
          const lon =
            typeof location?.lng === 'function'
              ? location.lng()
              : typeof location?.lng === 'number'
                ? location.lng
                : null;
          const displayName =
            typeof selectedPlace.displayName === 'string'
              ? selectedPlace.displayName
              : selectedPlace.displayName?.text;
          onPlacePicked?.({
            place_id: placeId,
            label: selectedPlace.formattedAddress ?? displayName ?? selectedPlace.name ?? placeId,
            name: displayName ?? selectedPlace.name ?? placeId,
            address_text: selectedPlace.formattedAddress ?? null,
            category: Array.isArray(selectedPlace.types) ? (selectedPlace.types[0] ?? null) : null,
            country: null,
            region: null,
            lat,
            lon,
            timezone: null,
            metadata: {
              types: Array.isArray(selectedPlace.types) ? selectedPlace.types : [],
            },
          });
        }}
      />
      {selectedPlaceId ? <PlaceOverview place={selectedPlaceId} /> : null}
    </div>
  );
}

export function GoogleMap3DPreview({
  center,
  marker,
  markerLabel,
  height = 280,
}: {
  center: LatLngPoint;
  marker?: LatLngPoint | null;
  markerLabel?: string | null;
  height?: number;
}) {
  const maps3d = useMapsLibrary('maps3d');
  const markerLib = useMapsLibrary('marker') as google.maps.MarkerLibrary | null;
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!config.features.map3D) {
    return null;
  }

  if (!maps3d) {
    return (
      <div
        className="flex items-center justify-center rounded-[22px] border text-sm text-[var(--color-text-muted)]"
        style={{ height }}
      >
        3D preview is available when the Maps 3D library loads successfully.
      </div>
    );
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map3dElement = document.createElement('gmp-map-3d');
    map3dElement.setAttribute('center', `${center.lat},${center.lng},110`);
    map3dElement.setAttribute('mode', 'hybrid');
    map3dElement.setAttribute('tilt', '67.5');
    map3dElement.setAttribute('heading', '18');
    map3dElement.setAttribute('range', '820');
    map3dElement.setAttribute('default-ui-hidden', '');
    map3dElement.style.width = '100%';
    map3dElement.style.height = `${height}px`;

    if (config.map.mapId) {
      map3dElement.setAttribute('map-id', config.map.mapId);
    }

    if (marker) {
      const marker3dElement = document.createElement('gmp-marker-3d');
      marker3dElement.setAttribute('position', `${marker.lat},${marker.lng},32`);
      marker3dElement.setAttribute('altitude-mode', 'relative-to-ground');
      marker3dElement.setAttribute('extruded', '');
      marker3dElement.setAttribute('size-preserved', '');
      marker3dElement.setAttribute('draws-when-occluded', '');
      if (markerLabel) {
        marker3dElement.setAttribute('title', markerLabel);
      }

      if (markerLib?.PinElement) {
        const pin = new markerLib.PinElement({
          background: DEFAULT_SELECTED_MARKER_COLOR,
          borderColor: '#A86819',
          glyphColor: '#FFFFFF',
          scale: 1.2,
        });
        marker3dElement.appendChild(pin.element);
      }

      map3dElement.appendChild(marker3dElement);
    }

    container.replaceChildren(map3dElement);

    return () => {
      container.replaceChildren();
    };
  }, [center.lat, center.lng, height, marker, markerLabel, markerLib]);

  return <div ref={containerRef} style={{ height }} />;
}

export function TripMapLayerRenderer({ layers }: { layers: TripMapLayer[] }) {
  const nativeLayers = layers.filter((layer) => layer.is_visible && layer.renderer === 'native');
  const deckLayers = layers.filter((layer) => layer.is_visible && layer.renderer === 'deckgl');
  const boundaryLayers = layers.filter(
    (layer) => layer.is_visible && layer.renderer === 'dds-boundary',
  );
  const datasetLayers = layers.filter(
    (layer) => layer.is_visible && layer.renderer === 'dds-dataset',
  );

  return (
    <>
      {nativeLayers.map((layer) => (
        <GoogleGeoJsonLayer
          key={layer.id}
          featureCollection={layer.feature_collection}
          style={{
            strokeColor: String(layer.style.strokeColor || DEFAULT_VECTOR_MARKER_COLOR),
            strokeWeight: Number(layer.style.strokeWeight || 3),
            strokeOpacity: Number(layer.style.strokeOpacity || 0.92),
            fillColor: String(layer.style.fillColor || DEFAULT_VECTOR_MARKER_COLOR),
            fillOpacity: Number(layer.style.fillOpacity || 0.12),
          }}
        />
      ))}
      {deckLayers.length > 0 ? (
        <GoogleDeckOverlay
          layers={deckLayers.flatMap((layer) => createDeckLayersForTripMapLayer(layer))}
        />
      ) : null}
      {boundaryLayers.map((layer) => {
        const featureType = layer.metadata.featureType as google.maps.FeatureType | undefined;
        if (!featureType) return null;
        return (
          <GoogleFeatureLayer
            key={layer.id}
            featureType={featureType}
            style={{
              fillColor: String(layer.style.fillColor || '#72AEE6'),
              fillOpacity: Number(layer.style.fillOpacity || 0.16),
              strokeColor: String(layer.style.strokeColor || DEFAULT_VECTOR_MARKER_COLOR),
              strokeWeight: Number(layer.style.strokeWeight || 2),
            }}
          />
        );
      })}
      {datasetLayers.map((layer) => {
        const datasetId = String(layer.metadata.datasetId || '');
        if (!datasetId) return null;
        return (
          <GoogleDatasetLayer
            key={layer.id}
            datasetId={datasetId}
            style={{
              fillColor: String(layer.style.fillColor || '#72AEE6'),
              fillOpacity: Number(layer.style.fillOpacity || 0.18),
              strokeColor: String(layer.style.strokeColor || DEFAULT_VECTOR_MARKER_COLOR),
              strokeWeight: Number(layer.style.strokeWeight || 2),
            }}
          />
        );
      })}
    </>
  );
}

export { ControlPosition };
