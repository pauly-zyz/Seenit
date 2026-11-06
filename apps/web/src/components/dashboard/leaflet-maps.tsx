"use client";

import "leaflet/dist/leaflet.css";

import { useEffect } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

/** OpenStreetMap tiles by default; set NEXT_PUBLIC_MAP_TILE_URL for another provider. */
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export interface Point {
  lat: number;
  lng: number;
}

function Recenter({ center }: { center: Point }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [map, center.lat, center.lng]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (p: Point) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Click the map to place the mission; the circle shows the capture radius. */
export function LocationPickerMap({
  value,
  radius,
  onChange,
}: {
  value: Point;
  radius: number;
  onChange: (p: Point) => void;
}) {
  return (
    <MapContainer
      center={[value.lat, value.lng]}
      zoom={15}
      className="h-80 w-full rounded-xl"
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={value} />
      <ClickToPick onPick={onChange} />
      <Circle
        center={[value.lat, value.lng]}
        radius={radius}
        pathOptions={{ color: "#496600", fillColor: "#c8f051", fillOpacity: 0.3 }}
      />
      <CircleMarker
        center={[value.lat, value.lng]}
        radius={6}
        pathOptions={{ color: "#0e1116", fillColor: "#0e1116", fillOpacity: 1 }}
      />
    </MapContainer>
  );
}

export interface CapturePoint extends Point {
  id: string;
  label: string;
  color: string;
  accuracyMeters: number | null;
}

/** The mission area with each submission's GPS fix (and its accuracy radius). */
export function SubmissionsMap({
  center,
  radius,
  points,
  focusId,
}: {
  center: Point;
  radius: number;
  points: CapturePoint[];
  focusId?: string | null;
}) {
  const focus = points.find((p) => p.id === focusId);
  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={16}
      className="h-72 w-full rounded-xl"
      scrollWheelZoom
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      {focus ? <Recenter center={focus} /> : null}
      <Circle
        center={[center.lat, center.lng]}
        radius={radius}
        pathOptions={{ color: "#496600", fillColor: "#c8f051", fillOpacity: 0.2 }}
      />
      {points.map((p) => (
        <span key={p.id}>
          {p.accuracyMeters ? (
            <Circle
              center={[p.lat, p.lng]}
              radius={p.accuracyMeters}
              pathOptions={{ color: p.color, weight: 1, fillOpacity: 0.08 }}
            />
          ) : null}
          <CircleMarker
            center={[p.lat, p.lng]}
            radius={p.id === focusId ? 9 : 6}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: p.color, fillOpacity: 1 }}
          >
            <Tooltip>{p.label}</Tooltip>
          </CircleMarker>
        </span>
      ))}
    </MapContainer>
  );
}

export interface MissionPin extends Point {
  id: string;
  label: string;
  radius: number;
  locked: boolean;
}

/** Contributor app: missions around you (tap one to open it) and your own position. */
export function NearbyMap({
  you,
  missions,
  onSelect,
}: {
  you: Point;
  missions: MissionPin[];
  onSelect: (id: string) => void;
}) {
  return (
    <MapContainer center={[you.lat, you.lng]} zoom={14} className="h-72 w-full rounded-xl">
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={you} />
      {missions.map((m) => (
        <span key={m.id}>
          <Circle
            center={[m.lat, m.lng]}
            radius={m.radius}
            pathOptions={{
              color: m.locked ? "#8a8f98" : "#496600",
              fillColor: m.locked ? "#8a8f98" : "#c8f051",
              fillOpacity: 0.25,
            }}
            eventHandlers={{ click: () => onSelect(m.id) }}
          />
          <CircleMarker
            center={[m.lat, m.lng]}
            radius={7}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: m.locked ? "#8a8f98" : "#496600",
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelect(m.id) }}
          >
            <Tooltip>{m.label}</Tooltip>
          </CircleMarker>
        </span>
      ))}
      <CircleMarker
        center={[you.lat, you.lng]}
        radius={7}
        pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}
      >
        <Tooltip>You</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
