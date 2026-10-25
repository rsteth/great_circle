import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, CircleDashed, Compass, Flag, LoaderCircle, LocateFixed, MapPin, MoveUpRight, RotateCcw, Route as RouteIcon, X } from 'lucide-react';
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
  return <details className="coordinates"><summary>Use coordinates <ChevronDown size={13} /></summary><div className="coordinate-inputs"><label>Latitude<input inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} /></label><label>Longitude<input inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} /></label></div><button type="button" className="text-button" onClick={() => {
    const next = { lat: Number(lat), lon: Number(lon) };
    if (!lat.trim() || !lon.trim() || !Number.isFinite(next.lat) || !Number.isFinite(next.lon) || Math.abs(next.lat) > 75 || Math.abs(next.lon) > 180) { setError('Use latitude −75 to 75 and longitude −180 to 180.'); return; }
    setError(''); onApply(next);
  }}>Apply coordinates <ArrowUpRight size={13} /></button>{error && <p className="input-error" role="alert">{error}</p>}</details>;
}
export default function App() {
  const [settings, setSettings] = useState<Settings>(initial);
  const [mode, setMode] = useState<'area' | 'start'>('area');
  const [route, setRoute] = useState<Route>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Choose an area. Make it a loop.');
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); worker.current?.terminate(); }, []);
  function update(patch: Partial<Settings>) {
    setSettings(previous => ({ ...previous, ...patch })); setRoute(undefined); setError(''); setDownloaded(false); setStatus('Settings changed. Ready for a new loop.');
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
    setBusy(false); setStatus('Cancelled. Change your settings or try again.');
  }
  async function generate() {
    try { validateSettings(settings); } catch (cause) { setError((cause as Error).message); return; }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true); setRoute(undefined); setError(''); setDownloaded(false);
    setStatus('Downloading roads & paths from OpenStreetMap…');
    try {
      const { data, cached } = await loadNetwork(settings, controller.signal);
      if (controller.signal.aborted) return;
      setStatus(cached ? 'Using cached map data. Searching for your loop…' : 'Map loaded. Searching for your loop…');
      const instance = new Worker(new URL('./routing/worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (controller.signal.aborted) return;
        const message = event.data;
        if (message.type === 'progress') { setStatus(message.message); return; }
        instance.terminate(); worker.current = null; abort.current = null; setBusy(false);
        if (message.type === 'result') { setRoute(message.route); setStatus('Loop found. Take a closer look, then take it outside.'); }
        else { setError(message.message); setStatus('No route generated. Adjust your settings and try again.'); }
      };
      instance.onerror = () => {
        if (controller.signal.aborted) return;
        instance.terminate(); worker.current = null; abort.current = null; setBusy(false);
        setError('The route worker stopped unexpectedly. Try a smaller area.'); setStatus('Route search stopped.');
      };
      instance.postMessage({ data, settings });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Something went wrong while loading the map.');
      setBusy(false); abort.current = null; setStatus('Map download stopped. You can try again.');
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
    <header className="site-header"><a className="brand" href="./" aria-label="Great Circle home"><span className="brand-mark"><CircleDashed size={27} /><i /></span>great circle<span className="beta">FIELD NOTES / 01</span></a><a className="header-link" href="https://github.com/rsteth/great_circle" target="_blank" rel="noreferrer">A little route experiment <ArrowUpRight size={14} /></a></header>
    <section className="intro"><div><div className="eyebrow"><span /> THE LONG WAY HOME</div><h1>Find your way around.</h1><p>Real roads. A rounder ride. A little room for discovery.</p></div><div className="intro-note"><Compass size={20} /><span>Pick a place. Find a loop.<br /><strong>Take the GPX with you.</strong></span></div></section>
    <main className="workspace">
      <aside className="planner" aria-label="Route settings">
        <div className="panel-heading"><span className="eyebrow">MAKE A LOOP</span><span className="tiny">01 — 03</span></div>
        <fieldset disabled={busy}>
          <section className="control-section"><div className="section-label"><span className="step">01</span><h2>Choose your patch</h2></div><p className="helper">Set the search area, then a starting point.</p><div className="segmented"><button type="button" className={mode === 'area' ? 'active' : ''} onClick={() => setMode('area')} aria-pressed={mode === 'area'}><LocateFixed size={15} /> Area center</button><button type="button" className={mode === 'start' ? 'active' : ''} onClick={() => setMode('start')} aria-pressed={mode === 'start'}><MapPin size={15} /> Start</button></div><div className="pin-readout"><span className="pin-dot" />{(mode === 'area' ? settings.center : settings.start).lat.toFixed(4)}, {(mode === 'area' ? settings.center : settings.start).lon.toFixed(4)}<span>{mode === 'area' ? 'CENTER' : 'START'}</span></div><Coordinates point={mode === 'area' ? settings.center : settings.start} onApply={pick} /><div className="range-label"><label htmlFor="radius">Search radius</label><output htmlFor="radius">{(settings.radiusM / 1000).toFixed(1)} <small>km</small></output></div><input id="radius" type="range" min="1000" max="6000" step="500" value={settings.radiusM} onChange={e => update({ radiusM: Number(e.target.value) })} /><div className="range-ends"><span>1 km</span><span>6 km</span></div></section>
          <section className="control-section"><div className="section-label"><span className="step">02</span><h2>How far feels right?</h2></div><div className="distance-input"><input id="distance" aria-label="Target distance in kilometers" type="number" min="3" max="40" step="1" value={settings.targetKm || ''} onChange={e => update({ targetKm: Number(e.target.value) })} /><label htmlFor="distance">kilometers<small>target loop distance</small></label><RouteIcon size={24} /></div><div className="quick-distances">{[5, 10, 20, 30].map(km => <button key={km} type="button" className={settings.targetKm === km ? 'active' : ''} onClick={() => update({ targetKm: km })}>{km} km</button>)}</div><label className="select-row" htmlFor="tolerance">Distance tolerance<select id="tolerance" value={settings.tolerance} onChange={e => update({ tolerance: Number(e.target.value) })}><option value="0.1">±10%</option><option value="0.2">±20%</option><option value="0.3">±30%</option></select></label></section>
          <section className="control-section preferences"><div className="section-label"><span className="step">03</span><h2>Make it your ride</h2></div><label className="select-row" htmlFor="style">Road preference<select id="style" value={settings.style} onChange={e => update({ style: e.target.value as Settings['style'] })}><option value="quiet">Quieter roads & paths</option><option value="balanced">Balanced cycling</option></select></label><label className="select-row" htmlFor="surface">Surface<select id="surface" value={settings.surface} onChange={e => update({ surface: e.target.value as Settings['surface'] })}><option value="mixed">Mixed surfaces</option><option value="paved">Known paved only</option></select></label><p className="helper">{settings.surface === 'paved' ? 'Requires a mapped paved surface. Untagged roads are excluded.' : 'Allows unpaved roads and unknown surfaces. Paths need explicit bicycle access.'}</p></section>
        </fieldset>
        <div className="generate-area">{busy ? <button className="primary cancel" onClick={cancel}><X size={17} /> Cancel search</button> : <button className="primary" onClick={generate}><CircleDashed size={18} /> Find my circle <MoveUpRight size={18} /></button>}<p className="request-note">{busy ? 'You can stop the download or search at any time.' : 'One map request. The rest happens in your browser.'}</p></div>
      </aside>
      <section className="route-space" aria-label="Route preview">
        <MapView settings={settings} route={route} mode={mode} busy={busy} onPick={pick} />
        <div className="status-bar" role="status" aria-label="Route status" aria-live="polite">{busy ? <LoaderCircle size={15} className="spin" /> : route ? <Check size={15} /> : <span className="status-dot" />}<span>{status}</span><span className="local-badge">{busy ? 'IN PROGRESS' : route ? 'CLOSED LOOP' : 'BROWSER LOCAL'}</span></div>
        {error && <div className="error-box" role="alert"><Flag size={18} /><div><strong>Let’s try a different circle.</strong><p>{error}</p></div></div>}
        <div className="metrics" aria-label="Route metrics"><div><span>ROUTE DISTANCE</span><strong>{route ? (route.lengthM / 1000).toFixed(2) : '—'} <small>km</small></strong><p>{route ? `${route.error < 0.005 ? 'On target' : `${route.lengthM > settings.targetKm * 1000 ? '+' : '−'}${(route.error * 100).toFixed(1)}% from target`}` : 'Aiming for your target'}</p></div><div><span>ROUNDNESS</span><strong>{route ? Math.round(route.roundness * 100) : '—'} <small>/ 100</small></strong><p>100 is a perfect circle</p></div><div><span>REPEATED SECTIONS</span><strong>{route ? Math.round(route.repeated * 100) : '—'} <small>%</small></strong><p>{route ? `${route.candidates} closed candidates compared` : 'Less retracing, more exploring'}</p></div></div>
        <div className="route-bottom">{route ? <><div className="export-heading"><span className="export-icon"><RouteIcon size={22} /></span><div><h2>Your way back to where you began.</h2><p>GPX 1.1 track · {route.points.length.toLocaleString()} mapped points · start = finish</p></div><button className="export-button" onClick={download}>{downloaded ? <Check size={17} /> : <ArrowDownToLine size={17} />}{downloaded ? 'Download again' : 'Export GPX'}</button></div><div className="route-notes"><p>Import the track into your cycling app or GPS device. Turn-by-turn instructions and elevation aren’t included.</p>{route.notes.map(note => <p key={note}>{note}</p>)}{route.dataTimestamp && <p className="data-time">Map data: {new Date(route.dataTimestamp).toLocaleString()}</p>}</div></> : <div className="empty-state"><span className="empty-orbit"><CircleDashed size={34} /><i /></span><div><h2>Less there-and-back. More around.</h2><p>We’ll look for a closed loop on mapped cycling roads and paths, then balance its shape against your distance.</p><button className="text-button" disabled={busy} onClick={() => { update(initial); setMode('start'); }}><RotateCcw size={13} /> Start with Vancouver</button></div></div>}</div>
      </section>
    </main>
    <footer><p><span className="footer-dot" /> A useful sketch, with real-world edges.</p><details><summary>How it works & what to check <ChevronDown size={13} /></summary><div><p>This prototype searches several circles and joins angular anchors along a directed cycling network. It ranks acceptable loops by distance error, roundness (4π × enclosed area ÷ length²), and repeated sections. It does not guarantee the best possible circle.</p><p>Routing uses mapped bicycle access, one-way rules, and supported via-node turn restrictions. Conditional access and approach roads with unsupported restrictions are excluded conservatively. Local laws, missing tags, closures, hills, and actual conditions can still differ. Preview your track before riding.</p><p>Map tiles are requested as you browse. Generating a loop sends only your selected area to the public Overpass service; your current location is never requested. One manual request at a time, at least 30 seconds between new areas, with a 15-minute in-memory cache. No account, analytics, or paid API.</p><p>Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a>. Public services are best-effort and intended here for light personal use.</p></div></details></footer>
  </div>;
}
