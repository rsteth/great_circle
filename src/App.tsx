import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleDashed, Flag, LoaderCircle, MoveUpRight, RotateCcw, Route as RouteIcon, SlidersHorizontal, X } from 'lucide-react';
import MapView from './MapView';
import NumberControl from './NumberControl';
import RadiusControl from './RadiusControl';
import SettingsDrawer from './SettingsDrawer';
import useMobileLayout from './useMobileLayout';
import { bearingTo, changeCircle, circleRadius } from './circle';
import { toGpx } from './routing/gpx';
import { planRoute, PlanningFailure } from './routing/plan';
import { SearchClient } from './routing/searchClient';
import { validateSettings } from './routing/solve';
import type { Point, Route, Settings } from './routing/types';
import { exampleSettings, readSelection, writeSelection } from './selection';

function Coordinates({ point, onApply }: { point: Point; onApply: (point: Point) => void }) {
  const [lat, setLat] = useState(String(point.lat));
  const [lon, setLon] = useState(String(point.lon));
  const [error, setError] = useState('');
  useEffect(() => { setLat(point.lat.toFixed(5)); setLon(point.lon.toFixed(5)); setError(''); }, [point]);
  return <details className="coordinates"><summary>Coordinates <ChevronDown size={13} /></summary><div className="coordinate-inputs"><label>Latitude<input inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></label><label>Longitude<input inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} /></label></div><button type="button" className="text-button" onClick={() => {
    const next = { lat: Number(lat), lon: Number(lon) };
    if (!lat.trim() || !lon.trim() || !Number.isFinite(next.lat) || !Number.isFinite(next.lon) || Math.abs(next.lat) > 75 || Math.abs(next.lon) > 180) { setError('Use latitude −75 to 75 and longitude −180 to 180.'); return; }
    setError(''); onApply(next);
  }}>Set pin <ArrowUpRight size={13} /></button>{error && <p className="input-error" role="alert">{error}</p>}</details>;
}
export default function App() {
  const [settings, setSettings] = useState<Settings>(() => readSelection() ?? exampleSettings());
  const userSelected = useRef(false);
  useEffect(() => { if (userSelected.current) writeSelection(settings); }, [settings]);
  const [route, setRoute] = useState<Route>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Size the circle, then drag S to choose a start.');
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const mobile = useMobileLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFocus, setDrawerFocus] = useState<string>();
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const drawerReturn = useRef<HTMLButtonElement | null>(null);
  const errorBox = useRef<HTMLDivElement>(null);
  const dockResult = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!mobile) setDrawerOpen(false); }, [mobile]);
  useEffect(() => { if (mobile && error && !drawerOpen) errorBox.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [error, mobile, drawerOpen]);
  useEffect(() => { if (mobile && route) dockResult.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }, [route, mobile]);
  function closeDrawer() { setDrawerOpen(false); setDrawerFocus(undefined); }
  const searchClient = useRef<SearchClient | null>(null);
  if (!searchClient.current) searchClient.current = new SearchClient();
  const requestSequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); searchClient.current?.cancel(); }, []);
  function update(patch: Partial<Settings>) {
    userSelected.current = true;
    setSettings(previous => ({ ...previous, ...patch })); setRoute(undefined); setError(''); setDownloaded(false); setStatus('Ready to generate.');
  }
  function circle(change: { center?: Point; radiusM?: number; bearing?: number }) {
    update(changeCircle(settings, change));
  }
  function cancel() {
    abort.current?.abort(); abort.current = null;
    searchClient.current?.cancel(); requestSequence.current++;
    setBusy(false); setStatus('Cancelled.');
  }
  async function generate() {
    if (abort.current) return;
    const invalid = [...document.querySelectorAll<HTMLInputElement>('.number-control input')].find(input => !input.value.trim() || !Number.isFinite(Number(input.value)) || Number(input.value) < Number(input.min) || Number(input.value) > Number(input.max));
    if (invalid) {
      setError('Check the circle size or start angle.');
      if (mobile && invalid.closest('dialog')) { drawerReturn.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : settingsTrigger.current; setDrawerFocus(invalid.id); setDrawerOpen(true); }
      else invalid.focus();
      return;
    }
    try { validateSettings(settings); } catch (cause) { setError((cause as Error).message); return; }
    const id = ++requestSequence.current;
    const generationStarted = performance.now();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setRoute(undefined); setError(''); setDownloaded(false);
    setStatus('Loading roads & paths…');
    try {
      const result = await planRoute(settings, controller.signal, message => { if (!controller.signal.aborted && id === requestSequence.current) setStatus(message); }, searchClient.current!.search);
      if (controller.signal.aborted || id !== requestSequence.current) return;
      performance.clearMeasures('great-circle-generation');
      performance.measure('great-circle-generation', { start: generationStarted, detail: { ...result.metrics, totalMs: performance.now() - generationStarted } });
      setRoute(result.route); setStatus('Loop found.');
      setBusy(false); abort.current = null;
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Couldn’t load map data. Try again.');
      if (cause instanceof PlanningFailure) {
        performance.clearMeasures('great-circle-generation');
        performance.measure('great-circle-generation', { start: generationStarted, detail: { ...cause.metrics, outcome: 'error', phase: cause.phase, totalMs: performance.now() - generationStarted } });
      }
      setBusy(false); abort.current = null; setStatus(cause instanceof PlanningFailure && cause.phase === 'search' ? (cause.message.startsWith('Search stopped') ? 'Search stopped.' : 'No loop found.') : cause instanceof PlanningFailure && cause.phase === 'budget' ? 'Planning stopped.' : 'Map download stopped.');
    }
  }
  function download() {
    if (!route) return;
    const url = URL.createObjectURL(new Blob([toGpx(route)], { type: 'application/gpx+xml' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `great-circle-${(route.lengthM / 1000).toFixed(1)}km.gpx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true);
  }
  const scaleControls = <div className="variation-control"><label htmlFor="variation">Route variation<input id="variation" aria-label="Route variation" aria-valuetext={settings.tolerance === 0.1 ? 'Tight' : settings.tolerance === 0.3 ? 'Flexible' : 'Moderate'} type="range" min="0.1" max="0.3" step="0.1" value={settings.tolerance} onChange={event => update({ tolerance: Number(event.target.value) })} /></label><RadiusControl value={circleRadius(settings) / 1000} disabled={busy} onCommit={km => circle({ radiusM: km * 1000 })} /></div>;
  const primaryAction = <>{busy ? <button className="primary cancel" onClick={cancel}><X size={17} /> Cancel</button> : <button className="primary" onClick={generate}><CircleDashed size={18} /> Generate loop <MoveUpRight size={18} /></button>}</>;
  const desktopFields = <><fieldset disabled={busy}>
          <section className="control-section">{scaleControls}<p className="helper">~{settings.targetKm.toFixed(1)} km loop. Resize on the map.</p><Coordinates point={settings.center} onApply={center => circle({ center })} /></section>
          <section className="control-section"><div className="section-label"><span className="step">02</span><h2>Start position</h2></div><p className="helper">Drag S around the edge. Click the map to move the center.</p><NumberControl id="start-bearing" label="Start angle (° clockwise from north)" value={Number(bearingTo(settings.center, settings.start).toFixed(1))} min={0} max={360} step={1} onCommit={bearing => circle({ bearing })} /><div className="quick-distances">{[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, angle]) => <button key={label} type="button" aria-label={`Start ${label}`} onClick={() => circle({ bearing: Number(angle) })}>{label}</button>)}</div><div className="pin-readout"><span className="pin-dot" />{settings.start.lat.toFixed(5)}, {settings.start.lon.toFixed(5)}</div></section>
          <section className="control-section preferences"><div className="section-label"><span className="step">03</span><h2>Ride preferences</h2></div><label className="select-row" htmlFor="style">Roads<select id="style" value={settings.style} onChange={e => update({ style: e.target.value as Settings['style'] })}><option value="quiet">Quieter roads</option><option value="balanced">Balanced</option></select></label><label className="select-row" htmlFor="surface">Surface<select id="surface" value={settings.surface} onChange={e => update({ surface: e.target.value as Settings['surface'] })}><option value="mixed">Mixed surfaces</option><option value="paved">Paved only</option></select></label><p className="helper">{settings.surface === 'paved' ? 'Only roads tagged as paved.' : 'Includes unpaved and unknown surfaces.'}</p></section>
        </fieldset></>;
  const secondaryFields = <><fieldset disabled={busy} className="settings-fields">
          <section className="control-section"><div className="section-label"><span className="step">01</span><h2>Circle center</h2></div><p className="helper">~{settings.targetKm.toFixed(1)} km loop. Resize on the map.</p><Coordinates point={settings.center} onApply={center => circle({ center })} /></section>
          <section className="control-section"><div className="section-label"><span className="step">02</span><h2>Start position</h2></div><p className="helper">Drag S around the edge. Click the map to move the center.</p><NumberControl id="start-bearing" label="Start angle (° clockwise from north)" value={Number(bearingTo(settings.center, settings.start).toFixed(1))} min={0} max={360} step={1} onCommit={bearing => circle({ bearing })} /><div className="quick-distances">{[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, angle]) => <button key={label} type="button" aria-label={`Start ${label}`} onClick={() => circle({ bearing: Number(angle) })}>{label}</button>)}</div><div className="pin-readout"><span className="pin-dot" />{settings.start.lat.toFixed(5)}, {settings.start.lon.toFixed(5)}</div></section>
          <section className="control-section preferences"><div className="section-label"><span className="step">03</span><h2>Ride preferences</h2></div><label className="select-row" htmlFor="style">Roads<select id="style" value={settings.style} onChange={e => update({ style: e.target.value as Settings['style'] })}><option value="quiet">Quieter roads</option><option value="balanced">Balanced</option></select></label><label className="select-row" htmlFor="surface">Surface<select id="surface" value={settings.surface} onChange={e => update({ surface: e.target.value as Settings['surface'] })}><option value="mixed">Mixed surfaces</option><option value="paved">Paved only</option></select></label><p className="helper">{settings.surface === 'paved' ? 'Only roads tagged as paved.' : 'Includes unpaved and unknown surfaces.'}</p></section>
        </fieldset></>;
  return <div className={`app ${mobile ? 'mobile-layout' : ''}`}>
    <header className="site-header"><a className="brand" href="./" aria-label="Great Circle home"><span className="brand-mark"><CircleDashed size={27} /><i /></span>great circle</a><a className="header-link" href="https://github.com/rsteth/great_circle" target="_blank" rel="noreferrer">Source <ArrowUpRight size={14} /></a></header>
    <section className="intro"><div><h1>Make a loop.</h1><p>Size the circle, then drag the start hand.</p></div></section>
    <main className="workspace">
      {!mobile && <aside className="planner" aria-label="Route settings">
        <div className="panel-heading"><span className="eyebrow">ROUTE SETTINGS</span></div>
        {desktopFields}
        <div className="generate-area">{primaryAction}</div>
      </aside>}
      <section className="route-space" aria-label="Route preview">
        <MapView settings={settings} route={route} busy={busy} onChange={next => update(next)} />
        <div className="status-bar" role="status" aria-label="Route status" aria-live="polite">{busy ? <LoaderCircle size={15} className="spin" /> : route ? <Check size={15} /> : <span className="status-dot" />}<span>{status}</span></div>
        {mobile && <section className="map-dock" aria-label="Map controls">
          <div className="dock-scale"><fieldset disabled={busy}>{scaleControls}</fieldset></div>
          <div className="dock-actions">{primaryAction}<button ref={settingsTrigger} type="button" className="settings-button" aria-haspopup="dialog" aria-expanded={drawerOpen} aria-controls="route-settings-drawer" disabled={busy} onClick={event => { drawerReturn.current = event.currentTarget; setDrawerFocus(undefined); setDrawerOpen(true); }}><SlidersHorizontal size={17} /> Settings</button></div>
          {route && <div ref={dockResult} className="dock-result"><strong>{(route.lengthM / 1000).toFixed(2)} km <small>closed loop</small></strong><button type="button" className="export-button" onClick={download}><ArrowDownToLine size={17} />{downloaded ? 'Download again' : 'Download GPX'}</button></div>}
        </section>}
        {error && <div ref={errorBox} className="error-box" role="alert"><Flag size={18} /><div><strong>Couldn’t make a loop.</strong><p>{error}</p></div></div>}
        <div className="metrics" aria-label="Route metrics"><div><span>DISTANCE</span><strong>{route ? (route.lengthM / 1000).toFixed(2) : '—'} <small>km</small></strong></div><div><span>FROM TARGET</span><strong>{route ? `${route.error < 0.005 ? '' : route.lengthM > settings.targetKm * 1000 ? '+' : '−'}${(route.error * 100).toFixed(1)}` : '—'} <small>%</small></strong></div><div><span>REPEATED</span><strong>{route ? Math.round(route.repeated * 100) : '—'} <small>%</small></strong></div></div>
        <div className="route-bottom">{route ? <>{!mobile && <div className="export-heading"><span className="export-icon"><RouteIcon size={22} /></span><div><h2>Save your route</h2><p>For your cycling app or GPS.</p></div><button className="export-button" onClick={download}>{downloaded ? <Check size={17} /> : <ArrowDownToLine size={17} />}{downloaded ? 'Download again' : 'Download GPX'}</button></div>}<div className="route-notes">{route.snapM > 25 && <p>Start moved {Math.round(route.snapM)} m to a mapped route. Getting there isn’t included.</p>}<details><summary>Route details</summary><p>Roundness: {Math.round(route.roundness * 100)}/100 · {route.candidates} loops compared · {route.points.length.toLocaleString()} track points.</p><p>No elevation or turn-by-turn directions.</p>{route.notes.filter(note => !note.startsWith('Start snapped')).map(note => <p key={note}>{note}</p>)}{route.dataTimestamp && <p className="data-time">Map updated: {new Date(route.dataTimestamp).toLocaleString()}</p>}</details></div></> : <div className="empty-state"><span className="empty-orbit"><CircleDashed size={34} /><i /></span><div><h2>Your loop will appear here.</h2><button className="text-button" disabled={busy} onClick={() => update(exampleSettings())}><RotateCcw size={13} /> Vancouver example</button></div></div>}</div>
      </section>
    </main>
    {mobile && <SettingsDrawer open={drawerOpen} onClose={closeDrawer} trigger={drawerReturn} focusId={drawerFocus}>{secondaryFields}</SettingsDrawer>}
    <footer><p><span className="footer-dot" /> Approximate routes. Check access and conditions before riding.</p><details><summary>About routes <ChevronDown size={13} /></summary><div><p>Loops won’t be perfect circles. Map errors, missing tags and closures can affect access. Some restrictions exclude roads.</p><p>Location is accessed only when you tap Locate me. Place searches go to Photon; selected areas go to Overpass. Requests are rate-limited; the service may be busy.</p><p>Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a>.</p></div></details></footer>
  </div>;
}
