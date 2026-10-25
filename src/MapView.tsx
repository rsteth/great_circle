import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Crosshair, Layers2 } from 'lucide-react';
import type { Point, Route, Settings } from './routing/types';
type Props = { settings: Settings; route?: Route; mode: 'area' | 'start'; busy: boolean; onPick: (point: Point) => void };
export default function MapView({ settings, route, mode, busy, onPick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ onPick, busy });
  const [tileFailed, setTileFailed] = useState(false);
  const [showIdeal, setShowIdeal] = useState(true);
  const [viewReady, setViewReady] = useState(false);
  const lastRoute = useRef<Route | undefined>(undefined);
  useEffect(() => { latest.current = { onPick, busy }; }, [onPick, busy]);
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { zoomControl: false, minZoom: 3, maxZoom: 18 }).setView([49.299, -123.133], 13);
    map.current = instance;
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(instance);
    const tile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19, updateWhenIdle: true, keepBuffer: 1,
    }).addTo(instance);
    tile.on('tileerror', () => setTileFailed(true));
    layers.current = L.layerGroup().addTo(instance);
    instance.on('click', event => { if (!latest.current.busy) latest.current.onPick({ lat: event.latlng.lat, lon: event.latlng.lng }); });
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(host.current);
    setViewReady(true);
    return () => { observer.disconnect(); instance.remove(); map.current = null; layers.current = null; };
  }, []);
  useEffect(() => {
    const group = layers.current;
    const instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    const area = L.circle([settings.center.lat, settings.center.lon], { radius: settings.radiusM, color: '#60a5fa', fillColor: '#3b82f6', fillOpacity: 0.045, weight: 1.5, dashArray: '5 7', interactive: false }).addTo(group);
    L.circleMarker([settings.center.lat, settings.center.lon], { radius: 4, color: '#bfdbfe', fillColor: '#60a5fa', fillOpacity: 1, weight: 1, interactive: false }).addTo(group);
    if (route) {
      if (showIdeal) L.circle([route.circleCenter.lat, route.circleCenter.lon], { radius: route.circleRadiusM, color: '#facc15', weight: 1.5, dashArray: '4 6', fill: false, interactive: false }).addTo(group);
      const points: L.LatLngTuple[] = route.points.map(p => [p.lat, p.lon]);
      L.polyline(points, { color: '#101c31', weight: 9, opacity: 0.8, interactive: false }).addTo(group);
      L.polyline(points, { color: '#3b82f6', weight: 4, opacity: 1, interactive: false }).addTo(group);
      L.circleMarker(points[0], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Route start & finish').addTo(group);
      if (lastRoute.current !== route) instance.fitBounds(L.latLngBounds(points).pad(0.15), { animate: false });
    } else if (lastRoute.current || !instance.getBounds().contains([settings.center.lat, settings.center.lon])) {
      instance.fitBounds(area.getBounds().pad(0.1), { animate: false });
    }
    const icon = L.divIcon({ className: 'start-icon', html: '<span>S</span>', iconSize: [28, 28], iconAnchor: [14, 14] });
    L.marker([settings.start.lat, settings.start.lon], { icon, keyboard: true, title: 'Selected start pin' }).addTo(group).bindTooltip('Selected start · route may start up to 300 m away');
    lastRoute.current = route;
  }, [settings, route, showIdeal, viewReady]);
  function fitArea() {
    map.current?.fitBounds(L.latLng([settings.center.lat, settings.center.lon]).toBounds(settings.radiusM * 2.3));
  }
  return <div className={`map-shell ${busy ? 'working' : ''}`}>
    <div ref={host} className="map" aria-label="Route map. Click to select the area center or start. Coordinate inputs are also available." />
    <div className="map-topline"><span className="map-tag"><span className="live-dot" /> {route ? 'ROUTE' : 'AREA'}</span><button className="map-button" onClick={fitArea} title="Fit search area" aria-label="Fit search area"><Crosshair size={17} /></button></div>
    <div className="map-hint">{busy ? 'Finding a loop…' : `Click to set ${mode === 'area' ? 'area center' : 'start'}.`}</div>
    {route && <button className={`ideal-toggle ${showIdeal ? 'selected' : ''}`} onClick={() => setShowIdeal(!showIdeal)} aria-pressed={showIdeal}><Layers2 size={14} /> Ideal circle</button>}
    {tileFailed && <div className="tile-warning" role="status">Map tiles unavailable. Try coordinates.</div>}
  </div>;
}
