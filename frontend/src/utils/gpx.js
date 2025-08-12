// Utility to convert an array of [lon, lat] coordinates to a minimal GPX string
export function pointsToGPX(points, { name = 'Route', creator = 'Cycling AI App' } = {}) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="${creator}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">`;
  const meta = `<metadata><name>${escapeXml(name)}</name><time>${new Date().toISOString()}</time></metadata>`;
  const trkOpen = `<trk><name>${escapeXml(name)}</name><trkseg>`;
  const seg = points.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><time>${new Date().toISOString()}</time></trkpt>`).join('');
  const trkClose = `</trkseg></trk>`;
  const footer = `</gpx>`;
  return [header, meta, trkOpen, seg, trkClose, footer].join('\n');
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] || c));
}
