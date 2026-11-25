import { useEffect, useRef } from 'react';
import L from 'leaflet';

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  tone: 'green' | 'amber' | 'red' | 'grey' | 'blue';
  href?: string;
  label?: string;
}

const COLORS = { green: '#16a34a', amber: '#d97706', red: '#dc2626', grey: '#94a3b8', blue: '#2563eb' };

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** OpenStreetMap with coloured shop markers. Optional line connecting points in order (a beat route). */
export function MapView({ points, route, height = 460, onOpen }: { points: MapPoint[]; route?: boolean; height?: number; onOpen?: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([22.5, 79], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    if (route && points.length > 1) {
      L.polyline(points.map((p) => [p.lat, p.lng] as [number, number]), { color: '#0d9488', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(g);
    }
    for (const p of points) {
      const icon = L.divIcon({
        className: 'map-pin',
        html: `<span style="background:${COLORS[p.tone]}">${p.label ? escapeHtml(p.label) : ''}</span>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([p.lat, p.lng], { icon, title: p.title }).addTo(g);
      marker.bindPopup(
        `<b>${escapeHtml(p.title)}</b>${p.subtitle ? `<br><span>${escapeHtml(p.subtitle)}</span>` : ''}${
          onOpen ? `<br><a href="#" data-open="${escapeHtml(p.id)}">Open customer →</a>` : ''
        }`,
      );
      marker.on('popupopen', (e) => {
        const a = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>('a[data-open]');
        a?.addEventListener('click', (ev) => {
          ev.preventDefault();
          onOpen?.(p.id);
        });
      });
    }
    if (points.length) m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])).pad(0.2), { maxZoom: 16 });
    setTimeout(() => m.invalidateSize(), 50);
  }, [points, route, onOpen]);

  return <div ref={el} className="map" style={{ height }} />;
}
