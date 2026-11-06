import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Place } from "./browse";

/** Every place the couple has memories of, as photo pins on a map; tapping one opens its memories. */
export function MemoriesMap({ places, label, onOpen }: { places: Place[]; label: string; onOpen: (place: Place) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    if (!box.current || !places.length) return;
    const map = L.map(box.current, { zoomControl: false, worldCopyJump: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
    for (const place of places) {
      const photo = place.cover ? `<img src="/api/photos/${encodeURIComponent(place.cover)}" alt="" draggable="false">` : "";
      const icon = L.divIcon({ className: "memory-pin", html: `${photo}<span>${place.moments.length}</span>`, iconSize: [46, 46], iconAnchor: [23, 23] });
      L.marker([place.lat, place.lon], { icon, title: place.title, keyboard: true }).on("click", () => open.current(place)).addTo(map);
    }
    map.fitBounds(L.latLngBounds(places.map((place) => [place.lat, place.lon] as [number, number])), { padding: [36, 36], maxZoom: 11 });
    return () => { map.remove(); };
  }, [places]);
  return <div ref={box} className="memories-map" data-scroll-drag="ignore" role="region" aria-label={label} />;
}
