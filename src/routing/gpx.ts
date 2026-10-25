import type { Route } from './types';
const escapeXml = (value: string) => value.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function toGpx(route: Route, name = 'Great Circle'): string {
  const description = `${(route.lengthM / 1000).toFixed(2)} km closed cycling track. OpenStreetMap contributors (ODbL). Review access and conditions before riding. https://www.openstreetmap.org/copyright`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Great Circle" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 https://www.topografix.com/GPX/1/1/gpx.xsd">\n  <metadata><name>${escapeXml(name)}</name><desc>${escapeXml(description)}</desc><link href="https://www.openstreetmap.org/copyright"><text>© OpenStreetMap contributors</text></link></metadata>\n  <trk><name>${escapeXml(name)}</name><type>cycling</type><trkseg>\n${route.points.map(p => `    <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"/>`).join('\n')}\n  </trkseg></trk>\n</gpx>\n`;
}
