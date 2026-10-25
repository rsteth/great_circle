import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleDashed, Flag, LoaderCircle, LocateFixed, MapPin, MoveUpRight, RotateCcw, Route as RouteIcon, X } from 'lucide-react';
import MapView from './MapView';
import { distance } from './routing/geo';
import { toGpx } from './routing/gpx';
import { loadNetwork } from './routing/overpass';
import { validateSettings } from './routing/solve';
import type { Point, Route, Settings, WorkerResponse } from './routing/types';
const initial: Settings = { center: { lat: 49.299, lon: -123.133 }, start: { lat: 49.2928, lon: -123.1331 }, radiusM: 3000, targetKm: 10, tolerance: 0.2, surface: 'mixed', style: 'quiet' };
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
  const [settings, setSettings] = useState<Settings>(initial);
  const [mode, setMode] = useState<'area' | 'start'>('area');
  const [route, setRoute] = useState<Route>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Set your area and start.');
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); worker.current?.terminate(); }, []);
  function update(patch: Partial<Settings>) {
    setSettings(previous => ({ ...previous, ...patch })); setRoute(undefined); setError(''); setDownloaded(false); setStatus('Ready to generate.');
  }
  function pick(point: Point) {
    if (busy) return;
    if (mode === 'area') {
      update({ center: point, ...(distance(point, settings.start) > settings.radiusM ? { start: point } : {}) });
    } else update({ start: point });
  }
  function cancel() {
    abort.current?.abort(); abort.current = null;
    worker.current?.terminate(); worker.current = null;
    setBusy(false); setStatus('Cancelled.');
  }
  async function generate() {
    try { validateSettings(settings); } catch (cause) { setError((cause as Error).message); return; }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setRoute(undefined); setError(''); setDownloaded(false);
    setStatus('Loading roads & paths…');
    try {
      const { data } = await loadNetwork(settings, controller.signal);
      if (controller.signal.aborted) return;
      setStatus('Finding a loop…');
      const instance = new Worker(new URL('./routing/worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (controller.signal.aborted) return;
        const message = event.data;
        if (message.type === 'progress') { setStatus(message.message); return; }
        instance.terminate(); worker.current = null; abort.current = null; setBusy(false);
        if (message.type === 'result') { setRoute(message.route); setStatus('Loop found.'); }
        else { setError(message.message); setStatus('No loop found.'); }
      };
      instance.onerror = () => {
        if (controller.signal.aborted) return;
        instance.terminate(); worker.current = null; abort.current = null; setBusy(false);
        setError('Search stopped. Try a smaller area.'); setStatus('Search stopped.');
      };
      instance.postMessage({ data, settings });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Couldn’t load map data. Try again.');
      setBusy(false); abort.current = null; setStatus('Map download stopped.');
    }
  }
  function download() {
    if (!route) return;
    const url = URL.createObjectURL(new Blob([toGpx(route)], { type: 'application/gpx+xml' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `great-circle-${(route.lengthM / 1000).toFixed(1)}km.gpx`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true);
  }
  return <div className="app">
    <header className="site-header"><a className="brand" href="./" aria-label="Great Circle home"><span className="brand-mark"><CircleDashed size={27} /><i /></span>great circle</a><a className="header-link" href="https://github.com/rsteth/great_circle" target="_blank" rel="noreferrer">Source <ArrowUpRight size={14} /></a></header>
    <section className="intro"><div><h1>Make a loop.</h1><p>Choose an area and start, then set your distance.</p></div></section>
    <main className="workspace">
      <aside className="planner" aria-label="Route settings">
        <div className="panel-heading"><span className="eyebrow">ROUTE SETTINGS</span><span className="tiny">01 — 03</span></div>
        <fieldset disabled={busy}>
          <section className="control-section"><div className="section-label"><span className="step">01</span><h2>Area & start</h2></div><div className="segmented"><button type="button" className={mode === 'area' ? 'active' : ''} onClick={() => setMode('area')} aria-pressed={mode === 'area'}><LocateFixed size={15} /> Area center</button><button type="button" className={mode === 'start' ? 'active' : ''} onClick={() => setMode('start')} aria-pressed={mode === 'start'}><MapPin size={15} /> Start</button></div><div className="pin-readout"><span className="pin-dot" />{(mode === 'area' ? settings.center : settings.start).lat.toFixed(4)}, {(mode === 'area' ? settings.center : settings.start).lon.toFixed(4)}<span>{mode === 'area' ? 'CENTER' : 'START'}</span></div><Coordinates point={mode === 'area' ? settings.center : settings.start} onApply={pick} /><div className="range-label"><label htmlFor="radius">Area radius</label><output htmlFor="radius">{(settings.radiusM / 1000).toFixed(1)} <small>km</small></output></div><input id="radius" type="range" min="1000" max="6000" step="500" value={settings.radiusM} onChange={e => update({ radiusM: Number(e.target.value) })} /><div className="range-ends"><span>1 km</span><span>6 km</span></div></section>
          <section className="control-section"><div className="section-label"><span className="step">02</span><h2>Target distance</h2></div><div className="distance-input"><input id="distance" aria-label="Target distance in kilometers" type="number" min="3" max="40" step="1" value={settings.targetKm || ''} onChange={e => update({ targetKm: Number(e.target.value) })} /><label htmlFor="distance">km</label><RouteIcon size={24} /></div><div className="quick-distances">{[5, 10, 20, 30].map(km => <button key={km} type="button" className={settings.targetKm === km ? 'active' : ''} onClick={() => update({ targetKm: km })}>{km} km</button>)}</div><label className="select-row" htmlFor="tolerance">Allow variation<select id="tolerance" value={settings.tolerance} onChange={e => update({ tolerance: Number(e.target.value) })}><option value="0.1">±10%</option><option value="0.2">±20%</option><option value="0.3">±30%</option></select></label></section>
          <section className="control-section preferences"><div className="section-label"><span className="step">03</span><h2>Ride preferences</h2></div><label className="select-row" htmlFor="style">Roads<select id="style" value={settings.style} onChange={e => update({ style: e.target.value as Settings['style'] })}><option value="quiet">Quieter roads</option><option value="balanced">Balanced</option></select></label><label className="select-row" htmlFor="surface">Surface<select id="surface" value={settings.surface} onChange={e => update({ surface: e.target.value as Settings['surface'] })}><option value="mixed">Mixed surfaces</option><option value="paved">Paved only</option></select></label><p className="helper">{settings.surface === 'paved' ? 'Only roads tagged as paved.' : 'Includes unpaved and unknown surfaces.'}</p></section>
        </fieldset>
        <div className="generate-area">{busy ? <button className="primary cancel" onClick={cancel}><X size={17} /> Cancel</button> : <button className="primary" onClick={generate}><CircleDashed size={18} /> Generate loop <MoveUpRight size={18} /></button>}</div>
      </aside>
      <section className="route-space" aria-label="Route preview">
        <MapView settings={settings} route={route} mode={mode} busy={busy} onPick={pick} />
        <div className="status-bar" role="status" aria-label="Route status" aria-live="polite">{busy ? <LoaderCircle size={15} className="spin" /> : route ? <Check size={15} /> : <span className="status-dot" />}<span>{status}</span></div>
        {error && <div className="error-box" role="alert"><Flag size={18} /><div><strong>Couldn’t make a loop.</strong><p>{error}</p></div></div>}
        <div className="metrics" aria-label="Route metrics"><div><span>DISTANCE</span><strong>{route ? (route.lengthM / 1000).toFixed(2) : '—'} <small>km</small></strong></div><div><span>FROM TARGET</span><strong>{route ? `${route.error < 0.005 ? '' : route.lengthM > settings.targetKm * 1000 ? '+' : '−'}${(route.error * 100).toFixed(1)}` : '—'} <small>%</small></strong></div><div><span>REPEATED</span><strong>{route ? Math.round(route.repeated * 100) : '—'} <small>%</small></strong></div></div>
        <div className="route-bottom">{route ? <><div className="export-heading"><span className="export-icon"><RouteIcon size={22} /></span><div><h2>Save your route</h2><p>For your cycling app or GPS.</p></div><button className="export-button" onClick={download}>{downloaded ? <Check size={17} /> : <ArrowDownToLine size={17} />}{downloaded ? 'Download again' : 'Download GPX'}</button></div><div className="route-notes">{route.snapM > 25 && <p>Start moved {Math.round(route.snapM)} m to a mapped route. Getting there isn’t included.</p>}<details><summary>Route details</summary><p>Roundness: {Math.round(route.roundness * 100)}/100 · {route.candidates} loops compared · {route.points.length.toLocaleString()} track points.</p><p>No elevation or turn-by-turn directions.</p>{route.notes.filter(note => !note.startsWith('Start snapped')).map(note => <p key={note}>{note}</p>)}{route.dataTimestamp && <p className="data-time">Map updated: {new Date(route.dataTimestamp).toLocaleString()}</p>}</details></div></> : <div className="empty-state"><span className="empty-orbit"><CircleDashed size={34} /><i /></span><div><h2>Your loop will appear here.</h2><button className="text-button" disabled={busy} onClick={() => { update(initial); setMode('start'); }}><RotateCcw size={13} /> Vancouver example</button></div></div>}</div>
      </section>
    </main>
    <footer><p><span className="footer-dot" /> Approximate routes. Check access and conditions before riding.</p><details><summary>About routes <ChevronDown size={13} /></summary><div><p>Loops won’t be perfect circles. Map errors, missing tags and closures can affect access. Some restrictions exclude roads.</p><p>Your selected area goes to the public map service. Your current location is never accessed. Requests are rate-limited; the service may be busy.</p><p>Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a>.</p></div></details></footer>
  </div>;
}
