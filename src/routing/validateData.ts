import type { OsmData } from './types';
// Structural completeness of the selected ways, not proof that OSM is complete
// or that the bounded corridor contains a connected cycling loop.
export function assertCompleteOsm(value: unknown): asserts value is OsmData {
  if (!value || typeof value !== 'object' || !Array.isArray((value as OsmData).elements)) throw new Error('The map service returned incomplete data. No partial roads were used. Try later.');
  const data = value as OsmData;
  if (data.remark) {
    const reason = /timed?\s*out|timeout/i.test(String(data.remark)) ? ' after a server query timeout' : /memory/i.test(String(data.remark)) ? ' after a server memory limit' : ' with a server error';
    throw new Error(`The map service returned incomplete data${reason}. No partial roads were used. Try later or choose a smaller circle.`);
  }
  const id = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  const tags = (value: unknown) => value === undefined || (!!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string'));
  const nodeIds = new Set<number>();
  for (const item of data.elements) {
    if (!item || !id(item.id) || !tags(item.tags)) throw new Error('The map service returned malformed road data. No roads were used. Try later.');
    if (item.type === 'node') {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon) || Math.abs(item.lat) > 90 || Math.abs(item.lon) > 180) throw new Error('The map service returned malformed road coordinates. No roads were used. Try later.');
      nodeIds.add(item.id);
    } else if (item.type === 'way') {
      if (!Array.isArray(item.nodes) || item.nodes.length < 2 || !item.nodes.every(id)) throw new Error('The map service returned incomplete way geometry. No partial roads were used. Try later.');
    } else if (item.type === 'relation') {
      if (!Array.isArray(item.members) || item.members.some(member => !member || !['node', 'way', 'relation'].includes(member.type) || !id(member.ref) || typeof member.role !== 'string')) throw new Error('The map service returned malformed turn restrictions. No roads were used. Try later.');
    } else throw new Error('The map service returned malformed road data. No roads were used. Try later.');
  }
  if (data.elements.some(item => item.type === 'way' && item.nodes.some(node => !nodeIds.has(node)))) throw new Error('The map service returned incomplete way geometry. No partial roads were used. Try later.');
}
