import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as GlMap, type Marker, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Place } from "./browse";

// The couple's places on a real map, built like 人脉's (founder 11-05): MapLibre GL with OpenFreeMap's free vector tiles, a
// globe or a flat map, and places that merge into one bubble when zoomed out and split as you zoom in. Every place and
// bubble shows one of their photos and how many memories it holds.
const STYLE = "https://tiles.openfreemap.org/styles/positron";
const TILEJSON = "https://tiles.openfreemap.org/planet";
const MODE_KEY = "pinky-map-mode";
type Mode = "globe" | "flat";
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "flat" ? "flat" : "globe"; } catch { return "globe"; } };

// Fetched here so it can be fixed before any tile is laid out: MapLibre 5's globe draws nothing when a layer switches
// symbol-placement by zoom (OpenFreeMap's road shields). The tile index goes straight into the style, one round trip less.
async function loadStyle(): Promise<StyleSpecification> {
  const [style, tiles] = await Promise.all([fetch(STYLE).then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); }), fetch(TILEJSON).then((response) => (response.ok ? response.json() : null), () => null)]);
  for (const layer of style.layers || []) if (layer.layout && Array.isArray(layer.layout["symbol-placement"])) layer.layout["symbol-placement"] = "line";
  for (const [key, source] of Object.entries<Record<string, unknown>>(style.sources || {})) {
    if (tiles?.tiles?.length && source.url === TILEJSON) style.sources[key] = { type: source.type, tiles: tiles.tiles, minzoom: tiles.minzoom, maxzoom: tiles.maxzoom, bounds: tiles.bounds, attribution: tiles.attribution };
  }
  return style;
}

const pin = (cover: string, count: number, bubble: boolean) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = bubble ? "memory-pin is-bubble" : "memory-pin";
  if (cover) { const image = document.createElement("img"); image.src = `/api/photos/${encodeURIComponent(cover)}`; image.alt = ""; image.draggable = false; element.appendChild(image); }
  const badge = document.createElement("span"); badge.textContent = String(count); element.appendChild(badge);
  return element;
};

export function MemoriesMap({ places, label, labels, onOpen }: { places: Place[]; label: string; labels: { globe: string; flat: string; failed: string; loading: string }; onOpen: (place: Place) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<GlMap | null>(null);
  const open = useRef(onOpen); open.current = onOpen;
  const [mode, setMode] = useState<Mode>(readMode);
  const [ready, setReady] = useState(false), [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const markers = new Map<string, Marker>();
    let gl: GlMap | null = null;
    loadStyle().then((style) => {
      if (!alive || !box.current) return;
      const first = places[0];
      gl = map.current = new maplibregl.Map({ container: box.current, style, center: first ? [first.lon, first.lat] : [0, 20], zoom: first ? 2.2 : 1.2, attributionControl: { compact: true }, maxPitch: 60, fadeDuration: 0 });
      gl.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      gl.on("style.load", () => {
        if (!gl) return;
        gl.setProjection({ type: readMode() === "flat" ? "mercator" : "globe" });
        gl.addSource("places", {
          type: "geojson", cluster: true, clusterRadius: 52, clusterMaxZoom: 12,
          // A bubble keeps the first photo among its places and adds up their memories.
          clusterProperties: { memories: ["+", ["get", "memories"]], cover: [["case", ["!=", ["accumulated"], ""], ["accumulated"], ["get", "cover"]], ["get", "cover"]] },
          data: { type: "FeatureCollection", features: places.map((place, index) => ({ type: "Feature", geometry: { type: "Point", coordinates: [place.lon, place.lat] }, properties: { index, memories: place.moments.length, cover: place.cover || "" } })) },
        });
        // Invisible circles keep the clustered features rendered so their photos can follow them.
        gl.addLayer({ id: "places", type: "circle", source: "places", paint: { "circle-radius": 1, "circle-opacity": 0 } });
        // The photo pins are HTML on top of the map, redrawn as the visible places and bubbles change.
        const draw = () => {
          if (!gl || !gl.isSourceLoaded("places")) return;
          const seen = new Set<string>();
          for (const feature of gl.querySourceFeatures("places")) {
            const props = feature.properties as Record<string, unknown>, coordinates = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const bubble = Boolean(props.cluster), id = bubble ? `c${props.cluster_id}` : `p${props.index}`;
            if (seen.has(id)) continue;
            seen.add(id);
            if (markers.has(id)) continue;
            const element = pin(String(props.cover || ""), Number(bubble ? props.memories : props.memories) || 0, bubble);
            element.setAttribute("aria-label", bubble ? `${props.point_count}` : places[Number(props.index)]?.title || "");
            element.addEventListener("click", (event) => {
              event.stopPropagation();
              if (!gl) return;
              if (!bubble) { const place = places[Number(props.index)]; if (place) open.current(place); return; }
              void (gl.getSource("places") as GeoJSONSource).getClusterExpansionZoom(Number(props.cluster_id)).then((zoom) => gl?.easeTo({ center: coordinates, zoom: Math.min(zoom, 14) })).catch(() => {});
            });
            markers.set(id, new maplibregl.Marker({ element }).setLngLat(coordinates).addTo(gl));
          }
          for (const [id, marker] of markers) if (!seen.has(id)) { marker.remove(); markers.delete(id); }
        };
        gl.on("render", draw);
        if (places.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const place of places) bounds.extend([place.lon, place.lat]);
          gl.fitBounds(bounds, { padding: 56, maxZoom: 10, duration: 0 });
        }
        // The credit stays one tap away (the ⓘ) instead of covering the bottom of a phone-sized map.
        gl.once("idle", () => box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
        if (alive) setReady(true);
      });
    }).catch(() => { if (alive) setError(true); });
    const watch = new ResizeObserver(() => map.current?.resize());
    if (box.current) watch.observe(box.current);
    return () => { alive = false; watch.disconnect(); for (const marker of markers.values()) marker.remove(); gl?.remove(); map.current = null; };
  }, [places]);

  const project = (next: Mode) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* the choice is only for this visit */ }
    map.current?.setProjection({ type: next === "flat" ? "mercator" : "globe" });
  };

  return <div className="memories-map-box" data-scroll-drag="ignore">
    <div ref={box} className="memories-map" role="region" aria-label={label} />
    <div className="memories-map-modes" role="group">{(["globe", "flat"] as Mode[]).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => project(value)}>{value === "globe" ? labels.globe : labels.flat}</button>)}</div>
    {(error || !ready) && <p className="memories-map-note" role={error ? "alert" : undefined}>{error ? labels.failed : labels.loading}</p>}
  </div>;
}
