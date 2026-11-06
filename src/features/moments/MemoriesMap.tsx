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

// Pinky's palette on OpenFreeMap's positron (founder 11-06: "做的再更精美一点"): ivory land, soft blue water, sage parks,
// rose borders, and one name per place in the app's language instead of "Russia / Россия".
const PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": "#f6f0e6" }, water: { "fill-color": "#bcd8e6" }, park: { "fill-color": "#e3ebd6" },
  landcover_wood: { "fill-color": "#e3ebd6" }, landuse_residential: { "fill-color": "#efe6da" }, building: { "fill-color": "#ebe2d6", "fill-outline-color": "#e2d8cb" },
  waterway: { "line-color": "#bcd8e6" }, boundary_2: { "line-color": "#d8a9bd" }, boundary_3: { "line-color": "#e6c9d5" },
};
type Language = "zh" | "en" | "es";
const localName = (language: Language) => language === "zh" ? ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name:en"], ["get", "name"]]
  : language === "es" ? ["coalesce", ["get", "name:es"], ["get", "name:en"], ["get", "name"]] : ["coalesce", ["get", "name:en"], ["get", "name"]];

// Fetched here so it can be fixed before any tile is laid out: MapLibre 5's globe draws nothing when a layer switches
// symbol-placement by zoom (OpenFreeMap's road shields). The tile index goes straight into the style, one round trip less.
async function loadStyle(language: Language): Promise<StyleSpecification> {
  const [style, tiles] = await Promise.all([fetch(STYLE).then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); }), fetch(TILEJSON).then((response) => (response.ok ? response.json() : null), () => null)]);
  for (const layer of style.layers || []) {
    if (layer.layout && Array.isArray(layer.layout["symbol-placement"])) layer.layout["symbol-placement"] = "line";
    if (PAINT[layer.id]) layer.paint = { ...layer.paint, ...PAINT[layer.id] };
    // Place and water names: one name in the app's language, in Pinky's ink on an ivory halo. Road shields keep their numbers.
    if (layer.type === "symbol" && layer.layout?.["text-field"] && /^(label_|water_name|airport)/.test(layer.id)) {
      layer.layout["text-field"] = localName(language);
      layer.paint = { ...layer.paint, "text-color": layer.id.startsWith("water") ? "#5b7f99" : layer.id.startsWith("label_country") ? "#5f4a52" : "#4a4540", "text-halo-color": "#f6f0e6", "text-halo-width": 1.4, "text-halo-blur": 0.5 };
    }
  }
  for (const [key, source] of Object.entries<Record<string, unknown>>(style.sources || {})) {
    if (tiles?.tiles?.length && source.url === TILEJSON) style.sources[key] = { type: source.type, tiles: tiles.tiles, minzoom: tiles.minzoom, maxzoom: tiles.maxzoom, bounds: tiles.bounds, attribution: tiles.attribution };
  }
  return style;
}

const geo = (places: Place[]) => ({ type: "FeatureCollection" as const, features: places.map((place, index) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] }, properties: { index, memories: place.moments.length, cover: place.cover || "" } })) });

const pin = (cover: string, count: number, bubble: boolean, label: string) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = bubble ? "memory-pin is-bubble" : "memory-pin";
  element.setAttribute("aria-label", label);
  if (cover) { const image = document.createElement("img"); image.src = `/api/photos/${encodeURIComponent(cover)}?w=240`; image.decoding = "async"; image.alt = ""; image.draggable = false; element.appendChild(image); }
  const badge = document.createElement("span"); badge.textContent = String(count); element.appendChild(badge);
  return element;
};

export function MemoriesMap({ places, language = "zh", label, labels, onOpen }: { places: Place[]; language?: Language; label: string; labels: { globe: string; flat: string; failed: string; loading: string }; onOpen: (place: Place) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<GlMap | null>(null);
  const open = useRef(onOpen); open.current = onOpen;
  // The map is built once; afterwards only its pins follow the places. Rebuilding it whenever a memory arrived (a phone
  // album syncing in the background) threw the globe back to where it started while someone was turning it (11-05).
  const current = useRef(places); current.current = places;
  const markers = useRef(new Map<string, Marker>());
  const [mode, setMode] = useState<Mode>(readMode);
  const [ready, setReady] = useState(false), [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const shown = markers.current;
    let gl: GlMap | null = null;
    loadStyle(language).then((style) => {
      if (!alive || !box.current) return;
      const first = current.current[0];
      gl = map.current = new maplibregl.Map({ container: box.current, style, center: first ? [first.lon, first.lat] : [0, 20], zoom: first ? 2.2 : 1.2, attributionControl: { compact: true }, maxPitch: 60, fadeDuration: 0 });
      gl.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      gl.on("style.load", () => {
        if (!gl) return;
        gl.setProjection({ type: readMode() === "flat" ? "mercator" : "globe" });
        // A soft rose-and-sky glow around the globe that fades as you zoom in.
        gl.setSky({ "sky-color": "#f3dfe7", "horizon-color": "#fbeef2", "fog-color": "#f6f0e6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-ground-blend": 0.9, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
        gl.addSource("places", {
          type: "geojson", cluster: true, clusterRadius: 52, clusterMaxZoom: 12, data: geo(current.current),
          // A bubble keeps the first photo among its places and adds up their memories.
          clusterProperties: { memories: ["+", ["get", "memories"]], cover: [["case", ["!=", ["accumulated"], ""], ["accumulated"], ["get", "cover"]], ["get", "cover"]] },
        });
        // Invisible circles keep the clustered features rendered so their photos can follow them.
        gl.addLayer({ id: "places", type: "circle", source: "places", paint: { "circle-radius": 1, "circle-opacity": 0 } });
        // The photo pins are HTML on top of the map, redrawn as the visible places and bubbles change.
        const draw = () => {
          if (!gl || !gl.isSourceLoaded("places")) return;
          const seen = new Set<string>();
          for (const feature of gl.querySourceFeatures("places")) {
            const props = feature.properties as Record<string, unknown>, coordinates = (feature.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const bubble = Boolean(props.cluster), place = bubble ? null : current.current[Number(props.index)];
            const id = bubble ? `c${props.cluster_id}:${props.memories}` : `p${props.index}:${place?.title}:${props.memories}`;
            if (seen.has(id)) continue;
            seen.add(id);
            if (shown.has(id)) continue;
            const element = pin(String(props.cover || ""), Number(props.memories) || 0, bubble, bubble ? String(props.point_count) : place?.title || "");
            element.addEventListener("click", (event) => {
              event.stopPropagation();
              if (!gl) return;
              if (!bubble) { const latest = current.current[Number(props.index)]; if (latest) open.current(latest); return; }
              void (gl.getSource("places") as GeoJSONSource).getClusterExpansionZoom(Number(props.cluster_id)).then((zoom) => gl?.easeTo({ center: coordinates, zoom: Math.min(zoom, 14) })).catch(() => {});
            });
            shown.set(id, new maplibregl.Marker({ element }).setLngLat(coordinates).addTo(gl));
          }
          for (const [id, marker] of shown) if (!seen.has(id)) { marker.remove(); shown.delete(id); }
        };
        gl.on("render", draw);
        // Framed once, when the map opens; after that the view is the person's own.
        if (current.current.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const place of current.current) bounds.extend([place.lon, place.lat]);
          gl.fitBounds(bounds, { padding: 56, maxZoom: 10, duration: 0 });
        }
        // The credit stays one tap away (the ⓘ) instead of covering the bottom of a phone-sized map.
        gl.once("idle", () => box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
        if (alive) setReady(true);
      });
    }).catch(() => { if (alive) setError(true); });
    const watch = new ResizeObserver(() => map.current?.resize());
    if (box.current) watch.observe(box.current);
    return () => { alive = false; watch.disconnect(); for (const marker of shown.values()) marker.remove(); shown.clear(); gl?.remove(); map.current = null; };
  }, []);

  // New or changed places: new pins, same view.
  useEffect(() => {
    const source = ready ? map.current?.getSource("places") as GeoJSONSource | undefined : undefined;
    if (!source) return;
    for (const marker of markers.current.values()) marker.remove();
    markers.current.clear();
    source.setData(geo(places));
  }, [places, ready]);

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
