import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent } from 'react';
import L from 'leaflet';
import { createPortal } from 'react-dom';
import { Crosshair, Layers2, LocateFixed, Move } from 'lucide-react';
import { angleKey, bearingTo, changeCircle, circleRadius, radiusKey, pointOnCircle, safeSizeBearing, MIN_CIRCLE_RADIUS, MAX_CIRCLE_RADIUS } from './circle';
import { distance } from './routing/geo';
import type { Point, Route, Settings } from './routing/types';
import PlaceSearch from './PlaceSearch';
type Props = { settings: Settings; route?: Route; busy: boolean; onChange: (settings: Settings) => void };
type Frame = { center: L.Point; start: L.Point; resize: L.Point; ring: string };
type Gesture = { pointer: number; kind: 'start' | 'size' | 'center'; centerOffset: Point; before: Settings; last: Settings; offset: number; sizeBearingBefore: number; button: HTMLButtonElement; handlers: { handler: L.Handler; enabled: boolean }[] };
export default function MapView({ settings, route, busy, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const latest = useRef({ settings, busy, onChange });
  const suppressMapClickUntil = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const project = useRef<(settings?: Settings) => void>(() => {});
  const fit = useRef<(settings: Settings) => void>(() => {});
  const sizeBearing = useRef(135);
  const locationSequence = useRef(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [sizeFocused, setSizeFocused] = useState(false);
  const [circlePane, setCirclePane] = useState<HTMLElement>();
  const [frame, setFrame] = useState<Frame>();
  const [tileFailed, setTileFailed] = useState(false);
  const [showIdeal, setShowIdeal] = useState(true);
  const [ready, setReady] = useState(false);
  const cameraStableCenters = useRef(new WeakSet<Point>());
  const previousCenter = useRef<Point | undefined>(undefined);
  const lastRoute = useRef<Route | undefined>(undefined);
  useEffect(() => { latest.current = { settings, busy, onChange }; }, [settings, busy, onChange]);
  function finish(cancel: boolean) {
    const active = gesture.current;
    if (!active) return;
    suppressMapClickUntil.current = performance.now() + 350;
    gesture.current = null;
    if (active.kind === 'center') cameraStableCenters.current.add((cancel ? active.before : active.last).center);
    if (active.button.hasPointerCapture(active.pointer)) active.button.releasePointerCapture(active.pointer);
    for (const { handler, enabled } of active.handlers) if (enabled) handler.enable();
    if (cancel) { sizeBearing.current = active.sizeBearingBefore; latest.current.onChange(active.before); project.current(active.before); }
    else project.current(active.last);
  }
  useEffect(() => {
    if (!host.current) return;
    // React's development remount creates a new map; stale view refs must not
    // suppress fitting the restored selection or fresh example on that map.
    previousCenter.current = undefined; lastRoute.current = undefined; sizeBearing.current = 135;
    const selectedCenter = latest.current.settings.center;
    const instance = L.map(host.current, { zoomControl: false, minZoom: 3, maxZoom: 18, zoomSnap: 0.25, zoomAnimation: false, markerZoomAnimation: false, trackResize: false }).setView([selectedCenter.lat, selectedCenter.lon], 13);
    map.current = instance;
    const pane = instance.createPane('circle-controls'); pane.style.zIndex = '450'; pane.style.pointerEvents = 'none'; setCirclePane(pane);
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(instance);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19, updateWhenIdle: true, keepBuffer: 1,
    }).on('tileerror', () => setTileFailed(true)).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    project.current = selected => {
      const current = selected ?? latest.current.settings;
      const projectPoint = (p: Point) => instance.project([p.lat, current.center.lon + ((p.lon - current.center.lon + 540) % 360 - 180)]).subtract(instance.getPixelOrigin());
      const toScreen = (angle: number) => projectPoint(pointOnCircle(current.center, circleRadius(current), angle));
      const center = projectPoint(current.center);
      const start = projectPoint(current.start);
      const oldBearing = sizeBearing.current;
      sizeBearing.current = safeSizeBearing(oldBearing, bearingTo(current.center, current.start), center.distanceTo(start), oldBearing);
      let resize = toScreen(sizeBearing.current);
      // Account for geodesic/Mercator distortion at large radii/high latitudes.
      const side = Math.sin((sizeBearing.current - bearingTo(current.center, current.start)) * Math.PI / 180) >= 0 ? 1 : -1;
      for (let i = 0; i < 180 && resize.distanceTo(start) < 60 && center.distanceTo(start) >= 34; i++) { sizeBearing.current += side; resize = toScreen(sizeBearing.current); }
      const angles = [...Array.from({ length: 120 }, (_, index) => index * 3), bearingTo(current.center, current.start), ((sizeBearing.current % 360) + 360) % 360].sort((a, b) => a - b);
      const ring = angles.map((angle, index) => { const point = toScreen(angle); return `${index ? 'L' : 'M'}${point.x},${point.y}`; }).join(' ') + ' Z';
      setFrame({ center, start, resize, ring });
    };
    fit.current = current => {
      const bounds = L.latLng(current.center.lat, current.center.lon).toBounds(circleRadius(current) * 2);
      // Reserve room for handle faces/labels, search, attribution and map controls.
      // Short landscape maps need smaller vertical margins to retain usable handles.
      const compact = instance.getSize().y < 240;
      instance.fitBounds(bounds, { paddingTopLeft: [72, compact ? 45 : 70], paddingBottomRight: [72, compact ? 45 : 96], animate: false });
    };
    instance.on('move zoom viewreset resize', () => project.current());
    instance.on('click', event => {
      if (latest.current.busy || gesture.current || performance.now() < suppressMapClickUntil.current) return;
      const current = latest.current.settings;
      const center = instance.latLngToContainerPoint([current.center.lat, current.center.lon]);
      const start = instance.latLngToContainerPoint([current.start.lat, current.start.lon]);
      const click = event.containerPoint;
      // Screen-space selection tolerates touch without stealing pans or pinches.
      if (click.distanceTo(start) < 60) return;
      if (Math.abs(click.distanceTo(center) - start.distanceTo(center)) <= 16) {
        sizeBearing.current = bearingTo(current.center, { lat: event.latlng.lat, lon: event.latlng.lng });
        project.current(); return;
      }
      locationSequence.current++; setLocating(false); setLocationError('');
      latest.current.onChange(changeCircle(current, { center: { lat: event.latlng.lat, lon: event.latlng.lng } }));
    });
    const observer = new ResizeObserver(() => { instance.invalidateSize({ animate: false, pan: true }); project.current(); });
    observer.observe(host.current);
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); finish(true); } };
    const onBlur = () => finish(true);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('blur', onBlur);
    setReady(true);
    return () => {
      locationSequence.current++; finish(true); observer.disconnect();
      window.removeEventListener('keydown', onEscape); window.removeEventListener('blur', onBlur);
      instance.remove(); map.current = null; layers.current = null;
    };
  }, []);
  useEffect(() => {
    const group = layers.current, instance = map.current;
    if (!group || !instance) return;
    group.clearLayers();
    if (route) {
      if (showIdeal) L.circle([route.circleCenter.lat, route.circleCenter.lon], { radius: route.circleRadiusM, color: '#facc15', weight: 1.5, dashArray: '4 6', fill: false, interactive: false }).addTo(group);
      const points: L.LatLngTuple[] = route.points.map(p => [p.lat, p.lon]);
      L.polyline(points, { color: '#101c31', weight: 9, opacity: 0.8, interactive: false }).addTo(group);
      L.polyline(points, { color: '#3b82f6', weight: 4, interactive: false }).addTo(group);
      L.circleMarker(points[0], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('Route start & finish').addTo(group);
      if (lastRoute.current !== route) fit.current(settings);
    }
    if (!gesture.current && !cameraStableCenters.current.has(settings.center) && (!previousCenter.current || distance(previousCenter.current, settings.center) > 0.01)) fit.current(settings);
    // Fit emits intermediate projection events; restore the initial Size bearing
    // only after the first fit, so a small example still starts lower-right.
    if (!previousCenter.current) sizeBearing.current = 135;
    previousCenter.current = settings.center;
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
  function begin(event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'size' | 'center') {
    event.stopPropagation(); event.preventDefault();
    if (latest.current.busy || gesture.current || event.button !== 0) return;
    const point = geo(event), instance = map.current;
    if (!point || !instance) return;
    const current = latest.current.settings;
    locationSequence.current++; setLocating(false); setLocationError('');
    const handlers = [instance.dragging, instance.touchZoom, instance.doubleClickZoom, instance.scrollWheelZoom, instance.boxZoom, instance.keyboard].map(handler => ({ handler, enabled: handler.enabled() }));
    handlers.forEach(({ handler }) => handler.disable());
    gesture.current = { pointer: event.pointerId, kind, centerOffset: { lat: current.center.lat - point.lat, lon: current.center.lon - point.lon }, before: current, last: current, offset: kind === 'start' ? bearingTo(current.center, point) - bearingTo(current.center, current.start) : distance(current.center, point) - circleRadius(current), sizeBearingBefore: sizeBearing.current, button: event.currentTarget, handlers };
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
    const next = changeCircle(active.before, active.kind === 'center' ? { center: { lat: Math.max(-75, Math.min(75, point.lat + active.centerOffset.lat)), lon: ((point.lon + active.centerOffset.lon + 540) % 360) - 180 } } : active.kind === 'start' ? { bearing: bearingTo(active.before.center, point) - active.offset } : { radiusM: distance(active.before.center, point) - active.offset });
    if (active.kind === 'center') cameraStableCenters.current.add(next.center);
    if (active.kind === 'size') sizeBearing.current = safeSizeBearing(bearingTo(active.before.center, point), bearingTo(next.center, next.start), frame?.center.distanceTo(frame.start) ?? 100, sizeBearing.current);
    const changed = Math.abs(circleRadius(next) - circleRadius(active.last)) >= 0.001 || distance(next.start, active.last.start) >= 0.001;
    active.last = next;
    if (changed) latest.current.onChange(next);
    project.current(next);
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, kind: 'start' | 'size' | 'center') {
    if (event.key === 'Escape') { finish(true); return; }
    const current = latest.current.settings;
    if (kind === 'center') {
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = directions[event.key], instance = map.current;
      if (!delta || !instance) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 48 : 12;
      const point = instance.latLngToContainerPoint([current.center.lat, current.center.lon]);
      const nextCenter = instance.containerPointToLatLng([point.x + delta[0] * step, point.y + delta[1] * step]);
      const next = changeCircle(current, { center: { lat: Math.max(-75, Math.min(75, nextCenter.lat)), lon: ((nextCenter.lng + 540) % 360) - 180 } });
      cameraStableCenters.current.add(next.center); locationSequence.current++; setLocating(false); setLocationError('');
      latest.current.onChange(next); project.current(next); return;
    }
    const value = kind === 'start' ? angleKey(event.key, bearingTo(current.center, current.start), event.shiftKey) : radiusKey(event.key, circleRadius(current), event.shiftKey);
    if (value === undefined) return;
    event.preventDefault(); event.stopPropagation();
    const next = changeCircle(current, kind === 'start' ? { bearing: value } : { radiusM: value });
    latest.current.onChange(next);
    project.current(next);
  }
  function recenter(center: Point) {
    if (latest.current.busy || gesture.current) return;
    locationSequence.current++; setLocating(false); setLocationError('');
    latest.current.onChange(changeCircle(latest.current.settings, { center }));
  }
  function locate() {
    if (locating) { locationSequence.current++; setLocating(false); return; }
    if (!navigator.geolocation) { setLocationError('Location unavailable. Search for a place instead.'); return; }
    const id = ++locationSequence.current;
    const centerAtRequest = latest.current.settings.center;
    setLocating(true); setLocationError('');
    navigator.geolocation.getCurrentPosition(position => {
      if (id !== locationSequence.current) return;
      setLocating(false);
      if (latest.current.settings.center !== centerAtRequest) return;
      if (Math.abs(position.coords.latitude) > 75) { setLocationError('Choose a location between 75° south and north.'); return; }
      recenter({ lat: position.coords.latitude, lon: position.coords.longitude });
    }, error => {
      if (id !== locationSequence.current) return;
      setLocating(false); setLocationError(error.code === 1 ? 'Location permission denied. Search for a place instead.' : 'Couldn’t locate you. Search for a place instead.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  useEffect(() => { if (busy) { locationSequence.current++; setLocating(false); } }, [busy]);
  const bearing = bearingTo(settings.center, settings.start);
  return <div className={`map-shell ${busy ? 'working' : ''}`}>
    <div ref={host} className="map" aria-label="Circle map. Drag the center handle to move the circle, click to move the center, drag S around the edge to choose a start, or focus Size and use arrow keys to resize." />
    {frame && circlePane && createPortal(<div className="circle-overlay circle-layer">
      <svg className="clock-lines" aria-hidden="true"><path className="target-ring" d={frame.ring} /><circle className="target-center" cx={frame.center.x} cy={frame.center.y} r="4" /><defs><marker id="size-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="#60a5fa" strokeWidth="1.5" /></marker></defs><line x1={frame.center.x} y1={frame.center.y} x2={frame.resize.x} y2={frame.resize.y} className="size-radius" />{frame.resize.distanceTo(frame.center) >= 34 && <line x1={frame.center.x + (frame.resize.x - frame.center.x) * 28 / frame.resize.distanceTo(frame.center)} y1={frame.center.y + (frame.resize.y - frame.center.y) * 28 / frame.resize.distanceTo(frame.center)} x2={frame.resize.x - (frame.resize.x - frame.center.x) * 25 / frame.resize.distanceTo(frame.center)} y2={frame.resize.y - (frame.resize.y - frame.center.y) * 25 / frame.resize.distanceTo(frame.center)} className="size-arrow-guide" markerStart="url(#size-arrow)" markerEnd="url(#size-arrow)" />}</svg>
      <button type="button" className="circle-handle center-handle" style={{ left: frame.center.x, top: frame.center.y }} aria-label="Move circle" aria-description="Drag to move the circle. Arrow keys move it; Shift moves farther. Radius and start angle stay fixed. Escape cancels a drag." disabled={busy} title="Drag to move circle. Arrow keys move; Shift moves farther." onPointerDown={event => begin(event, 'center')} onPointerMove={move} onPointerUp={event => { event.stopPropagation(); if (gesture.current?.pointer === event.pointerId) { if (event.currentTarget.hasPointerCapture(event.pointerId)) { move(event); finish(false); } else finish(true); } }} onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onLostPointerCapture={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onKeyDown={event => key(event, 'center')} onClick={event => event.stopPropagation()}><Move size={18} aria-hidden="true" /></button>
      {(['start', 'size'] as const).map(kind => {
        const point = kind === 'start' ? frame.start : frame.resize;
        return <button key={kind} type="button" hidden={kind === 'size' && frame.resize.distanceTo(frame.center) < 34 && gesture.current?.kind !== 'size' && !sizeFocused} className={`circle-handle ${kind}-handle ${kind === 'size' && frame.resize.distanceTo(frame.center) < 34 && gesture.current?.kind !== 'size' ? 'size-too-small' : ''}`} style={{ left: point.x, top: point.y }} role="slider" aria-label={kind === 'start' ? 'Start angle' : 'Circle radius'} aria-valuemin={kind === 'start' ? 0 : MIN_CIRCLE_RADIUS} aria-valuemax={kind === 'start' ? 359 : MAX_CIRCLE_RADIUS} aria-valuenow={Math.round(kind === 'start' ? bearing : circleRadius(settings))} aria-valuetext={kind === 'start' ? `${Math.round(bearing)} degrees clockwise from north` : `${(circleRadius(settings) / 1000).toFixed(2)} kilometers`} disabled={busy} title={kind === 'start' ? 'Drag around the circle to choose a start. Arrow keys rotate.' : 'Drag outward or inward to resize. Arrow keys resize.'} onFocus={() => { if (kind === 'size') setSizeFocused(true); }} onBlur={() => { if (kind === 'size') setSizeFocused(false); }} onPointerDown={event => begin(event, kind)} onPointerMove={move} onPointerUp={event => { event.stopPropagation(); if (gesture.current?.pointer === event.pointerId) { if (event.currentTarget.hasPointerCapture(event.pointerId)) { move(event); finish(false); } else finish(true); } }} onPointerCancel={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onLostPointerCapture={event => { if (gesture.current?.pointer === event.pointerId) finish(true); }} onKeyDown={event => key(event, kind)} onClick={event => event.stopPropagation()}><span aria-hidden="true">{kind === 'start' ? 'S' : '↔'}</span><small aria-hidden="true">{kind === 'start' ? 'Start' : 'Size'}</small></button>;
      })}
    </div>, circlePane)}
    <div className="map-topline"><PlaceSearch busy={busy} onSelect={recenter} /><button className="map-button" onClick={() => fit.current(settings)} title="Fit circle" aria-label="Fit circle"><Crosshair size={17} /></button></div>
    <button type="button" className="locate-button map-button" aria-label={locating ? 'Cancel locating' : 'Locate me'} aria-pressed={locating} disabled={busy} onClick={locate}><LocateFixed size={18} /></button>
    {locationError && <div className="location-error" role="status">{locationError}<button type="button" aria-label="Dismiss location message" onClick={() => setLocationError('')}>×</button></div>}
    <div className="map-hint">{busy ? 'Finding a loop…' : 'Drag center to move · S to set start · Size to resize'}</div>
    {route && <button className={`ideal-toggle ${showIdeal ? 'selected' : ''}`} onClick={() => setShowIdeal(!showIdeal)} aria-pressed={showIdeal}><Layers2 size={14} /> Ideal circle</button>}
    {tileFailed && <div className="tile-warning" role="status">Map tiles unavailable. Use the circle controls.</div>}
  </div>;
}
