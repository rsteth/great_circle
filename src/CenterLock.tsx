import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import type L from 'leaflet';
import { distance } from './routing/geo';
import type { Point, Settings } from './routing/types';
export const CENTER_HOLD_MS = 600;
const MOTION_PX = 8;
type Visual = { x: number; y: number; progress: number; unlocked: boolean; keyboard: boolean };
type Hold = { pointer: number; source: 'handle' | 'map'; originX: number; originY: number; x: number; y: number; since: number; unlocked: boolean; offset: Point; before: Settings; capture: HTMLElement; handlers: { handler: L.Handler; enabled: boolean }[]; raf: number };
type Props = { map: L.Map; settings: Settings; busy: boolean; position: L.Point; onCommit: (point: Point) => void; onSuppressClick: () => void };
/** Preview is transactional: no settings/route changes until an unlocked release. */
export default function CenterLock({ map, settings, busy, position, onCommit, onSuppressClick }: Props) {
  const button = useRef<HTMLButtonElement>(null), hold = useRef<Hold | null>(null);
  const pointers = useRef(new Set<number>()), keyboard = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ settings, busy, onCommit, onSuppressClick });
  const [visual, setVisual] = useState<Visual>();
  useLayoutEffect(() => { latest.current = { settings, busy, onCommit, onSuppressClick }; });
  const container = map.getContainer(), shell = container.parentElement!;
  function disableMap(active: Hold) {
    if (active.handlers.length) return;
    active.handlers = [map.dragging, map.touchZoom, map.doubleClickZoom, map.scrollWheelZoom, map.boxZoom, map.keyboard].map(handler => ({ handler, enabled: handler.enabled() }));
    active.handlers.forEach(({ handler }) => handler.disable());
  }
  function point(x: number, y: number, offset = { lat: 0, lon: 0 }): Point {
    const bounds = container.getBoundingClientRect(), p = map.containerPointToLatLng([x - bounds.left, y - bounds.top]);
    return { lat: Math.max(-75, Math.min(75, p.lat + offset.lat)), lon: ((p.lng + offset.lon + 540) % 360) - 180 };
  }
  function preview(active: Hold) {
    const bounds = shell.getBoundingClientRect();
    setVisual({ x: active.x - bounds.left, y: active.y - bounds.top, progress: Math.max(0, Math.min(1, (performance.now() - active.since) / CENTER_HOLD_MS)), unlocked: active.unlocked, keyboard: false });
  }
  function finish(commit = false) {
    const active = hold.current; hold.current = null;
    if (active) {
      cancelAnimationFrame(active.raf);
      if (active.capture.hasPointerCapture(active.pointer)) active.capture.releasePointerCapture(active.pointer);
      active.handlers.forEach(({ handler, enabled }) => { if (enabled) handler.enable(); });
      if (active.source === 'handle' || active.unlocked) latest.current.onSuppressClick();
      const bounds = container.getBoundingClientRect();
      const inside = active.x >= bounds.left && active.x <= bounds.right && active.y >= bounds.top && active.y <= bounds.bottom;
      if (commit && inside && active.unlocked && !latest.current.busy && latest.current.settings === active.before) {
        const next = point(active.x, active.y, active.offset);
        if (distance(next, active.before.center) > .01) latest.current.onCommit(next);
      }
    }
    keyboard.current = null; setVisual(undefined);
  }
  function tick() {
    const active = hold.current; if (!active) return;
    if (latest.current.busy || pointers.current.size > 1) { finish(); return; }
    if (!active.unlocked && performance.now() - active.since >= CENTER_HOLD_MS) {
      active.unlocked = true; disableMap(active);
      active.capture.setPointerCapture(active.pointer);
    }
    preview(active); active.raf = requestAnimationFrame(tick);
  }
  function begin(event: PointerEvent | ReactPointerEvent<HTMLButtonElement>, source: Hold['source']) {
    if (latest.current.busy || event.button !== 0 || pointers.current.size > 1) return;
    finish();
    const current = latest.current.settings, p = point(event.clientX, event.clientY);
    const active: Hold = { pointer: event.pointerId, source, originX: event.clientX, originY: event.clientY, x: event.clientX, y: event.clientY, since: performance.now(), unlocked: false, offset: source === 'handle' ? { lat: current.center.lat - p.lat, lon: current.center.lon - p.lon } : { lat: 0, lon: 0 }, before: current, capture: source === 'handle' ? button.current! : container, handlers: [], raf: 0 };
    hold.current = active;
    if (source === 'handle') { disableMap(active); active.capture.setPointerCapture(active.pointer); }
    preview(active); active.raf = requestAnimationFrame(tick);
  }
  useEffect(() => {
    function down(event: PointerEvent) {
      pointers.current.add(event.pointerId);
      if (pointers.current.size > 1) finish();
    }
    function mapDown(event: PointerEvent) {
      if (event.pointerType === 'mouse' || !(event.target instanceof Element) || event.target.closest('button,input,a,select,textarea,summary,.leaflet-control,.leaflet-interactive,.circle-handle')) return;
      begin(event, 'map'); // No capture/preventDefault before dwell: native Leaflet pan/pinch remains available.
    }
    function move(event: PointerEvent) {
      const active = hold.current; if (!active || active.pointer !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - active.originX, event.clientY - active.originY);
      if (!active.unlocked && moved > MOTION_PX) {
        if (active.source === 'map') { finish(); return; }
        active.originX = event.clientX; active.originY = event.clientY; active.since = performance.now();
      }
      active.x = event.clientX; active.y = event.clientY;
      if (active.source === 'handle' || active.unlocked) { event.preventDefault(); event.stopPropagation(); }
      preview(active);
    }
    function up(event: PointerEvent) {
      pointers.current.delete(event.pointerId);
      if (hold.current?.pointer === event.pointerId) { if (hold.current.source === 'handle' || hold.current.unlocked) event.stopPropagation(); finish(hold.current.capture.hasPointerCapture(event.pointerId)); }
    }
    function cancelled(event: PointerEvent) { pointers.current.delete(event.pointerId); if (hold.current?.pointer === event.pointerId) finish(); }
    function lost(event: PointerEvent) { if (hold.current?.pointer === event.pointerId) finish(); }
    function escape(event: globalThis.KeyboardEvent) { if (event.key === 'Escape' && (hold.current || keyboard.current)) { event.preventDefault(); event.stopPropagation(); finish(); } }
    function blur() { pointers.current.clear(); finish(); }
    function visibility() { if (document.hidden) blur(); }
    function context(event: Event) { if (hold.current) event.preventDefault(); }
    function camera() { if (hold.current || keyboard.current) finish(); }
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointermove', move, { capture: true, passive: false }); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', cancelled, true);
    document.addEventListener('keydown', escape, true); document.addEventListener('scroll', camera, true); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur); window.addEventListener('pagehide', blur); container.addEventListener('pointerdown', mapDown); container.addEventListener('lostpointercapture', lost); container.addEventListener('contextmenu', context); container.addEventListener('wheel', camera, { passive: true }); map.on('movestart zoomstart resize', camera);
    return () => {
      finish(); document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', cancelled, true);
      document.removeEventListener('keydown', escape, true); document.removeEventListener('scroll', camera, true); document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur); window.removeEventListener('pagehide', blur); container.removeEventListener('pointerdown', mapDown); container.removeEventListener('lostpointercapture', lost); container.removeEventListener('contextmenu', context); container.removeEventListener('wheel', camera); map.off('movestart zoomstart resize', camera);
    };
  }, [map]);
  useEffect(() => { finish(); }, [busy, settings]);
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const active = keyboard.current;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation();
      if (active) { const next = point(active.x, active.y); finish(); if (distance(next, latest.current.settings.center) > .01) latest.current.onCommit(next); }
      else {
        finish(); const p = map.latLngToContainerPoint([settings.center.lat, settings.center.lon]), bounds = container.getBoundingClientRect();
        keyboard.current = { x: p.x + bounds.left, y: p.y + bounds.top }; const shellBounds = shell.getBoundingClientRect();
        setVisual({ x: keyboard.current.x - shellBounds.left, y: keyboard.current.y - shellBounds.top, progress: 1, unlocked: true, keyboard: true });
      }
      return;
    }
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = directions[event.key]; if (!delta) return;
    event.preventDefault(); event.stopPropagation(); if (!active) return;
    const step = event.shiftKey ? 48 : 12; active.x += delta[0] * step; active.y += delta[1] * step;
    const bounds = shell.getBoundingClientRect(); setVisual({ x: active.x - bounds.left, y: active.y - bounds.top, progress: 1, unlocked: true, keyboard: true });
  }
  const countdown = (active: boolean) => <svg className="center-countdown" viewBox="0 0 44 44" aria-hidden="true" data-active={active} data-unlocked={!!visual?.unlocked}><circle cx="22" cy="22" r="21" pathLength="1" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="1 1" strokeDashoffset={active ? -(visual?.progress ?? 0) : 0} /></svg>;
  return <><span id="center-lock-help" className="center-lock-announcement">Center locked. Drag and hold still for 600 milliseconds, then release to move. Or press Enter to unlock, arrows to position, Enter to confirm, Escape to cancel.</span><button ref={button} type="button" className="circle-handle center-handle center-lock" style={{ left: position.x, top: position.y }} aria-label="Move circle" aria-pressed={!!visual?.unlocked} aria-describedby="center-lock-help" disabled={busy} title="Hold to move. Keyboard: Enter, arrows, Enter." onPointerDown={event => { event.preventDefault(); event.stopPropagation(); button.current?.focus({ preventScroll: true }); begin(event, 'handle'); }} onLostPointerCapture={event => { if (hold.current?.pointer === event.pointerId) finish(); }} onKeyDown={key} onBlur={() => { if (keyboard.current) finish(); }} onClick={event => event.stopPropagation()}>{countdown(!!visual && !visual.keyboard)}{visual?.unlocked ? <LockKeyholeOpen size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}</button>
    {visual && createPortal(<div className="center-lock-preview" style={{ left: visual.x, top: visual.y, opacity: .25 + visual.progress * .75 }} aria-hidden="true" data-unlocked={visual.unlocked}><span className="lock-progress">{countdown(!visual.keyboard)}{visual.unlocked ? <LockKeyholeOpen size={20} /> : <LockKeyhole size={20} />}</span><small style={{ left: Math.max(8, Math.min(shell.clientWidth - 218, visual.x - 105)) - visual.x + 22, width: 210 }}>{visual.unlocked ? visual.keyboard ? 'Enter to move · Esc to cancel' : 'Release to move' : 'Hold to unlock'}</small></div>, shell)}
    {visual && createPortal(<span className="center-lock-announcement" role="status" aria-label="Center movement">{visual.unlocked ? visual.keyboard ? 'Center unlocked. Arrow keys position the preview. Enter moves the circle; Escape cancels.' : 'Center unlocked. Release to move; Escape cancels.' : 'Hold still to unlock the center.'}</span>, shell)}
  </>;
}
