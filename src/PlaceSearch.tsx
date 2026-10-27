import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchPlaces, type Place } from './geocoding';
import type { Point } from './routing/types';
export default function PlaceSearch({ busy, onSelect }: { busy: boolean; onSelect: (point: Point) => void }) {
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  function cancel() { sequence.current++; abort.current?.abort(); abort.current = null; setLoading(false); }
  useEffect(() => () => { sequence.current++; abort.current?.abort(); }, []);
  useEffect(() => { if (busy) { cancel(); setPlaces([]); setStatus(''); } }, [busy]);
  async function submit() {
    cancel(); const id = sequence.current, controller = new AbortController(); abort.current = controller;
    setPlaces([]); setLoading(true); setStatus('Searching…');
    try {
      const result = await searchPlaces(query, controller.signal);
      if (id !== sequence.current) return;
      setPlaces(result); setStatus(result.length ? '' : 'No places found. Try another name.');
    } catch (error) {
      if (id !== sequence.current || controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : 'Place search unavailable. Try again.');
    } finally { if (id === sequence.current) { setLoading(false); abort.current = null; } }
  }
  return <div className="place-search" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); cancel(); setPlaces([]); setStatus(''); input.current?.focus(); } }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-label="Place search">
      <input ref={input} type="search" aria-label="Search here" placeholder="Search here" value={query} maxLength={200} disabled={busy} autoComplete="off" onChange={event => { cancel(); setQuery(event.target.value); setPlaces([]); setStatus(''); }} />
      <button type="submit" aria-label="Search places" disabled={busy || loading || query.trim().length < 2}><Search size={18} /></button>
      {(query || loading) && <button type="button" aria-label={loading ? 'Cancel place search' : 'Clear place search'} disabled={busy} onClick={() => { cancel(); setQuery(''); setPlaces([]); setStatus(''); input.current?.focus(); }}><X size={16} /></button>}
    </form>
    {(status || places.length > 0) && <div className="place-results" aria-busy={loading}>{status && <p role="status">{status}</p>}{places.length > 0 && <ul aria-label="Places">{places.map((place, index) => <li key={index}><button type="button" onClick={() => { cancel(); onSelect(place.point); setQuery(place.label); setPlaces([]); setStatus(''); input.current?.focus(); }}>{place.label}</button></li>)}</ul>}<a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">Search: Photon · OSM</a></div>}
  </div>;
}
