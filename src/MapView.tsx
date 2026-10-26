import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent } from 'react';
import L from 'leaflet';
import { Crosshair, Layers2 } from 'lucide-react';
import { angleKey, bearingTo, changeCircle, circleRadius, radiusKey } from './circle';
import { distance } from './routing/geo';
import type { Point, Route, Settings } from './routing/types';
type Props = { settings: Settings; route?: Route; busy: boolean; onChange: (settings: Settings) => void };
type Frame = { center: L.Point; start: L.Point; resize: L.Point; edge: L.Point };
type Gesture = { pointer: number; kind: 'start' | 'size'; before: Settings; last: Settings; offset: number; button: HTMLButtonElement; handlers: { handler: L.Handler; enabled: boolean }[] };
export default function MapView({ settings, route, busy, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ settings, busy, onChange });
  const gesture = useRef<Gesture | null>(null);
  const project = useRef<() => void>(() => {});
  const fit = useRef<(settings: Settings) => void>(() => {});
  const [frame, setFrame] = useState<Frame>();
  const [tileFailed, setTileFailed] = useState(false);
  const [showIdeal, setShowIdeal] = useState(true);
  const [ready, setReady] = useState(false);
  const previousCenter = useRef<Point | undefined>(undefined);
  const previousRadius = useRef<number | undefined>(undefined);
  const lastRoute = useRef<Route | undefined>(undefined);
  useEffect(() => { latest.current = { settings, busy, onChange }; }, [settings, busy, onChange]);
  function finish(cancel: boolean) {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.button.hasPointerCapture(active.pointer)) active.button.releasePointerCapture(active.pointer);
    for (const { handler, enabled } of active.handlers) if (enabled) handler.enable();
    if (cancel) latest.current.onChange(active.before);
    else if (active.kind === 'size') fit.current(active.last);
  }
  useEffect(() => {
    if (!host.current) return;
    const instance = L.map(host.current, { zoomControl: false, minZoom: 3, maxZoom: 18 }).setView([49.299, -123.133], 13);
    map.current = instance;
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19, updateWhenIdle: true, keepBuffer: 1,
    }).on('tileerror', () => setTileFailed(true)).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    project.current = () => {
      const current = latest.current.settings;
      const center = instance.latLngToContainerPoint([current.center.lat, current.center.lon]);
      const start = instance.latLngToContainerPoint([current.start.lat, current.start.lon]);
      // Fixed south-east resize affordance, offset outside the ring so it cannot
      // overlap the start hand when the angle passes through this quadrant.
      const radiusPx = Math.abs(instance.latLngToContainerPoint([current.center.lat + circleRadius(current) / 111195, current.center.lon]).y - center.y);
      const unit = Math.SQRT1_2;
      setFrame({ center, start, edge: L.point(center.x + radiusPx * unit, center.y + radiusPx * unit), resize: L.point(center.x + (radiusPx + 56) * unit, center.y + (radiusPx + 56) * unit) });
    };
    fit.current = current => {
      const bounds = L.latLng(current.center.lat, current.center.lon).toBounds(circleRadius(current) * 2);
      instance.fitBounds(bounds, { padding: [64, 64], animate: false });
    };
    instance.on('move zoom resize', () => project.current());
    instance.on('click', event => {
      if (latest.current.busy || gesture.current) return;
      latest.current.onChange(changeCircle(latest.current.settings, { center: { lat: event.latlng.lat, lon: event.latlng.lng } }));
    });
    const observer = new ResizeObserver(() => { instance.invalidateSize(); if (!gesture.current) fit.current(latest.current.settings); project.current(); });
    observer.observe(host.current);
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); finish(true); } };
    const onBlur = () => finish(true);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', onBlur);
    setReady(true);
    return () => {
      finish(true); observer.disconnect();
      window.removeEventListener('keydown', onEscape); window.removeEventListener('blur', onBlur);
      instance.remove(); map.current = null; layers.current = null;
    };
  }, []);
  useEffect(() => {
    const group = layers.current, instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    L.circle([settings.center.lat, settings.center.lon], { radius: circleRadius(settings), color: '#60a5fa', fillColor: '#3b82f6', fillOpacity: 0.055, weight: 2, interactive: false }).addTo(group);
    L.circleMarker([settings.center.lat, settings.center.lon], { radius: 4, color: '#dbeafe', fillColor: '#3b82f6', fillOpacity: 1, weight: 1, interactive: false }).addTo(group);
    if (route) {
      if (showIdeal) L.circle([route.circleCenter.lat, route.circleCenter.lon], { radius: route.circleRadiusM, color: '#facc15', weight: 1.5, dashArray: '4 6', fill: false, interactive: false }).addTo(group);
      const points: L.LatLngTuple[] = route.points.map(p => [p.lat, p.lon]);
      L.polyline(points, { color: '#101c31', weight: 9, opacity: 0.8, interactive: false }).addTo(group);
      L.polyline(points, { color: '#3b82f6', weight: 4, interactive: false }).addTo(group);
      L.circleMarker(points[0], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Route start & finish').addTo(group);
      if (lastRoute.current !== route) fit.current(settings);
    }
    if (!gesture.current && (!previousCenter.current || distance(previousCenter.current, settings.center) > 0.01 || previousRadius.current !== circleRadius(settings))) fit.current(settings);
    previousCenter.current = settings.center;
    previousRadius.current = circleRadius(settings);
    lastRoute.current = route;
    project.current();
  }, [settings, route, showIdeal, ready]);
  function geo(event: ReactPointerEvent<HTMLButtonElement>): Point | undefined {
    const instance = map.current, element = host.current;
    if (!instance || !element) return;
    const box = element.getBoundingClientRect();
    const point = instance.containerPointToLatLng([event.clientX - box.left, event.clientY - box.top]);
    return { lat: point.lat, lon: point.lng };
  }
  function begin(event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'size') {
    event.stopPropagation(); event.preventDefault();
    if (latest.current.busy || gesture.current || event.button !== 0) return;
    const point = geo(event), instance = map.current;
    if (!point || !instance) return;
    const current = latest.current.settings;
    const handlers = [instance.dragging, instance.touchZoom, instance.doubleClickZoom, instance.scrollWheelZoom, instance.boxZoom, instance.keyboard].map(handler => ({ handler, enabled: handler.enabled() }));
    handlers.forEach(({ handler }) => handler.disable());
    gesture.current = { pointer: event.pointerId, kind, before: current, last: current, offset: kind === 'start' ? bearingTo(current.center, point) - bearingTo(current.center, current.start) : distance(current.center, point) - circleRadius(current), button: event.currentTarget, handlers };
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.stopPropagation(); event.preventDefault();
    const point = geo(event);
    if (!point) return;
    if (active.kind === 'start' && distance(point, active.before.center) < circleRadius(active.before) * 0.1) return;
    const next = changeCircle(latest.current.settings, active.kind === 'start' ? { bearing: bearingTo(active.before.center, point) - active.offset } : { radiusM: distance(active.before.center, point) - active.offset });
    if (Math.abs(circleRadius(next) - circleRadius(active.last)) < 0.001 && distance(next.start, active.last.start) < 0.001) return;
    active.last = next;
    latest.current.onChange(next);
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, kind: 'start' | 'size') {
    if (event.key === 'Escape') { finish(true); return; }
    const current = latest.current.settings;
    const value = kind === 'start' ? angleKey(event.key, bearingTo(current.center, current.start), event.shiftKey) : radiusKey(event.key, circleRadius(current), event.shiftKey);
    if (value === undefined) return;
    event.preventDefault(); event.stopPropagation();
    const next = changeCircle(current, kind === 'start' ? { bearing: value } : { radiusM: value });
    latest.current.onChange(next);
    if (kind === 'size') fit.current(next);
  }
  const bearing = bearingTo(settings.center, settings.start);
  return <div className={`map-shell ${busy ? 'working' : ''}`}>
    <div ref={host} className="map" aria-label="Circle map. Click to move the center, drag S around the edge to choose a start, or use the numeric controls." />
    {frame && <div className="circle-overlay">
      <svg className="clock-lines" aria-hidden="true"><line x1={frame.center.x} y1={frame.center.y} x2={frame.start.x} y2={frame.start.y} className="clock-hand" /><line x1={frame.edge.x} y1={frame.edge.y} x2={frame.resize.x} y2={frame.resize.y} className="resize-leader" /></svg>
      {(['start', 'size'] as const).map(kind => {
        const point = kind === 'start' ? frame.start : frame.resize;
        return <button key={kind} type="button" className={`circle-handle ${kind}-handle`} style={{ left: point.x, top: point.y }} role="slider" aria-label={kind === 'start' ? 'Start angle' : 'Circle radius'} aria-valuemin={kind === 'start' ? 0 : 500} aria-valuemax={kind === 'start' ? 359 : 4500} aria-valuenow={Math.round(kind === 'start' ? bearing : circleRadius(settings))} aria-valuetext={kind === 'start' ? `${Math.round(bearing)} degrees clockwise from north` : `${(circleRadius(settings) / 1000).toFixed(2)} kilometers`} disabled={busy} title={kind === 'start' ? 'Drag around the circle to choose a start. Arrow keys rotate.' : 'Drag outward or inward to resize. Arrow keys resize.'} onPointerDown={event => begin(event, kind)} onPointerMove={move} onPointerUp={event => { event.stopPropagation(); if (gesture.current?.pointer === event.pointerId) { move(event); finish(false); } }} onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onLostPointerCapture={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onKeyDown={event => key(event, kind)} onClick={event => event.stopPropagation()}><span aria-hidden="true">{kind === 'start' ? 'S' : '↔'}</span><small aria-hidden="true">{kind === 'start' ? 'Start' : 'Size'}</small></button>;
      })}
    </div>}
    <div className="map-topline"><span className="map-tag"><span className="live-dot" /> {route ? 'ROUTE' : 'CIRCLE'}</span><button className="map-button" onClick={() => fit.current(settings)} title="Fit circle" aria-label="Fit circle"><Crosshair size={17} /></button></div>
    <div className="map-hint">{busy ? 'Finding a loop…' : 'Drag S to set start · drag ↔ to resize · click to move center'}</div>
    {route && <button className={`ideal-toggle ${showIdeal ? 'selected' : ''}`} onClick={() => setShowIdeal(!showIdeal)} aria-pressed={showIdeal}><Layers2 size={14} /> Ideal circle</button>}
    {tileFailed && <div className="tile-warning" role="status">Map tiles unavailable. Use the circle controls.</div>}
  </div>;
}
