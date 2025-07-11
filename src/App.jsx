import { useEffect, useRef, useState } from 'react';
import './index.css';
import maplibregl from 'maplibre-gl';
import * as turf from '@turf/turf';

const HERE_API_KEY = 'u13md3V2AYn5epRLY4ibspMoZbW6B8SlS6FvjytsVJc';
const LANE_WIDTH = 3.5; // meters
const NUM_LANES = 3;
const LANE_COLORS = ['#e41a1c', '#4daf4a', '#ff7f00'];

function App() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [routeCoords, setRouteCoords] = useState(null);
  const [segmentPoints, setSegmentPoints] = useState([]); // [start, end]
  const [laneFeatures, setLaneFeatures] = useState([]); // GeoJSON features
  const [selectedLane, setSelectedLane] = useState(null); // index
  const [workzonePoints, setWorkzonePoints] = useState([]); // [startIdx, endIdx] along lane
  const [tgsOverlay, setTgsOverlay] = useState(null); // {taper, sign}

  useEffect(() => {
    if (mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [144.9631, -37.8136],
      zoom: 14,
    });
    mapRef.current.on('click', (e) => {
      // Lane click
      if (laneFeatures.length > 0) {
        const features = mapRef.current.queryRenderedFeatures(e.point, { layers: laneFeatures.map((_, i) => 'lane-' + i) });
        if (features.length > 0) {
          setSelectedLane(features[0].properties.laneIdx);
          setWorkzonePoints([]); // Reset workzone on lane change
          setTgsOverlay(null);
          return;
        }
      }
      // Workzone click (if lane selected)
      if (selectedLane !== null && laneFeatures[selectedLane]) {
        const laneCoords = laneFeatures[selectedLane].geometry.coordinates;
        // Find nearest point index on lane
        let minDist = Infinity, minIdx = 0;
        laneCoords.forEach((pt, idx) => {
          const d = turf.distance(turf.point(pt), turf.point([e.lngLat.lng, e.lngLat.lat]));
          if (d < minDist) {
            minDist = d;
            minIdx = idx;
          }
        });
        if (workzonePoints.length === 0) {
          setWorkzonePoints([minIdx]);
        } else if (workzonePoints.length === 1) {
          if (minIdx !== workzonePoints[0]) {
            setWorkzonePoints([workzonePoints[0], minIdx]);
          }
        } else {
          setWorkzonePoints([minIdx]);
        }
        setTgsOverlay(null);
        return;
      }
      // Otherwise, handle segment selection
      handleMapClick([e.lngLat.lng, e.lngLat.lat]);
    });
  }, [laneFeatures, selectedLane, workzonePoints]);

  // Draw route, lanes, workzone, and TGS overlay on map
  useEffect(() => {
    if (!mapRef.current) return;
    // Remove old route
    if (mapRef.current.getSource('route')) {
      mapRef.current.removeLayer('route');
      mapRef.current.removeSource('route');
    }
    // Remove old lanes
    laneFeatures.forEach((_, i) => {
      if (mapRef.current.getSource('lane-' + i)) {
        mapRef.current.removeLayer('lane-' + i);
        mapRef.current.removeSource('lane-' + i);
      }
    });
    setLaneFeatures([]);
    // Remove old workzone
    if (mapRef.current.getSource('workzone')) {
      mapRef.current.removeLayer('workzone');
      mapRef.current.removeSource('workzone');
    }
    // Remove old TGS overlays
    if (mapRef.current.getSource('taper')) {
      mapRef.current.removeLayer('taper');
      mapRef.current.removeSource('taper');
    }
    if (mapRef.current.getSource('sign')) {
      mapRef.current.removeLayer('sign');
      mapRef.current.removeSource('sign');
    }
    // Draw route
    if (routeCoords) {
      mapRef.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: routeCoords,
          },
        },
      });
      mapRef.current.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        paint: {
          'line-color': '#3b82f6',
          'line-width': 5,
        },
      });
      // Draw fake lanes
      const line = turf.lineString(routeCoords);
      const features = [];
      for (let i = 0; i < NUM_LANES; i++) {
        const offset = (i - (NUM_LANES - 1) / 2) * LANE_WIDTH;
        const lane = turf.lineOffset(line, offset, { units: 'meters' });
        features.push({ ...lane, properties: { laneIdx: i } });
        mapRef.current.addSource('lane-' + i, {
          type: 'geojson',
          data: lane,
        });
        mapRef.current.addLayer({
          id: 'lane-' + i,
          type: 'line',
          source: 'lane-' + i,
          paint: {
            'line-color': LANE_COLORS[i],
            'line-width': selectedLane === i ? 8 : 4,
            'line-opacity': selectedLane === i ? 0.9 : 0.7,
            'line-blur': selectedLane === i ? 1 : 0,
            'line-glow-width': selectedLane === i ? 10 : 0,
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }
      setLaneFeatures(features);
      // Draw workzone if defined
      if (selectedLane !== null && workzonePoints.length === 2) {
        const laneCoords = features[selectedLane].geometry.coordinates;
        const [start, end] = workzonePoints;
        const wStart = Math.min(start, end);
        const wEnd = Math.max(start, end);
        const workzoneCoords = laneCoords.slice(wStart, wEnd + 1);
        mapRef.current.addSource('workzone', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: workzoneCoords,
            },
          },
        });
        mapRef.current.addLayer({
          id: 'workzone',
          type: 'line',
          source: 'workzone',
          paint: {
            'line-color': '#ffd600',
            'line-width': 12,
            'line-opacity': 0.85,
          },
        });
      }
      // Draw TGS overlay if present
      if (tgsOverlay && tgsOverlay.taper) {
        mapRef.current.addSource('taper', {
          type: 'geojson',
          data: tgsOverlay.taper,
        });
        mapRef.current.addLayer({
          id: 'taper',
          type: 'line',
          source: 'taper',
          paint: {
            'line-color': '#a020f0',
            'line-width': 8,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8,
          },
        });
      }
      if (tgsOverlay && tgsOverlay.sign) {
        mapRef.current.addSource('sign', {
          type: 'geojson',
          data: tgsOverlay.sign,
        });
        mapRef.current.addLayer({
          id: 'sign',
          type: 'symbol',
          source: 'sign',
          layout: {
            'icon-image': 'roadwork-sign',
            'icon-size': 1.5,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': 'Roadwork Ahead',
            'text-offset': [0, 2],
            'text-size': 14,
            'text-anchor': 'top',
            'text-color': '#ffd600',
          },
          paint: {},
        });
        // Add a simple marker if icon-image is not available
        if (!mapRef.current.hasImage('roadwork-sign')) {
          const canvas = document.createElement('canvas');
          canvas.width = 32; canvas.height = 32;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffd600';
          ctx.beginPath();
          ctx.arc(16, 16, 14, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = '#222';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = '#222';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', 16, 18);
          mapRef.current.addImage('roadwork-sign', canvas);
        }
      }
    }
  }, [routeCoords, selectedLane, laneFeatures, workzonePoints, tgsOverlay]);

  // Draw segment points as markers
  useEffect(() => {
    if (!mapRef.current) return;
    // Remove old markers
    document.querySelectorAll('.segment-marker').forEach(el => el.remove());
    segmentPoints.forEach((pt, idx) => {
      const el = document.createElement('div');
      el.className = 'segment-marker';
      el.style.width = '16px';
      el.style.height = '16px';
      el.style.background = idx === 0 ? '#22d3ee' : '#f472b6';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid #fff';
      el.style.boxShadow = '0 0 4px #0008';
      el.style.zIndex = 10;
      new maplibregl.Marker(el).setLngLat(pt).addTo(mapRef.current);
    });
  }, [segmentPoints]);

  // Handle map click to set segment points
  const handleMapClick = (lngLat) => {
    setError('');
    setRouteCoords(null);
    setSelectedLane(null);
    setLaneFeatures([]);
    setWorkzonePoints([]);
    setTgsOverlay(null);
    if (segmentPoints.length === 0) {
      setSegmentPoints([lngLat]);
    } else if (segmentPoints.length === 1) {
      setSegmentPoints([segmentPoints[0], lngLat]);
      fetchRoute(segmentPoints[0], lngLat);
    } else {
      setSegmentPoints([lngLat]);
    }
  };

  const handleSearch = async (e) => {
    if (e.key !== 'Enter' || !search.trim()) return;
    setLoading(true);
    setError('');
    try {
      const url = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(search)}&apiKey=${HERE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        const { lat, lng } = data.items[0].position;
        mapRef.current.flyTo({ center: [lng, lat], zoom: 16 });
      } else {
        setError('No results found.');
      }
    } catch (err) {
      setError('Error searching address.');
    } finally {
      setLoading(false);
    }
  };

  // Generate TGS overlay (taper and sign)
  const handleGenerateTGS = () => {
    if (selectedLane === null || workzonePoints.length !== 2 || !laneFeatures[selectedLane]) return;
    const laneCoords = laneFeatures[selectedLane].geometry.coordinates;
    const [start, end] = workzonePoints;
    const wStart = Math.min(start, end);
    const wEnd = Math.max(start, end);
    // Calculate taper: 60m upstream of workzone (for demo, use 60m)
    const taperLength = 60; // meters
    // Find upstream direction (assume start < end is downstream)
    const upstreamIdx = wStart;
    // Find point 60m before workzone start
    let dist = 0, taperStartIdx = upstreamIdx;
    for (let i = upstreamIdx; i > 0; i--) {
      dist += turf.distance(turf.point(laneCoords[i]), turf.point(laneCoords[i - 1]), { units: 'meters' });
      if (dist >= taperLength) {
        taperStartIdx = i - 1;
        break;
      }
    }
    const taperCoords = laneCoords.slice(taperStartIdx, upstreamIdx + 1);
    // Place sign 100m before taper start
    dist = 0;
    let signIdx = taperStartIdx;
    for (let i = taperStartIdx; i > 0; i--) {
      dist += turf.distance(turf.point(laneCoords[i]), turf.point(laneCoords[i - 1]), { units: 'meters' });
      if (dist >= 100) {
        signIdx = i - 1;
        break;
      }
    }
    const signCoord = laneCoords[signIdx];
    setTgsOverlay({
      taper: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: taperCoords },
      },
      sign: {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: signCoord },
        properties: { label: 'Roadwork Ahead' },
      },
    });
  };

  // Fetch route from HERE Routing API
  const fetchRoute = async (start, end) => {
    try {
      const url = `https://router.hereapi.com/v8/routes?transportMode=car&origin=${start[1]},${start[0]}&destination=${end[1]},${end[0]}&return=polyline&apiKey=${HERE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes[0] && data.routes[0].sections[0].polyline) {
        const coords = decodePolyline(data.routes[0].sections[0].polyline);
        setRouteCoords(coords);
      } else {
        setError('No route found.');
      }
    } catch (err) {
      setError('Error fetching route.');
    }
  };

  // HERE polyline decoder
  function decodePolyline(encoded) {
    let index = 0, lat = 0, lng = 0, coordinates = [];
    while (index < encoded.length) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;
      coordinates.push([lng / 1e5, lat / 1e5]);
    }
    return coordinates.map(([lng, lat]) => [lng, lat]);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#18181b] to-[#23232b] text-white flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Traffic Guidance Scheme MVP</h1>
        <span className="text-zinc-400 text-sm">by [Your Brand]</span>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-4xl bg-zinc-900 rounded-xl shadow-lg p-6 mt-8">
          {/* Map and controls */}
          <div className="h-96 w-full bg-zinc-800 rounded-lg flex items-center justify-center">
            <div ref={mapContainer} className="h-full w-full rounded-lg" />
          </div>
          <div className="mt-6 flex flex-col md:flex-row gap-4 items-center justify-between">
            <input
              type="text"
              className="w-full md:w-1/2 px-4 py-2 rounded bg-zinc-800 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-zinc-400 disabled:opacity-50"
              placeholder="Search for address or road..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              disabled={loading}
            />
            <button
              className={`px-6 py-2 rounded font-semibold shadow text-white transition ${selectedLane !== null && workzonePoints.length === 2 ? 'bg-blue-600 hover:bg-blue-500' : 'bg-zinc-700 opacity-50 cursor-not-allowed'}`}
              disabled={selectedLane === null || workzonePoints.length !== 2}
              onClick={handleGenerateTGS}
            >
              Generate TGS
            </button>
          </div>
          {selectedLane !== null && (
            <div className="mt-2 text-green-400 text-sm">Lane {selectedLane + 1} selected</div>
          )}
          {workzonePoints.length === 1 && (
            <div className="mt-2 text-yellow-400 text-sm">Click a second point along the lane to define the workzone</div>
          )}
          {workzonePoints.length === 2 && (
            <div className="mt-2 text-yellow-300 text-sm">Workzone defined (yellow line)</div>
          )}
          {tgsOverlay && (
            <div className="mt-2 text-purple-300 text-sm">TGS generated: Taper (purple), Roadwork Ahead sign (yellow circle)</div>
          )}
          {loading && <div className="mt-2 text-blue-400 text-xs">Searching...</div>}
          {error && <div className="mt-2 text-red-400 text-xs">{error}</div>}
          <div className="mt-4 text-zinc-400 text-xs">
            <ul className="list-disc ml-5">
              <li>Pan/zoom the map or search for a location</li>
              <li>Click two points on the map to define a road segment</li>
              <li>Click a lane to select it</li>
              <li>Click two points along the lane to define the workzone</li>
              <li>Click 'Generate TGS' to create a compliant scheme (taper, sign)</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
