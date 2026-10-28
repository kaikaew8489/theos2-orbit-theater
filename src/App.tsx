// @ts-nocheck
// Thailand Satellite Orbit — INTERNATIONAL MASTER v1.1 — ADAPTIVE HUD / MULTI-DISPLAY HARDENING — 2026-10-24
// 2026-10-25 MASTER HOTFIX: detached Browser-X lifecycle rescue preserves live React/Canvas surfaces before child-window teardown.
// MASTER DISPLAY REQUIREMENT (LOCKED):
// - Presentation / Desktop / Compact Landscape / Narrow-Portrait viewport tiers.
// - Equal left/right HUD baselines and adaptive vertical fill.
// - Reserve a central 3D Globe Safe Zone; grow vertically before growing horizontally.
// - Visual tools do not use scrollbars to solve layout; table tools follow their locked navigation rules.
// - Resizing/rotating/moving windows must never reset clock, target, station, camera or simulation state.

import React, { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { createPortal } from 'react-dom';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// Runtime integrations/caches are attached to window at runtime (plain JSX compatible).

// Production hardening: contain unexpected render/lifecycle errors instead of leaving a blank screen.
class SatOrbitErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[SAT-ORBIT] Unhandled UI error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', background: '#010408', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ maxWidth: '720px', width: '100%', border: '1px solid #ff3333', borderRadius: '10px', padding: '24px', background: 'rgba(20,0,0,0.92)', boxShadow: '0 0 30px rgba(255,51,51,0.25)' }}>
          <h2 style={{ margin: '0 0 12px', color: '#ff6666' }}>SAT-ORBIT RECOVERY MODE</h2>
          <p style={{ margin: '0 0 18px', lineHeight: 1.5 }}>The interface encountered an unexpected error. Orbit data stored in the browser has not been deleted.</p>
          <button onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }} style={{ padding: '10px 18px', cursor: 'pointer', borderRadius: '6px', border: '1px solid #00eaff', background: 'rgba(0,234,255,0.12)', color: '#00eaff', fontWeight: 700 }}>RELOAD SAT-ORBIT</button>
        </div>
      </div>
    );
  }
}

// =========================================================================
// 📍 PDF PARSER ENGINE (Theos-2 Mission Plan)
// =========================================================================
if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function extractPdfText(file) {
  if (typeof window === 'undefined' || !window.pdfjsLib) throw new Error('PDF.js is not available');
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({data: buf}).promise;
  const allLines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items;
    const byY = {};
    const yKeys = [];
    items.forEach(it => {
      const y = it.transform[5];
      let bucket = null;
      for (let k = 0; k < yKeys.length; k++) { 
        if (Math.abs(yKeys[k] - y) <= 2) { bucket = yKeys[k]; break; } 
      }
      if (bucket === null) { bucket = y; yKeys.push(y); }
      byY[bucket] = byY[bucket] || [];
      byY[bucket].push(it);
    });
    yKeys.sort((a, b) => b - a);
    yKeys.forEach(y => {
      const lineItems = byY[y].slice().sort((a, b) => a.transform[4] - b.transform[4]);
      let lineText = '';
      let lastEndX = null;
      lineItems.forEach(it => {
        const x = it.transform[4];
        if (lastEndX !== null && (x - lastEndX) > 1.5 && lineText.length && lineText.charAt(lineText.length - 1) !== ' ') {
            lineText += ' ';
        }
        lineText += it.str;
        lastEndX = x + (it.width || 0);
      });
      allLines.push(lineText);
    });
  }
  return allLines.join('\n');
}

function parsePlanText(text) {
  const lines = text.split('\n');
  const n = lines.length;
  const files = {};
  const startImgRe = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+MCC05035\s+CORECI Start Imaging/;
  const tsLineRe = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\s+\S/;
  
  function getFile(fnum) { 
      if (!files[fnum]) files[fnum] = { file_nb: fnum }; 
      return files[fnum]; 
  }

  let idx = 0;
  while (idx < n) {
    const line = lines[idx];
    if (startImgRe.test(line)) {
      const block = []; let j2 = idx + 1;
      while (j2 < n && !tsLineRe.test(lines[j2])) { block.push(lines[j2]); j2++; }
      const btxt = block.join('\n');
      const fn = /File nb:\s*(\d+)/.exec(btxt);
      const acqs = /Acquisition start date:\s*([\d/: .]+)/.exec(btxt);
      const acqe = /Acquisition end date:\s*([\d/: .]+?)\. Duration:\s*([\d.]+)\s*s/.exec(btxt);
      
      if (fn) {
        const f = getFile(parseInt(fn[1], 10));
        f.acq_start = acqs ? acqs[1].trim() : null;
        if (acqe) { 
            f.acq_end = acqe[1].trim(); 
            f.acq_duration_s = parseFloat(acqe[2]); 
        }
      }
      idx = j2; continue;
    }
    idx++;
  }

  // ดึงข้อมูลออกมาเฉพาะไฟล์ที่มีการถ่ายภาพ (Acquisition)
  const imagingPlans = Object.keys(files).map(Number).sort((a,b)=>a-b).map(fnum => files[fnum]).filter(f => f.acq_start !== null);
  return imagingPlans;
}
// =========================================================================

// ==========================================
// Mission imports preserve source geometry and use UTC consistently.
function missionTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const text = value.trim().replace(/\.$/, '');
  const plain = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(text);
  if (plain) {
    const [, ys, mos, ds, hs, mis, ss, fraction = ''] = plain;
    const [year, month, day, hour, minute, second] = [ys, mos, ds, hs, mis, ss].map(Number);
    const ms = Number(fraction.padEnd(3, '0').slice(0, 3));
    const result = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const check = new Date(result);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return NaN;
    return result;
  }
  // Require a timezone for other timestamp formats; never infer the workstation zone.
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? Date.parse(text) : NaN;
}

function missionHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

function validMissionPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function missionGeometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates;
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function validateMissionGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('Expected Polygon or MultiPolygon geometry');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) throw new Error('Empty geometry');
  const validated = polygons.map(polygon => {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('Empty polygon');
    return polygon.map(ring => {
      if (!Array.isArray(ring) || ring.length < 3) throw new Error('Polygon ring needs at least three vertices');
      const result = ring.map(point => {
        if (!Array.isArray(point) || !validMissionPoint(point[1], point[0]) || point.slice(2).some(v => !Number.isFinite(v))) throw new Error('Invalid longitude/latitude');
        return point.slice();
      });
      const first = result[0], last = result[result.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) result.push(first.slice());
      if (result.length < 4) throw new Error('Invalid polygon ring');
      return result;
    });
  });
  return { ...geometry, type: geometry.type, coordinates: geometry.type === 'Polygon' ? validated[0] : validated };
}

function missionGeometryAnchors(geometry) {
  const ring = missionGeometryRings(geometry)[0];
  if (!ring?.length) return {};
  const first = ring[0], opposite = ring[Math.floor((ring.length - 1) / 2)];
  // These anchors frame the imported area in the viewer; they do not assert a flight direction.
  return { startLat: first[1], startLng: first[0], endLat: opposite[1], endLng: opposite[0] };
}

function makeMissionPlan(record) {
  const start = missionTimestamp(record.start), end = missionTimestamp(record.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('Invalid acquisition interval');
  const externalId = record.externalId === null || record.externalId === undefined ? null : String(record.externalId);
  const geometryHash = record.geometry ? missionHash(record.geometry) : null;
  return { ...record, start, end, duration: (end - start) / 1000, externalId, externalIds: externalId === null ? [] : [externalId], geometryHash,
    id: record.id || `mission-${missionHash([externalId, start, end, geometryHash])}` };
}

function parseMissionGeoJson(data, sourceFile) {
  const features = data?.type === 'Feature' ? [data] : data?.features;
  if (!Array.isArray(features) || !features.length) throw new Error('No GeoJSON features found');
  if (features.length > 5000) throw new Error('More than 5000 features in one file');
  return features.map((feature, index) => {
    try {
      const properties = feature?.properties || {};
      const geometry = validateMissionGeometry(feature?.geometry);
      return makeMissionPlan({
        externalId: properties.id ?? feature.id ?? properties.file_nb ?? properties.fileNb ?? properties.fileNumber,
        start: properties.acqStart ?? properties.acq_start ?? properties.start,
        end: properties.acqEnd ?? properties.acq_end ?? properties.end,
        orbit: properties.orbit ?? properties.orbitNumber ?? properties.orbit_number ?? data.orbit ?? null,
        geometry, properties, ...missionGeometryAnchors(geometry),
        sourceKind: 'GEOJSON', timingSource: 'GEOJSON', sourceFiles: [sourceFile],
      });
    } catch (error) { throw new Error(`Feature ${index + 1}: ${error.message}`); }
  });
}

function parseMissionPdfRecords(records, sourceFile) {
  const parsed = records.map(record => {
    const start = missionTimestamp(record.acq_start);
    const statedEnd = missionTimestamp(record.acq_end);
    const duration = Number(record.acq_duration_s);
    const end = Number.isFinite(statedEnd) && statedEnd > start ? statedEnd : start + duration * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return makeMissionPlan({ externalId: record.file_nb, start, end, orbit: record.orbit ?? null,
      sourceKind: 'PDF', timingSource: 'PDF', sourceFiles: [sourceFile] });
  }).filter(Boolean);
  if (!parsed.length) throw new Error('No valid imaging records found in PDF');
  return parsed;
}

function mergeMissionPlans(records) {
  const merged = [];
  const spatialBuckets = new Map(), resultBuckets = new Map();
  const inInterval = (a, b) => Math.abs(a.start - b.start) <= 1000 && Math.abs(a.end - b.end) <= 1000;
  const candidateBucketKeys = plan => [-1, 0, 1].map(offset => Math.floor(plan.start / 1000) + offset);
  for (const plan of records) {
    if (!plan.geometry) continue;
    const key = Math.floor(plan.start / 1000);
    if (!spatialBuckets.has(key)) spatialBuckets.set(key, []);
    spatialBuckets.get(key).push(plan);
  }
  const uniqueSpatialMatch = timingPlan => {
    const candidates = candidateBucketKeys(timingPlan).flatMap(key => spatialBuckets.get(key) || []).filter(plan => inInterval(plan, timingPlan));
    const byIdentifier = candidates.filter(plan => (plan.externalIds || []).some(id => (timingPlan.externalIds || []).includes(id)));
    return new Set((byIdentifier.length ? byIdentifier : candidates).map(plan => plan.geometryHash || plan.id)).size === 1;
  };
  const indexResult = (plan, index) => {
    const key = Math.floor(plan.start / 1000);
    if (!resultBuckets.has(key)) resultBuckets.set(key, new Set());
    resultBuckets.get(key).add(index);
  };
  for (const incoming of records) {
    const identifiers = incoming.externalIds || (incoming.externalId == null ? [] : [String(incoming.externalId)]);
    const candidateIndexes = [...new Set(candidateBucketKeys(incoming).flatMap(key => [...(resultBuckets.get(key) || [])]))];
    const candidates = candidateIndexes.map(index => ({ plan: merged[index], index })).filter(({ plan }) => {
      if (!inInterval(plan, incoming)) return false;
      // Different supplied areas are distinct records even when upstream IDs repeat.
      if (plan.geometry && incoming.geometry && plan.geometryHash !== incoming.geometryHash) return false;
      const sameIdentifier = (plan.externalIds || []).some(id => identifiers.includes(id));
      const sameGeometry = plan.geometryHash && plan.geometryHash === incoming.geometryHash;
      const complementary = Boolean(plan.geometry) !== Boolean(incoming.geometry);
      if (complementary && !uniqueSpatialMatch(plan.geometry ? incoming : plan)) return false;
      return plan.id === incoming.id || sameIdentifier || sameGeometry || complementary;
    });
    const byIdentifier = candidates.filter(({ plan }) => (plan.externalIds || []).some(id => identifiers.includes(id)));
    const byExactId = candidates.filter(({ plan }) => plan.id === incoming.id);
    const matches = byExactId.length ? byExactId : byIdentifier.length ? byIdentifier : candidates;
    // Ambiguous simultaneous areas remain separate instead of being silently combined.
    if (matches.length !== 1) { indexResult(incoming, merged.length); merged.push({ ...incoming }); continue; }
    const { plan, index } = matches[0];
    const timing = incoming.timingSource === 'PDF' ? incoming : plan.timingSource === 'PDF' ? plan : incoming;
    const spatial = incoming.geometry ? incoming : plan.geometry ? plan : null;
    merged[index] = {
      ...plan, ...incoming,
      ...(spatial ? { geometry: spatial.geometry, geometryHash: spatial.geometryHash, properties: spatial.properties,
        startLat: spatial.startLat, startLng: spatial.startLng, endLat: spatial.endLat, endLng: spatial.endLng, sourceKind: 'GEOJSON' } : {}),
      id: plan.id, start: timing.start, end: timing.end, duration: (timing.end - timing.start) / 1000, timingSource: timing.timingSource,
      orbit: incoming.orbit ?? plan.orbit ?? null,
      externalIds: [...new Set([...(plan.externalIds || []), ...identifiers])],
      sourceFiles: [...new Set([...(plan.sourceFiles || []), ...(incoming.sourceFiles || [])])],
    };
    indexResult(merged[index], index);
  }
  return merged.sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)));
}

function missionPlanCoordinates(plan, rec, propagate) {
  const anchors = plan.geometry ? missionGeometryAnchors(plan.geometry) : {};
  const source = { ...plan,
    startLat: validMissionPoint(plan.startLat, plan.startLng) ? plan.startLat : anchors.startLat,
    startLng: validMissionPoint(plan.startLat, plan.startLng) ? plan.startLng : anchors.startLng,
    endLat: validMissionPoint(plan.endLat, plan.endLng) ? plan.endLat : anchors.endLat,
    endLng: validMissionPoint(plan.endLat, plan.endLng) ? plan.endLng : anchors.endLng };
  const startProvided = validMissionPoint(source.startLat, source.startLng);
  const endProvided = validMissionPoint(source.endLat, source.endLng);
  const startPos = !startProvided && rec ? propagate(new Date(source.start), rec) : null;
  const endPos = !endProvided && rec ? propagate(new Date(source.end), rec) : null;
  return { ...source,
    startLat: startProvided ? source.startLat : startPos?.lat, startLng: startProvided ? source.startLng : startPos?.lng,
    endLat: endProvided ? source.endLat : endPos?.lat, endLng: endProvided ? source.endLng : endPos?.lng,
    duration: (missionTimestamp(plan.end) - missionTimestamp(plan.start)) / 1000,
    positionSource: plan.geometry ? 'GEOJSON' : startProvided && endProvided ? 'IMPORTED' : rec ? 'TLE ESTIMATE' : 'UNAVAILABLE',
  };
}

function buildMissionPathData(plans, rec, propagate) {
  return plans.map(plan => {
    const start = missionTimestamp(plan.start), end = missionTimestamp(plan.end);
    let paths = [];
    if (plan.geometry) paths = missionGeometryRings(plan.geometry).map(ring => ring.map(([lng, lat]) => ({ lat, lng, alt: 0.002 })));
    else if (validMissionPoint(plan.startLat, plan.startLng) && validMissionPoint(plan.endLat, plan.endLng)) {
      paths = [[{ lat: plan.startLat, lng: plan.startLng, alt: 0.002 }, { lat: plan.endLat, lng: plan.endLng, alt: 0.002 }]];
    } else if (rec && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const points = [], steps = Math.min(512, Math.max(1, Math.ceil((end - start) / 1000)));
      for (let i = 0; i <= steps; i++) {
        const position = propagate(new Date(start + (end - start) * i / steps), rec);
        if (position && validMissionPoint(position.lat, position.lng)) points.push({ lat: position.lat, lng: position.lng, alt: 0.002 });
      }
      if (points.length > 1) paths = [points];
    }
    return { id: plan.id, start, end, importedGeometry: Boolean(plan.geometry), paths };
  });
}

// Split equirectangular paths at ±180°, including boundary intersection points.
// The same spherical footprint vertices now feed the 3D globe and 2D map.
function splitMapPath(points) {
  const segments = [];
  let segment = [];
  for (const point of points || []) {
    if (!validMissionPoint(point?.lat, point?.lng)) {
      if (segment.length > 1) segments.push(segment);
      segment = []; continue;
    }
    const next = { lat: point.lat, lng: point.lng };
    const previous = segment[segment.length - 1];
    if (previous && Math.abs(next.lng - previous.lng) > 180) {
      const crossingEast = next.lng < previous.lng;
      const nextUnwrapped = next.lng + (crossingEast ? 360 : -360);
      const boundary = crossingEast ? 180 : -180;
      const fraction = (boundary - previous.lng) / (nextUnwrapped - previous.lng);
      const latitude = previous.lat + fraction * (next.lat - previous.lat);
      segment.push({ lng: boundary, lat: latitude });
      if (segment.length > 1) segments.push(segment);
      segment = [{ lng: -boundary, lat: latitude }];
    }
    segment.push(next);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

function mapSegmentPoints(segment) {
  return segment.map(point => `${(point.lng + 180) / 360 * 100},${(90 - point.lat) / 180 * 100}`).join(' ');
}

function formatPointingAngle(number) {
  if (!Number.isFinite(number)) return 'N/A';
  const rounded = Number(number.toFixed(3));
  return `${rounded < 0 ? '-' : ''}${Math.abs(rounded).toFixed(3).padStart(rounded < 0 ? 6 : 7, '0')}`;
}

// 1. DATA & CONFIGURATION
// ==========================================

// 📍 ฟันธง 1: สร้างฐานข้อมูลเครือข่ายสถานีรับสัญญาณ 4 จุด (เพิ่มความสูงระดับน้ำทะเล: alt หน่วยเป็นเมตร)
const GS_NETWORK = [
  { id: 'SRC', name: 'GISTDA (SRC)', lat: 13.101195, lng: 100.928091, alt: 17 },   // ศรีราชา (~17 เมตร)
  { id: 'CMI', name: 'GISTDA (CMI)', lat: 18.858778, lng: 99.180111, alt: 340 },   // เชียงใหม่ (~340 เมตร)
  { id: 'UBN', name: 'GISTDA (UBN)', lat: 15.125694, lng: 104.924500, alt: 135 },  // อุบลราชธานี (~135 เมตร)
  { id: 'UDN', name: 'GISTDA (UDN)', lat: 17.451639, lng: 102.933389, alt: 175 }   // อุดรธานี (~175 เมตร)
];

// Active station is maintained inside React state; no mutable global observer is used.

const EARTH_RADIUS_KM = 6371;

// 📍 ฟันธง 1: ฐานข้อมูลคิวถ่ายภาพ THEOS-2 (สกัดจากไฟล์ MPLN_T2V PDF)
// หมายเหตุ: เดือนใน JavaScript Date.UTC เริ่มนับจาก 0 (ดังนั้น เดือน 8 สิงหาคม = เลข 7)
// 📍 ฟันธง 1: ฐานข้อมูลคิวถ่ายภาพ THEOS-2 (ดึงข้อมูลช่วงที่บินผ่านไทย จากไฟล์แผนการบิน Orbit 269)
const THEOS2_IMAGING_PLAN = [
  // คิวที่ 1: ถ่ายภาพ 19 วินาที[cite: 1]
  { id: 'builtin-theos2-20260801-024618', sourceKind: 'BUILTIN', orbit: 269, start: Date.UTC(2026, 7, 1, 2, 46, 18), end: Date.UTC(2026, 7, 1, 2, 46, 37) }, 
  // คิวที่ 2: ถ่ายภาพ 19 วินาที[cite: 1]
  { id: 'builtin-theos2-20260801-024710', sourceKind: 'BUILTIN', orbit: 269, start: Date.UTC(2026, 7, 1, 2, 47, 10), end: Date.UTC(2026, 7, 1, 2, 47, 29) }, 
  // คิวที่ 3: ถ่ายภาพ 37 วินาที[cite: 1]
  { id: 'builtin-theos2-20260801-024923', sourceKind: 'BUILTIN', orbit: 269, start: Date.UTC(2026, 7, 1, 2, 49, 23), end: Date.UTC(2026, 7, 1, 2, 50,  0) },
];

const SATELLITE_OPTIONS = [
  // 1. GISTDA & THAILAND COMMUNICATIONS (LEO & GEO) - คัดเฉพาะที่ยังมีชีวิต!
  { catnr: '58016', name: 'THEOS-2', displayName: 'THEOS-2', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'GISTDA', mission: 'High-Res Optical', telemetry: '2066.56 UP / 2244.228 DN MHz', payload: '8150 MHz' },
  { catnr: '33396', name: 'THEOS', displayName: 'THEOS', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'GISTDA', mission: 'Earth Observation', telemetry: '2036 UP / 2211 DN MHz', payload: '8140 MHz' },
  { catnr: '39500', name: 'THAICOM 6', displayName: 'THAICOM 6', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'C/Ku-Band', payload: 'C/Ku-Band' },
  { catnr: '39498', name: 'THAICOM 7', displayName: 'THAICOM 7 (ASIASAT 6)', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'C-Band', payload: 'C-Band' },
  { catnr: '41552', name: 'THAICOM 8', displayName: 'THAICOM 8', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'Ku-Band', payload: 'Ku-Band' },

 // 2. THAI CUBESAT & MICROSAT (LEO) - อ้างอิงจากวงโคจรจริงปัจจุบัน
 { catnr: '67683', name: 'KNACKSAT-2', displayName: 'KNACKSAT-2 (KMUTNB)', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'KMUTNB', mission: 'Technology Demo', telemetry: 'Amateur Radio', payload: 'UHF/VHF' }, // 📍 เปลี่ยนเป็น NORAD ID ของจริง (67683)
 
 // 3. SPACE STATIONS & TELESCOPES
  { catnr: '25544', name: 'ISS (ZARYA)', displayName: 'ISS (Space Station)', flag: 'us', group: 'SPACE STATIONS & TELESCOPES', operator: 'International', mission: 'Space Station', telemetry: '2.216 GHz', payload: '15.003 GHz' },
  { catnr: '48274', name: 'CSS (TIANGONG)', displayName: 'TIANGONG (CSS)', flag: 'cn', group: 'SPACE STATIONS & TELESCOPES', operator: 'CMSA', mission: 'Space Station', telemetry: 'S-Band', payload: 'Ka-Band' },
  { catnr: '20580', name: 'HST', displayName: 'HUBBLE TELESCOPE', flag: 'us', group: 'SPACE STATIONS & TELESCOPES', operator: 'NASA/ESA', mission: 'Space Observatory', telemetry: 'S-Band', payload: 'High Gain S-Band' },

  // 4. GLOBAL NAVIGATION (GNSS) - MEO
  { catnr: '24876', name: 'GPS BIIR-2', displayName: 'GPS BIIR-2 (PRN 13)', flag: 'us', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'USSF', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2' },
  { catnr: '28874', name: 'GPS BIIRM-1', displayName: 'GPS BIIRM-1 (PRN 17)', flag: 'us', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'USSF', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2' },
  { catnr: '36585', name: 'GPS BIIF-1', displayName: 'GPS BIIF-1 (PRN 01)', flag: 'us', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'USSF', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2, L5' },
  { catnr: '43873', name: 'GPS BIII-1', displayName: 'GPS BIII-1 (PRN 04)', flag: 'us', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'USSF', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2, L5' },
  { catnr: '37846', name: 'GSAT0101', displayName: 'GALILEO (GSAT0101)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '37847', name: 'GSAT0102', displayName: 'GALILEO (GSAT0102)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '38857', name: 'GSAT0103', displayName: 'GALILEO (GSAT0103)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '40128', name: 'GSAT0201', displayName: 'GALILEO (GSAT0201)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '40129', name: 'GSAT0202', displayName: 'GALILEO (GSAT0202)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '37829', name: 'COSMOS 2474', displayName: 'GLONASS-M (742)', flag: 'ru', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'Roscosmos', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2' },
  { catnr: '46689', name: 'COSMOS 2547', displayName: 'GLONASS-K (705)', flag: 'ru', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'Roscosmos', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'L1, L2, L3' },
  { catnr: '36828', name: 'BEIDOU-2 C06', displayName: 'BEIDOU-2 (C06)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37210', name: 'BEIDOU-2 C04', displayName: 'BEIDOU-2 (C04)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (GEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37256', name: 'BEIDOU-2 C07', displayName: 'BEIDOU-2 (C07)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37384', name: 'BEIDOU-2 C08', displayName: 'BEIDOU-2 (C08)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '38091', name: 'BEIDOU-2 C05', displayName: 'BEIDOU-2 (C05)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (GEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '40549', name: 'BEIDOU-3 C31', displayName: 'BEIDOU-3 (C31)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '43001', name: 'BEIDOU-3 C19', displayName: 'BEIDOU-3 (C19)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '43002', name: 'BEIDOU-3 C20', displayName: 'BEIDOU-3 (C20)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },

  // 5. INTERNATIONAL RADAR (SAR)
  { catnr: '32382', name: 'RADARSAT-2', displayName: 'RADARSAT-2', flag: 'ca', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'MDA', mission: 'SAR Imaging', telemetry: '2.215 GHz', payload: '8.250 GHz' },
  { catnr: '31598', name: 'COSMO-SKYMED-1', displayName: 'COSMO-1', flag: 'it', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '32376', name: 'COSMO-SKYMED-2', displayName: 'COSMO-2', flag: 'it', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '33412', name: 'COSMO-SKYMED-3', displayName: 'COSMO-3', flag: 'it', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '37216', name: 'COSMO-SKYMED-4', displayName: 'COSMO-4', flag: 'it', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '39634', name: 'SENTINEL-1A', displayName: 'SENTINEL-1A', flag: 'eu', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'ESA', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '31698', name: 'TERRASAR-X', displayName: 'TERRASAR-X', flag: 'de', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '36605', name: 'TANDEM-X', displayName: 'TANDEM-X', flag: 'de', group: 'SYNTHETIC APERTURE RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },

  // 6. WEATHER & EARTH RESOURCES
  { catnr: '40267', name: 'HIMAWARI-8', displayName: 'HIMAWARI-8', flag: 'jp', group: 'WEATHER & EARTH RESOURCES', operator: 'JMA', mission: 'Weather (GEO)', telemetry: 'Ku-Band', payload: 'Ka-Band' },
  { catnr: '41858', name: 'HIMAWARI-9', displayName: 'HIMAWARI-9', flag: 'jp', group: 'WEATHER & EARTH RESOURCES', operator: 'JMA', mission: 'Weather (GEO)', telemetry: 'Ku-Band', payload: 'Ka-Band' },
  { catnr: '41866', name: 'GOES-16', displayName: 'GOES-16', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NOAA', mission: 'Weather (GEO)', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '49260', name: 'LANDSAT-9', displayName: 'LANDSAT-9', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '39084', name: 'LANDSAT-8', displayName: 'LANDSAT-8', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '25994', name: 'TERRA', displayName: 'TERRA', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NASA', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '27424', name: 'AQUA', displayName: 'AQUA', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NASA', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '54234', name: 'NOAA-21', displayName: 'NOAA-21 (JPSS-2)', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NOAA', mission: 'Weather & Climate', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '43013', name: 'NOAA-20', displayName: 'NOAA-20 (JPSS-1)', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NOAA', mission: 'Weather & Climate', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '37849', name: 'SUOMI NPP', displayName: 'SUOMI NPP', flag: 'us', group: 'WEATHER & EARTH RESOURCES', operator: 'NOAA', mission: 'Weather & Climate', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '40697', name: 'SENTINEL-2A', displayName: 'SENTINEL-2A', flag: 'eu', group: 'WEATHER & EARTH RESOURCES', operator: 'ESA', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '32783', name: 'CARTOSAT-2A', displayName: 'CARTOSAT-2A', flag: 'in', group: 'WEATHER & EARTH RESOURCES', operator: 'ISRO', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },

  // 7. GLOBAL EESS & SCIENCE 
  { catnr: '39150', name: 'GAOFEN-1', displayName: 'GAOFEN-1', flag: 'cn', group: 'GLOBAL EESS & SCIENCE', operator: 'CNSA', mission: 'Earth Observation', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '40376', name: 'SMAP', displayName: 'SMAP', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA', mission: 'Soil Moisture', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '54754', name: 'SWOT', displayName: 'SWOT', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA/CNES', mission: 'Water Topography', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '43613', name: 'ICESAT-2', displayName: 'ICESAT-2', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA', mission: 'Ice Elevation', telemetry: 'S-Band', payload: 'X-Band' },

  // 8. MEGA CONSTELLATIONS (STARLINK & ONEWEB)
  { catnr: '44714', name: 'STARLINK-1008', displayName: 'STARLINK-1008', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44718', name: 'STARLINK-1012', displayName: 'STARLINK-1012', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44723', name: 'STARLINK-1017', displayName: 'STARLINK-1017', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44725', name: 'STARLINK-1020', displayName: 'STARLINK-1020', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44741', name: 'STARLINK-1036', displayName: 'STARLINK-1036', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44744', name: 'STARLINK-1039', displayName: 'STARLINK-1039', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44747', name: 'STARLINK-1042', displayName: 'STARLINK-1042', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44748', name: 'STARLINK-1043', displayName: 'STARLINK-1043', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44751', name: 'STARLINK-1046', displayName: 'STARLINK-1046', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44752', name: 'STARLINK-1047', displayName: 'STARLINK-1047', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '52312', name: 'STARLINK-3932', displayName: 'STARLINK-3932', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '52313', name: 'STARLINK-3957', displayName: 'STARLINK-3957', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'SpaceX', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44057', name: 'ONEWEB-0012', displayName: 'ONEWEB-0012', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44058', name: 'ONEWEB-0010', displayName: 'ONEWEB-0010', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44059', name: 'ONEWEB-0008', displayName: 'ONEWEB-0008', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44060', name: 'ONEWEB-0007', displayName: 'ONEWEB-0007', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44061', name: 'ONEWEB-0006', displayName: 'ONEWEB-0006', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '44062', name: 'ONEWEB-0011', displayName: 'ONEWEB-0011', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '45131', name: 'ONEWEB-0013', displayName: 'ONEWEB-0013', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '45132', name: 'ONEWEB-0017', displayName: 'ONEWEB-0017', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '45133', name: 'ONEWEB-0020', displayName: 'ONEWEB-0020', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },
  { catnr: '45134', name: 'ONEWEB-0021', displayName: 'ONEWEB-0021', flag: 'gb', group: 'MEGA CONSTELLATIONS', operator: 'OneWeb', mission: 'Broadband', telemetry: 'Ku-Band', payload: 'Ku/Ka-Band' },

  // 9. COMMUNICATIONS (L-BAND)
  { catnr: '31573', name: 'GLOBALSTAR M069', displayName: 'GLOBALSTAR M069', flag: 'us', group: 'COMMUNICATIONS (L-BAND)', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '31574', name: 'GLOBALSTAR M072', displayName: 'GLOBALSTAR M072', flag: 'us', group: 'COMMUNICATIONS (L-BAND)', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '32265', name: 'GLOBALSTAR M066', displayName: 'GLOBALSTAR M066', flag: 'us', group: 'COMMUNICATIONS (L-BAND)', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '37188', name: 'GLOBALSTAR M079', displayName: 'GLOBALSTAR M079', flag: 'us', group: 'COMMUNICATIONS (L-BAND)', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '37189', name: 'GLOBALSTAR M074', displayName: 'GLOBALSTAR M074', flag: 'us', group: 'COMMUNICATIONS (L-BAND)', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' }
];

const FALLBACK_TLES = {
  // Emergency degraded fallback only. The UI marks fallback mode as DEGRADED.
  // Other satellites require a validated cached/live TLE rather than a synthetic trajectory.
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' }
};

const injectStyles = () => {
  if (document.getElementById('scifi-theater-styles')) return;
  const style = document.createElement('style');
  style.id = 'scifi-theater-styles';
  style.innerHTML = `
  @import url('https://fonts.googleapis.com/css2?family=Audiowide&family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@500;600;700&display=swap');
    :root { --cyan: #00eaff; --gold: #ffcc00; --bg: #010408; --red: #ff3333; --dark-cyan: #005f73; --green: #00ff66; }
    /* 📍 ฟันธง 1: ปิดระบบไฮไลท์ข้อความ (Text Selection) ทำให้ไม่มีแถบสีฟ้ามากวนใจเวลาลากหน้าต่าง */
    body { margin: 0; overflow: hidden; background: var(--bg); color: #fff; font-family: 'Rajdhani', sans-serif; user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; }
    
    .scanlines { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1)); background-size: 100% 4px; z-index: 100; opacity: 0.6; }
    
    /* 📍 CSS สำหรับ Loading Screen อวกาศสมจริง (Nebula + Dynamic Stars เล็ก/กลาง/ใหญ่) */
    .loading-overlay { position: fixed; inset: 0; background: #010308; z-index: 999999; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: opacity 0.8s ease-out, visibility 0.8s; overflow: hidden; }
    
    /* 🌌 เลเยอร์ 1: พื้นหลังกาแล็กซี (ปรับสมดุลแสงและความเบลอใหม่ ให้สวยอลังการแต่ไม่แย่งซีน) */
    .loading-overlay::before { 
        content: ''; position: absolute; top: -10%; left: -10%; width: 120%; height: 120%;
        background-image: url('https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Andromeda_Galaxy_%28with_h-alpha%29.jpg/1920px-Andromeda_Galaxy_%28with_h-alpha%29.jpg'); 
        background-size: cover; background-position: center;
        
        /* 📍 ฟันธง: เพิ่มความเข้ม (Opacity) ขึ้นเป็น 0.55 ให้เห็นมวลแสงกาแล็กซีชัดเจนขึ้น อลังการขึ้น */
        opacity: 0.55; 
        
        /* 📍 ฟันธง: ลดความเบลอลงเหลือ 2px ให้พอมองเห็นโครงสร้างเกลียวดาวสวยๆ แต่ยังคงมิติหน้าชัดหลังเบลอให้ดาวเทียมเด้งออกมา */
        filter: blur(2px) contrast(1.1); 
        
        animation: slow-zoom-galaxy 45s ease-in-out infinite alternate; 
        z-index: 0; pointer-events: none; 
    }
    
    /* ✨ เลเยอร์ 2: เอฟเฟกต์ดาวกระพริบวิบวับ ซ้อนทับกาแล็กซีให้ดูมีชีวิต (ปรับแสงให้อ่อนลงจะได้กลืนไปกับภาพ ไม่แย่งซีน) */
    .loading-overlay::after {
        content: ''; position: absolute; inset: 0;
        background-image: 
            radial-gradient(circle at 15% 50%, rgba(255, 255, 255, 0.8) 1.5px, transparent 5px),
            radial-gradient(circle at 85% 30%, rgba(255, 255, 255, 0.8) 2px, transparent 6px),
            radial-gradient(circle at 45% 80%, rgba(255, 255, 255, 0.8) 1.5px, transparent 5px),
            radial-gradient(circle at 35% 20%, rgba(255, 255, 255, 0.6) 1px, transparent 3px),
            radial-gradient(circle at 75% 70%, rgba(0, 234, 255, 0.6) 1.5px, transparent 4px),
            radial-gradient(circle at 55% 40%, rgba(255, 204, 0, 0.6) 1.2px, transparent 4px),
            radial-gradient(circle at 10% 85%, rgba(255, 255, 255, 0.3) 0.5px, transparent 1px),
            radial-gradient(circle at 90% 10%, rgba(255, 255, 255, 0.3) 0.5px, transparent 1px),
            radial-gradient(circle at 60% 90%, rgba(255, 255, 255, 0.3) 0.5px, transparent 1px),
            radial-gradient(circle at 25% 65%, rgba(255, 255, 255, 0.3) 0.5px, transparent 1px);
        background-size: 213px 213px, 347px 347px, 509px 509px, 163px 163px, 277px 277px, 401px 401px, 97px 97px, 131px 131px, 199px 199px, 251px 251px;
        background-repeat: repeat;
        animation: twinkle-stars 6s ease-in-out infinite alternate;
        z-index: 1; pointer-events: none;
        mix-blend-mode: screen; /* ทำให้ดาวจำลองกลืนไปกับแสงของกาแล็กซีของจริง */
    }
    
    @keyframes slow-zoom-galaxy { 0% { transform: scale(1) rotate(0deg); } 100% { transform: scale(1.15) rotate(1.5deg); } }
    @keyframes twinkle-stars { 0% { opacity: 0.2; } 50% { opacity: 0.8; filter: brightness(1.2); } 100% { opacity: 0.3; } }
    
    .loading-overlay.fade-out { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }

    /* 📍 ย่อสเกลปลดล็อกความสูง ปล่อยให้กรอบข้อความไหลลงไปตามธรรมชาติ */
    .loading-logo { 
        display: flex; flex-direction: column; align-items: center; justify-content: center; 
        z-index: 1; text-align: center; width: 100%; height: auto !important; 
    }
    
    /* 🌟 ฟันธง: ย่อสเกลป้าย THEOS-2 ให้เพรียวบาง เป็น "ป้ายกำกับ" ที่ไม่แย่งซีนดาวเทียมและโลโก้ */
    .loading-badge { 
        position: absolute; top: clamp(15px, 3vh, 40px); left: 50%; transform: translateX(-50%); margin: 0 !important; z-index: 20;
        display: flex; align-items: center; justify-content: center; 
        background: linear-gradient(90deg, rgba(0,234,255,0.1), rgba(0,234,255,0.3), rgba(0,234,255,0.1)); 
        border: 2px solid var(--cyan); border-radius: 6px; 
        
        /* 📍 บีบกรอบ (Padding) ให้แคบและเพรียวลง */
        padding: clamp(4px, 0.8vh, 8px) clamp(15px, 2vw, 25px); 
        
        /* 📍 ลดความฟุ้งของแสงเงาลง ไม่ให้สว่างทับดาวเทียม */
        box-shadow: 0 0 20px rgba(0, 234, 255, 0.5), inset 0 0 10px rgba(0, 234, 255, 0.2); 
        backdrop-filter: blur(4px); animation: badge-pulse 2s infinite alternate; 
    }
    
    /* 📍 ย่อขนาดธงชาติไทย ให้สมมาตรกับกรอบใหม่ */
    .loading-badge img { 
        width: clamp(18px, 2.5vw, 32px) !important; 
        border-radius: 2px; margin-right: 10px; 
        box-shadow: 0 0 8px rgba(255,255,255,0.5); 
    }
    
    /* 📍 ลดขนาดตัวหนังสือ THEOS-2 ให้เป็นรองดาวเทียมและโลโก้หลัก */
    .loading-badge span { 
        font-family: 'Audiowide', 'Orbitron', sans-serif !important; 
        font-size: clamp(14px, 1.8vw, 24px) !important; 
        font-weight: 400; color: #fff; letter-spacing: 3px; 
        
        /* 📍 ฟันธง: แก้บรรทัดนี้! ปิดการแสดงผล text-shadow เพื่อลบแสงแฟลร์ */
        text-shadow: none !important; 
        
        text-transform: uppercase; margin-top: 2px; 
    }

    /* 🌟 ฟันธง: ลดระยะห่างด้านล่างลง เพื่อดึงข้อความที่ตกขอบจอกลับขึ้นมา */
    .hero-satellite { 
        width: clamp(280px, 32vw, 750px); 
        max-width: 80vw; height: auto; 
        animation: float-sat 6s ease-in-out infinite !important; 
        filter: drop-shadow(0 30px 20px rgba(0,0,0,0.85)); 
        margin-top: clamp(80px, 12vh, 150px); 
        
        /* 📍 ปรับแก้ตรงนี้: ลดจาก 34vh เหลือ 20vh ดึงข้อความล่างสุดกลับเข้าจอเป๊ะๆ */
        margin-bottom: clamp(60px, 20vh, 250px); 
    }

    /* 🌟 โค้ดเครื่องยนต์ขับเคลื่อนดาวเทียม (ห้ามลบ) */
    @keyframes float-sat { 
        0% { transform: translateY(0px) rotate(0deg) scale(1); } 
        50% { transform: translateY(-20px) rotate(2deg) scale(1.03); } 
        100% { transform: translateY(0px) rotate(0deg) scale(1); } 
    }
    
    /* 🌟 ฟันธง: ย่อสเกลข้อความหลัก SATELLITE ORBIT ให้เล็กลง สมส่วน */
    .loading-title { 
        font-family: 'Audiowide', 'Orbitron', sans-serif !important; 
        font-size: clamp(16px, 2.2vw, 36px); /* 📍 ลดไซส์ลง */
        color: #ffffff; letter-spacing: clamp(2px, 0.4vw, 5px); 
        text-shadow: 0 0 30px rgba(0,234,255,0.8), 0 0 10px rgba(255,255,255,0.6); 
        text-align: center; line-height: 1; text-transform: uppercase; font-weight: 400; 
        margin-top: 0; margin-bottom: clamp(4px, 0.5vh, 8px); 
    }

    .loading-logo ~ div { transform: none !important; position: relative; z-index: 20; }
    
    /* 🌟 ย่อสเกลข้อความรอง THAILAND... ให้เพรียวบาง */
    .loading-subtitle { 
        font-family: 'Rajdhani', sans-serif; 
        font-size: clamp(11px, 1vw, 18px); /* 📍 ลดไซส์ลง */
        color: var(--gold); letter-spacing: clamp(3px, 0.6vw, 8px); font-weight: 900; 
        text-shadow: 0 0 15px rgba(255, 204, 0, 0.9); text-transform: uppercase; 
        margin-top: 0; margin-bottom: clamp(8px, 1.5vh, 20px); 
    }
    
    /* 🌟 บีบความกว้างของบาร์โหลดให้สั้นลงอีกนิด ไม่ให้กวนตา */
    .progress-container { 
        width: clamp(250px, 30vw, 480px); /* 📍 บีบความกว้างลง */
        padding: 4px; /* 📍 ลดความหนากรอบ */
        border: 2px solid rgba(0, 234, 255, 0.5); 
        border-radius: 12px; box-shadow: 0 0 30px rgba(0,234,255,0.3); background: rgba(0, 5, 15, 0.8); z-index: 1; margin-top: 0; 
    }
    
    /* 🌟 กดหลอดพลังงานให้บางลงอีก ดูล้ำๆ */
    .progress-bar { 
        height: 14px; /* 📍 ลดความหนาหลอดพลังงานลงเหลือ 14px */
        background: linear-gradient(90deg, #ff3333 0%, #ffaa00 50%, #00ff66 100%); 
        border-radius: 6px; transition: width 0.15s ease-out; 
        box-shadow: 0 0 25px rgba(255, 255, 255, 0.2), inset 0 0 15px rgba(255,255,255,0.8); position: relative; overflow: hidden; 
    }
    .progress-bar::after { content: ''; position: absolute; top: 0; left: 0; bottom: 0; right: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent); animation: sweep-light 1.2s infinite linear; }
    
    /* 🌟 ย่อสเกลข้อความเปอร์เซ็นต์ */
    .progress-text { 
        margin-top: 8px; font-family: 'Orbitron', sans-serif; 
        font-size: clamp(18px, 2vw, 30px); /* 📍 ลดไซส์ลง */
        font-weight: 900; z-index: 1; line-height: 1; font-variant-numeric: tabular-nums; transition: color 0.2s, text-shadow 0.2s; 
        
        /* 📍 ฟันธง: เพิ่มบรรทัดนี้! ปิดการแสดงผล text-shadow เพื่อลบแสงแฟลร์ที่ตัวเลข */
        text-shadow: none !important; 
    }
    
    /* 🌟 ย่อสเกลข้อความ Log และเผื่อระยะด้านล่างป้องกันการโดนตัดทิ้ง */
    .loading-log { 
        margin-top: 8px; 
        margin-bottom: clamp(10px, 2vh, 30px); /* 🌟 เพิ่มระยะเผื่อล่างสุด ไม่ให้ชนขอบจอหรือ Taskbar */
        font-family: 'Rajdhani', monospace; 
        font-size: clamp(9px, 0.8vw, 13px); /* 📍 ลดไซส์ลง */
        font-weight: 900; letter-spacing: 2px; z-index: 1; text-transform: uppercase; transition: color 0.3s, text-shadow 0.3s; 
    }


    /* 🌟 UI LAYER: รีดไขมันแนวตั้ง ใช้ vh ดันกล่องให้ชิดกันเมื่อจอเตี้ยลง */
    .ui-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100dvh; pointer-events: none; display: flex; justify-content: space-between; padding: clamp(10px, 1.5vh, 25px); box-sizing: border-box; z-index: 10; overflow: hidden; }
    
    /* 📍 ฟันธง: บังคับแผงซ้ายและขวาให้กว้างเท่ากันเป๊ะ (สมมาตร 100%) และรีดไขมันลงเหลือสูงสุดแค่ 460px เพื่อไม่ให้กรอบนาฬิกายื่นยาวเกินไป */
    .left-container { width: clamp(380px, 28vw, 460px) !important; display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; max-height: 100%; z-index: 20; overflow: visible !important; }
    .right-container { width: clamp(380px, 28vw, 460px) !important; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; max-height: 100%; z-index: 20; }
 
    .menu-toggle-btn-left { width: 36px; height: 36px; background: linear-gradient(135deg, rgba(0,234,255,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--cyan); color: var(--cyan); font-size: 18px; cursor: pointer; border-radius: 6px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-right: 10px; box-shadow: 0 0 15px rgba(0,234,255,0.6), inset 0 0 10px rgba(0,234,255,0.3); flex-shrink: 0; }
    .menu-toggle-btn-left:hover { background: var(--cyan); color: #000; box-shadow: 0 0 30px var(--cyan); transform: scale(1.1); }
    
    /* 📍 รีดไขมัน: เปลี่ยน gap และ padding-bottom เป็น vh */
    .left-panel { width: 100% !important; box-sizing: border-box !important; display: flex; flex-direction: column; gap: clamp(6px, 1.2vh, 12px); pointer-events: auto; flex: 1; min-height: 0; animation: slideInLeft 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; overflow-x: hidden; padding-bottom: clamp(10px, 2vh, 20px); }
    .left-panel::-webkit-scrollbar { display: none; }
    /* 📍 ฟันธง: แก้ไขบรรทัดนี้! ขยายความกว้างแผงขวาจาก 380-460px เป็น 400-550px ให้สมมาตรกับฝั่งซ้าย 100% */
    .right-container { width: clamp(380px, 28vw, 460px) !important; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; max-height: 100%; z-index: 20; }
    
    .menu-toggle-btn { width: 36px; height: 36px; background: linear-gradient(135deg, rgba(255,204,0,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--gold); color: var(--gold); font-size: 18px; cursor: pointer; border-radius: 6px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-bottom: clamp(8px, 1.5vh, 12px); box-shadow: 0 0 10px rgba(255,204,0,0.6); flex-shrink: 0; }
    .menu-toggle-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 20px var(--gold); transform: scale(1.1); }
    
    /* 📍 รีดไขมัน: เปลี่ยน gap และ padding-bottom เป็น vh */
    .right-panel { width: 100% !important; display: flex; flex-direction: column; gap: clamp(6px, 1.2vh, 12px); pointer-events: auto; flex: 1; min-height: 0; animation: slideInRight 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; overflow-x: hidden; padding-bottom: clamp(10px, 2vh, 20px); }
    .right-panel::-webkit-scrollbar { display: none; }


    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }


   /* 📍 ฟันธง: รีดไขมัน UI ทั้งหมด ลดขนาดฟอนต์และช่องว่างลง ให้พอดีจอ 100% */
    .panel-box { 
      box-sizing: border-box !important;
      background: linear-gradient(145deg, rgba(5, 10, 20, 0.85) 0%, rgba(0, 5, 10, 0.95) 100%) !important; 
      backdrop-filter: blur(15px) !important; border: 1px solid var(--cyan) !important; 
      border-radius: 8px; padding: 12px 15px; /* 🌟 ลด padding */
      box-shadow: 0 5px 15px rgba(0,0,0,0.8), inset 0 0 10px rgba(255, 255, 255, 0.05) !important; 
      position: relative; overflow: hidden; flex-shrink: 0 !important; 
    }

    .control-group { 
      background: linear-gradient(145deg, rgba(5, 10, 20, 0.85) 0%, rgba(0, 5, 15, 0.95) 100%) !important; 
      backdrop-filter: blur(15px) !important; border: 1px solid var(--cyan); border-top: 2px solid var(--cyan);
      border-radius: 8px; padding: 12px; box-shadow: 0 5px 15px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(255, 255, 255, 0.05); 
      position: relative; overflow: visible; flex-shrink: 0; margin-top: 15px; 
    }

    .main-title h1 { margin: 0 0 8px 0; font-family: 'Orbitron', sans-serif; font-size: 30px; font-weight: 900; color: #ffffff; text-shadow: 0 0 20px var(--cyan); letter-spacing: 2px; }
    .main-title span { display: block !important; font-size: 13px !important; color: #ffffff !important; font-weight: 600 !important; letter-spacing: 2px !important; text-shadow: 0 0 10px rgba(0,0,0,0.8) !important; text-transform: uppercase !important; }

    /* 📍 ย่อ Master Clock */
    /* 📍 ฟันธง: ขยายกรอบเวลาด้านบนให้กว้างและรับกับความกว้างใหม่ของแผงซ้าย-ขวา */
    .global-clock-hud { 
      display: flex; flex-direction: column; flex: 1 !important; width: 100% !important; box-sizing: border-box !important; 
      background: linear-gradient(180deg, rgba(5, 10, 20, 0.98), rgba(0, 0, 5, 1)); backdrop-filter: blur(20px); 
      border: 1px solid var(--cyan); border-top: 2px solid var(--cyan); border-radius: 8px; 
      padding: 12px 18px; 
      box-shadow: 0 10px 25px rgba(0,0,0,0.9), inset 0 0 10px rgba(255, 255, 255, 0.05); pointer-events: auto; position: relative; gap: 4px; flex-shrink: 0 !important; overflow: hidden;
    }
    
   .clock-row { display: flex; justify-content: space-between; width: 100%; align-items: center; gap: 5px; }
   /* 📍 จัดการกล่องเวลาใหม่ รองรับการแยกซ้าย-ขวา ยืดหยุ่น 100% */
   .global-clock-hud .clock-item { display: flex; flex-direction: column; justify-content: center; white-space: nowrap; flex: 1; }
   
   /* 📍 ขยายหัวข้อคำว่า TH LOCAL / DOY / UTC */
   .global-clock-hud .clock-item span { font-size: clamp(10px, 1vw, 12px); color: rgba(255, 255, 255, 0.95); font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; text-transform: uppercase; text-shadow: 0 0 8px rgba(0,0,0,0.9); }
   
   /* 📍 แก้บั๊กตัวเลขเบียดกัน: ปรับขนาดเวลา (TH LOCAL, UTC) ให้พอดีกรอบ 33.33% สมมาตร ไม่ล้น ฟันธง! */
   /* 📍 ฟันธง: เติม text-shadow: none !important; เพื่อปิดแสงแฟลร์ให้สนิท */
   .global-clock-hud .clock-item strong { font-family: 'Orbitron', sans-serif; font-size: clamp(19px, 2.2vw, 25px); font-weight: 900; font-variant-numeric: tabular-nums; letter-spacing: 1px; line-height: 1; text-shadow: none !important; }
   .global-clock-hud .clock-item:nth-child(1) strong { color: var(--red); text-shadow: none !important; }
   .global-clock-hud .clock-item:nth-child(3) strong { color: var(--cyan); text-shadow: none !important; }
   
   /* 📍 แก้บั๊กตัวเลขเบียดกัน: ปรับลดขนาด DOY ให้สมดุล เป็นพระเอกตรงกลางแต่ไม่ทับเพื่อน */
   .global-clock-hud .clock-item.doy-item strong { color: var(--gold) !important; font-size: clamp(26px, 2.8vw, 34px) !important; text-shadow: none !important; line-height: 0.85; }

   .status-badge { width: 100%; display: flex; justify-content: center; align-items: center; gap: 6px; padding: 8px 0 !important; border-radius: 4px; font-size: clamp(10px, 1vw, 12px) !important; font-weight: 900; font-family: 'Orbitron', sans-serif; letter-spacing: 2px; border: 1px solid; text-transform: uppercase; }
   .status-badge.live { background: rgba(0,0,0,0.5); border-color: var(--green); color: var(--green); box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.05); }
   .status-badge.sim { background: rgba(0,0,0,0.5); border-color: var(--gold); color: var(--gold); box-shadow: inset 0 0 10px rgba(255, 255, 255, 0.05); }

   .target-header { display: flex; flex-direction: row !important; align-items: center; justify-content: center; gap: 10px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(255,255,255,0.2); }
   .target-header img { width: clamp(35px, 3vw, 50px); border-radius: 4px; border: 2px solid var(--cyan); box-shadow: 0 0 10px rgba(0,0,0,0.5); }
   .target-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: clamp(16px, 1.6vw, 24px); font-weight: 900; color: #fff; letter-spacing: 1px; text-shadow: none; line-height: 1.1; text-align: center; }
   
   /* 📍 รีดไขมันแนวตั้งขั้นสุด: ดึงกล่อง Weather ให้กลับมาโชว์หน้าแรก 100% โดยไม่ต้อง Scroll */
   .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(4px, 0.8vh, 6px); margin-bottom: clamp(6px, 1vh, 10px); } 
   .t-box { 
     background: linear-gradient(145deg, rgba(0, 15, 30, 0.6) 0%, rgba(0, 5, 10, 0.8) 100%); border: 1px solid rgba(0, 234, 255, 0.15); border-left: 3px solid rgba(0, 234, 255, 0.5); border-radius: 4px; 
     padding: clamp(2px, 0.5vh, 6px) 12px; /* ลด Padding บน-ล่าง */
     display: flex; flex-direction: column; justify-content: center; 
     min-height: clamp(30px, 3.8vh, 42px); /* หดความสูงกล่องลงอีกนิด */
     transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); box-shadow: 0 4px 8px rgba(0,0,0,0.5); overflow: hidden; 
   }
   .t-box:hover { border-color: var(--gold); border-left: 3px solid var(--gold); background: rgba(255, 204, 0, 0.08); transform: translateY(-2px); z-index: 5; }
   .t-box.highlight { border-left: 3px solid var(--red); background: linear-gradient(90deg, rgba(255, 51, 51, 0.15) 0%, transparent 100%); }
   
   .t-box span { font-size: clamp(9px, 0.9vw, 11px); color: rgba(255, 255, 255, 0.65); text-transform: uppercase; letter-spacing: 1px; font-weight: 800; white-space: nowrap; }
   
   /* 📍 ฟันธง: ปิดแสงแฟลร์ (text-shadow) ของตัวเลขทุกชนิดในแอปให้คมชัด 100% */
   .t-box strong { font-family: 'Orbitron', sans-serif; font-size: clamp(16px, 1.8vw, 22px); color: #ffffff; margin-top: 2px; text-shadow: none !important; letter-spacing: 1px; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
   
   /* 📍 บีบช่องว่างระหว่างบรรทัดของ Info-list */
   .info-list { list-style: none; padding: clamp(4px, 0.8vh, 8px) 0 0 0; margin: clamp(4px, 0.8vh, 8px) 0 0 0; border-top: 1px dashed rgba(0, 234, 255, 0.4); line-height: 1.2; } /* ลด line-height */
   .info-list li { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: clamp(2px, 0.4vh, 5px); margin-bottom: clamp(3px, 0.6vh, 6px); } /* ลด margin/padding */
   .info-list li:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
   .info-list span { color: rgba(255, 255, 255, 0.8); font-size: clamp(11px, 1.1vw, 14px); font-weight: 700; letter-spacing: 1px; }
   .info-list strong { color: var(--cyan); font-weight: 900; text-shadow: 0 0 8px rgba(0, 234, 255, 0.4); text-align: right; font-size: clamp(12px, 1.2vw, 16px); letter-spacing: 1px; }

   /* TSX TV ENGINEERING HUD — rendered only in F11/native fullscreen by JSX.
      Browser mode is intentionally untouched. */
   .sat-hud-engineering {
     margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(0,234,255,0.35);
   }
   .sat-hud-engineering-title {
     margin-bottom: 7px; color: var(--cyan); font-family: 'Orbitron', sans-serif;
     font-size: 12px; font-weight: 900; letter-spacing: 1.4px; text-align: center;
   }
   .sat-hud-engineering-grid {
     display:grid; grid-template-columns:1fr 1fr; gap:5px 7px;
   }
   .sat-hud-engineering-item {
     min-width:0; min-height:32px; box-sizing:border-box; padding:5px 7px;
     display:flex; align-items:center; justify-content:space-between; gap:6px;
     background:linear-gradient(145deg,rgba(0,20,34,.62),rgba(0,7,14,.82));
     border:1px solid rgba(0,234,255,.16); border-left:2px solid rgba(0,234,255,.48); border-radius:4px;
   }
   .sat-hud-engineering-item span {
     color:rgba(255,255,255,.56); font-family:'Rajdhani',sans-serif; font-size:11px; font-weight:800;
     letter-spacing:.55px; white-space:nowrap;
   }
   .sat-hud-engineering-item strong {
     min-width:0; color:#eaffff; font-family:'Orbitron',sans-serif; font-size:12px; font-weight:900;
     letter-spacing:.25px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right;
     font-variant-numeric:tabular-nums; text-shadow:none!important;
   }
   .sat-hud-engineering-item[data-rf="true"] { border-left-color:rgba(255,204,0,.72); }
   .sat-hud-engineering-item[data-rf="true"] strong { color:var(--gold); }

   /* 📍 ขยายแผงซ้ายขวาให้สมมาตร 100% ยืดหยุ่น ไม่ล้นจอ */
   /* 📍 แก้บั๊ก: เปลี่ยน height: 100% เป็น max-height: 100% */
   .right-container { width: clamp(380px, 28vw, 460px) !important; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; max-height: 100%; z-index: 20; }
   .menu-toggle-btn { width: 36px; height: 36px; background: linear-gradient(135deg, rgba(255,204,0,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--gold); color: var(--gold); font-size: 18px; cursor: pointer; border-radius: 6px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-bottom: 12px; box-shadow: 0 0 10px rgba(255,204,0,0.6); flex-shrink: 0; }
   .menu-toggle-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 20px var(--gold); transform: scale(1.1); }
   
   /* 📍 แก้บั๊ก: เพิ่ม padding-bottom ให้แผงเมนูขวา เพื่อป้องกันเครดิตผู้พัฒนาโดนตัด */
   .right-panel { width: 100% !important; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInRight 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; overflow-x: hidden; padding-bottom: 5px; }.right-panel::-webkit-scrollbar { display: none; }

   .control-group { 
    background: linear-gradient(145deg, rgba(5, 10, 20, 0.85) 0%, rgba(0, 5, 15, 0.95) 100%) !important; 
    backdrop-filter: blur(15px) !important; border: 1px solid var(--cyan); border-top: 2px solid var(--cyan);
    border-radius: 8px; padding: clamp(6px, 1vh, 10px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(255, 255, 255, 0.05); 
    position: relative; overflow: visible; flex-shrink: 0; margin-top: clamp(6px, 1.2vh, 10px);
  }

  /* 📍 ย่อหัวข้อเมนูขวา */
  .control-group p { 
    text-align: center; margin: -20px auto clamp(8px, 1vh, 12px) auto; width: fit-content; 
    font-size: clamp(10px, 1vw, 12px) !important; font-weight: 900; letter-spacing: 2px !important; 
    padding: 2px 12px !important; color: #ffffff !important;
    background: #010408; border-radius: 4px; border: 1px solid; 
    font-family: 'Orbitron', sans-serif; text-shadow: none !important;
  }
  .right-panel .sat-hud-page[data-section-index="0"] > .control-group p { border-color: var(--gold); box-shadow: 0 0 10px rgba(255,204,0,0.4); }
  .right-panel .sat-hud-page[data-section-index="1"] > .control-group p { border-color: var(--green); box-shadow: 0 0 10px rgba(0,255,102,0.4); }
  .right-panel .sat-hud-page[data-section-index="2"] > .control-group p { border-color: var(--cyan); box-shadow: 0 0 10px rgba(0,234,255,0.4); }
  
  /* 📍 รีดไขมัน: เปลี่ยน padding แนวตั้งและ margin ของปุ่มเป็น vh */
  .btn { display: block; width: 100%; background: rgba(0, 15, 30, 0.5); border: 1px solid rgba(0, 234, 255, 0.5); color: var(--cyan); padding: clamp(6px, 1.2vh, 12px) !important; margin-bottom: clamp(2px, 0.5vh, 6px); font-family: 'Rajdhani', sans-serif; font-size: clamp(12px, 1.2vw, 16px) !important; font-weight: 900; cursor: pointer; text-align: center; border-radius: 4px; transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1); letter-spacing: 1.5px !important; text-transform: uppercase; box-shadow: 0 3px 8px rgba(0,0,0,0.4); overflow: hidden; }
  
  .btn::before { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent); transform: skewX(-20deg); transition: 0.4s; }
    .btn:hover::before { left: 150%; }
    .btn:disabled { opacity: 0.3; pointer-events: none; filter: grayscale(100%); }
    
    /* 📍 ฟันธง: วางแทรกตรงนี้เลยครับ! (ต่อจาก btn:disabled) */
    .control-group div[style*="grid"] { gap: clamp(6px, 1vh, 8px) !important; }

    .speed-row { display: flex; gap: 6px; margin-bottom: 8px; }
    .speed-row .btn { padding: 6px 2px !important; font-size: 14px !important; font-weight: 900 !important; letter-spacing: 0.5px !important; }
    .media-btn { padding: 8px !important; }
    .media-btn .icon { font-size: 20px !important; }

    /* ⏱️ กลุ่มที่ 1: TIME & PLAYBACK (ขอบทอง / ปุ่มแดง-ทอง) */

    /* 📍 สไตล์ของ TIME SCRUB BAR (Slide Bar) */
    .time-scrubber-container { margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(0, 234, 255, 0.4); position: relative; }
    
    input[type=range].sci-fi-slider { -webkit-appearance: none; width: 100%; background: transparent; margin: 10px 0; }
    input[type=range].sci-fi-slider:focus { outline: none; }
    input[type=range].sci-fi-slider::-webkit-slider-runnable-track {
      width: 100%; height: 8px; cursor: pointer;
      background: rgba(255,255,255,0.05);
      border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.2);
    }
    input[type=range].sci-fi-slider::-webkit-slider-thumb {
      height: 22px; width: 14px; border-radius: 4px;
      background: var(--thumb-color, #00eaff);
      cursor: grab; -webkit-appearance: none; margin-top: -8px;
      border: 2px solid #fff;
      box-shadow: 0 0 15px var(--thumb-glow, #00eaff), inset 0 0 5px rgba(0,0,0,0.5);
      transition: transform 0.1s;
    }
    input[type=range].sci-fi-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.2); }

    .right-panel .sat-hud-page[data-section-index="0"] > .control-group { border-color: var(--gold); border-top-color: var(--gold); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(255, 204, 0, 0.15), inset 0 0 20px rgba(255, 204, 0, 0.05); }
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group p { color: var(--gold); border-bottom-color: rgba(255, 204, 0, 0.5); }
    
    /* 📍 บังคับให้ปุ่มทุกตัวในกลุ่มนี้เป็นสีทอง ไม่มีแสงแฟลร์ */
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn { border-color: rgba(255,204,0,0.4) !important; color: var(--gold) !important; text-shadow: none !important; background: rgba(255,204,0,0.05) !important; }
    
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn:hover { background: linear-gradient(135deg, #ffcc00, #ff6600) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: none !important; transform: translateY(-2px); }
    
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn.active { background: linear-gradient(135deg, #ffcc00, #ff8800) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: none !important; }

    /* 📍 แยกเป้าหมายเฉพาะปุ่ม PAUSE ไม่มีแสงแฟลร์ */
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn.btn-pause { border-color: rgba(255,51,51,0.6) !important; color: var(--red) !important; text-shadow: none !important; background: rgba(255,51,51,0.05) !important; }
    .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn.btn-pause:hover, .right-panel .sat-hud-page[data-section-index="0"] > .control-group .btn.btn-pause.active { background: linear-gradient(135deg, #ff3333, #aa0000) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--red) !important; text-shadow: none !important; }

    /* สไตล์ปุ่มเครื่องเล่นเทป (Media Controls) */
    .media-btn { display: flex !important; flex-direction: row; align-items: center; justify-content: center; padding: 14px !important; }
    .media-btn .icon { font-size: 44px; line-height: 1; filter: none !important; }

    /* 🖥️ กลุ่มที่ 2: DISPLAY CONTROLS (ขอบเขียว) */
    .right-panel .sat-hud-page[data-section-index="1"] > .control-group { border-color: var(--green); border-top-color: var(--green); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(0, 255, 102, 0.15), inset 0 0 20px rgba(0, 255, 102, 0.05); }
    .right-panel .sat-hud-page[data-section-index="1"] > .control-group p { color: var(--green); border-bottom-color: rgba(0, 255, 102, 0.4); }

    /* 🌟 เพิ่มคลาสปุ่มสีทอง (Gold) สำหรับ PASS SCHEDULE */
    .btn-gold { background: rgba(255, 204, 0, 0.05) !important; border: 1px solid rgba(255, 204, 0, 0.5) !important; color: var(--gold) !important; text-shadow: none !important; }
    .btn-gold:hover, .btn-gold.active { background: var(--gold) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--gold) !important; transform: scale(1.02) !important; }

    /* 🛠️ กลุ่มที่ 3: DATA & TOOLS (ล้าง Hover สีส้มทิ้ง สร้างคลาสสีมาตรฐาน Invert Color) */
    .right-panel .sat-hud-page[data-section-index="2"] > .control-group { border-color: var(--cyan); border-top-color: var(--cyan); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 30px rgba(0, 234, 255, 0.2), inset 0 0 20px rgba(0, 234, 255, 0.1); }
    .right-panel .sat-hud-page[data-section-index="2"] > .control-group p { color: var(--cyan); border-bottom-color: rgba(0, 234, 255, 0.4); }
    .right-panel .sat-hud-page[data-section-index="2"] > .control-group button { transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important; }
    
    /* 📍 ฟันธง: สังหารเอฟเฟกต์แสงขาววิ่งผ่าน (Sweep Flare) ทิ้ง เฉพาะในกรอบ DATA & TOOLS เด็ดขาด! */
    .right-panel .sat-hud-page[data-section-index="2"] > .control-group .btn::before { display: none !important; }
    
    .btn-cyan { background: rgba(0, 15, 30, 0.6) !important; border: 1px solid rgba(0, 234, 255, 0.5) !important; color: var(--cyan) !important; text-shadow: none !important; box-shadow: inset 0 0 10px rgba(0, 234, 255, 0.05) !important; }
    .btn-cyan:hover, .btn-cyan.active { background: var(--cyan) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--cyan) !important; transform: scale(1.02) !important; }

    .btn-red { background: rgba(255, 51, 51, 0.05) !important; border: 1px solid rgba(255, 51, 51, 0.5) !important; color: var(--red) !important; text-shadow: none !important; }
    .btn-red:hover, .btn-red.active { background: var(--red) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 30px var(--red) !important; transform: scale(1.02) !important; }

    .btn-green { background: rgba(0, 255, 102, 0.05) !important; border: 1px solid rgba(0, 255, 102, 0.5) !important; color: var(--green) !important; text-shadow: none !important; }
    .btn-green:hover, .btn-green.active { background: var(--green) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--green) !important; transform: scale(1.02) !important; }

    /* 🗓️ ปุ่มล่างสุด PASS SCHEDULE (ปรับขนาดให้สมมาตร) */
    .right-panel > button:last-child { background: linear-gradient(145deg, rgba(30, 15, 0, 0.8), rgba(10, 5, 0, 0.9)) !important; border: 2px solid var(--gold) !important; color: var(--gold) !important; padding: clamp(12px, 1.5vh, 20px) !important; font-size: clamp(16px, 1.5vw, 22px) !important; font-weight: 900 !important; letter-spacing: 3px !important; box-shadow: 0 0 25px rgba(255, 204, 0, 0.4), inset 0 0 15px rgba(255, 204, 0, 0.2) !important; margin-top: 10px; }
    .right-panel > button:last-child:hover { background: linear-gradient(135deg, #ffcc00, #ff6600) !important; color: #000 !important; border-color: #fff !important; box-shadow: 0 0 35px rgba(255, 204, 0, 0.8), inset 0 0 15px rgba(255, 255, 255, 0.5) !important; text-shadow: none !important; transform: scale(1.03) !important; }

    .modal-clear-btn { background: rgba(255, 179, 71, 0.1); border: 1px solid var(--gold); color: var(--gold); padding: 5px 15px; border-radius: 4px; font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(255, 204, 0, 0.2); margin-right: 15px; letter-spacing: 1px; display: flex; align-items: center; text-transform: uppercase; }
    .modal-clear-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 20px rgba(255, 204, 0, 0.8); transform: scale(1.05); }
    .group-header-row { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px dashed rgba(0, 234, 255, 0.5); padding-bottom: 8px; margin-bottom: 15px; }
    .modal-group-title { color: var(--cyan); font-size: 16px; font-weight: 900; letter-spacing: 3px; text-transform: uppercase; font-family: 'Orbitron', sans-serif; text-shadow: 0 0 12px rgba(0, 234, 255, 0.8); }
    .group-toggle-btn { background: rgba(0,234,255,0.1); border: 1px solid var(--cyan); color: var(--cyan); font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 4px; cursor: pointer; transition: all 0.2s; letter-spacing: 1px; }
    .group-toggle-btn:hover { background: var(--cyan); color: #000; box-shadow: 0 0 15px var(--cyan); }
    
    .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
    .modal-sat-btn { background: rgba(0, 255, 102, 0.05); border: 1px solid rgba(0, 255, 102, 0.4); color: #fff; padding: 15px 20px; border-radius: 6px; font-family: 'Rajdhani', sans-serif; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s ease-in-out; text-align: left; display: flex; align-items: center; justify-content: space-between; letter-spacing: 1px; box-shadow: inset 0 0 10px rgba(0,0,0,0.5); }
    .modal-sat-btn:hover { background: rgba(0, 255, 102, 0.2); box-shadow: 0 0 20px rgba(0, 255, 102, 0.6); border-color: var(--green); transform: translateY(-2px); }
    .modal-sat-btn.secondary { background: linear-gradient(135deg, #00ff66, #009933) !important; color: #000 !important; border-color: var(--green) !important; box-shadow: 0 0 25px rgba(0, 255, 102, 0.8) !important; font-weight: 900; }
    .modal-sat-btn.primary { background: linear-gradient(135deg, #ff3333, #990000) !important; color: #fff !important; border: 1px solid #ffaaaa !important; box-shadow: 0 0 30px rgba(255, 51, 51, 0.9), inset 0 0 15px rgba(255, 255, 255, 0.5) !important; text-shadow: 0 0 5px #000 !important; font-weight: 900; z-index: 10; transform: scale(1.02); }

    /* 📍 แก้ข้อ 3: ซ่อน Scrollbar ของทุกหน้าต่าง และเพิ่มระยะ Padding ให้สวยงาม ไม่ชิดขอบ */
    .modal-content { padding: 30px 40px !important; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
    .modal-content::-webkit-scrollbar { display: none; }
    
    /* 📍 แก้ข้อ 3: บังคับปุ่ม Close/Maximize (กากบาท/สี่เหลี่ยม) ทุกหน้าต่างให้เรืองแสงสีทองเวลานำเมาส์ไปชี้ ทับโค้ดเดิมทั้งหมด! */
    .modal-close-btn { transition: all 0.3s ease !important; background: rgba(0,0,0,0.5) !important; cursor: pointer; border-radius: 4px; }
    .modal-close-btn:hover { background: var(--gold) !important; color: #000 !important; border-color: var(--gold) !important; box-shadow: 0 0 20px var(--gold) !important; transform: scale(1.15) !important; z-index: 10; }
   
   
    /* 2D MAP (TACTICAL CONTAINED MODE) */
    
    .flat-map-wrap { 
      position: absolute; top: 0; left: 0; 
      width: 100vw; height: 100dvh; 
      background: var(--bg); 
      display: flex; align-items: center; justify-content: center; 
      z-index: 5; 
      padding: 0 !important;
    }

    .flat-map-container { 
      position: relative; 
      background-color: #000; 
      box-shadow: 0 0 50px rgba(0, 234, 255, 0.2); 
      border: 2px solid var(--cyan); 
      border-radius: 8px; 
      overflow: hidden; 
      
      /* ล็อกสัดส่วน 2:1 อัตโนมัติ */
      aspect-ratio: 2 / 1; 
      height: auto !important; 
      max-height: 88vh !important; 
      transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
      
      /* =========================================
         [สถานะที่ 1] : ตอนเปิด 2 เมนู (รูปที่ 1)
         ========================================= */
      /* 🛠️ ปรับความกว้าง (ยิ่งมากยิ่งกว้าง แนะนำ: 45vw - 50vw) */
      width: 60vw !important; 
      
      /* 🛠️ ปรับเลื่อน ซ้าย-ขวา (X) และ บน-ล่าง (Y) */
      /* X: 0vw คืออยู่ตรงกลาง / Y: 2vh คือดันลงมาหลบนาฬิกานิดนึง */
      transform: translateX(1.8vw) translateY(2vh) !important; 
    }

    /* =========================================
       [สถานะที่ 2] : ปิดเมนูซ้าย เปิดขวา (รูปที่ 2)
       ========================================= */
    .flat-map-wrap.left-panel-closed:not(.panel-closed) .flat-map-container { 
       /* 🛠️ ปรับความกว้าง (แนะนำ: 65vw - 72vw) */
       width: 78vw !important; 
       
       /* 🛠️ ปรับเลื่อน X ให้ติดลบ เพื่อดันแผนที่ไปทางซ้าย หลบเมนูฝั่งขวา */
       transform: translateX(-11vw) translateY(3.5vh) !important; 
    }

    /* =========================================
       [สถานะที่ 3] : ปิดเมนูขวา เปิดซ้าย (รูปที่ 3)
       ========================================= */
    .flat-map-wrap.panel-closed:not(.left-panel-closed) .flat-map-container { 
       /* 🛠️ ปรับความกว้าง (แนะนำ: 65vw - 72vw) */
       width: 73vw !important; 
       
       /* 🛠️ ปรับเลื่อน X ให้เป็นบวก เพื่อดันแผนที่ไปทางขวา หลบเมนูฝั่งซ้าย */
       transform: translateX(13vw) translateY(2vh) !important; 
    }

    /* =========================================
       [สถานะที่ 4] : Full Screen ปิด 2 ข้าง (รูปที่ 4)
       ========================================= */
    .flat-map-wrap.left-panel-closed.panel-closed .flat-map-container { 
       /* รูปที่ 4 เพอร์เฟกต์แล้ว ปล่อยค่านี้ไว้ได้เลยครับ */
       width: 99vw !important; 
       max-height: 94vh !important; 
       transform: translateX(0vw) translateY(3vh) !important; 
    }

    /* (ส่วนของ .map-svg และ .map-marker ด้านล่าง ปล่อยไว้เหมือนเดิม ห้ามแก้ครับ) */

    .map-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
    .map-marker { position: absolute; transform: translate(-50%, -50%); cursor: pointer; pointer-events: auto; display: flex; flex-direction: column; align-items: center; transition: transform 0.2s; z-index: 3; }

    .map-marker:hover { transform: translate(-50%, -50%) scale(1.8); z-index: 20 !important; }
    .map-marker span.dot { width: 5px; height: 5px; background: currentColor; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
    .map-marker span.target-dot { width: 10px; height: 10px; background: currentColor; border-radius: 2px; box-shadow: 0 0 15px currentColor; animation: pulse 2s infinite; }
    .map-marker span.label { margin-top: 5px; font-size: 11px; font-weight: 800; white-space: nowrap; font-family: 'Rajdhani', sans-serif; text-shadow: 0 0 6px #000, 0 0 10px #000; letter-spacing: 0.5px; }
    .map-marker .map-tooltip { display: none; position: absolute; bottom: 130%; left: 50%; transform: translateX(-50%); background: rgba(0, 15, 30, 0.95); border: 1px solid var(--cyan); border-radius: 4px; padding: 10px 15px; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 14px; white-space: nowrap; pointer-events: none; box-shadow: 0 5px 20px rgba(0,234,255,0.5); z-index: 30; }
    .map-marker:hover .map-tooltip { display: block; }
    .map-tooltip img { vertical-align: middle; border-radius: 2px; margin-right: 8px; width: 20px; }
    .map-tooltip span.norad { display: block; color: var(--cyan); font-size: 12px; margin-top: 4px; font-weight: 600; }
    .map-tooltip span.alt { display: block; color: var(--gold); font-size: 12px; font-weight: 600; }

    @media (max-width: 900px) {
      .ui-layer { flex-direction: column; padding: 10px; height: 100vh; overflow-y: auto; justify-content: flex-start; gap: 15px; pointer-events: none; }
      .ui-layer::-webkit-scrollbar { display: none; }
      .left-container, .right-panel { width: 100%; pointer-events: auto; }
      .flat-map-wrap { padding: 10px; }
    }

   /* 📍 ฟันธง 1: CSS สำหรับ WOW Feature (Block Diagram & Matrix) */
    @keyframes data-flow {
      0% { stroke-dashoffset: 20; opacity: 0.5; }
      50% { opacity: 1; }
      100% { stroke-dashoffset: 0; opacity: 0.5; }
    }
    .hw-box { background: rgba(0, 20, 30, 0.8); border: 2px solid var(--cyan); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 15px; box-shadow: inset 0 0 15px rgba(0, 234, 255, 0.2); transition: all 0.3s ease; }
    .hw-box.active { border-color: var(--green); box-shadow: 0 0 20px rgba(0, 255, 102, 0.4), inset 0 0 20px rgba(0, 255, 102, 0.3); transform: scale(1.05); }
    
    @keyframes matrix-fall {
      0% { transform: translateY(-100%); opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: 1; }
      100% { transform: translateY(100%); opacity: 0; }
    }
    .matrix-column { display: flex; flex-direction: column; font-family: monospace; font-size: 10px; color: rgba(0, 234, 255, 0.7); line-height: 1; animation: matrix-fall linear infinite; }


    /* 📍 ฟันธง 2: ดัน Tooltip หนีไอคอนมือให้ไกลขึ้นอีก (ขยับขวา 60px ดันขึ้นบน 120%) */
    body .scene-tooltip { 
      background: rgba(0, 10, 25, 0.95) !important; 
      border: 2px solid var(--cyan) !important; 
      border-radius: 8px !important; 
      padding: 18px 24px !important; 
      font-family: 'Rajdhani', sans-serif !important; 
      box-shadow: 0 5px 25px rgba(0,234,255,0.4) !important; 

     /* 📍 จุดเปลี่ยนฟันธง: ห้ามใช้ transform เด็ดขาดเพราะหักล้างกับระบบเมาส์ ให้ใช้ margin ผลักหนีแทน */
    margin-top: -80px !important;
    margin-left: 45px !important;
    pointer-events: none !important; 
    min-width: 350px !important; 
    color: #fff !important;
    }

  `;
  
  document.head.appendChild(style);
};


// ==========================================
// 3. MATH & UTILITIES
// ==========================================
const toRadians = (deg) => (deg * Math.PI) / 180;
const toDegrees = (rad) => (rad * 180) / Math.PI;
const pad2 = (v) => String(v).padStart(2, '0');
const pad3 = (v) => String(v).padStart(3, '0');

// Production hardening: storage can throw in private/restricted browser contexts.
const getSafeStorage = (storageName) => {
  if (typeof window === 'undefined') return null;
  if (storageName === 'localStorage') return window.localStorage;
  if (storageName === 'sessionStorage') return window.sessionStorage;
  return null;
};

const safeStorageGet = (storageName, key) => {
  try {
    const storage = getSafeStorage(storageName);
    return storage ? storage.getItem(key) : null;
  } catch (_) {
    return null;
  }
};

const safeStorageSet = (storageName, key, value) => {
  try {
    const storage = getSafeStorage(storageName);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
};

const formatBangkokTime = (timeMs) => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date(timeMs));
  } catch (_) {
    return new Date(timeMs + 7 * 3600000).toISOString().substring(11, 19);
  }
};

function getUtcDayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000) + 1;
}

function calculateSatData(date, satrec, station = GS_NETWORK[0]) {
  if (!satrec) return null;
  try {
    const positionAndVelocity = satelliteJs.propagate(satrec, date);
    if (!positionAndVelocity.position || typeof positionAndVelocity.position === 'boolean') return null;

    const gmst = satelliteJs.gstime(date);
    const geodetic = satelliteJs.eciToGeodetic(positionAndVelocity.position, gmst);
    const positionEcf = satelliteJs.eciToEcf(positionAndVelocity.position, gmst);
   // 📍 ฟันธง: ดึงความสูงจริง (เมตร) แปลงเป็นกิโลเมตร เพื่อคำนวณมุม AOS/LOS ให้แม่นยำที่สุด!
   const observerGd = { 
    latitude: toRadians(station.lat), 
    longitude: toRadians(station.lng), 
    height: station.alt / 1000 
  };
    const lookAngles = satelliteJs.ecfToLookAngles(observerGd, positionEcf);
    const speed = Math.sqrt(positionAndVelocity.velocity.x ** 2 + positionAndVelocity.velocity.y ** 2 + positionAndVelocity.velocity.z ** 2);

    let rawLng = satelliteJs.degreesLong(geodetic.longitude);
    const normalizedLng = ((rawLng + 180) % 360 + 360) % 360 - 180;

    const lat = satelliteJs.degreesLat(geodetic.latitude);
    const altKm = geodetic.height;

    if (isNaN(lat) || isNaN(normalizedLng) || isNaN(altKm)) return null;

    return {
      lat: lat,
      lng: normalizedLng,
      altKm: altKm,
      elevationDeg: toDegrees(lookAngles.elevation),
      azimuthDeg: toDegrees(lookAngles.azimuth),
      rangeKm: lookAngles.rangeSat,
      speedKmS: speed
    };
  } catch (e) { return null; }
}

function getInclinationDeg(line2) { return Number(line2.trim().split(/\s+/)[2] || 0); }

// TSX TV ENGINEERING HUD: derive identity/orbit values locally from the selected TLE.
// No extra network request is required, so the show remains deterministic if venue Wi-Fi is unavailable.
function getTleEngineeringData(line1, line2) {
  try {
    if (typeof line1 !== 'string' || typeof line2 !== 'string') return null;
    const parts = line2.trim().split(/\s+/);
    const eccentricityDigits = parts[4] || '';
    const eccentricity = /^\d+$/.test(eccentricityDigits) ? Number(`0.${eccentricityDigits}`) : NaN;
    const meanMotionRevDay = Number(parts[7]);
    if (!Number.isFinite(eccentricity) || !Number.isFinite(meanMotionRevDay) || meanMotionRevDay <= 0) return null;

    // TLE International Designator: YYNNNP... -> YYYY-NNNP...
    const rawDesignator = line1.substring(9, 17).trim();
    let cosparId = '—';
    const idMatch = /^(\d{2})(\d{3})([A-Z0-9]{0,3})$/.exec(rawDesignator);
    if (idMatch) {
      const yy = Number(idMatch[1]);
      const year = yy >= 57 ? 1900 + yy : 2000 + yy;
      cosparId = `${year}-${idMatch[2]}${idMatch[3] || ''}`;
    }

    const periodMin = 1440 / meanMotionRevDay;
    const meanMotionRadS = meanMotionRevDay * 2 * Math.PI / 86400;
    const muKm3S2 = 398600.4418;
    const earthEquatorialKm = 6378.137;
    const semiMajorKm = Math.cbrt(muKm3S2 / (meanMotionRadS * meanMotionRadS));
    const perigeeKm = semiMajorKm * (1 - eccentricity) - earthEquatorialKm;
    const apogeeKm = semiMajorKm * (1 + eccentricity) - earthEquatorialKm;
    return { cosparId, eccentricity, meanMotionRevDay, periodMin, perigeeKm, apogeeKm };
  } catch (_) {
    return null;
  }
}

function getDownlinkCarrierMHz(text, band) {
  if (typeof text !== 'string') return null;
  const source = text.toUpperCase();
  let value = null;
  let unit = 'MHZ';

  // Prefer an explicitly marked downlink when telemetry contains both UP and DN.
  const dn = /(\d+(?:\.\d+)?)\s*DN(?:\s*(GHZ|MHZ))?/.exec(source);
  if (dn) {
    value = Number(dn[1]);
    unit = dn[2] || (/GHZ/.test(source) ? 'GHZ' : 'MHZ');
  } else {
    const numeric = /(\d+(?:\.\d+)?)\s*(GHZ|MHZ)/.exec(source);
    if (!numeric) return null;
    value = Number(numeric[1]);
    unit = numeric[2];
  }
  if (!Number.isFinite(value)) return null;
  const mhz = unit === 'GHZ' ? value * 1000 : value;
  if (band === 's') return mhz >= 1800 && mhz <= 4500 ? mhz : null;
  if (band === 'x') return mhz >= 7000 && mhz <= 12000 ? mhz : null;
  return mhz;
}

function getRangeRateKmS(timeMs, satrec, station) {
  if (!satrec || !Number.isFinite(timeMs)) return null;
  // Central-difference slant range over one second: stable, station-relative and independent of UI frame rate.
  const halfWindowMs = 500;
  const before = calculateSatData(new Date(timeMs - halfWindowMs), satrec, station);
  const after = calculateSatData(new Date(timeMs + halfWindowMs), satrec, station);
  if (!Number.isFinite(before?.rangeKm) || !Number.isFinite(after?.rangeKm)) return null;
  return (after.rangeKm - before.rangeKm) / (2 * halfWindowMs / 1000);
}

function getDopplerShiftKhz(carrierMHz, rangeRateKmS) {
  if (!Number.isFinite(carrierMHz) || !Number.isFinite(rangeRateKmS)) return null;
  const cKmS = 299792.458;
  // Positive range rate = receding => negative received-frequency shift.
  return -(carrierMHz * 1e6) * (rangeRateKmS / cKmS) / 1000;
}

function formatSigned(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function hasValidTleChecksum(line) {
  if (typeof line !== 'string' || line.length < 69) return false;
  const checksumChar = line.charAt(68);
  if (!/\d/.test(checksumChar)) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const ch = line.charAt(i);
    if (ch >= '0' && ch <= '9') sum += Number(ch);
    else if (ch === '-') sum += 1;
  }
  return (sum % 10) === Number(checksumChar);
}

function getTleEpochMs(line1) {
  try {
    if (typeof line1 !== 'string' || line1.length < 32) return null;
    const yy = Number(line1.substring(18, 20));
    const dayOfYear = Number(line1.substring(20, 32));
    if (!Number.isFinite(yy) || !Number.isFinite(dayOfYear) || dayOfYear < 1 || dayOfYear >= 367) return null;
    const year = yy >= 57 ? 1900 + yy : 2000 + yy;
    return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000;
  } catch (_) {
    return null;
  }
}

function isUsableTlePair(line1, line2, expectedCatnr = null) {
  try {
    if (typeof line1 !== 'string' || typeof line2 !== 'string') return false;
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) return false;
    if (!hasValidTleChecksum(line1) || !hasValidTleChecksum(line2)) return false;
    const cat1 = line1.substring(2, 7).trim();
    const cat2 = line2.substring(2, 7).trim();
    if (!cat1 || cat1 !== cat2 || (expectedCatnr && cat1 !== String(expectedCatnr))) return false;
    const rec = satelliteJs.twoline2satrec(line1, line2);
    return Boolean(rec) && (!Number.isFinite(rec.error) || rec.error === 0);
  } catch (_) {
    return false;
  }
}

function sanitizeTleMap(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const sat of SATELLITE_OPTIONS) {
    const pair = raw[sat.catnr];
    if (pair && isUsableTlePair(pair.line1, pair.line2, sat.catnr)) {
      clean[sat.catnr] = { line1: pair.line1, line2: pair.line2 };
    }
  }
  return clean;
}

function getFootprintRadiusDeg(altKm, minElevDeg = 5) {
  const re = EARTH_RADIUS_KM;
  const r = re + Math.max(0, altKm);
  const elevRad = toRadians(minElevDeg);
  
  const ratio = (re / r) * Math.cos(elevRad);
  const clampedRatio = Math.max(-1, Math.min(1, ratio)); 
  
  const nadirAngleRad = Math.asin(clampedRatio);
  const earthCentralAngleRad = (Math.PI / 2) - elevRad - nadirAngleRad;
  return toDegrees(earthCentralAngleRad);
}

function getCirclePolygon(centerLat, centerLng, radiusDeg, numPoints = 64) {
  const lat1 = toRadians(centerLat);
  const lon1 = toRadians(centerLng);
  const d = toRadians(radiusDeg);
  const coords = [];
  for (let i = 0; i <= numPoints; i++) {
    const tc = (2 * Math.PI * i) / numPoints;
    const latArg = Math.max(-1, Math.min(1, Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(tc)));
    let lat = Math.asin(latArg);
    let lon = lon1 + Math.atan2(Math.sin(tc) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat));
    
    lon = (lon + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    coords.push([toDegrees(lon), toDegrees(lat)]);
  }
  return coords;
}

function createSatelliteModel(isTarget = false) {
  const group = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: '#ffcc00' });
  const silver = new THREE.MeshBasicMaterial({ color: '#8892b0' }); 
  
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.45), gold));
  
  // ฟันธง: กำหนดมุมเอียง 45 องศา (Math.PI / 4) เพื่อบิดแผงรับแสงและโชว์หน้ากว้าง
  const tiltAngle = Math.PI / 4;

  const lp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), silver); 
  lp.position.x = -1.85; 
  lp.rotation.x = tiltAngle; // บิดแกน X เงยแผงขึ้น
  group.add(lp);
  
  const rp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), silver); 
  rp.position.x = 1.85; 
  rp.rotation.x = tiltAngle; // บิดแกน X เงยแผงขึ้น
  group.add(rp);
  
  const scale = isTarget ? 3.0 : 1.2;
  group.scale.set(scale, scale, scale);
  return group;
}

// 📍 ฟันธง: เครื่องสร้างป้ายชื่อ 3D สไตล์ Sci-Fi (อัปเกรดระบบรอฟอนต์ ป้องกันฟอนต์เน่า 100%)
const create3DLabel = (name, catnr) => {
  const cacheKey = 'label_3d_' + catnr;
  
  // 📍 ฟันธงจุดตาย: เช็คก่อนว่าเบราว์เซอร์ดาวน์โหลดฟอนต์ Orbitron เสร็จหรือยัง?
  // ถ้าฟอนต์โหลดเสร็จแล้ว และมี Cache ค่อยดึงภาพป้ายสวยๆ มาใช้
  const isFontLoaded = document.fonts ? document.fonts.check('900 48px Orbitron') : true;
  if (isFontLoaded && window[cacheKey]) return window[cacheKey].clone();

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = '900 48px "Orbitron", sans-serif'; 
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // ใส่เงาเรืองแสงสีฟ้า Cyan ให้ดุดันสไตล์ Sci-Fi
  ctx.shadowColor = '#00eaff';
  ctx.shadowBlur = 25;
  ctx.fillStyle = '#ffffff';
  
  ctx.fillText(name, 256, 64);
  
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter; 
  texture.magFilter = THREE.LinearFilter;
  
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  
  // ตั้งสเกลกรอบป้ายให้สมส่วนกับความกว้างดาวเทียม
  sprite.scale.set(30, 7.5, 1);
  
  // 📍 ฟันธง: จะอนุญาตให้ "จดจำ (Cache)" ป้ายนี้ ก็ต่อเมื่อฟอนต์ Orbitron โหลดสำเร็จแล้วเท่านั้น!
  // ป้องกันการแอบจำฟอนต์ระบบธรรมดาเอาไว้ตอนเปิดเว็บครั้งแรก
  if (isFontLoaded) {
    window[cacheKey] = sprite;
  }
  
  return sprite.clone();
};

// Self-contained hardware icons: available offline and in detached panel documents.
function FlowHardwareIcon({ kind, color = 'var(--cyan)', label }) {
  const paths = {
    converter: 'M7 21V4m-4 4 4-4 4 4M17 3v17m-4-4 4 4 4-4',
    antenna: 'M4 5a12 12 0 0 0 15 15L4 5Zm7 12-2 5m-4 0h10M12 12l7-7m-1-3a4 4 0 0 1 4 4m-6-2a6 6 0 0 1 6 6',
    tuner: 'M12 7v15M8 22l4-11 4 11M7 10a7 7 0 0 1 0-8m10 0a7 7 0 0 1 0 8M9 8a4 4 0 0 1 0-4m6 0a4 4 0 0 1 0 4M10 6h4',
    router: 'M3 14h18v7H3zM7 17h.01M11 17h.01M18 17h.01M8 14V9m8 5V9M6 5a9 9 0 0 1 12 0M9 8a4 4 0 0 1 6 0',
    baseband: 'M4 2h16v6H4zM4 11h16v6H4zM7 5h.01M7 14h.01M12 17v4M4 23v-2h16v2M16 5h2m-2 9h2',
  };
  return (
    <svg className="n-icon" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={label || kind} focusable="false">
      <path d={paths[kind] || paths.baseband} />
    </svg>
  );
}

// One audio owner for the controller and every panel host. stop() cuts both the
// master gain and all already-playing oscillators; clearing a timer alone does not mute.
function createSonarAudioController(AudioContextCtor, ownerWindow) {
  let ctx = null;
  let master = null;
  let timer = null;
  let wanted = false;
  let disposed = false;
  let generation = 0;
  let waitingForGesture = false;
  const voices = new Set();

  const removeGestureListeners = () => {
    if (!waitingForGesture) return;
    ownerWindow.removeEventListener('pointerdown', retryFromGesture);
    ownerWindow.removeEventListener('keydown', retryFromGesture);
    waitingForGesture = false;
  };
  const releaseVoice = (voice, stopNow = false) => {
    if (voice.released) return;
    voice.released = true;
    voices.delete(voice);
    for (const osc of voice.oscillators) {
      osc.onended = null;
      if (stopNow) { try { osc.stop(ctx?.currentTime || 0); } catch (_) {} }
      try { osc.disconnect(); } catch (_) {}
    }
    try { voice.gain.disconnect(); } catch (_) {}
  };
  const ping = () => {
    if (!wanted || disposed || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const voice = { gain, oscillators: [osc1, osc2], ended: 0, released: false };
    voices.add(voice);
    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(850, now);
    osc1.frequency.exponentialRampToValueAtTime(830, now + 1.8);
    osc2.frequency.setValueAtTime(1700, now);
    osc2.frequency.exponentialRampToValueAtTime(1660, now + 1.8);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    gain.connect(master);
    for (const osc of voice.oscillators) {
      osc.connect(gain);
      osc.onended = () => { if (++voice.ended === 2) releaseVoice(voice); };
      osc.start(now);
      osc.stop(now + 1.8);
    }
  };
  const arm = (token) => {
    if (!wanted || disposed || token !== generation || ctx?.state !== 'running' || timer !== null) return;
    removeGestureListeners();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(1, ctx.currentTime);
    ping();
    timer = ownerWindow.setInterval(ping, 2000);
  };
  const tryResume = () => {
    if (!wanted || disposed || !ctx) return;
    const token = generation;
    if (ctx.state === 'running') { arm(token); return; }
    if (!waitingForGesture) {
      waitingForGesture = true;
      ownerWindow.addEventListener('pointerdown', retryFromGesture);
      ownerWindow.addEventListener('keydown', retryFromGesture);
    }
    try { Promise.resolve(ctx.resume()).then(() => arm(token)).catch(() => {}); } catch (_) {}
  };
  function retryFromGesture() { tryResume(); }
  const stop = () => {
    wanted = false;
    generation += 1;
    removeGestureListeners();
    if (timer !== null) { ownerWindow.clearInterval(timer); timer = null; }
    if (ctx && master && ctx.state !== 'closed') {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0, ctx.currentTime);
    }
    for (const voice of [...voices]) releaseVoice(voice, true);
  };
  return {
    start() {
      if (disposed || !AudioContextCtor) return;
      if (!wanted) { wanted = true; generation += 1; }
      if (!ctx) {
        try {
          ctx = new AudioContextCtor();
          master = ctx.createGain();
          master.gain.setValueAtTime(0, ctx.currentTime);
          master.connect(ctx.destination);
        } catch (_) { ctx = null; master = null; wanted = false; return; }
      }
      tryResume();
    },
    stop,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      try { master?.disconnect(); } catch (_) {}
      if (ctx && ctx.state !== 'closed') {
        try { Promise.resolve(ctx.close()).catch(() => {}); } catch (_) {}
      }
      master = null;
      ctx = null;
    },
  };
}

// 📍 ฟันธง: สร้าง Component สำหรับป้ายความถี่ (f-label) แบบฝัง CSS ป้องกันบั๊ก!
const FreqLabel = ({ linkType, freq, active }) => {
  let color = '#fff';
  let shadow = 'none';
  let labelText = '';

  if (linkType === 'tm') { color = 'var(--cyan)'; shadow = 'rgba(0,234,255,0.4)'; labelText = 'S-BAND TM (DOWN)'; }
  else if (linkType === 'tm_up') { color = 'var(--gold)'; shadow = 'rgba(255,204,0,0.4)'; labelText = 'S-BAND TC (UP)'; }
  else if (linkType === 'downlink') { color = 'var(--green)'; shadow = 'rgba(0,255,102,0.4)'; labelText = 'DOWNLINK'; }

  if (!active) return null;

  return (
    <div style={{ position: 'absolute', pointerEvents: 'none', border: `2px solid ${color}`, borderRadius: '4px', padding: 'max(8px, 0.8cqmin) max(15px, 1.5cqmin)', fontFamily: '"Orbitron", sans-serif', fontSize: 'max(13px, 1.5cqmin)', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1.5px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', color: color, boxShadow: `0 0 10px ${shadow}`, transform: 'translate(-50%, -50%)' }}>
      {freq}<br /><span style={{ fontSize: 'max(10px, 1cqmin)', color: '#fff' }}>{labelText}</span>
    </div>
  );
};


// =========================================================================
// INTERNAL VECTOR ANTENNA 3D SIMULATOR
// - Embedded inside SAT-ORBIT (no external window required)
// - Reuses SAT-ORBIT master clock / AZ / EL / SIM rate
// - Vector/wireframe reflector + feed + pedestal, preserving the original concept
// =========================================================================
const CLASSIC_VECTOR_ANTENNA_BASE_PATH = `M158,679L158,683L157,684L157,692L156,693L156,699L155,700L155,707L154,708L154,713L153,714L153,720L152,721L152,728L151,729L151,737L150,738L150,745L149,746L149,753L148,754L148,762L147,763L147,772L146,773L146,780L145,781L145,788L144,789L144,795L143,796L143,803L142,804L142,813L141,814L141,823L144,823L145,824L146,824L147,823L147,820L148,819L148,812L149,811L149,806L150,805L150,798L151,797L151,789L153,787L154,788L160,788L162,790L161,791L161,798L160,799L160,806L159,807L159,815L158,816L158,832L157,833L157,852L155,854L148,854L146,852L146,833L140,833L140,1040L146,1040L147,1039L147,1021L149,1019L156,1019L157,1020L157,1034L158,1035L158,1044L157,1045L157,1047L156,1048L155,1051L153,1053L153,1054L152,1055L150,1055L148,1053L145,1052L143,1050L143,1047L142,1047L141,1046L140,1046L139,1047L136,1046L136,1047L134,1049L133,1052L131,1054L131,1055L130,1056L129,1059L127,1061L127,1062L126,1063L125,1066L123,1068L122,1071L120,1073L120,1074L119,1075L118,1078L116,1080L115,1083L113,1085L112,1088L110,1090L109,1093L107,1095L107,1096L106,1097L106,1098L105,1099L104,1102L102,1104L102,1105L101,1106L101,1107L100,1108L100,1109L99,1110L99,1111L98,1112L98,1113L97,1114L96,1117L99,1120L102,1119L104,1121L105,1121L107,1123L108,1123L111,1126L111,1133L110,1134L106,1134L105,1135L102,1135L100,1133L100,1126L99,1125L98,1125L97,1126L93,1126L93,1138L92,1139L93,1140L93,1142L92,1143L92,1326L93,1327L99,1327L101,1325L110,1325L111,1326L111,1332L316,1332L316,1327L317,1326L317,1322L316,1321L316,1289L317,1288L317,1284L318,1283L332,1283L334,1281L334,1130L333,1129L318,1129L317,1128L317,1126L316,1125L315,1122L313,1120L312,1117L310,1115L310,1114L309,1113L309,1112L308,1111L307,1108L305,1106L305,1105L304,1104L304,1103L303,1102L302,1099L300,1097L299,1094L297,1092L296,1089L294,1087L294,1086L293,1085L292,1082L290,1080L290,1079L289,1078L288,1075L286,1073L286,1072L285,1071L284,1068L282,1066L282,1065L281,1064L281,1063L280,1062L279,1059L277,1057L277,1056L276,1055L276,1054L274,1052L274,1051L273,1050L272,1047L270,1045L270,981L272,979L283,979L283,978L284,977L284,975L283,974L283,973L271,973L270,972L270,870L274,866L277,865L279,863L280,863L282,861L283,861L284,860L284,856L272,856L271,855L271,826L272,825L272,817L274,815L275,815L275,810L276,809L276,803L277,802L277,795L278,794L278,787L279,786L279,778L280,777L280,771L281,770L281,762L282,761L282,753L283,752L283,745L284,744L284,737L285,736L285,730L283,728L283,725L284,724L284,721L285,720L285,719L289,715L290,715L294,711L294,710L293,709L287,709L286,708L286,701L287,700L287,696L285,696L285,700L284,701L284,707L282,709L204,709L203,708L196,708L195,709L194,709L194,711L195,712L199,712L200,713L200,715L201,716L201,720L202,721L204,721L205,720L204,719L204,716L203,715L203,713L204,712L233,712L234,713L234,716L233,717L233,721L236,721L236,717L237,716L237,713L238,712L265,712L266,713L265,714L265,715L263,718L263,720L264,721L265,721L266,720L266,719L267,718L267,717L268,716L268,715L270,712L282,712L283,713L283,717L282,718L282,726L280,728L273,728L272,729L272,734L271,735L271,742L270,743L270,749L269,750L269,756L268,757L268,763L267,764L267,772L266,773L266,780L265,781L265,790L264,791L264,798L263,799L263,810L262,811L262,816L260,818L253,818L252,817L245,817L244,816L238,816L237,815L231,815L230,814L224,814L223,813L216,813L215,812L208,812L207,811L200,811L199,810L191,810L190,809L183,809L182,808L175,808L174,807L167,807L166,806L163,806L162,805L162,799L163,798L163,791L165,789L165,788L166,787L166,782L167,781L167,780L165,778L165,775L166,774L166,767L167,766L167,760L168,759L168,752L169,751L169,744L170,743L170,737L171,736L171,727L172,726L172,720L173,719L173,714L175,712L175,711L176,710L176,703L175,702L175,694L176,693L176,687L177,686L177,680L178,679L183,679L184,680L184,685L183,686L183,691L184,691L185,692L194,692L194,683L196,681L198,681L199,682L205,682L206,683L213,683L214,684L221,684L222,685L229,685L230,686L235,686L230,686L229,685L225,685L224,684L220,684L219,683L214,683L213,682L209,682L208,681L204,681L203,680L198,680L197,679L193,679L193,690L192,691L190,691L189,690L189,687L190,686L190,679L189,678L189,682L188,683L188,689L187,690L186,690L185,689L185,683L186,682L186,678L178,678L177,677L176,677L176,680L175,681L175,688L174,689L174,696L173,697L173,702L172,703L171,703L170,702L164,702L162,700L163,699L163,691L164,690L164,683L165,682L165,680L164,679ZM113,1330L114,1329L313,1329L314,1330L313,1331L114,1331ZM95,1316L96,1315L110,1315L111,1316L111,1322L110,1323L96,1323L95,1322ZM95,1312L96,1311L97,1311L98,1312L97,1313L96,1313ZM96,1286L98,1288L98,1308L97,1309L96,1309L95,1308L95,1287ZM96,1261L97,1261L98,1262L98,1283L97,1284L96,1284L95,1283L95,1262ZM96,1235L97,1235L98,1236L98,1257L97,1258L96,1258L95,1257L95,1236ZM101,1230L110,1230L111,1231L111,1312L110,1313L101,1313L100,1312L100,1231ZM95,1230L96,1229L97,1229L98,1230L98,1231L97,1232L96,1232L95,1231ZM95,1221L97,1219L109,1219L111,1221L111,1226L109,1228L108,1227L96,1227L95,1226ZM97,1209L98,1210L98,1216L96,1218L95,1217L95,1210L96,1209ZM96,1183L98,1185L98,1205L97,1206L96,1206L95,1205L95,1184ZM96,1157L97,1157L98,1158L98,1179L97,1180L96,1180L95,1179L95,1158ZM96,1147L97,1147L98,1148L98,1153L97,1154L96,1154L95,1153L95,1148ZM102,1146L109,1146L111,1148L111,1216L109,1218L102,1218L100,1216L100,1148ZM95,1137L96,1136L109,1136L111,1138L111,1143L110,1144L96,1144L95,1143ZM269,1131L330,1131L331,1132L331,1279L330,1280L269,1280L268,1279L268,1132ZM247,1131L264,1131L266,1133L266,1279L265,1280L247,1280L246,1279L246,1132ZM96,1128L97,1128L98,1129L98,1133L97,1134L96,1134L95,1133L95,1129ZM113,1128L114,1127L314,1127L315,1128L314,1129L245,1129L244,1130L244,1282L245,1283L313,1283L314,1284L314,1327L313,1328L233,1328L232,1327L230,1327L229,1328L140,1328L139,1327L136,1327L135,1328L115,1328L113,1326ZM126,1187L125,1188L125,1305L126,1306L196,1306L196,1305L197,1304L197,1303L196,1302L196,1301L197,1300L196,1299L196,1298L197,1297L197,1291L196,1290L196,1265L197,1264L197,1223L196,1222L196,1199L197,1198L197,1189L196,1188L196,1187ZM192,1189L194,1189L195,1190L195,1303L194,1304L193,1304L192,1303L192,1297L191,1296L191,1269L192,1268L191,1267L191,1265L192,1264L192,1258L191,1257L191,1216L192,1215L192,1202L191,1201L191,1190ZM128,1189L189,1189L190,1190L190,1303L189,1304L128,1304L126,1302L126,1297L127,1296L127,1222L126,1221L126,1202L127,1201L127,1192L126,1191ZM130,1192L130,1301L186,1301L187,1300L187,1238L186,1237L186,1234L187,1233L187,1193L186,1192ZM132,1194L184,1194L185,1195L185,1299L184,1300L132,1300L131,1299L131,1195ZM147,1169L147,1177L148,1178L169,1178L170,1177L170,1169L169,1168L148,1168ZM160,1171L161,1170L167,1170L168,1171L168,1175L167,1176L161,1176L160,1175ZM149,1171L150,1170L156,1170L157,1171L157,1175L156,1176L150,1176L149,1175ZM155,1139L155,1146L162,1146L162,1140L161,1139ZM157,1142L158,1141L159,1141L160,1142L160,1144L159,1145L158,1145L157,1144ZM103,1109L105,1109L106,1110L107,1110L109,1112L110,1112L111,1113L112,1113L115,1115L115,1117L114,1118L114,1119L112,1122L110,1122L107,1119L106,1119L104,1117L103,1117L100,1115L100,1113L101,1112L101,1111ZM105,1107L106,1106L107,1107L106,1108ZM119,1084L120,1085L120,1086L119,1087L118,1090L116,1092L115,1095L113,1097L113,1098L112,1099L111,1102L109,1104L108,1104L107,1103L107,1101L108,1100L109,1097L111,1095L111,1094L112,1093L112,1092L114,1090L115,1087L118,1084ZM138,1061L140,1063L143,1064L145,1066L145,1067L143,1069L142,1072L140,1074L139,1077L137,1079L137,1080L136,1081L136,1082L134,1084L134,1085L133,1086L132,1089L130,1091L130,1092L129,1093L129,1094L127,1096L126,1099L122,1104L122,1105L121,1106L121,1107L119,1109L118,1112L117,1113L116,1113L115,1112L112,1111L110,1109L110,1108L111,1107L112,1104L114,1102L114,1101L115,1100L116,1097L118,1095L118,1094L119,1093L120,1090L122,1088L122,1087L123,1086L124,1083L126,1081L126,1080L127,1079L128,1076L130,1074L131,1071L133,1069L133,1068L134,1067L135,1064ZM132,1061L133,1062L133,1064L132,1065L132,1066L130,1068L129,1071L127,1073L127,1074L126,1075L125,1078L123,1080L123,1081L122,1082L121,1082L119,1080L120,1079L120,1078L122,1076L123,1073L125,1071L125,1070L126,1069L126,1068L128,1066L129,1063L131,1061ZM137,1050L139,1050L144,1054L147,1055L150,1058L150,1059L146,1064L145,1063L144,1063L142,1061L141,1061L139,1059L136,1058L134,1056L134,1054L135,1053L135,1052ZM114,1123L116,1121L117,1118L119,1116L120,1113L122,1111L123,1108L125,1106L125,1105L126,1104L126,1103L127,1102L128,1099L132,1094L133,1091L135,1089L136,1086L138,1084L139,1081L141,1079L141,1078L142,1077L143,1074L145,1072L146,1069L148,1067L148,1066L149,1065L150,1062L152,1060L152,1059L154,1057L155,1054L157,1052L158,1049L160,1047L268,1047L270,1049L270,1050L271,1051L272,1054L274,1056L274,1057L275,1058L276,1061L278,1063L278,1064L279,1065L280,1068L282,1070L282,1071L283,1072L284,1075L286,1077L286,1078L287,1079L288,1082L290,1084L291,1087L293,1089L293,1090L294,1091L294,1092L295,1093L296,1096L298,1098L298,1099L299,1100L300,1103L302,1105L303,1108L305,1110L305,1111L306,1112L307,1115L309,1117L309,1118L310,1119L310,1120L312,1123L311,1124L255,1124L254,1125L251,1125L250,1124L233,1124L232,1125L223,1125L222,1124L217,1124L216,1125L214,1125L213,1124L212,1125L211,1124L200,1124L199,1125L198,1124L197,1124L196,1125L195,1124L194,1125L193,1124L192,1125L191,1124L176,1124L175,1125L141,1125L140,1124L134,1124L133,1125L116,1125ZM160,1044L161,1043L267,1043L268,1044L267,1045L161,1045ZM160,1041L160,1040L161,1039L267,1039L268,1040L266,1042L161,1042ZM143,1031L144,1031L145,1032L145,1037L144,1038L143,1038L142,1037L142,1032ZM143,1020L144,1020L145,1021L145,1025L144,1026L143,1026L142,1025L142,1021ZM141,1012L143,1010L158,1010L160,1012L160,1016L158,1018L143,1018L141,1016ZM144,1003L145,1004L145,1007L143,1009L141,1007L141,1005L143,1003ZM148,980L157,980L158,981L158,1007L156,1009L149,1009L147,1007L147,981ZM160,981L161,980L211,980L212,979L266,979L267,980L267,987L268,988L268,1013L267,1014L268,1015L268,1017L267,1018L267,1033L268,1034L268,1036L266,1038L161,1038L160,1037L160,1020L161,1019L161,1013L162,1012L162,1011L160,1008ZM145,977L147,975L281,975L282,976L282,977L281,978L146,978ZM143,953L144,953L145,954L145,973L144,974L144,979L145,980L145,999L144,1000L143,1000L142,999L142,990L141,989L141,955ZM148,943L157,943L158,944L158,972L157,973L148,973L147,972L147,944ZM143,943L144,943L145,944L145,948L144,949L142,949L141,948L141,945ZM141,935L142,934L159,934L160,935L160,940L159,941L142,941L141,940ZM143,926L145,928L145,931L144,932L142,932L141,931L141,928ZM147,873L148,874L148,909L147,910L146,909L146,874ZM143,873L144,873L145,874L145,923L144,924L143,924L141,922L141,875ZM146,867L147,866L148,867L148,868L147,869L146,868ZM151,865L157,865L158,866L158,931L157,932L151,932L150,931L150,866ZM143,865L144,865L145,866L145,869L144,870L142,870L141,869L141,867ZM270,866L270,862L271,861L277,861L278,862L277,863L276,863L274,865L273,865L271,867ZM162,861L267,861L268,862L268,943L267,944L267,967L268,968L268,972L267,973L161,973L160,972L160,943L162,941L162,934L160,932L160,863ZM147,862L148,861L158,861L159,862L158,863L148,863ZM147,858L148,857L281,857L282,858L282,859L281,860L148,860L147,859ZM270,855L269,856L160,856L159,855L160,854L238,854L239,853L258,853L259,854L266,854L267,853L268,853ZM143,848L144,848L145,849L145,862L144,863L142,863L141,862L141,857L142,856L142,849ZM158,841L159,840L269,840L270,841L270,851L268,853L159,853L158,852ZM143,834L144,834L145,835L145,844L144,845L142,845L141,844L141,837ZM159,829L160,828L168,828L169,829L184,829L185,830L199,830L200,831L216,831L217,832L231,832L232,833L243,833L244,834L254,834L255,835L261,835L262,836L267,836L269,838L268,839L160,839L159,838ZM262,818L264,816L270,816L271,817L271,819L270,820L265,820ZM159,824L160,823L160,817L162,815L163,816L170,816L171,817L179,817L180,818L187,818L188,819L195,819L196,820L202,820L203,821L210,821L211,822L218,822L219,823L226,823L227,824L233,824L234,825L239,825L240,826L247,826L248,827L255,827L256,828L263,828L264,829L268,829L269,830L269,835L268,836L267,835L263,835L262,834L259,834L258,833L244,833L243,832L232,832L231,831L218,831L217,830L205,830L204,829L189,829L188,828L174,828L173,827L161,827L159,825ZM161,812L162,811L165,811L166,812L173,812L174,813L181,813L182,814L188,814L189,815L196,815L197,816L204,816L205,817L212,817L213,818L220,818L221,819L228,819L229,820L235,820L236,821L242,821L243,822L250,822L251,823L256,823L257,824L263,824L264,825L268,825L270,827L269,828L265,828L264,827L257,827L256,826L250,826L249,825L242,825L241,824L236,824L235,823L228,823L227,822L220,822L219,821L213,821L212,820L205,820L204,819L197,819L196,818L189,818L188,817L181,817L180,816L174,816L173,815L167,815L166,814L162,814L161,813ZM161,809L163,807L164,808L171,808L172,809L180,809L181,810L188,810L189,811L197,811L198,812L204,812L205,813L213,813L214,814L220,814L221,815L228,815L229,816L235,816L236,817L243,817L244,818L251,818L252,819L256,819L257,820L262,820L263,821L269,821L270,822L270,823L269,824L264,824L263,823L258,823L257,822L251,822L250,821L244,821L243,820L236,820L235,819L228,819L227,818L220,818L219,817L213,817L212,816L205,816L204,815L198,815L197,814L190,814L189,813L182,813L181,812L174,812L173,811L166,811L165,810L162,810ZM147,797L148,798L148,805L147,806L147,814L146,815L146,819L144,821L143,820L143,811L144,810L144,804L145,803L145,798L146,797ZM147,787L149,787L150,788L150,790L148,793L147,793L146,792L146,788ZM147,780L148,779L158,779L159,780L164,780L165,781L165,785L163,787L160,787L159,786L152,786L151,785L148,785L147,784ZM149,771L151,771L152,772L152,773L151,774L151,776L150,777L149,777L148,776L148,772ZM154,745L155,746L155,750L154,751L154,758L153,759L153,765L152,766L152,767L151,768L150,768L149,767L149,763L150,762L150,755L151,754L151,747L153,745ZM276,729L277,730L282,730L283,731L283,733L282,734L282,742L281,743L281,750L280,751L280,759L279,760L279,767L278,768L278,776L277,777L277,784L276,785L276,792L275,793L275,800L274,801L274,809L273,810L273,813L272,814L266,814L264,812L264,808L265,807L265,799L266,798L266,790L267,789L267,782L268,781L268,774L269,773L269,767L270,766L270,759L271,758L271,750L272,749L272,741L273,740L273,732ZM156,719L158,721L158,726L157,727L157,736L156,737L156,741L155,742L154,742L152,740L152,738L153,737L153,730L154,729L154,722ZM289,711L290,712L286,716L285,715L285,713L287,711ZM170,712L171,713L171,720L170,721L170,728L169,729L169,735L168,736L168,743L167,744L167,751L166,752L166,759L165,760L165,768L164,769L164,775L162,778L155,778L153,776L153,773L154,772L154,765L155,764L155,758L156,757L156,750L157,749L157,742L158,741L158,733L159,732L159,726L160,725L160,717L161,716L161,712L162,711L164,711L165,712ZM158,711L159,712L159,715L157,717L155,715L155,713L157,711ZM156,705L158,702L159,702L160,703L168,703L169,704L173,704L174,705L174,710L173,711L170,711L169,710L161,710L160,709L157,709L156,708ZM158,694L160,694L161,695L161,700L160,701L158,701L157,700L157,695ZM162,680L163,681L163,686L162,687L162,690L161,691L159,691L158,690L158,689L159,688L159,682L161,680Z`;

// One mechanical simulation, owned by the controller rather than a popup.
// All rates and acquisition delays below are measured in simulation seconds.
const ANTENNA_STOW = { az: 0, el: 90 };
const antennaAzError = (target, current) => ((target - current + 540) % 360) - 180;
const antennaClamp = (value, min, max) => Math.max(min, Math.min(max, value));
const createAntennaSimulation = () => ({
  ...ANTENNA_STOW, azVel: 0, elVel: 0, sourceKey: null,
  lastSimMs: null, lastLinkActive: false, signalReadyAt: null,
  losAt: null, acquired: false, signalVisible: false, mode: 'STOW'
});

function stepAntennaAxis(current, velocity, target, maxRate, acceleration, dt, circular = false) {
  const error = circular ? antennaAzError(target, current) : target - current;
  if (Math.abs(error) < 0.01 && Math.abs(velocity) < 0.05) return { value: target, velocity: 0 };
  const desired = antennaClamp(error * 2.1, -maxRate, maxRate);
  const nextVelocity = velocity + antennaClamp(desired - velocity, -acceleration * dt, acceleration * dt);
  let step = nextVelocity * dt;
  let resultVelocity = nextVelocity;
  if (Math.sign(step) === Math.sign(error) && Math.abs(step) > Math.abs(error)) {
    step = error;
    resultVelocity = 0;
  }
  const value = current + step;
  return { value: circular ? ((value % 360) + 360) % 360 : value, velocity: resultVelocity };
}

function advanceAntennaSimulation(previous, input) {
  const simNow = Number(input.simulatedTimeMs);
  if (!Number.isFinite(simNow)) return previous;
  const changedSource = previous.sourceKey !== input.sourceKey;
  const discontinuity = changedSource || input.discontinuity || (previous.lastSimMs !== null && simNow < previous.lastSimMs);
  const state = discontinuity ? createAntennaSimulation() : { ...previous };
  state.sourceKey = input.sourceKey;
  const dt = !discontinuity && state.lastSimMs !== null && input.isPlaying
    ? Math.max(0, (simNow - state.lastSimMs) / 1000) : 0;
  state.lastSimMs = simNow;
  const valid = Number.isFinite(input.az) && Number.isFinite(input.el);
  const linked = Boolean(input.linkActive && valid);
  const wrappedAz = valid ? ((input.az % 360) + 360) % 360 : 0;
  const mask = Number.isFinite(input.stationMask) ? Math.max(0, input.stationMask) : 0;

  if (linked && !state.lastLinkActive) {
    state.signalReadyAt = simNow + 3000;
    state.losAt = null;
    state.acquired = false;
  } else if (!linked && state.lastLinkActive) {
    state.losAt = simNow;
    state.signalReadyAt = null;
    state.acquired = false;
  }
  state.lastLinkActive = linked;
  const timeToAos = Number.isFinite(input.nextPassTimeMs) ? input.nextPassTimeMs - simNow : Infinity;
  const preSlew = !linked && valid && timeToAos > 0 && timeToAos <= 9000;
  const holding = !linked && state.losAt !== null && simNow - state.losAt < 1200;
  const targetAz = linked || preSlew ? wrappedAz : holding ? state.az : ANTENNA_STOW.az;
  const targetEl = linked ? antennaClamp(input.el, 0, 90) : preSlew ? antennaClamp(mask, 0, 90) : holding ? state.el : ANTENNA_STOW.el;

  if (dt > 0 && !holding) {
    // Integrate in small simulation-time steps, keeping smoothing identical at 1X/60X.
    // At extreme rates the last 30 s are sufficient to settle this visual servo.
    const span = Math.min(dt, 30);
    const steps = Math.max(1, Math.ceil(span / 0.025));
    const stepDt = span / steps;
    for (let i = 0; i < steps; i += 1) {
      const azStep = stepAntennaAxis(state.az, state.azVel, targetAz, linked || preSlew ? 15 : 12, linked || preSlew ? 30 : 20, stepDt, true);
      const elStep = stepAntennaAxis(state.el, state.elVel, targetEl, linked || preSlew ? 12 : 9, linked || preSlew ? 24 : 18, stepDt);
      state.az = azStep.value;
      state.el = antennaClamp(elStep.value, 0, 90);
      state.azVel = azStep.velocity;
      state.elVel = elStep.velocity;
    }
  }
  const pointingError = linked ? Math.max(Math.abs(antennaAzError(wrappedAz, state.az)), Math.abs(antennaClamp(input.el, 0, 90) - state.el)) : Infinity;
  if (linked && state.signalReadyAt !== null && simNow >= state.signalReadyAt && pointingError <= 2.5) state.acquired = true;
  // Mechanical acquisition may remain latched through a zenith crossing, but it
  // never survives a source change, clock seek or LOS. RF visual obeys the SIM mask.
  state.signalVisible = linked && state.acquired && input.el >= Math.max(3, mask);
  const parked = Math.abs(antennaAzError(0, state.az)) < 0.1 && Math.abs(state.el - 90) < 0.1;
  state.mode = linked ? (state.acquired ? 'TRACKING' : 'ACQUIRING') : preSlew ? 'PRE-SLEW' : holding ? 'LOS HOLD' : parked ? 'STOW' : 'STOWING';
  return state;
}

function useAntennaSimulation(input) {
  const stateRef = useRef(createAntennaSimulation());
  const previousWallRef = useRef(null);
  const [display, setDisplay] = useState(stateRef.current);
  useEffect(() => {
    const wallNow = Date.now();
    const wallElapsed = previousWallRef.current === null ? 0 : Math.max(0, wallNow - previousWallRef.current);
    previousWallRef.current = wallNow;
    const oldTime = stateRef.current.lastSimMs;
    const jump = oldTime === null ? 0 : input.simulatedTimeMs - oldTime;
    const expected = wallElapsed * Math.max(1, Number(input.speedMult) || 1);
    const discontinuity = oldTime !== null && (jump < 0 || jump > Math.max(1500, expected * 4 + 500) || (!input.isPlaying && jump !== 0));
    stateRef.current = advanceAntennaSimulation(stateRef.current, { ...input, discontinuity });
    setDisplay(stateRef.current);
  }, [input.simulatedTimeMs, input.sourceKey, input.az, input.el, input.linkActive, input.isPlaying, input.speedMult, input.stationMask, input.nextPassTimeMs]);
  return display;
}


// Measure the actual presentation host, including after a portal changes document.
// This observes display size only; no simulation or network work is started here.
function useSatOwnedPanelSize(ref, open, hostWindow, hostRevision) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const owner = hostWindow || element.ownerDocument?.defaultView || window;
    let active = true;
    let frame = 0;
    const measure = () => {
      if (!active) return;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const schedule = () => {
      if (frame) owner.cancelAnimationFrame(frame);
      frame = owner.requestAnimationFrame(measure);
    };
    measure();
    const Observer = owner.ResizeObserver || window.ResizeObserver;
    const observer = Observer ? new Observer(schedule) : null;
    observer?.observe(element);
    owner.addEventListener('resize', schedule);
    owner.visualViewport?.addEventListener('resize', schedule);
    element.ownerDocument.fonts?.ready?.then(() => { if (active) schedule(); });
    return () => {
      active = false;
      if (frame) owner.cancelAnimationFrame(frame);
      observer?.disconnect();
      owner.removeEventListener('resize', schedule);
      owner.visualViewport?.removeEventListener('resize', schedule);
    };
  }, [open, hostWindow, hostRevision]);
  return size;
}

function toggleSatOwnedFullscreen(owner) {
  const doc = owner?.document;
  if (!doc) return;
  const action = doc.fullscreenElement ? doc.exitFullscreen?.bind(doc) : doc.documentElement.requestFullscreen?.bind(doc.documentElement);
  if (action) Promise.resolve(action()).catch(() => { owner.focus?.(); });
  else owner.focus?.();
}

function Antenna3DSimulatorModal({
  open,
  onClose,
  targetData,
  targetConfig,
  linkActive,
  speedMult,
  isPlaying,
  stationMask,
  stationId,
  satelliteTextureUrl,
  windowZIndex,
  onFocus,
  simulatedTimeMs,
  nextPassTimeMs,
  antennaState,
  hostWindow = window,
  hosted = false,
  hostRevision = 0,
  windowControl = null,
  presentationScale = 1
}) {
  // STOW/PARK visual position: reflector-up, AZ 0 deg / EL 90 deg.
  // Keep the vector geometry and all tracking/orbit logic unchanged.
  const STOW_PARK_AZ_DEG = 0;
  const STOW_PARK_EL_DEG = 90;

  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [windowRect, setWindowRect] = useState({ x: 90, y: 72, width: 1180, height: 720 });
  const visualSignalVisible = Boolean(antennaState?.signalVisible);
  const frameRef = useRef(null);
  const dragRef = useRef({ offsetX: 0, offsetY: 0 });
  const initializedWindowRef = useRef(false);


  useEffect(() => {
    if (!open) {
      setIsMaximized(false);
      setIsMinimized(false);
      setIsDragging(false);
      return;
    }

    const fitRectToViewport = (rect) => {
      const vw = Math.max(320, hostWindow.innerWidth);
      const vh = Math.max(240, hostWindow.innerHeight);
      const maxW = Math.max(1, vw - 16);
      const maxH = Math.max(1, vh - 16);
      const width = Math.min(Math.max(320, rect.width), maxW);
      const height = Math.min(Math.max(300, rect.height), maxH);
      const x = Math.min(Math.max(8, rect.x), Math.max(8, vw - width - 8));
      const y = Math.min(Math.max(8, rect.y), Math.max(8, vh - height - 8));
      return x === rect.x && y === rect.y && width === rect.width && height === rect.height ? rect : { x, y, width, height };
    };

    if (!hosted && !initializedWindowRef.current) {
      const vw = Math.max(320, hostWindow.innerWidth);
      const vh = Math.max(240, hostWindow.innerHeight);
      const width = Math.min(1360, Math.max(760, vw * 0.74), vw - 24);
      const height = Math.min(840, Math.max(540, vh * 0.78), vh - 24);
      setWindowRect({
        x: Math.max(12, (vw - width) / 2),
        y: Math.max(12, (vh - height) / 2),
        width,
        height
      });
      initializedWindowRef.current = true;
    } else if (!hosted) {
      setWindowRect((rect) => fitRectToViewport(rect));
    }

    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || hostWindow.document.fullscreenElement) return;
      if (hosted) { onClose(); return; }
      if (isMaximized) setIsMaximized(false);
      else if (isMinimized) setIsMinimized(false);
      else onClose();
    };
    const onResize = () => {
      if (isMaximized || hosted) return;
      setWindowRect((rect) => fitRectToViewport(rect));
    };

    hostWindow.addEventListener('keydown', onKeyDown);
    hostWindow.addEventListener('resize', onResize);
    return () => {
      hostWindow.removeEventListener('keydown', onKeyDown);
      hostWindow.removeEventListener('resize', onResize);
    };
  }, [open, isMaximized, isMinimized, onClose, hostWindow, hosted, hostRevision]);

  useEffect(() => {
    if (!open || !isDragging || hosted) return;

    const onPointerMove = (event) => {
      const vw = Math.max(320, hostWindow.innerWidth);
      const vh = Math.max(240, hostWindow.innerHeight);
      setWindowRect((rect) => {
        const x = Math.min(Math.max(0, event.clientX - dragRef.current.offsetX), Math.max(0, vw - rect.width));
        const effectiveHeight = isMinimized ? 58 : rect.height;
        const y = Math.min(Math.max(0, event.clientY - dragRef.current.offsetY), Math.max(0, vh - effectiveHeight));
        return { ...rect, x, y };
      });
    };
    const onPointerUp = () => setIsDragging(false);

    hostWindow.addEventListener('pointermove', onPointerMove);
    hostWindow.addEventListener('pointerup', onPointerUp, { once: true });
    hostWindow.addEventListener('pointercancel', onPointerUp, { once: true });
    return () => {
      hostWindow.removeEventListener('pointermove', onPointerMove);
      hostWindow.removeEventListener('pointerup', onPointerUp);
      hostWindow.removeEventListener('pointercancel', onPointerUp);
    };
  }, [open, isDragging, isMinimized, hostWindow, hosted]);

  useEffect(() => {
    if (!open || hosted || isMaximized || isMinimized || !frameRef.current || !hostWindow.ResizeObserver) return;
    const observer = new hostWindow.ResizeObserver((entries) => {
      const rect = entries[0]?.target?.getBoundingClientRect?.();
      if (!rect) return;
      setWindowRect((current) => {
        if (Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1) return current;
        return { ...current, width: rect.width, height: rect.height };
      });
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, isMaximized, isMinimized, hosted, hostWindow, hostRevision]);

  const startWindowDrag = (event) => {
    if (hosted || isMaximized || event.button !== 0) return;
    if (event.target?.closest?.('button, input, label')) return;
    const rect = frameRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setIsDragging(true);
    event.preventDefault();
  };

  // This view only renders the controller-owned mechanical state.
  const displayAz = antennaState?.az ?? STOW_PARK_AZ_DEG;
  const displayEl = antennaState?.el ?? STOW_PARK_EL_DEG;

  // The antenna below is the same Classic Vector geometry/projection model used
  // by GISTDA Mission Simulator v2.4.14.  SAT-ORBIT remains the master clock;
  // only the visual renderer is reused here.  No extra TLE/orbit engine is added.
  const classicVector = useMemo(() => {
    const TAU = Math.PI * 2;
    const ANT = {
      R: 507,
      vertexX: 55,
      focusX: 458,
      rimDepth: 160,
      hubX: -86,
      hubR: 70,
      subX: 455,
      subR: 58,
      supportR: 27,
      panelCount: 24,
      feedTipX: 500
    };

    const styleDefs = {
      surface: { stroke: '#2c5f78', width: 1.00, opacity: 0.58 },
      truss: { stroke: '#204e67', width: 1.20, opacity: 0.82 },
      major: { stroke: '#103c55', width: 1.78, opacity: 1.00 },
      feed: { stroke: '#075a75', width: 1.60, opacity: 0.98 },
      balance: { stroke: '#17465f', width: 1.52, opacity: 0.92, bands: { back: 0.18, mid: 0.62, front: 1.00 } },
      xfeed: { stroke: '#0d667d', width: 1.40, opacity: 0.92, bands: { back: 0.24, mid: 0.70, front: 1.00 } },
      depth: { stroke: '#426f82', width: 0.88, opacity: 0.42 }
    };

    const v3 = (x, y, z) => ({ x, y, z });
    const dishPoint = (r, t) => {
      const q = r / ANT.R;
      return v3(ANT.vertexX + ANT.rimDepth * q * q, r * Math.cos(t), r * Math.sin(t));
    };
    const rearPoint = (r, t) => {
      const q = r / ANT.R;
      const front = dishPoint(r, t);
      const back = 54 + 62 * (1 - q);
      return v3(front.x - back, front.y, front.z);
    };
    const ring3 = (radius, xFn, n = ANT.panelCount, phase = 0) => {
      const points = [];
      for (let i = 0; i < n; i++) {
        const t = phase + TAU * i / n;
        points.push(typeof xFn === 'function'
          ? v3(xFn(radius, t), radius * Math.cos(t), radius * Math.sin(t))
          : v3(xFn, radius * Math.cos(t), radius * Math.sin(t)));
      }
      points.push(points[0]);
      return points;
    };
    const circleAxisX = (x, r, n = 24, phase = 0) => ring3(r, x, n, phase);
    const geometry = { surface: [], truss: [], major: [], feed: [], balance: [], xfeed: [], depth: [] };
    const seg = (layer, a, b) => geometry[layer].push([a, b]);
    const poly = (layer, points) => {
      for (let i = 1; i < points.length; i++) seg(layer, points[i - 1], points[i]);
    };
    const PH = Math.PI / 24;

    // Main reflector: 24-panel faceted rim and restrained contour lines.
    const frontRim = ring3(ANT.R, (r, t) => dishPoint(r, t).x, ANT.panelCount, PH);
    poly('major', frontRim);
    [0.30, 0.52, 0.73, 0.88].forEach((frac) => {
      poly('surface', ring3(ANT.R * frac, (r, t) => dishPoint(r, t).x, ANT.panelCount, PH));
    });
    const surfaceRib = (t, steps = 10) => {
      const points = [];
      for (let j = 0; j <= steps; j++) points.push(dishPoint(ANT.R * j / steps, t));
      return points;
    };
    for (let i = 0; i < ANT.panelCount; i++) {
      const t = PH + TAU * i / ANT.panelCount;
      poly(i % 6 === 0 ? 'truss' : 'surface', surfaceRib(t, 10));
    }
    poly('major', surfaceRib(0, 12));
    poly('major', surfaceRib(Math.PI, 12));

    // Rear reflector space frame.
    const rearOuter = ring3(ANT.R, (r, t) => rearPoint(r, t).x, ANT.panelCount, PH);
    const r82 = ANT.R * 0.82;
    const r60 = ANT.R * 0.60;
    const r36 = ANT.R * 0.36;
    const rear82 = ring3(r82, (r, t) => rearPoint(r, t).x, ANT.panelCount, PH);
    const rear60 = ring3(r60, (r, t) => rearPoint(r, t).x, ANT.panelCount, PH);
    const rear36 = ring3(r36, (r, t) => rearPoint(r, t).x, ANT.panelCount, PH);
    const hubRing = circleAxisX(ANT.hubX, ANT.hubR, 12, Math.PI / 12);
    poly('major', rearOuter);
    poly('truss', rear82);
    poly('truss', rear60);
    poly('truss', rear36);
    poly('major', hubRing);

    for (let i = 0; i < ANT.panelCount; i++) {
      const next = (i + 1) % ANT.panelCount;
      seg('truss', frontRim[i], rearOuter[i]);
      seg(i % 2 === 0 ? 'truss' : 'depth', frontRim[i], rearOuter[next]);
      seg('truss', rearOuter[i], rear82[i]);
      seg('truss', rear82[i], rear60[i]);
      seg('truss', rear60[i], rear36[i]);
      const h = Math.floor(i / 2) % 12;
      seg(i % 2 === 0 ? 'major' : 'truss', rear36[i], hubRing[h]);
      seg(i % 2 === 0 ? 'truss' : 'depth', rearOuter[i], rear82[next]);
      seg(i % 2 === 0 ? 'truss' : 'depth', rear82[i], rear60[next]);
      seg(i % 2 === 0 ? 'truss' : 'depth', rear60[i], rear36[next]);
    }

    // Central hub / elevation interface.
    poly('major', circleAxisX(ANT.vertexX - 18, 86, 20, Math.PI / 20));
    poly('major', circleAxisX(ANT.hubX, 48, 18, 0));
    for (let i = 0; i < 12; i++) {
      const t = TAU * i / 12;
      seg('truss', hubRing[i], v3(ANT.vertexX - 18, 86 * Math.cos(t), 86 * Math.sin(t)));
    }

    const boxWire = (layer, x0, x1, hy, hz) => {
      const a = [v3(x0, -hy, -hz), v3(x0, hy, -hz), v3(x0, hy, hz), v3(x0, -hy, hz)];
      const b = [v3(x1, -hy, -hz), v3(x1, hy, -hz), v3(x1, hy, hz), v3(x1, -hy, hz)];
      poly(layer, [...a, a[0]]);
      poly(layer, [...b, b[0]]);
      for (let i = 0; i < 4; i++) seg(layer, a[i], b[i]);
    };

    // Elevation yoke.
    [-58, 58].forEach((z) => {
      seg('major', v3(-128, -40, z), v3(-18, -40, z));
      seg('major', v3(-128, 40, z), v3(-18, 40, z));
      seg('truss', v3(-128, -40, z), v3(-128, 40, z));
      seg('truss', v3(-18, -40, z), v3(-18, 40, z));
    });

    // Counterweight / balance assembly.
    boxWire('balance', -255, -112, 28, 22);
    seg('balance', v3(-112, -28, -22), v3(-255, 28, 22));
    seg('balance', v3(-112, 28, 22), v3(-255, -28, -22));
    seg('balance', v3(-112, -28, 22), v3(-255, 28, -22));
    seg('balance', v3(-112, 28, -22), v3(-255, -28, 22));
    boxWire('balance', -300, -255, 38, 34);
    seg('balance', v3(-255, -28, -22), v3(-300, -38, -34));
    seg('balance', v3(-255, 28, 22), v3(-300, 38, 34));
    seg('balance', v3(-255, -28, 22), v3(-300, -38, 34));
    seg('balance', v3(-255, 28, -22), v3(-300, 38, -34));
    boxWire('major', -392, -300, 54, 74);
    for (let x = -384; x <= -308; x += 8) {
      poly('balance', [v3(x, -58, -78), v3(x, 58, -78), v3(x, 58, 78), v3(x, -58, 78), v3(x, -58, -78)]);
    }
    boxWire('balance', -408, -392, 56, 76);
    [-54, 54].forEach((y) => [-74, 74].forEach((z) => seg('balance', v3(-300, y, z), v3(-408, y, z))));
    seg('balance', v3(-300, -38, -34), v3(-392, -54, -74));
    seg('balance', v3(-300, 38, 34), v3(-392, 54, 74));
    seg('balance', v3(-300, -38, 34), v3(-392, -54, 74));
    seg('balance', v3(-300, 38, -34), v3(-392, 54, -74));

    // Central X-band feed.
    const xFeedStations = [
      { x: ANT.vertexX + 8, r: 16.5 },
      { x: 98, r: 16.5 },
      { x: 129, r: 15.0 },
      { x: 160, r: 13.5 },
      { x: 190, r: 12.2 },
      { x: 218, r: 10.2 },
      { x: 240, r: 8.5 }
    ];
    for (let i = 1; i < xFeedStations.length; i++) {
      const a = xFeedStations[i - 1];
      const b = xFeedStations[i];
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((t) => {
        seg('xfeed', v3(a.x, a.r * Math.cos(t), a.r * Math.sin(t)), v3(b.x, b.r * Math.cos(t), b.r * Math.sin(t)));
      });
      poly('xfeed', circleAxisX(b.x, b.r, 16));
    }
    [{ x: 96, r: 21 }, { x: 156, r: 18.5 }, { x: 216, r: 15.5 }].forEach((c) => {
      poly('xfeed', circleAxisX(c.x, c.r, 16));
      poly('depth', circleAxisX(c.x + 7, c.r, 16));
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((t) => {
        seg('xfeed', v3(c.x, c.r * Math.cos(t), c.r * Math.sin(t)), v3(c.x + 7, c.r * Math.cos(t), c.r * Math.sin(t)));
      });
    });
    poly('xfeed', circleAxisX(244, 7.0, 16));
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((t) => {
      seg('xfeed', v3(240, 8.5 * Math.cos(t), 8.5 * Math.sin(t)), v3(244, 7.0 * Math.cos(t), 7.0 * Math.sin(t)));
    });

    // Four-point feed / subreflector support.
    const feedSupportPoints = [
      { rim: 3 * Math.PI / 4, hub: v3(ANT.subX - 16, -14, 18) },
      { rim: Math.PI / 4, hub: v3(ANT.subX - 16, 14, 18) },
      { rim: 5 * Math.PI / 4, hub: v3(ANT.subX - 16, -14, -18) },
      { rim: 7 * Math.PI / 4, hub: v3(ANT.subX - 16, 14, -18) }
    ];
    feedSupportPoints.forEach((support) => {
      const a = dishPoint(ANT.R * 0.965, support.rim);
      const b = support.hub;
      seg('major', a, b);
      const dt = 0.012;
      seg('depth', dishPoint(ANT.R * 0.965, support.rim + dt), v3(b.x, b.y * 1.02, b.z * 1.02));
    });

    // Dichroic subreflector / S-band feed region.
    poly('major', circleAxisX(ANT.subX, ANT.subR, 28, Math.PI / 28));
    poly('surface', circleAxisX(ANT.subX + 12, ANT.subR * 0.72, 24, 0));
    for (let i = 0; i < 12; i++) {
      const t = TAU * i / 12;
      seg('surface',
        v3(ANT.subX, ANT.subR * Math.cos(t), ANT.subR * Math.sin(t)),
        v3(ANT.subX + 12, ANT.subR * 0.72 * Math.cos(t), ANT.subR * 0.72 * Math.sin(t))
      );
    }
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((t) => {
      seg('feed',
        v3(ANT.subX + 18, 17 * Math.cos(t), 17 * Math.sin(t)),
        v3(ANT.feedTipX - 15, 17 * Math.cos(t), 17 * Math.sin(t))
      );
      seg('feed',
        v3(ANT.feedTipX - 15, 17 * Math.cos(t), 17 * Math.sin(t)),
        v3(ANT.feedTipX, 23 * Math.cos(t), 23 * Math.sin(t))
      );
    });
    poly('feed', circleAxisX(ANT.subX + 18, 17, 16));
    poly('feed', circleAxisX(ANT.feedTipX, 23, 18));

    return { ANT, geometry, styleDefs };
  }, []);

  const vectorScene = useMemo(() => {
    // Presentation-only overhead spacing. At EL <= 45 deg the MASTER composition is unchanged;
    // from 45-70 deg the dish lowers and the satellite gains headroom smoothly.
    const overheadVisualT = Math.max(0, Math.min(1, (displayEl - 45) / 25));
    const P = { x: 800, y: 438 + 28 * overheadVisualT };
    const S = 0.515;
    const CAMERA = 180;
    const D = Math.PI / 180;
    const { ANT, geometry, styleDefs } = classicVector;

    const alpha = Math.cos((displayAz - CAMERA) * D);
    const beta = Math.sin((CAMERA - displayAz) * D);
    const el = displayEl * D;
    const q = {
      a: alpha * Math.cos(el),
      b: -Math.sin(el),
      c: alpha * Math.sin(el),
      d: Math.cos(el),
      alpha,
      beta
    };

    const proj3 = (p) => ({
      x: P.x + S * (q.a * p.x + q.c * p.y + q.beta * p.z),
      y: P.y + S * (q.b * p.x + q.d * p.y)
    });
    const viewDepth = (p) => (-q.beta * q.d) * p.x + (q.beta * q.b) * p.y + (q.a * q.d - q.c * q.b) * p.z;

    const allDepths = [];
    Object.values(geometry).forEach((segments) => segments.forEach(([a, b]) => {
      allDepths.push((viewDepth(a) + viewDepth(b)) / 2);
    }));
    let minDepth = Math.min(...allDepths);
    let maxDepth = Math.max(...allDepths);
    if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth) || maxDepth - minDepth < 1e-6) {
      minDepth = -1;
      maxDepth = 1;
    }
    const t1 = minDepth + (maxDepth - minDepth) * 0.38;
    const t2 = minDepth + (maxDepth - minDepth) * 0.67;
    const paths = {};
    Object.keys(styleDefs).forEach((kind) => { paths[kind] = { back: '', mid: '', front: '' }; });

    Object.entries(geometry).forEach(([kind, segments]) => {
      segments.forEach(([a, b]) => {
        const A = proj3(a);
        const B = proj3(b);
        const z = (viewDepth(a) + viewDepth(b)) / 2;
        const band = z < t1 ? 'back' : (z < t2 ? 'mid' : 'front');
        paths[kind][band] += `M${A.x.toFixed(2)} ${A.y.toFixed(2)}L${B.x.toFixed(2)} ${B.y.toFixed(2)}`;
      });
    });

    const feed = proj3({ x: ANT.feedTipX, y: 0, z: 0 });
    const len = Math.hypot(q.a, q.b);
    const nx = len < 1e-7 ? 0 : q.a / len;
    const ny = len < 1e-7 ? -1 : q.b / len;
    // Visual satellite placement only: keep the true AZ/EL ray, but place the
    // satellite farther away from the dish while keeping its centre inside a
    // safe screen envelope. This changes no orbit/pointing calculation.
    const visualRx = 760;
    const visualRy = 400 + 70 * overheadVisualT; // presentation-only: a little more vertical separation near overhead
    const desiredRadius = 1 / Math.hypot(nx / visualRx, ny / visualRy);
    const safeLeft = 150;
    const safeRight = 1450;
    const safeTop = 145 - 93 * overheadVisualT; // 145px normally -> 52px near overhead; true pointing ray preserved
    const safeBottom = 755;
    const safeCandidates = [];
    if (nx > 1e-7) safeCandidates.push((safeRight - P.x) / nx);
    else if (nx < -1e-7) safeCandidates.push((safeLeft - P.x) / nx);
    if (ny > 1e-7) safeCandidates.push((safeBottom - P.y) / ny);
    else if (ny < -1e-7) safeCandidates.push((safeTop - P.y) / ny);
    const safeRadius = Math.min(...safeCandidates.filter((value) => Number.isFinite(value) && value > 0));
    const radius = Number.isFinite(safeRadius) ? Math.min(desiredRadius, safeRadius) : desiredRadius;
    const target = { x: P.x + nx * radius, y: P.y + ny * radius };

    const vx = feed.x - target.x;
    const vy = feed.y - target.y;
    const vl = Math.hypot(vx, vy) || 1;
    const ux = vx / vl;
    const uy = vy / vl;
    const px = -uy;
    const py = ux;
    const chevrons = [0.22, 0.40, 0.58, 0.76].map((t) => {
      const x = target.x + vx * t;
      const y = target.y + vy * t;
      const backX = x - ux * 14;
      const backY = y - uy * 14;
      return `M${(backX + px * 7).toFixed(2)} ${(backY + py * 7).toFixed(2)}L${x.toFixed(2)} ${y.toFixed(2)}L${(backX - px * 7).toFixed(2)} ${(backY - py * 7).toFixed(2)}`;
    });

    const satAngle = Math.atan2(vy, vx) / D + 90;
    const baseTransform = `matrix(${S} 0 0 ${S} ${P.x - S * 242} ${P.y - S * 600})`;
    const bridgePath = `M${P.x - 18} ${P.y + 34}L${P.x - 9} ${P.y + 7}M${P.x + 5} ${P.y + 30}L${P.x + 10} ${P.y + 7}`;

    return { P, S, paths, styleDefs, feed, target, chevrons, satAngle, baseTransform, bridgePath };
  }, [classicVector, displayAz, displayEl]);

  if (!open) return null;

  const effectiveWidth = isMinimized ? Math.min(windowRect.width, 720, hostWindow.innerWidth - 16) : windowRect.width;
  const frameStyle = hosted
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 0, borderWidth: 0, resize: 'none', pointerEvents: 'auto' }
    : isMaximized
    ? {
        position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
        borderRadius: 0, borderWidth: 0, resize: 'none', pointerEvents: 'auto'
      }
    : {
        position: 'fixed', left: `${windowRect.x}px`, top: `${windowRect.y}px`,
        width: `${effectiveWidth}px`, height: isMinimized ? 'auto' : `${windowRect.height}px`,
        borderRadius: '12px', borderWidth: '2px', resize: isMinimized ? 'none' : 'both',
        minWidth: 'min(320px, calc(100vw - 16px))',
        minHeight: isMinimized ? '0px' : 'min(300px, calc(100dvh - 16px))',
        maxWidth: 'calc(100vw - 8px)', maxHeight: 'calc(100dvh - 8px)',
        pointerEvents: 'auto'
      };

  const beamDuration = Math.max(0.28, 1.15 / (1 + Math.log10(Math.max(1, Number(speedMult) || 1)) * 0.55));
  const satW = 230;
  const satH = 156;
  return (
    <div
      className="sat-antenna3d-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: Number(windowZIndex) || 10004, pointerEvents: 'none' }}
    >
      <style>{`
        .sat-antenna3d-frame {
          overflow: hidden;
          box-sizing: border-box;
          border-style: solid;
          border-color: var(--green);
          box-shadow: 0 0 36px rgba(0,255,102,0.28), 0 18px 60px rgba(0,0,0,0.35), inset 0 0 26px rgba(0,234,255,0.07);
          background: #a8d8eb;
          isolation: isolate;
          container-type: inline-size;
          container-name: antenna3d;
        }
        .sat-antenna3d-header {
          position: absolute;
          inset: 0 0 auto 0;
          height: 58px;
          z-index: 12;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: clamp(8px, 1.1cqw, 16px);
          padding: clamp(10px, 1.1cqw, 14px) clamp(10px, 1.35cqw, 20px) 0;
          background: transparent;
          border-bottom: 0;
          box-shadow: none;
          user-select: none;
          box-sizing: border-box;
        }
        .sat-antenna3d-title-wrap {
          min-width: 0;
          flex: 1 1 auto;
          pointer-events: none;
        }
        .sat-antenna3d-title {
          font-family: Orbitron, sans-serif;
          font-weight: 900;
          letter-spacing: clamp(0.5px, 0.10cqw, 1.2px);
          color: var(--green);
          font-size: clamp(13px, 1.55cqw, 19px);
          line-height: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-shadow: 0 2px 4px rgba(3,24,35,0.96), 0 0 10px rgba(0,255,102,0.22);
        }
        .sat-antenna3d-header-right {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: clamp(8px, 1.2cqw, 16px);
          flex: 0 0 auto;
          min-width: 0;
        }
        .sat-antenna3d-target {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: clamp(6px, 0.75cqw, 10px);
          min-width: 0;
          pointer-events: none;
          color: #fff;
          font: 900 clamp(11px, 1.35cqw, 16px)/1 Orbitron, sans-serif;
          letter-spacing: clamp(0.4px, 0.08cqw, 1px);
          white-space: nowrap;
          text-shadow: 0 2px 4px rgba(3,24,35,0.96), 0 0 10px rgba(0,0,0,0.45);
        }
        .sat-antenna3d-target img {
          width: clamp(24px, 2.8cqw, 34px);
          height: auto;
          border-radius: 3px;
          box-shadow: 0 0 8px rgba(255,255,255,0.28);
          flex: 0 0 auto;
        }
        .sat-antenna3d-target-name {
          max-width: clamp(92px, 15cqw, 190px);
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sat-antenna3d-window-controls {
          display: flex;
          align-items: center;
          gap: clamp(5px, 0.65cqw, 8px);
          flex: 0 0 auto;
        }
        .sat-antenna3d-stage {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background: #bfe3ec;
        }
        .sat-antenna3d-landscape,
        .sat-antenna3d-vector {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
        .sat-antenna3d-landscape { z-index: 1; }
        .sat-antenna3d-vector { z-index: 2; pointer-events: none; }

        /* Antenna 3D final pointing readout: clean floating AZ/EL at opposite screen edges. */
        .sat-antenna3d-pointing-inline {
          width: 100%;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: clamp(18px, 3cqw, 42px);
          font-family: Rajdhani, Arial, sans-serif;
          white-space: nowrap;
          min-width: 0;
          pointer-events: none;
        }
        .sat-antenna3d-pointing-inline span {
          display: inline-flex;
          align-items: baseline;
          gap: clamp(7px, .75cqw, 11px);
          padding: clamp(5px, .55cqw, 8px) clamp(9px, 1cqw, 14px);
          border-radius: 8px;
          background: rgba(3, 24, 35, 0.62);
          border: 1px solid rgba(224, 248, 255, 0.24);
          box-shadow: 0 2px 10px rgba(0,0,0,.18), inset 0 0 14px rgba(255,255,255,.035);
          font-weight: 900;
          letter-spacing: .9px;
          backdrop-filter: blur(2px);
        }
        .sat-antenna3d-pointing-inline span:first-child { border-color: rgba(0,234,255,.48); }
        .sat-antenna3d-pointing-inline span:last-child { border-color: rgba(0,255,102,.48); }
        .sat-antenna3d-pointing-inline b {
          color: #f4fbff;
          font: 900 calc(clamp(11px, 1cqw, 14px) * var(--sat-text-scale,1))/1 Orbitron, sans-serif;
          text-shadow: 0 1px 3px rgba(0,0,0,.95);
        }
        .sat-antenna3d-pointing-inline strong {
          display: inline-block;
          min-width: 7.1ch;
          text-align: right;
          font: 900 calc(clamp(20px, 1.8cqw, 28px) * var(--sat-text-scale,1))/1 Orbitron, sans-serif;
          font-variant-numeric: tabular-nums lining-nums;
          font-feature-settings: 'tnum' 1, 'lnum' 1;
          letter-spacing: 0;
          -webkit-text-stroke: .25px rgba(3,24,35,.72);
        }
        .sat-antenna3d-pointing-inline span:first-child strong {
          color: #00eaff !important;
          text-shadow: 0 1px 3px rgba(0,0,0,.96), 0 0 10px rgba(0,234,255,.44);
        }
        .sat-antenna3d-pointing-inline span:last-child strong {
          color: #00ff66 !important;
          text-shadow: 0 1px 3px rgba(0,0,0,.96), 0 0 10px rgba(0,255,102,.44);
        }
        @container antenna3d (max-width: 740px) {
          .sat-antenna3d-pointing-inline strong { font-size: calc(18px * var(--sat-text-scale,1)); min-width: 6.8ch; }
          .sat-antenna3d-pointing-inline span { padding: 5px 8px; }
        }
        @container antenna3d (max-width: 520px) {
          .sat-antenna3d-pointing-inline b { font-size: calc(9px * var(--sat-text-scale,1)); }
          .sat-antenna3d-pointing-inline strong { font-size: calc(15px * var(--sat-text-scale,1)); }
        }
        .sat-antenna3d-toolbar {
          position: absolute;
          z-index: 11;
          left: clamp(10px, 1.25cqw, 18px);
          right: clamp(10px, 1.25cqw, 18px);
          bottom: clamp(9px, 1.05cqw, 14px);
          width: auto;
          height: auto;
          display: flex;
          align-items: flex-end;
          justify-content: stretch;
          padding: 0;
          background: transparent;
          border-top: 0;
          box-shadow: none;
          box-sizing: border-box;
          pointer-events: none;
        }
        .sat-antenna3d-control-btn {
          width: clamp(32px, 3.35cqw, 40px);
          height: clamp(30px, 3.0cqw, 36px);
          border-radius: 6px;
          font: 900 clamp(14px, 1.45cqw, 18px) Orbitron, sans-serif;
          cursor: pointer;
          flex: 0 0 auto;
          padding: 0;
        }
        .sat-antenna3d-rf {
          animation: satAntennaRfFlow var(--ant-beam-dur, 0.8s) linear infinite;
        }
        .sat-antenna3d-resize-grip {
          position: absolute;
          right: 3px;
          bottom: 3px;
          z-index: 20;
          color: rgba(0,255,102,0.55);
          font: 900 14px/1 monospace;
          pointer-events: none;
        }
        @keyframes satAntennaRfFlow {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: -48; }
        }
        @container antenna3d (max-width: 900px) {
          .sat-antenna3d-header { gap: 10px; padding-inline: 10px; }
          .sat-antenna3d-title { font-size: clamp(13px, 1.9cqw, 16px); }
          .sat-antenna3d-target { font-size: clamp(10px, 1.55cqw, 13px); }
          .sat-antenna3d-target-name { max-width: 130px; }
          .sat-antenna3d-window-controls { gap: 5px; }
          .sat-antenna3d-toolbar-left { gap: 10px; }
        }
        @container antenna3d (max-width: 740px) {
          .sat-antenna3d-header { padding-inline: 8px; }
          .sat-antenna3d-title { font-size: 12px; letter-spacing: 0.4px; }
          .sat-antenna3d-target { gap: 5px; font-size: 10px; }
          .sat-antenna3d-target img { width: 22px; }
          .sat-antenna3d-target-name { max-width: 100px; }
          .sat-antenna3d-control-btn { width: 30px; height: 29px; font-size: 13px; }
          .sat-antenna3d-toolbar { left: 8px; bottom: 8px; }
          .sat-antenna3d-toolbar-left { gap: 7px; }
          .sat-antenna3d-toggle { gap: 3px; font-size: 8px; letter-spacing: 0.4px; }
          .sat-antenna3d-toggle button { min-width: 42px; height: 22px; padding-inline: 5px; font-size: 8px; }
        }

        /* ANTENNA 3D PRESENTATION LOCK (Expo):
           Keep the scene full-bleed. Header and toolbar stay floating/transparent so
           the satellite can use the upper safe area and the unchanged antenna geometry
           can sit lower in the viewport. */
        .sat-antenna3d-frame { position: relative; }
        .sat-antenna3d-header { background: transparent; border-bottom: 0; box-shadow: none; }
        .sat-antenna3d-toolbar { background: transparent; border-top: 0; box-shadow: none; }
        @media (pointer: coarse) {
          .sat-antenna3d-control-btn, .sat-antenna3d-toggle button, .sat-antenna3d-window-controls button { min-height: 40px; min-width: 40px; touch-action: manipulation; }
        }
      `}</style>

      <div
        ref={frameRef}
        className="sat-antenna3d-frame"
        data-hosted={hosted}
        data-minimized={isMinimized && !hosted}
        style={{ ...frameStyle, '--sat-text-scale': presentationScale }}
        onPointerDownCapture={() => onFocus?.()}
      >
        <div
          className="sat-antenna3d-header"
          onPointerDown={startWindowDrag}
          style={{ touchAction: 'none', cursor: hosted || isMaximized ? 'default' : (isDragging ? 'grabbing' : 'grab') }}
        >
          <div className="sat-antenna3d-title-wrap">
            <div className="sat-antenna3d-title">ANTENNA 3D TRACKING SIMULATOR</div>
          </div>

          <div className="sat-antenna3d-header-right">
            <div className="sat-antenna3d-target" title={targetConfig?.displayName || 'THEOS-2'}>
              {targetConfig?.flag ? (
                <img src={`https://flagcdn.com/w40/${targetConfig.flag.toLowerCase()}.png`} alt="flag" />
              ) : (
                <span aria-hidden="true">🛰️</span>
              )}
              <span className="sat-antenna3d-target-name">{targetConfig?.displayName || 'THEOS-2'}</span>
            </div>

            <div className="sat-antenna3d-window-controls">
            {windowControl}
            {!hosted && <button
              className="sat-antenna3d-control-btn"
              onClick={() => {
                if (isMaximized) setIsMaximized(false);
                setIsMinimized((value) => !value);
              }}
              title={isMinimized ? 'Restore window' : 'Minimize'}
              style={{ border: '1px solid rgba(0,234,255,0.62)', color: 'var(--cyan)', background: 'rgba(0,234,255,0.06)' }}
            >
              {isMinimized ? '\u25a1' : '\u2212'}
            </button>}
            <button
              className="sat-antenna3d-control-btn"
              onClick={() => {
                if (hosted) { toggleSatOwnedFullscreen(hostWindow); return; }
                setIsMinimized(false);
                setIsMaximized((value) => !value);
              }}
              title={hosted ? 'Fullscreen' : isMaximized ? 'Restore window' : 'Maximize'}
              style={{ border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,234,255,0.08)' }}
            >
              <SatWindowIcon kind={isMaximized ? 'restore' : 'maximize'} />
            </button>
            <button
              className="sat-antenna3d-control-btn"
              onClick={onClose}
              title="Close"
              style={{ border: '1px solid var(--red)', color: 'var(--red)', background: 'rgba(255,51,51,0.08)' }}
            >
              x
            </button>
            </div>
          </div>
        </div>

        {(!isMinimized || hosted) && (
          <>
            <div className="sat-antenna3d-stage">
              <svg className="sat-antenna3d-landscape" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="antSky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#61acd4" />
                    <stop offset="58%" stopColor="#b8dfe8" />
                    <stop offset="100%" stopColor="#e7efe8" />
                  </linearGradient>
                  <radialGradient id="antSunGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#fff7bd" stopOpacity="0.95" />
                    <stop offset="34%" stopColor="#fff2a6" stopOpacity="0.40" />
                    <stop offset="100%" stopColor="#fff2a6" stopOpacity="0" />
                  </radialGradient>
                  <filter id="antCloudBlur"><feGaussianBlur stdDeviation="2.8" /></filter>
                  <pattern id="antEngineeringGrid" width="80" height="60" patternUnits="userSpaceOnUse">
                    <path d="M80 0H0V60" fill="none" stroke="#3d7488" strokeOpacity="0.16" strokeWidth="1" />
                    <circle cx="0" cy="0" r="1.2" fill="#3d7488" opacity="0.18" />
                  </pattern>
                </defs>

                <rect width="1600" height="900" fill="url(#antSky)" />
                {showGrid && <rect width="1600" height="900" fill="url(#antEngineeringGrid)" />}
                <circle cx="1360" cy="116" r="78" fill="url(#antSunGlow)" />
                <circle cx="1360" cy="116" r="13" fill="#fff4bd" opacity="0.96" />

                <g fill="#e9f5f7" opacity="0.58" filter="url(#antCloudBlur)">
                  <path d="M70 190 C110 145 165 160 186 188 C215 152 268 163 286 206 L70 206 Z" />
                  <path d="M390 230 C423 194 466 199 488 229 C516 205 557 209 576 242 L390 242 Z" />
                  <path d="M1120 228 C1155 191 1204 198 1226 227 C1254 203 1300 210 1320 245 L1120 245 Z" />
                </g>

                <path d="M0 650 C140 595 240 612 350 653 C470 697 570 601 705 646 C835 689 945 600 1082 647 C1210 691 1328 607 1600 654 L1600 900 L0 900 Z" fill="#8fbfc0" opacity="0.28" />
                <path d="M0 704 C142 648 257 671 362 713 C475 758 591 665 719 711 C838 753 955 669 1082 716 C1216 764 1347 677 1600 720 L1600 900 L0 900 Z" fill="#7cabaa" opacity="0.24" />
                <path d="M0 770 C145 710 255 733 374 780 C495 827 603 732 726 779 C844 824 962 740 1090 783 C1226 829 1361 747 1600 790 L1600 900 L0 900 Z" fill="#719e92" opacity="0.21" />

                <g fill="#709b8e" opacity="0.21">
                  <circle cx="115" cy="813" r="18" /><circle cx="152" cy="811" r="15" />
                  <circle cx="258" cy="833" r="20" /><circle cx="302" cy="831" r="16" />
                  <circle cx="1160" cy="824" r="19" /><circle cx="1204" cy="821" r="16" />
                  <circle cx="1370" cy="842" r="22" /><circle cx="1422" cy="840" r="17" />
                </g>

                {showGuides && (
                  <g>
                    <line x1="64" y1="590" x2="1536" y2="590" stroke="#6fa1b3" strokeOpacity="0.48" strokeWidth="2" strokeDasharray="9 11" />
                    <line x1="800" y1="82" x2="800" y2="590" stroke="#7aa7b7" strokeOpacity="0.24" strokeWidth="1.5" strokeDasharray="5 10" />
                  </g>
                )}
              </svg>

              <svg className="sat-antenna3d-vector" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax meet" aria-label="Classic vector antenna tracking view">
                <defs>
                  <filter id="classicVectorGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="7" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <radialGradient id="classicSatHalo" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#e5fbff" stopOpacity="0.34" />
                    <stop offset="48%" stopColor="#c8f1ff" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#c8f1ff" stopOpacity="0" />
                  </radialGradient>
                  <linearGradient id="antConcreteTop" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d9e4e0" />
                    <stop offset="100%" stopColor="#b9ceca" />
                  </linearGradient>
                </defs>

                <g aria-label="Concrete antenna foundation" transform={`translate(0 ${(vectorScene.P.y - 438).toFixed(2)})`} vectorEffect="non-scaling-stroke">
                  <path d="M620 805 L980 805 L1018 823 L582 823 Z" fill="url(#antConcreteTop)" stroke="#315c6e" strokeWidth="2.2" />
                  <rect x="582" y="823" width="436" height="38" rx="2" fill="#b5cbc8" stroke="#315c6e" strokeWidth="2.2" />
                  <line x1="690" y1="823" x2="690" y2="861" stroke="#5d7f87" strokeWidth="1.2" opacity="0.72" />
                  <line x1="910" y1="823" x2="910" y2="861" stroke="#5d7f87" strokeWidth="1.2" opacity="0.72" />
                </g>

                <g transform={vectorScene.baseTransform} fill="rgba(19,64,82,0.035)" fillRule="evenodd" stroke="#103c55" strokeWidth="1.10" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
                  <path d={CLASSIC_VECTOR_ANTENNA_BASE_PATH} />
                </g>
                <path d={vectorScene.bridgePath} fill="none" stroke="#21495f" strokeWidth="2.0" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

                {Object.entries(vectorScene.styleDefs).flatMap(([kind, def]) => ['back', 'mid', 'front'].map((band) => {
                  const mult = def.bands?.[band] ?? (band === 'front' ? 1 : (band === 'mid' ? 0.76 : 0.40));
                  const widthMult = band === 'front' ? 1 : (band === 'mid' ? 0.94 : 0.84);
                  return (
                    <path
                      key={`${kind}-${band}`}
                      d={vectorScene.paths[kind][band]}
                      fill="none"
                      stroke={def.stroke}
                      strokeWidth={(def.width * widthMult * 1.35).toFixed(2)}
                      strokeOpacity={(def.opacity * mult).toFixed(3)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                }))}

                {visualSignalVisible && (
                  <g>
                    <circle cx={vectorScene.target.x} cy={vectorScene.target.y} r="108" fill="url(#classicSatHalo)" />
                    <line
                      className="sat-antenna3d-rf"
                      x1={vectorScene.target.x}
                      y1={vectorScene.target.y}
                      x2={vectorScene.feed.x}
                      y2={vectorScene.feed.y}
                      stroke="#5cff8a"
                      strokeWidth="3.4"
                      strokeDasharray="14 10"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ '--ant-beam-dur': `${beamDuration}s`, filter: 'drop-shadow(0 0 5px rgba(92,255,138,0.72))' }}
                    />
                    {vectorScene.chevrons.map((d, index) => (
                      <path key={index} d={d} fill="none" stroke="#eaffef" strokeWidth="3.0" strokeLinecap="round" strokeLinejoin="round" opacity={0.96 - index * 0.09} vectorEffect="non-scaling-stroke" />
                    ))}
                    <g transform={`rotate(${vectorScene.satAngle.toFixed(2)} ${vectorScene.target.x} ${vectorScene.target.y})`}>
                      <image
                        href={satelliteTextureUrl || '/textures/THEOS-2.webp'}
                        x={vectorScene.target.x - satW / 2}
                        y={vectorScene.target.y - satH / 2}
                        width={satW}
                        height={satH}
                        preserveAspectRatio="xMidYMid meet"
                        style={{ filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.38))' }}
                      />
                    </g>
                  </g>
                )}
              </svg>
            </div>

            <div className="sat-antenna3d-toolbar">
              <div className="sat-antenna3d-pointing-inline" aria-label="Simulated antenna pointing angles">
                <span><b>AZ</b><strong>{Number.isFinite(antennaState?.az) ? `${antennaState.az.toFixed(2).padStart(6,'0')}°` : 'N/A'}</strong></span>
                <span><b>EL</b><strong>{Number.isFinite(antennaState?.el) ? `${antennaState.el.toFixed(2).padStart(5,'0')}°` : 'N/A'}</strong></span>
              </div>
            </div>

            {!isMaximized && !hosted && <div className="sat-antenna3d-resize-grip">&#8991;</div>}
          </>
        )}
      </div>
    </div>
  );
}


// =========================================================================
// GISTDA ANTENNA BRIDGE v1.4
// READ-ONLY SIDECAR / NON-REGRESSION
// =========================================================================

const ANTENNA_URL =
  'https://gistda-antenna-mission-simulator.vercel.app/';

const ANTENNA_ORIGIN =
  new URL(ANTENNA_URL).origin;

const ANTENNA_BRIDGE_PROTOCOL =
  'gistda-antenna-bridge/v1';

const ANTENNA_BRIDGE_SOURCE =
  'SAT-ORBIT';

const ANTENNA_RECEIVER_SOURCE =
  'ANTENNA-SIM';

const createEmptyPassCache = () => ({
  horizonAos: null,
  horizonLos: null,
  simAos: null,
  simLos: null,
  maxEl: null,
  passId: null
});

const sendAntennaBridgeMessage = (windowRef, payload) => {
  if (!windowRef || windowRef.closed) return false;

  try {
    windowRef.postMessage(payload, ANTENNA_ORIGIN);
    return true;
  } catch (error) {
    console.warn('[AntennaBridge] postMessage failed:', error);
    return false;
  }
};

const useAntennaBridge = (bridgeData) => {

  const [bridgeStatus, setBridgeStatus] =
    useState('OFF');
  // OFF | OPENING | LINKED | LOST

  const receiverWinRef = useRef(null);
  const sessionIdRef = useRef(null);
  const sequenceRef = useRef(0);
  const lastAckAtRef = useRef(0);

  const dataRef = useRef(bridgeData);

  const passCacheRef =
    useRef(createEmptyPassCache());


  // -----------------------------------------------------------------------
  // 1. KEEP LATEST MASTER STATE
  // Read only. Never mutate SAT-ORBIT state.
  // -----------------------------------------------------------------------

  useEffect(() => {
    dataRef.current = bridgeData;
  }, [bridgeData]);


  // -----------------------------------------------------------------------
  // 2. DETERMINE CURRENT / NEXT PASS
  // -----------------------------------------------------------------------

  const currentBridgePass = useMemo(() => {

    if (
      !bridgeData.targetSatrec ||
      !Array.isArray(bridgeData.passSchedule) ||
      bridgeData.passSchedule.length === 0 ||
      !Number.isFinite(bridgeData.simTimeMs)
    ) {
      return null;
    }

    return (
      bridgeData.passSchedule.find(
        (pass) =>
          Number.isFinite(pass?.aosTime) &&
          Number.isFinite(pass?.losTime) &&
          pass.losTime >= bridgeData.simTimeMs
      ) || null
    );

  }, [
    bridgeData.targetSatrec,
    bridgeData.passSchedule,
    bridgeData.simTimeMs
  ]);


  const currentBridgePassKey =
    currentBridgePass
      ? [
          bridgeData.selectedCatnr,
          bridgeData.activeStation?.id,
          currentBridgePass.aosTime,
          currentBridgePass.losTime,
          bridgeData.stationMask
        ].join('|')
      : null;


  // -----------------------------------------------------------------------
  // 3. PRECISION PASS BOUNDARY
  //
  // Horizon AOS/LOS = 0 deg
  // SIM AOS/LOS     = selected Station Mask (0/3/5)
  //
  // Directional bracket + Binary Search <= 1 second
  // -----------------------------------------------------------------------

  useEffect(() => {

    const resetCache = () => {
      passCacheRef.current =
        createEmptyPassCache();
    };

    const d = bridgeData;

    if (
      !d.targetSatrec ||
      !currentBridgePass ||
      !d.activeStation ||
      !Number.isFinite(d.activeStation.lat) ||
      !Number.isFinite(d.activeStation.lng) ||
      !Number.isFinite(d.activeStation.alt) ||
      !Number.isFinite(d.stationMask)
    ) {
      resetCache();
      return;
    }

    if (
      passCacheRef.current.passId ===
      currentBridgePassKey
    ) {
      return;
    }


    const observer = {
      latitude:
        (d.activeStation.lat * Math.PI) / 180,

      longitude:
        (d.activeStation.lng * Math.PI) / 180,

      height:
        d.activeStation.alt / 1000
    };


    const getElevation = (timeMs) => {

      if (!Number.isFinite(timeMs)) {
        return null;
      }

      try {

        const date = new Date(timeMs);

        const pv =
          satelliteJs.propagate(
            d.targetSatrec,
            date
          );

        if (
          !pv ||
          !pv.position ||
          typeof pv.position === 'boolean'
        ) {
          return null;
        }

        const gmst =
          satelliteJs.gstime(date);

        const ecf =
          satelliteJs.eciToEcf(
            pv.position,
            gmst
          );

        const look =
          satelliteJs.ecfToLookAngles(
            observer,
            ecf
          );

        if (
          !look ||
          !Number.isFinite(look.elevation)
        ) {
          return null;
        }

        return (
          look.elevation * 180 / Math.PI
        );

      } catch (error) {

        return null;

      }
    };


    // ---------------------------------------------------------------------
    // DIRECTIONAL CROSSING SEARCH
    //
    // AOS:
    // BELOW -> ABOVE
    //
    // LOS:
    // ABOVE -> BELOW
    //
    // Search step 30 sec
    // Maximum search span ~40 minutes
    // ---------------------------------------------------------------------

    const findCrossing = (
      baseMs,
      threshold,
      isAos
    ) => {

      if (
        !Number.isFinite(baseMs) ||
        !Number.isFinite(threshold)
      ) {
        return null;
      }

      const STEP_MS = 30000;
      const MAX_STEPS = 80;

      const baseEl =
        getElevation(baseMs);

      if (baseEl === null) {
        return null;
      }

      let left = null;
      let right = null;


      // ================================================================
      // AOS : BELOW -> ABOVE
      // ================================================================

      if (isAos) {

        // Base already above threshold:
        // search BACKWARD until below.
        if (baseEl >= threshold) {

          right = baseMs;
          let cursor = baseMs;

          for (
            let i = 0;
            i < MAX_STEPS;
            i++
          ) {

            const candidate =
              cursor - STEP_MS;

            const candidateEl =
              getElevation(candidate);

            if (candidateEl === null) {
              return null;
            }

            if (candidateEl < threshold) {
              left = candidate;
              break;
            }

            right = candidate;
            cursor = candidate;
          }

        }

        // Base still below threshold:
        // search FORWARD until above.
        else {

          left = baseMs;
          let cursor = baseMs;

          for (
            let i = 0;
            i < MAX_STEPS;
            i++
          ) {

            const candidate =
              cursor + STEP_MS;

            const candidateEl =
              getElevation(candidate);

            if (candidateEl === null) {
              return null;
            }

            if (candidateEl >= threshold) {
              right = candidate;
              break;
            }

            left = candidate;
            cursor = candidate;
          }

        }

      }


      // ================================================================
      // LOS : ABOVE -> BELOW
      // ================================================================

      else {

        // Base still above threshold:
        // search FORWARD until below.
        if (baseEl >= threshold) {

          left = baseMs;
          let cursor = baseMs;

          for (
            let i = 0;
            i < MAX_STEPS;
            i++
          ) {

            const candidate =
              cursor + STEP_MS;

            const candidateEl =
              getElevation(candidate);

            if (candidateEl === null) {
              return null;
            }

            if (candidateEl < threshold) {
              right = candidate;
              break;
            }

            left = candidate;
            cursor = candidate;
          }

        }

        // Base already below threshold:
        // search BACKWARD until above.
        else {

          right = baseMs;
          let cursor = baseMs;

          for (
            let i = 0;
            i < MAX_STEPS;
            i++
          ) {

            const candidate =
              cursor - STEP_MS;

            const candidateEl =
              getElevation(candidate);

            if (candidateEl === null) {
              return null;
            }

            if (candidateEl >= threshold) {
              left = candidate;
              break;
            }

            right = candidate;
            cursor = candidate;
          }

        }

      }


      if (
        left === null ||
        right === null
      ) {
        return null;
      }


      let elLeft =
        getElevation(left);

      let elRight =
        getElevation(right);


      if (
        elLeft === null ||
        elRight === null
      ) {
        return null;
      }


      // Verify directional bracket.

      if (isAos) {

        if (
          !(
            elLeft < threshold &&
            elRight >= threshold
          )
        ) {
          return null;
        }

      } else {

        if (
          !(
            elLeft >= threshold &&
            elRight < threshold
          )
        ) {
          return null;
        }

      }


      // -----------------------------------------------------------------
      // BINARY SEARCH <= 1 SECOND
      // -----------------------------------------------------------------

      while (
        right - left > 1000
      ) {

        const mid =
          Math.floor(
            (left + right) / 2
          );

        const elMid =
          getElevation(mid);

        if (elMid === null) {
          return null;
        }


        if (isAos) {

          if (elMid >= threshold) {
            right = mid;
          } else {
            left = mid;
          }

        } else {

          if (elMid >= threshold) {
            left = mid;
          } else {
            right = mid;
          }

        }

      }


      return new Date(
        isAos ? right : left
      ).toISOString();
    };


    // ---------------------------------------------------------------------
    // BUILD PRECISION PASS CACHE
    // ---------------------------------------------------------------------

    const horizonAos =
      findCrossing(
        currentBridgePass.aosTime,
        0,
        true
      );

    const horizonLos =
      findCrossing(
        currentBridgePass.losTime,
        0,
        false
      );

    const simAos =
      findCrossing(
        currentBridgePass.aosTime,
        d.stationMask,
        true
      );

    const simLos =
      findCrossing(
        currentBridgePass.losTime,
        d.stationMask,
        false
      );


    passCacheRef.current = {

      horizonAos,
      horizonLos,

      simAos,
      simLos,

      maxEl:
        Number.isFinite(
          currentBridgePass.maxEl
        )
          ? Number(
              currentBridgePass.maxEl
                .toFixed(2)
            )
          : null,

      passId:
        currentBridgePassKey
    };


  }, [
    currentBridgePass,
    currentBridgePassKey,
    bridgeData.targetSatrec,
    bridgeData.activeStation,
    bridgeData.stationMask
  ]);


  // -----------------------------------------------------------------------
  // 4. SECURE MESSAGE RECEIVER
  // -----------------------------------------------------------------------

  useEffect(() => {

    const handleMessage = (event) => {

      if (
        !event.data ||
        typeof event.data !== 'object'
      ) {
        return;
      }


      if (
        event.origin !== ANTENNA_ORIGIN
      ) {
        return;
      }


      if (
        event.source !==
        receiverWinRef.current
      ) {
        return;
      }


      const {
        type,
        protocol,
        sessionId,
        source
      } = event.data;


      if (
        protocol !==
        ANTENNA_BRIDGE_PROTOCOL
      ) {
        return;
      }


      if (
        sessionId !==
        sessionIdRef.current
      ) {
        return;
      }


      if (
        source !==
        ANTENNA_RECEIVER_SOURCE
      ) {
        return;
      }


      // READY may only transition:
      // OPENING -> LINKED

      if (
        type === 'ANTENNA_READY'
      ) {

        lastAckAtRef.current =
          performance.now();

        setBridgeStatus(
          (prev) =>
            prev === 'OPENING'
              ? 'LINKED'
              : prev
        );

        return;
      }


      if (
        type === 'ANTENNA_PONG' ||
        type === 'RECEIVER_STATUS'
      ) {

        lastAckAtRef.current =
          performance.now();

      }

    };


    window.addEventListener(
      'message',
      handleMessage
    );


    return () => {

      window.removeEventListener(
        'message',
        handleMessage
      );

    };

  }, []);


  // -----------------------------------------------------------------------
  // 5. HELLO / TX / PING / WATCHDOG
  // -----------------------------------------------------------------------

  useEffect(() => {

    if (
      bridgeStatus === 'OFF' ||
      bridgeStatus === 'LOST'
    ) {
      return;
    }


    let helloTimer = null;
    let txTimer = null;
    let pingTimer = null;
    let watchdogTimer = null;
    let handshakeTimeout = null;


    // ================================================================
    // OPENING / HANDSHAKE
    // ================================================================

    if (
      bridgeStatus === 'OPENING'
    ) {

      const currentSession =
        sessionIdRef.current;


      const sendHello = () => {

        sendAntennaBridgeMessage(
          receiverWinRef.current,
          {
            protocol:
              ANTENNA_BRIDGE_PROTOCOL,

            type:
              'BRIDGE_HELLO',

            source:
              ANTENNA_BRIDGE_SOURCE,

            sessionId:
              currentSession
          }
        );

      };


      // Send immediately.
      sendHello();


      // Continue every 500 ms.
      helloTimer =
        setInterval(
          sendHello,
          500
        );


      handshakeTimeout =
        setTimeout(
          () => {

            if (
              sessionIdRef.current !==
              currentSession
            ) {
              return;
            }


            setBridgeStatus(
              (prev) =>
                prev === 'OPENING'
                  ? 'LOST'
                  : prev
            );

          },
          8000
        );

    }


    // ================================================================
    // LINKED
    // ================================================================

    if (
      bridgeStatus === 'LINKED'
    ) {

      const sendPing = () => {

        sendAntennaBridgeMessage(
          receiverWinRef.current,
          {
            protocol:
              ANTENNA_BRIDGE_PROTOCOL,

            type:
              'BRIDGE_PING',

            source:
              ANTENNA_BRIDGE_SOURCE,

            sessionId:
              sessionIdRef.current
          }
        );

      };


      // Send one immediately.
      sendPing();


      pingTimer =
        setInterval(
          sendPing,
          1000
        );


      watchdogTimer =
        setInterval(
          () => {

            if (
              performance.now() -
                lastAckAtRef.current >
              2500
            ) {

              setBridgeStatus(
                'LOST'
              );

            }

          },
          1000
        );


      // -------------------------------------------------------------
      // POINTING STATE @ 25 Hz
      // -------------------------------------------------------------

      txTimer =
        setInterval(
          () => {

            const d =
              dataRef.current;


            if (
              !receiverWinRef.current ||
              receiverWinRef.current.closed
            ) {

              setBridgeStatus(
                'LOST'
              );

              return;
            }


            if (
              !d ||
              !d.targetData ||
              !d.activeStation ||
              !Number.isFinite(
                d.simTimeMs
              ) ||
              !Number.isFinite(
                d.targetData.azimuthDeg
              ) ||
              !Number.isFinite(
                d.targetData.elevationDeg
              ) ||
              !Number.isFinite(
                d.stationMask
              )
            ) {
              return;
            }


            const az =
              (
                (
                  d.targetData.azimuthDeg %
                    360
                ) +
                360
              ) % 360;


            const el =
              d.targetData.elevationDeg;


            const payload = {

              protocol:
                ANTENNA_BRIDGE_PROTOCOL,

              type:
                'POINTING_STATE',

              source:
                ANTENNA_BRIDGE_SOURCE,

              sessionId:
                sessionIdRef.current,

              sequence:
                sequenceRef.current++,

              target:
                d.selectedCatnr != null
                  ? String(
                      d.selectedCatnr
                    )
                  : null,

              name:
                d.targetConfig
                  ?.displayName ||
                'UNKNOWN',

              simTimeUtc:
                new Date(
                  d.simTimeMs
                ).toISOString(),

              isPlaying:
                Boolean(d.isPlaying),

              simRate:
                d.isPlaying &&
                Number.isFinite(
                  d.speedMult
                )
                  ? d.speedMult
                  : 0,

              azimuth:
                Number(
                  az.toFixed(2)
                ),

              elevation:
                Number(
                  el.toFixed(2)
                ),

              isAboveHorizon:
                el >= 0,

              isWithinStationMask:
                el >= d.stationMask,

              isTracking:
                el >= d.stationMask,

              phase:
                null,

              altitudeKm:
                Number.isFinite(
                  d.targetData.altKm
                )
                  ? Number(
                      d.targetData.altKm
                        .toFixed(2)
                    )
                  : null,

              slantRangeKm:
                Number.isFinite(
                  d.targetData.rangeKm
                )
                  ? Number(
                      d.targetData.rangeKm
                        .toFixed(2)
                    )
                  : null,

              satLat:
                Number.isFinite(
                  d.targetData.lat
                )
                  ? Number(
                      d.targetData.lat
                        .toFixed(4)
                    )
                  : null,

              satLon:
                Number.isFinite(
                  d.targetData.lng
                )
                  ? Number(
                      d.targetData.lng
                        .toFixed(4)
                    )
                  : null,

              station: {

                id:
                  d.activeStation.id,

                name:
                  d.activeStation.name,

                lat:
                  d.activeStation.lat,

                lon:
                  d.activeStation.lng,

                altM:
                  d.activeStation.alt
              },

              stationMaskDeg:
                d.stationMask,

              horizonAosUtc:
                passCacheRef.current
                  .horizonAos,

              horizonLosUtc:
                passCacheRef.current
                  .horizonLos,

              simAosUtc:
                passCacheRef.current
                  .simAos,

              simLosUtc:
                passCacheRef.current
                  .simLos,

              maxElevation:
                passCacheRef.current
                  .maxEl
            };


            sendAntennaBridgeMessage(
              receiverWinRef.current,
              payload
            );

          },
          40
        );

    }


    // -----------------------------------------------------------------
    // CLEANUP ALL TIMERS
    // -----------------------------------------------------------------

    return () => {

      if (helloTimer) {
        clearInterval(helloTimer);
      }

      if (txTimer) {
        clearInterval(txTimer);
      }

      if (pingTimer) {
        clearInterval(pingTimer);
      }

      if (watchdogTimer) {
        clearInterval(
          watchdogTimer
        );
      }

      if (handshakeTimeout) {
        clearTimeout(
          handshakeTimeout
        );
      }

    };

  }, [bridgeStatus]);


  // -----------------------------------------------------------------------
  // 6. CONNECT
  // -----------------------------------------------------------------------

  const connectAntenna = () => {

    const newSessionId =
      globalThis.crypto
        ?.randomUUID?.() ||
      `${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;


    sessionIdRef.current =
      newSessionId;

    sequenceRef.current = 0;

    lastAckAtRef.current = 0;


    // Must happen directly from user click
    // so popup blocker permits it.

    const receiverWindow =
      window.open(
        ANTENNA_URL,
        'AntennaSim'
      );


    receiverWinRef.current =
      receiverWindow;


    if (!receiverWindow) {

      setBridgeStatus('LOST');
      return;

    }


    setBridgeStatus('OPENING');
  };


  // -----------------------------------------------------------------------
  // 7. DISCONNECT
  // -----------------------------------------------------------------------

  const disconnectAntenna = () => {

    const currentSession =
      sessionIdRef.current;


    if (currentSession) {

      sendAntennaBridgeMessage(
        receiverWinRef.current,
        {
          protocol:
            ANTENNA_BRIDGE_PROTOCOL,

          type:
            'BRIDGE_DISCONNECT',

          source:
            ANTENNA_BRIDGE_SOURCE,

          sessionId:
            currentSession
        }
      );

    }


    sessionIdRef.current = null;
    sequenceRef.current = 0;
    lastAckAtRef.current = 0;

    receiverWinRef.current = null;

    setBridgeStatus('OFF');
  };

  // Ensure the sidecar is told to stop tracking when SAT-ORBIT is refreshed/unmounted.
  useEffect(() => {
    return () => {
      const currentSession = sessionIdRef.current;
      if (currentSession) {
        sendAntennaBridgeMessage(receiverWinRef.current, {
          protocol: ANTENNA_BRIDGE_PROTOCOL,
          type: 'BRIDGE_DISCONNECT',
          source: ANTENNA_BRIDGE_SOURCE,
          sessionId: currentSession
        });
      }
      sessionIdRef.current = null;
      receiverWinRef.current = null;
    };
  }, []);


  return {
    bridgeStatus,
    connectAntenna,
    disconnectAntenna
  };
};

// =========================================================================
// END GISTDA ANTENNA BRIDGE v1.4
// =========================================================================


// =========================================================================
// ASSET STABILITY GUARD v1
// One-shot fallback for runtime images. Prevents recursive onError loops.
// =========================================================================
const handleRuntimeImageError = (event, fallbackSrc = null) => {
  const img = event?.currentTarget;
  if (!img) return;

  const fallbackUrl = fallbackSrc
    ? new URL(fallbackSrc, window.location.href).href
    : null;

  // Retry only once, and never retry the same broken URL recursively.
  if (
    fallbackUrl &&
    img.src !== fallbackUrl &&
    img.dataset.gistdaFallbackApplied !== '1'
  ) {
    img.dataset.gistdaFallbackApplied = '1';
    img.src = fallbackUrl;
    return;
  }

  // Keep layout stable if both primary and fallback are unavailable.
  img.style.visibility = 'hidden';
};

// ==========================================
// 4. MAIN APP
// ==========================================


// =========================================================================
// GROUND STATION WEATHER CENTER
// - Lazy-loads detailed weather only while the popup is open
// - Uses Open-Meteo point forecast for station conditions / 24 h / 5 day
// - Regional map uses Leaflet + OpenStreetMap with NASA GIBS cloud/rain overlays
// - No weather-map engine runs while this popup is closed
// =========================================================================
// Lightweight interactive regional map for Weather Center only.
// Leaflet is lazy-loaded when the Weather Center opens, so the main SAT-ORBIT view carries no map-engine cost.
const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const WEATHER_STALE_MS = 15 * 60 * 1000;
const weatherHasNumber = (value) => (
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value))
);
const weatherStationKey = (station) => `${station?.id || ''}:${station?.lat ?? ''}:${station?.lng ?? ''}`;
const WEATHER_CODES = {
  0: 'CLEAR SKY', 1: 'PARTLY CLOUDY', 2: 'PARTLY CLOUDY', 3: 'OVERCAST',
  45: 'FOG', 48: 'FOG', 51: 'DRIZZLE', 53: 'DRIZZLE', 55: 'DRIZZLE', 56: 'FREEZING DRIZZLE', 57: 'FREEZING DRIZZLE',
  61: 'RAIN', 63: 'RAIN', 65: 'RAIN', 66: 'FREEZING RAIN', 67: 'FREEZING RAIN',
  71: 'SNOW', 73: 'SNOW', 75: 'SNOW', 77: 'SNOW GRAINS',
  80: 'RAIN SHOWERS', 81: 'RAIN SHOWERS', 82: 'RAIN SHOWERS', 85: 'SNOW SHOWERS', 86: 'SNOW SHOWERS',
  95: 'THUNDERSTORM', 96: 'THUNDERSTORM WITH HAIL', 99: 'THUNDERSTORM WITH HAIL'
};
const weatherCodeLabel = (code) => weatherHasNumber(code) ? (WEATHER_CODES[Number(code)] || 'UNKNOWN') : 'NO DATA';
const weatherRecordForStation = (record, stationKey) => record?.stationKey === stationKey ? record.data : null;


const weatherLeafletPromises = new WeakMap();
function loadWeatherLeaflet(ownerWindow = window) {
  const doc = ownerWindow?.document;
  if (!doc) return Promise.reject(new Error('Leaflet requires a browser'));
  if (ownerWindow.L) return Promise.resolve(ownerWindow.L);
  if (weatherLeafletPromises.has(doc)) return weatherLeafletPromises.get(doc);
  const promise = new Promise((resolve, reject) => {
    if (!doc.getElementById('sat-orbit-leaflet-css')) {
      const link = doc.createElement('link');
      link.id = 'sat-orbit-leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      doc.head.appendChild(link);
    }
    doc.getElementById('sat-orbit-leaflet-js')?.remove();
    const script = doc.createElement('script');
    script.id = 'sat-orbit-leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      script.onload = null;
      script.onerror = null;
      if (error) { script.remove(); reject(error); }
      else resolve(ownerWindow.L);
    };
    const timeoutId = setTimeout(() => finish(new Error('Leaflet load timeout')), 10000);
    script.onload = () => finish(ownerWindow.L ? null : new Error('Leaflet unavailable after load'));
    script.onerror = () => finish(new Error('Leaflet script failed to load'));
    doc.head.appendChild(script);
  }).catch(error => { weatherLeafletPromises.delete(doc); throw error; });
  weatherLeafletPromises.set(doc, promise);
  return promise;
}

function WeatherInteractiveMap({ station, fmt, cloudCover, precipitationNow, validTime, active = false, hostWindow = window, hostRevision = 0 }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const weatherLayerRef = useRef(null);
  const leafletRef = useRef(null);
  const savedViewRef = useRef(null);
  const [mapRevision, setMapRevision] = useState(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [layerMode, setLayerMode] = useState('CLOUD');

  const lat = Number(station?.lat || 0);
  const lng = Number(station?.lng || 0);
  const stationId = station?.id || 'SRC';

  // FINAL READY WEATHER MAP SOURCES (no client API key required)
  // CLOUD     : NASA GIBS / MODIS Aqua Cloud Fraction (global daily cloud fraction)
  // RAIN      : NASA GIBS / GPM IMERG V07 30-minute precipitation rate (global; limited boxes only near the poles)
  // SATELLITE : NASA GIBS / MODIS Terra Corrected Reflectance True Color (global daily imagery)
  // Layers are requested lazily only while Weather Center is open.
  const nasaGibsWms = 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi';

  useEffect(() => {
    let cancelled = false;
    let resizeFrame = null;
    let resizeObserver = null;
    const owner = hostWindow || hostRef.current?.ownerDocument?.defaultView;
    const currentStationKey = `${stationId}:${lat}:${lng}`;
    const resizeMap = () => {
      if (resizeFrame) owner.cancelAnimationFrame(resizeFrame);
      resizeFrame = owner.requestAnimationFrame(() => {
        if (!cancelled && hostRef.current?.clientWidth && hostRef.current?.clientHeight) {
          try { mapRef.current?.invalidateSize({ pan: false, debounceMoveend: true }); } catch (_) {}
        }
      });
    };
    setMapReady(false);
    setMapError('');

    loadWeatherLeaflet(owner)
      .then((L) => {
        if (cancelled || !hostRef.current || hostRef.current.ownerDocument !== owner.document) return;
        leafletRef.current = L;
        if (mapRef.current) {
          try { mapRef.current.remove(); } catch (_) {}
          mapRef.current = null;
        }

        // Only the renderer is recreated after document adoption; preserve the
        // user's map center/zoom and keep the one existing forecast poller.
        const map = L.map(hostRef.current, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: true,
          wheelDebounceTime: 35,
          wheelPxPerZoomLevel: 60,
          doubleClickZoom: true,
          dragging: true,
          touchZoom: true,
          boxZoom: true,
          keyboard: false,
          worldCopyJump: true,
          minZoom: 2
        });
        // Station-first UX: every new Weather Map renderer starts on the selected ground station.
        // User pan/zoom is preserved only while the renderer remains open; switching back to MAP recenters deliberately.
        map.setView([lat, lng], 8, { animate: false });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        // MASTER WEATHER MAP: station is a simple yellow point only; no permanent label/range ring.
        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          color: '#ffcc00',
          weight: 2,
          fillColor: '#ffcc00',
          fillOpacity: 1
        }).addTo(map);
        marker.bindPopup(`<strong>${stationId}</strong><br/>${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E<br/>Altitude ${Number(station?.alt || 0).toFixed(0)} m`);

        mapRef.current = map;
        setMapRevision(value => value + 1);
        setMapReady(true);
        const Observer = owner.ResizeObserver || window.ResizeObserver;
        resizeObserver = Observer ? new Observer(resizeMap) : null;
        resizeObserver?.observe(hostRef.current);
        owner.addEventListener('resize', resizeMap);
        owner.visualViewport?.addEventListener('resize', resizeMap);
        resizeMap();
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[WeatherCenter] interactive map unavailable:', error);
        setMapError('INTERACTIVE MAP OFFLINE');
      });

    return () => {
      cancelled = true;
      if (resizeFrame) owner.cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      owner.removeEventListener('resize', resizeMap);
      owner.visualViewport?.removeEventListener('resize', resizeMap);
      if (weatherLayerRef.current) {
        try { weatherLayerRef.current.remove(); } catch (_) {}
        weatherLayerRef.current = null;
      }
      if (mapRef.current) {
        try { savedViewRef.current = { stationKey: currentStationKey, center: mapRef.current.getCenter(), zoom: mapRef.current.getZoom() }; } catch (_) {}
        try { mapRef.current.remove(); } catch (_) {}
        mapRef.current = null;
      }
    };
  }, [stationId, lat, lng, hostWindow, hostRevision]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const owner = hostWindow || mapRef.current?._container?.ownerDocument?.defaultView || window;
    const frame = owner.requestAnimationFrame(() => {
      try {
        mapRef.current?.invalidateSize({ pan: false, debounceMoveend: false });
        mapRef.current?.setView([lat, lng], 8, { animate: false });
      } catch (_) {}
    });
    return () => owner.cancelAnimationFrame(frame);
  }, [active, stationId, lat, lng, mapRevision, hostWindow]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (weatherLayerRef.current) {
      try { map.removeLayer(weatherLayerRef.current); } catch (_) {}
      weatherLayerRef.current = null;
    }

    if (layerMode === 'BASE') return;

    // Global weather imagery. CLOUD is intentionally a visible-cloud view rather
    // than the MODIS Cloud Fraction science overlay: the fraction product can be
    // sparse/day-only and may look blank at some locations/times. VIIRS true-color
    // daily imagery makes the cloud field directly visible while remaining global.
    const isCloudLayer = layerMode === 'CLOUD';
    const layerConfig = layerMode === 'RAIN'
      ? {
          layers: 'IMERG_Precipitation_Rate_30min',
          opacity: 0.70,
          attribution: 'NASA GIBS / GPM IMERG',
          error: 'RAIN LAYER TEMPORARILY UNAVAILABLE',
          format: 'image/png',
          transparent: true,
          pane: undefined
        }
      : layerMode === 'SATELLITE'
        ? {
            layers: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
            opacity: 0.88,
            attribution: 'NASA GIBS / VIIRS NOAA-20 True Color',
            error: 'SATELLITE LAYER TEMPORARILY UNAVAILABLE',
            format: 'image/jpeg',
            transparent: false,
            pane: undefined
          }
        : {
            layers: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
            opacity: 0.58,
            attribution: 'NASA GIBS / VIIRS NOAA-20 Visible Cloud',
            error: 'CLOUD LAYER TEMPORARILY UNAVAILABLE',
            format: 'image/jpeg',
            transparent: false,
            pane: 'weatherCloudPane'
          };

    if (isCloudLayer && !map.getPane('weatherCloudPane')) {
      const pane = map.createPane('weatherCloudPane');
      pane.style.zIndex = '420';
      // Keep geographic context visible while making bright cloud masses pop.
      pane.style.filter = 'grayscale(1) saturate(0) brightness(1.28) contrast(1.20)';
    }

    const layer = L.tileLayer.wms(nasaGibsWms, {
      layers: layerConfig.layers,
      styles: 'default',
      format: layerConfig.format,
      transparent: layerConfig.transparent,
      version: '1.1.1',
      time: 'default',
      opacity: layerConfig.opacity,
      attribution: layerConfig.attribution,
      ...(layerConfig.pane ? { pane: layerConfig.pane } : {})
    });

    let activeLayer = true;
    layer.on('tileerror', () => { if (activeLayer) setMapError(layerConfig.error); });
    layer.on('load', () => { if (activeLayer) setMapError(''); });
    layer.addTo(map);
    weatherLayerRef.current = layer;
    return () => { activeLayer = false; layer.off(); try { layer.remove(); } catch (_) {} if (weatherLayerRef.current === layer) weatherLayerRef.current = null; };
  }, [layerMode, mapRevision]);

  const zoomBy = (delta) => {
    const map = mapRef.current;
    if (!map) return;
    if (delta > 0) map.zoomIn(); else map.zoomOut();
  };

  const cloudPct = weatherHasNumber(cloudCover) ? Math.max(0, Math.min(100, Number(cloudCover))) : null;
  const rainNow = weatherHasNumber(precipitationNow) ? Math.max(0, Number(precipitationNow)) : null;

  return (
    <div className="weather-map-shell">
      <div ref={hostRef} className="weather-leaflet-host" />
      <div className="weather-map-overlay" />
      <div className="weather-map-label">GLOBAL WEATHER MAP • {stationId}</div>
      <div className="weather-map-valid">VALID {validTime || '--:--'} UTC</div>
      <div className="weather-map-actions">
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => { try { mapRef.current?.setView([lat, lng], 8, { animate: true }); } catch (_) {} }} disabled={!mapReady} title={`Center on ${stationId} ground station`}>⌖</button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(1)} disabled={!mapReady} title="Zoom in">+</button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(-1)} disabled={!mapReady} title="Zoom out">−</button>
      </div>
      <div className="weather-map-layers">
        <button type="button" className={layerMode === 'BASE' ? 'active base' : 'base'} onPointerDown={(e) => e.stopPropagation()} onClick={() => setLayerMode('BASE')}>BASE</button>
        <button
          type="button"
          className={layerMode === 'CLOUD' ? 'active cloud' : 'cloud'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setLayerMode('CLOUD')}
          title="Global visible cloud imagery • NASA GIBS / VIIRS NOAA-20"
        >CLOUD</button>
        <button
          type="button"
          className={layerMode === 'RAIN' ? 'active rain' : 'rain'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setLayerMode('RAIN')}
          title="Global precipitation rate • NASA GIBS / GPM IMERG V07 30-minute"
        >RAIN</button>
        <button
          type="button"
          className={layerMode === 'SATELLITE' ? 'active satellite' : 'satellite'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setLayerMode('SATELLITE')}
          title="Global satellite true color • NASA GIBS / VIIRS NOAA-20"
        >SATELLITE</button>
      </div>
      {mapError ? <div className="weather-map-error">{mapError}</div> : null}
      <div className="weather-map-coord">LAT {fmt(lat,4)}° • LON {fmt(lng,4)}° • ALT {fmt(station?.alt,0)} m</div>
      <div className="weather-map-legend">
        <div className="weather-map-legend-row">
          <span>CLOUD COVER</span>
          <strong>{cloudPct == null ? '--' : `${Math.round(cloudPct)}%`}</strong>
        </div>
        <div className="weather-cloud-scale"><i/><i/><i/><i/><i/></div>
        <div className="weather-map-legend-row">
          <span>RAIN NOW</span>
          <strong>{rainNow == null ? '--' : `${rainNow.toFixed(1)} mm`}</strong>
        </div>
        <small>{layerMode === 'CLOUD' ? 'CLOUD: VIIRS NOAA-20 VISIBLE CLOUD • NASA GIBS' : layerMode === 'RAIN' ? 'RAIN: GPM IMERG V07 30-MIN GLOBAL • NASA GIBS' : layerMode === 'SATELLITE' ? 'SATELLITE: VIIRS NOAA-20 TRUE COLOR • NASA GIBS' : 'BASE: OPENSTREETMAP'}</small>
      </div>
    </div>
  );
}

function WeatherCenterModal({
  open,
  onClose,
  station,
  zIndex = 10005,
  onFocus,
  summaryCloudCover,
  summaryMode,
  hostWindow = window,
  hosted = false,
  hostRevision = 0,
  windowControl = null,
  presentationScale = 1
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [windowRect, setWindowRect] = useState({ x: 210, y: 95, width: 1120, height: 720 });
  const [weatherRecord, setWeatherRecord] = useState(null);
  const stationKey = weatherStationKey(station);
  const weatherData = weatherRecordForStation(weatherRecord, stationKey);
  const [weatherWallMs, setWeatherWallMs] = useState(Date.now);
  const [isLoading, setIsLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const frameRef = useRef(null);
  const dragRef = useRef({ offsetX: 0, offsetY: 0 });
  const initializedRef = useRef(false);
  const bodyRef = useRef(null);
  const panelSize = useSatOwnedPanelSize(frameRef, open, hostWindow, hostRevision);
  const bodySize = useSatOwnedPanelSize(bodyRef, open, hostWindow, hostRevision);
  const [weatherTab, setWeatherTab] = useState('overview');
  const [metricPage, setMetricPage] = useState(0);
  const [trendPage, setTrendPage] = useState(0);
  const [hourPage, setHourPage] = useState(0);
  const [dayPage, setDayPage] = useState(0);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const finite = weatherHasNumber;
  const fmt = (v, digits = 0, fallback = 'N/A') => finite(v) ? Number(v).toFixed(digits) : fallback;
  const parseUtc = (value) => {
    if (!value) return NaN;
    const s = String(value);
    return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`).getTime();
  };
  const formatUtcHour = (value) => {
    const ms = parseUtc(value);
    if (!Number.isFinite(ms)) return '--:--';
    return new Date(ms).toISOString().slice(11, 16);
  };
  const formatUtcDate = (value) => {
    const ms = parseUtc(value);
    if (!Number.isFinite(ms)) return '--';
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(ms)).toUpperCase();
  };
  const weatherLabel = weatherCodeLabel;
  const weatherIcon = (code, className = 'weather-glyph') => {
    const c = finite(code) ? Number(code) : null;
    const kind = c === 0 ? 'sun' : c === 1 || c === 2 ? 'partly' : c === 3 ? 'cloud' : c === 45 || c === 48 ? 'fog' : c !== null && ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) ? 'rain' : c !== null && ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) ? 'snow' : c !== null && [95,96,99].includes(c) ? 'storm' : 'cloud';
    const cloud = <><path d="M20 44h28c7 0 12-4 12-10s-5-10-11-10c-2-8-9-13-17-13-10 0-18 7-19 17C7 29 3 33 3 38c0 4 3 6 7 6h10Z"/><path d="M15 29c2-8 8-13 17-13 7 0 13 4 16 10" opacity=".45"/></>;
    return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'sun' && <><circle cx="32" cy="32" r="11"/><path d="M32 6v8M32 50v8M6 32h8M50 32h8M13.6 13.6l5.7 5.7M44.7 44.7l5.7 5.7M50.4 13.6l-5.7 5.7M19.3 44.7l-5.7 5.7"/></>}
      {kind === 'partly' && <><circle cx="42" cy="20" r="9"/><path d="M42 4v5M42 31v5M26 20h5M53 20h5"/>{cloud}</>}
      {kind === 'cloud' && cloud}
      {kind === 'fog' && <><path d="M12 24h40M8 34h48M15 44h34"/><path d="M18 17h29" opacity=".5"/></>}
      {kind === 'rain' && <>{cloud}<path d="M20 49l-3 7M32 49l-3 7M44 49l-3 7"/></>}
      {kind === 'snow' && <>{cloud}<path d="M20 51h0M32 54h0M44 51h0" strokeWidth="5"/></>}
      {kind === 'storm' && <>{cloud}<path d="M35 46l-8 10h7l-4 6 12-13h-7l4-3" fill="currentColor" stroke="none"/></>}
    </svg>;
  };
  const windCardinal = (deg) => {
    if (!finite(deg)) return '--';
    const names = ['N','NE','E','SE','S','SW','W','NW'];
    return names[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
  };
  const dewPointC = (temperature, humidity) => {
    if (!finite(temperature) || !finite(humidity) || Number(humidity) <= 0) return null;
    const a = 17.62, b = 243.12, t = Number(temperature), rh = Math.min(100, Math.max(1, Number(humidity)));
    const gamma = Math.log(rh / 100) + (a * t) / (b + t);
    return (b * gamma) / (a - gamma);
  };
  const metricGlyph = (label) => {
    const code = label === 'TEMPERATURE' || label === 'FEELS LIKE' || label === 'DEW POINT' ? 'T' : label === 'HUMIDITY' ? 'RH' : label === 'PRESSURE' ? 'P' : label === 'VISIBILITY' ? 'VIS' : label.startsWith('WIND') ? 'W' : label.startsWith('RAIN') ? 'R' : label === 'THUNDERSTORM' ? 'TS' : 'WX';
    return <span className="weather-metric-glyph" aria-hidden="true">{code}</span>;
  };
  const weatherTabGlyph = (id) => ({ overview: '◈', map: '⌖', now: '●', trends: '⌁', hours: '◷', days: '▦' }[id] || '•');
  const numericSeries = (values) => values.map(v => finite(v) ? Number(v) : null);
  const seriesStats = (values) => {
    const valid = numericSeries(values).filter(v => v !== null);
    return valid.length ? { min: Math.min(...valid), max: Math.max(...valid), now: valid[valid.length - 1] } : { min: null, max: null, now: null };
  };
  const groundStationImpact = ({ code, gust, visibility, rain, pop, cloud }) => {
    const c = finite(code) ? Number(code) : null, g = finite(gust) ? Number(gust) : null, vis = finite(visibility) ? Number(visibility) : null, r = finite(rain) ? Number(rain) : null, p = finite(pop) ? Number(pop) : null, cl = finite(cloud) ? Number(cloud) : null;
    if ((c !== null && [95,96,99].includes(c)) || (g !== null && g >= 60) || (vis !== null && vis < 2) || (r !== null && r >= 10)) return { label: 'WEATHER RISK', level: 'risk' };
    if ((g !== null && g >= 40) || (vis !== null && vis < 5) || (p !== null && p >= 70) || (cl !== null && cl >= 80)) return { label: 'CAUTION', level: 'caution' };
    return { label: 'NORMAL', level: 'normal' };
  };

  useEffect(() => {
    if (!open) { setIsDragging(false); return; }
    const fit = (rect) => {
      const vw = hostWindow.innerWidth, vh = hostWindow.innerHeight;
      const width = Math.min(Math.max(320, rect.width), Math.max(1, vw - 16));
      const height = Math.min(Math.max(320, rect.height), Math.max(1, vh - 16));
      const x = clamp(rect.x, 8, Math.max(8, vw - width - 8)), y = clamp(rect.y, 8, Math.max(8, vh - height - 8));
      return width === rect.width && height === rect.height && x === rect.x && y === rect.y ? rect : { width, height, x, y };
    };
    if (!hosted && !initializedRef.current) {
      const vw = hostWindow.innerWidth, vh = hostWindow.innerHeight;
      const width = Math.min(1220, Math.max(900, vw * .72), Math.max(1, vw - 32));
      const height = Math.min(790, Math.max(610, vh * .78), Math.max(1, vh - 32));
      setWindowRect({ x: Math.max(16, (vw - width) / 2), y: Math.max(16, (vh - height) / 2), width, height });
      initializedRef.current = true;
    } else if (!hosted && !isMaximized) setWindowRect(rect => fit(rect));
    const onResize = () => { if (!hosted && !isMaximized) setWindowRect(rect => fit(rect)); };
    const onKey = event => {
      if (!hosted || event.key !== 'Escape' || hostWindow.document.fullscreenElement) return;
      onClose();
    };
    hostWindow.addEventListener('resize', onResize);
    hostWindow.addEventListener('keydown', onKey);
    return () => { hostWindow.removeEventListener('resize', onResize); hostWindow.removeEventListener('keydown', onKey); };
  }, [open, hosted, hostWindow, isMaximized, onClose]);

  useEffect(() => {
    if (!open || hosted || isMaximized || !frameRef.current || !hostWindow.ResizeObserver) return;
    const observer = new hostWindow.ResizeObserver(entries => {
      const rect = entries[0]?.target?.getBoundingClientRect?.();
      if (!rect) return;
      setWindowRect(current => Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1 ? current : { ...current, width: rect.width, height: rect.height });
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, isMaximized, hosted, hostWindow, hostRevision]);

  useEffect(() => {
    if (!open || !isDragging || hosted) return;
    const onMove = event => setWindowRect(rect => ({
      ...rect,
      x: clamp(event.clientX - dragRef.current.offsetX, 0, Math.max(0, hostWindow.innerWidth - rect.width)),
      y: clamp(event.clientY - dragRef.current.offsetY, 0, Math.max(0, hostWindow.innerHeight - rect.height))
    }));
    const onUp = () => setIsDragging(false);
    hostWindow.addEventListener('pointermove', onMove);
    hostWindow.addEventListener('pointerup', onUp, { once: true });
    hostWindow.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      hostWindow.removeEventListener('pointermove', onMove);
      hostWindow.removeEventListener('pointerup', onUp);
      hostWindow.removeEventListener('pointercancel', onUp);
    };
  }, [open, isDragging, hosted, hostWindow]);

  useEffect(() => {
    if (!open) return;
    setWeatherWallMs(Date.now());
    const ageTimer = setInterval(() => setWeatherWallMs(Date.now()), 60000);
    const refreshTimer = setInterval(() => setRefreshKey((value) => value + 1), WEATHER_REFRESH_MS);
    return () => { clearInterval(ageTimer); clearInterval(refreshTimer); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!station || !finite(station.lat) || !finite(station.lng)) {
      setWeatherRecord(null);
      setWeatherError('STATION COORDINATES UNAVAILABLE');
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setWeatherError(null);
    setWeatherRecord((record) => record?.stationKey === stationKey ? record : null);

    const currentFields = [
      'temperature_2m','relative_humidity_2m','apparent_temperature','precipitation','rain',
      'weather_code','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m','is_day'
    ].join(',');
    const hourlyFields = [
      'temperature_2m','relative_humidity_2m','precipitation_probability','precipitation','rain','weather_code',
      'cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','visibility','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'
    ].join(',');
    const dailyFields = [
      'weather_code','temperature_2m_max','temperature_2m_min','precipitation_sum','precipitation_probability_max',
      'wind_speed_10m_max','wind_gusts_10m_max','sunrise','sunset'
    ].join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.lat}&longitude=${station.lng}&current=${currentFields}&hourly=${hourlyFields}&daily=${dailyFields}&past_hours=6&forecast_days=6&timezone=UTC&wind_speed_unit=kmh&precipitation_unit=mm`;
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        if (!data || typeof data !== 'object' || data.error || (!data.current && !data.hourly)) throw new Error('Empty weather response');
        const fetchedAt = Date.now();
        setWeatherRecord({ stationKey, fetchedAt, data });
        setWeatherWallMs(fetchedAt);
        setWeatherError(null);
      })
      .catch((error) => {
        if (!active) return;
        if (error?.name !== 'AbortError') console.warn('[WeatherCenter] forecast fetch failed:', error);
        setWeatherError(error?.name === 'AbortError' ? 'REQUEST TIMEOUT' : 'WEATHER DATA OFFLINE');
      })
      .finally(() => {
        clearTimeout(timeoutId);
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [open, stationKey, refreshKey]);

  if (!open) return null;

  const weatherAgeMinutes = weatherData ? Math.max(0, Math.floor((weatherWallMs - weatherRecord.fetchedAt) / 60000)) : null;
  const weatherIsStale = Boolean(weatherData && (weatherError || weatherWallMs - weatherRecord.fetchedAt > WEATHER_STALE_MS));
  const weatherStatus = weatherIsStale ? 'CACHED FORECAST' : weatherData ? 'CURRENT FORECAST' : isLoading ? 'FETCHING FORECAST' : 'FORECAST UNAVAILABLE';
  const current = weatherData?.current || {};
  const hourly = weatherData?.hourly || {};
  const daily = weatherData?.daily || {};
  const currentMs = parseUtc(current?.time) || Date.now();
  const hourTimes = Array.isArray(hourly.time) ? hourly.time : [];
  let nearestHour = 0;
  let nearestDiff = Infinity;
  hourTimes.forEach((time, index) => {
    const ms = parseUtc(time);
    const diff = Math.abs(ms - currentMs);
    if (Number.isFinite(ms) && diff < nearestDiff) { nearestDiff = diff; nearestHour = index; }
  });
  const hourlyAt = (key, index = nearestHour) => Array.isArray(hourly?.[key]) ? hourly[key][index] : null;
  const visibilityKm = finite(hourlyAt('visibility')) ? Number(hourlyAt('visibility')) / 1000 : null;
  const popNow = hourlyAt('precipitation_probability');
  const weatherCodeKnown = finite(current.weather_code) && Boolean(WEATHER_CODES[Number(current.weather_code)]);
  const thunderstormNow = weatherCodeKnown ? [95, 96, 99].includes(Number(current.weather_code)) : null;
  const next24 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 24); i += 3) {
    next24.push({
      time: hourTimes[i],
      code: hourly.weather_code?.[i],
      temp: hourly.temperature_2m?.[i],
      cloud: hourly.cloud_cover?.[i],
      pop: hourly.precipitation_probability?.[i],
      rain: hourly.precipitation?.[i],
      wind: hourly.wind_speed_10m?.[i],
      windDir: hourly.wind_direction_10m?.[i]
    });
  }
  const dailyCards = (daily.time || []).slice(0, 5).map((time, index) => ({
    time,
    code: daily.weather_code?.[index],
    tMax: daily.temperature_2m_max?.[index],
    tMin: daily.temperature_2m_min?.[index],
    pop: daily.precipitation_probability_max?.[index],
    rain: daily.precipitation_sum?.[index],
    wind: daily.wind_speed_10m_max?.[index],
    gust: daily.wind_gusts_10m_max?.[index]
  }));

  const clampPct = (value) => finite(value) ? Math.max(0, Math.min(100, Number(value))) : null;
  const cloudPct = clampPct(current.cloud_cover);
  const cloudState = cloudPct === null ? 'NO DATA' : cloudPct >= 90 ? 'OVERCAST' : cloudPct >= 70 ? 'CLOUDY' : cloudPct >= 40 ? 'BROKEN CLOUDS' : cloudPct >= 15 ? 'PARTLY CLOUDY' : 'CLEAR / FEW CLOUDS';
  const cloudLevelColor = (pct) => {
    const v = clampPct(pct);
    if (v === null) return '#7d8b98';
    if (v <= 20) return '#24475f';
    if (v <= 40) return '#4f89a8';
    if (v <= 60) return '#83b8d0';
    if (v <= 80) return '#bfd8e6';
    return '#f4fbff';
  };
  // Conventional meteorological thermal ramp (there is no single universal palette):
  // colder values use blue/cyan; warm values move through green/yellow/orange to red.
  const temperatureColor = (value) => {
    if (!finite(value)) return '#7d8b98';
    const t = Number(value);
    if (t < 0) return '#5b7cff';
    if (t < 10) return '#39a8ff';
    if (t < 20) return '#2bd9e9';
    if (t < 25) return '#55e06f';
    if (t < 30) return '#ffd23f';
    if (t < 35) return '#ff982e';
    if (t < 40) return '#ff5a3d';
    return '#ff365d';
  };
  const cloudHeroColor = cloudLevelColor(cloudPct);
  const cloudOperationalLabel = cloudPct === null ? 'WEATHER UNAVAILABLE • OPTICAL STATUS UNKNOWN' : cloudPct <= 20 ? 'CLEAR • OPTICAL FAVORABLE' : cloudPct <= 40 ? 'LOW CLOUD • GENERALLY FAVORABLE' : cloudPct <= 60 ? 'PARTLY CLOUDY • REVIEW TARGET' : cloudPct <= 80 ? 'CLOUDY • DEGRADED' : 'OVERCAST • OPTICAL DEGRADED';
  const precipNow = finite(current.precipitation ?? current.rain) ? Number(current.precipitation ?? current.rain) : null;
  const windDirection = finite(current.wind_direction_10m) ? ((Number(current.wind_direction_10m) % 360) + 360) % 360 : null;
  const windFlowDirection = windDirection === null ? null : (windDirection + 180) % 360;
  const dewPoint = dewPointC(current.temperature_2m, current.relative_humidity_2m);
  const currentImpact = groundStationImpact({ code: current.weather_code, gust: current.wind_gusts_10m, visibility: visibilityKm, rain: precipNow, pop: popNow, cloud: cloudPct });
  const observedUtc = formatUtcHour(current.time);
  const dataFreshLabel = weatherIsStale ? `DATA AGE ${weatherAgeMinutes ?? '--'} MIN` : weatherData ? 'DATA CURRENT' : 'DATA UNAVAILABLE';

  const trendLast6 = [];
  for (let i = Math.max(0, nearestHour - 5); i <= nearestHour && i < hourTimes.length; i += 1) {
    trendLast6.push({
      time: hourTimes[i], temp: hourly.temperature_2m?.[i], humidity: hourly.relative_humidity_2m?.[i], pressure: hourly.surface_pressure?.[i],
      wind: hourly.wind_speed_10m?.[i], gust: hourly.wind_gusts_10m?.[i], cloud: hourly.cloud_cover?.[i], rain: hourly.precipitation?.[i]
    });
  }
  const trendTempStats = seriesStats(trendLast6.map(d => d.temp));
  const trendPressureStats = seriesStats(trendLast6.map(d => d.pressure));
  const trendWindStats = seriesStats(trendLast6.map(d => d.wind));
  const trendGustStats = seriesStats(trendLast6.map(d => d.gust));
  const trendCloudStats = seriesStats(trendLast6.map(d => d.cloud));
  const trendRainStats = seriesStats(trendLast6.map(d => d.rain));
  const trendDelta = (key) => {
    const values = trendLast6.map(item => item?.[key]).filter(finite).map(Number);
    return values.length >= 2 ? values[values.length - 1] - values[0] : null;
  };
  const deltaText = (value, digits = 1, unit = '') => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(digits)}${unit}` : 'N/A';
  const directionText = (value, threshold = 0.05, up = 'RISING', down = 'FALLING') => !finite(value) ? 'NO TREND' : Number(value) > threshold ? up : Number(value) < -threshold ? down : 'STABLE';
  const trendTempDelta = trendDelta('temp');
  const trendPressureDelta = trendDelta('pressure');
  const trendWindDelta = trendDelta('wind');
  const trendCloudDelta = trendDelta('cloud');

  const rainHistory6 = [];
  for (let i = Math.max(0, nearestHour - 5); i < hourTimes.length && i <= nearestHour; i += 1) {
    rainHistory6.push({
      time: hourTimes[i],
      rain: finite(hourly.precipitation?.[i]) ? Number(hourly.precipitation[i]) : null
    });
  }
  const rainHistoryMax = Math.max(0.1, ...rainHistory6.map((item) => item.rain || 0));
  const rainHistoryTotal = rainHistory6.length && rainHistory6.every((item) => finite(item.rain)) ? rainHistory6.reduce((sum, item) => sum + item.rain, 0) : null;

  const precipNext6 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 6); i += 1) {
    precipNext6.push({
      time: hourTimes[i],
      rain: finite(hourly.precipitation?.[i]) ? Number(hourly.precipitation[i]) : null,
      pop: finite(hourly.precipitation_probability?.[i]) ? Number(hourly.precipitation_probability[i]) : null
    });
  }
  const precipNext6Max = Math.max(0.1, ...precipNext6.map((item) => item.rain || 0));
  const precipNext6Total = precipNext6.length && precipNext6.every((item) => finite(item.rain)) ? precipNext6.reduce((sum, item) => sum + item.rain, 0) : null;
  const precipNext6Pop = precipNext6.length && precipNext6.every((item) => finite(item.pop)) ? Math.max(...precipNext6.map((item) => item.pop)) : null;

  const cloudNext6 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 6); i += 1) {
    cloudNext6.push({
      time: hourTimes[i],
      cloud: clampPct(hourly.cloud_cover?.[i])
    });
  }

  const weatherAccent = (code) => {
    if (!finite(code) || !WEATHER_CODES[Number(code)]) return '#7d8b98';
    const c = Number(code);
    if (c >= 95) return '#ff3b5c';
    if ((c >= 61 && c <= 82) || (c >= 51 && c <= 57)) return '#ffb000';
    if (c === 3 || c === 45 || c === 48) return '#00d9ff';
    return '#00ff8a';
  };

  const lat = Number(station?.lat || 0);
  const lng = Number(station?.lng || 0);

  const frameStyle = hosted ? {
    position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 0, resize: 'none', minWidth: 0, minHeight: 0
  } : isMaximized ? {
    position: 'fixed', inset: 0, width: '100vw', height: '100vh', borderRadius: 0, resize: 'none'
  } : {
    position: 'fixed', left: `${windowRect.x}px`, top: `${windowRect.y}px`, width: `${windowRect.width}px`, height: `${windowRect.height}px`,
    minWidth: 'min(320px, calc(100vw - 16px))', minHeight: 'min(320px, calc(100dvh - 16px))',
    maxWidth: 'calc(100vw - 8px)', maxHeight: 'calc(100dvh - 8px)', borderRadius: '12px', resize: 'both'
  };

  const startDrag = (event) => {
    if (hosted || isMaximized || event.button !== 0 || event.target?.closest?.('button, select, input')) return;
    const rect = frameRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setIsDragging(true);
    event.preventDefault();
  };


  const scale = Math.min(1.5, Math.max(1, Number(presentationScale) || 1));
  const overviewAvailable = panelSize.width >= 1080 * scale && bodySize.height >= 620 * scale;
  const activeWeatherTab = weatherTab === 'overview' && !overviewAvailable ? 'now' : weatherTab;
  const metricsColumns = bodySize.width >= 840 * scale ? 5 : bodySize.width >= 430 * scale ? 2 : 1;
  const metricRows = Math.max(1, Math.floor((bodySize.height - 140 * scale) / (54 * scale)));
  const metricPageSize = activeWeatherTab === 'now' && bodySize.width >= 720 * scale ? 11 : Math.min(10, metricsColumns * metricRows);
  const trendColumns = bodySize.width >= 680 * scale ? 2 : 1;
  const trendRows = Math.max(1, Math.floor((bodySize.height - 42) / (180 * scale)));
  const trendPageSize = Math.min(4, trendColumns * trendRows);
  const hourColumns = Math.max(1, Math.min(8, Math.floor(bodySize.width / (126 * scale))));
  const hourRows = Math.max(1, Math.floor((bodySize.height - 60) / (150 * scale)));
  const hourPageSize = Math.max(1, Math.min(8, hourColumns * hourRows));
  const dayColumns = Math.max(1, Math.min(5, Math.floor(bodySize.width / (240 * scale))));
  const dayRows = Math.max(1, Math.floor((bodySize.height - 60) / (106 * scale)));
  const dayPageSize = Math.max(1, Math.min(5, dayColumns * dayRows));
  const pageIndex = (page, total, count) => Math.max(0, Math.min(page, Math.ceil(total / count) - 1));
  const pageItems = (items, page, count) => activeWeatherTab === 'overview' ? items : items.slice(pageIndex(page, items.length, count) * count, (pageIndex(page, items.length, count) + 1) * count);
  const pager = (label, page, setPage, total, count) => {
    if (activeWeatherTab === 'overview' || total <= count) return null;
    const currentPage = pageIndex(page, total, count), pages = Math.ceil(total / count);
    return <div className="weather-pager" aria-label={`${label} pages`}>
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label={`Previous ${label}`}>‹</button>
      <span>{label} · {currentPage * count + 1}–{Math.min(total, (currentPage + 1) * count)} / {total} · {currentPage + 1}/{pages}</span>
      <button type="button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)} aria-label={`Next ${label}`}>›</button>
    </div>;
  };
  const weatherMetrics = [
    ['TEMPERATURE', fmt(current.temperature_2m,1), '°C', temperatureColor(current.temperature_2m), 'temperature-highlight'],
    ['FEELS LIKE', fmt(current.apparent_temperature,1), '°C', temperatureColor(current.apparent_temperature), 'temperature-highlight'],
    ['DEW POINT', fmt(dewPoint,1), '°C', '#7bdcff'],
    ['HUMIDITY', fmt(current.relative_humidity_2m,0), '%', 'var(--cyan)'],
    ['PRESSURE', fmt(current.surface_pressure,0), ' hPa', '#fff'],
    ['VISIBILITY', fmt(visibilityKm,1), ' km', finite(visibilityKm) && Number(visibilityKm) < 5 ? 'var(--gold)' : '#fff'],
    ['WIND', `${windCardinal(current.wind_direction_10m)} ${fmt(current.wind_speed_10m,0)}`, ' km/h', 'var(--cyan)'],
    ['WIND GUST', fmt(current.wind_gusts_10m,0), ' km/h', finite(current.wind_gusts_10m) && Number(current.wind_gusts_10m) >= 40 ? '#ff8a00' : '#fff'],
    ['RAIN NOW', fmt(precipNow,1), ' mm', precipNow > 0 ? '#ff9a00' : '#fff', 'rain-highlight'],
    ['RAIN PROB.', fmt(popNow,0), '%', finite(popNow) && Number(popNow) >= 60 ? 'var(--gold)' : '#fff', 'rain-highlight'],
    ['THUNDERSTORM', thunderstormNow === null ? 'N/A' : thunderstormNow ? 'FORECAST' : 'NOT FORECAST', '', thunderstormNow === null ? '#7d8b98' : thunderstormNow ? 'var(--red)' : 'var(--green)', thunderstormNow ? 'alert-highlight' : '']
  ];

  const metric = (label, value, unit = '', accent = '#fff', extraClass = '') => (
    <div key={label} className={`weather-center-metric ${extraClass}`.trim()}>
      {metricGlyph(label)}
      <span>{label}</span>
      <strong style={{ color: accent }}>{value}{unit}</strong>
    </div>
  );
  const visibleWeatherMetrics = activeWeatherTab === 'overview' ? weatherMetrics.slice(0, 6) : weatherMetrics;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex, pointerEvents: 'none' }}>
      <style>{`
        .weather-center-frame { box-sizing: border-box; overflow: hidden; pointer-events: auto; background: rgba(2,9,16,0.985); border: 2px solid var(--cyan); box-shadow: 0 0 42px rgba(0,234,255,0.24), 0 22px 70px rgba(0,0,0,0.55); display: flex; flex-direction: column; container-type: inline-size; }
        .weather-center-header { height: 66px; flex: 0 0 66px; padding: 0 18px; display: flex; align-items: center; justify-content: space-between; gap: 14px; background: linear-gradient(180deg, rgba(3,25,38,0.98), rgba(2,12,22,0.98)); border-bottom: 1px solid rgba(0,234,255,0.28); user-select: none; }
        .weather-center-title { font-family: Orbitron, sans-serif; font-size: clamp(17px, 2.0cqw, 25px); font-weight: 900; color: var(--cyan); letter-spacing: 1.3px; white-space: nowrap; text-shadow: 0 0 14px rgba(0,234,255,.18); }
        .weather-center-sub { font: 800 clamp(10px,1.0cqw,13px) Rajdhani, sans-serif; color: rgba(255,255,255,0.64); letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .weather-center-btn { width: 44px; height: 38px; border-radius: 6px; cursor: pointer; font: 900 17px Orbitron, sans-serif; background: rgba(0,234,255,0.06); color: var(--cyan); border: 1px solid var(--cyan); }
        .weather-center-body { min-height: 0; flex: 1; overflow: auto; padding: 14px; display: grid; grid-template-rows: minmax(390px, 1fr) auto auto; gap: 12px; scrollbar-width: none; -ms-overflow-style: none; }
        .weather-center-body::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .weather-center-top { min-height: 0; display: grid; grid-template-columns: minmax(470px, 1.18fr) minmax(360px, .82fr); gap: 12px; }
        .weather-center-panel { position: relative; min-width: 0; overflow: hidden; border: 1px solid rgba(0,234,255,0.28); border-radius: 9px; background: linear-gradient(145deg, rgba(0,19,31,0.92), rgba(0,8,16,0.97)); box-shadow: inset 0 0 18px rgba(0,234,255,0.04); }
        .weather-map-shell { position: absolute; inset: 0; overflow: hidden; background: #09161a; }
        .weather-leaflet-host { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; filter: saturate(0.90) brightness(0.70) contrast(1.14); }
        .weather-map-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; background: linear-gradient(180deg, rgba(0,16,27,0.10), rgba(0,4,8,0.04)); }
        .weather-map-label { position: absolute; z-index: 5; top: 12px; left: 12px; padding: 7px 10px; border: 1px solid rgba(0,255,102,0.55); border-radius: 5px; background: rgba(0,12,18,0.84); color: var(--green); font: 900 11px Orbitron, sans-serif; letter-spacing: .9px; pointer-events: none; box-shadow: 0 0 12px rgba(0,255,102,.08); }
        .weather-map-coord { position: absolute; z-index: 5; bottom: 12px; left: 12px; padding: 6px 9px; border-radius: 5px; background: rgba(0,8,14,0.84); color: #fff; font: 800 11px Rajdhani, sans-serif; letter-spacing: .7px; pointer-events: none; }
        .weather-map-actions { position: absolute; z-index: 6; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 4px; }
        .weather-map-actions button { width: 34px; height: 34px; border: 1px solid rgba(0,234,255,0.65); border-radius: 5px; background: rgba(0,12,18,0.90); color: #fff; font: 900 20px/1 Orbitron, sans-serif; cursor: pointer; box-shadow: 0 0 10px rgba(0,234,255,0.12); }
        .weather-map-actions button:hover:not(:disabled) { background: var(--cyan); color: #001018; }
        .weather-map-actions button:disabled { opacity: .38; cursor: default; }
        .weather-map-layers { position: absolute; z-index: 6; top: 12px; right: 54px; display: flex; gap: 5px; }
        .weather-map-layers button { height: 31px; padding: 0 10px; border: 1px solid rgba(0,234,255,0.45); border-radius: 5px; background: rgba(0,12,18,0.88); color: var(--cyan); font: 900 clamp(9px,.78cqw,11px) Orbitron, sans-serif; letter-spacing: .6px; cursor: pointer; }
        .weather-map-layers button.base.active { border-color: var(--green); color: var(--green); box-shadow: 0 0 10px rgba(0,255,102,0.22); }
        .weather-map-layers button.cloud.active { border-color: var(--cyan); color: #001018; background: var(--cyan); box-shadow: 0 0 14px rgba(0,234,255,0.28); }
        .weather-map-layers button.rain.active { border-color: var(--gold); color: #001018; background: var(--gold); box-shadow: 0 0 14px rgba(255,204,0,0.28); }
        .weather-map-layers button.satellite.active { border-color: #d7ecff; color: #001018; background: #d7ecff; box-shadow: 0 0 14px rgba(215,236,255,0.25); }
        .weather-map-layers button:disabled { opacity: .34; cursor: not-allowed; }
        .weather-map-error { position: absolute; z-index: 7; left: 50%; top: 50%; transform: translate(-50%,-50%); padding: 10px 14px; border: 1px solid var(--red); border-radius: 5px; background: rgba(18,0,0,.88); color: #ff7777; font: 900 10px Orbitron, sans-serif; letter-spacing: .7px; pointer-events: none; }
        .weather-map-legend { position: absolute; z-index: 5; right: 55px; bottom: 12px; width: min(255px, 42%); padding: 8px 9px; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; background: rgba(0,8,14,.82); backdrop-filter: blur(4px); pointer-events: none; }
        .weather-map-legend-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; color: rgba(255,255,255,.78); font: 800 clamp(9px,.78cqw,11px) Rajdhani, sans-serif; letter-spacing: .6px; }
        .weather-map-legend-row strong { font: 900 clamp(10px,.88cqw,12px) Orbitron, sans-serif; color: var(--gold); }
        .weather-map-legend small { display: block; margin-top: 5px; color: rgba(255,255,255,.50); font: 800 clamp(8px,.68cqw,10px) Rajdhani, sans-serif; letter-spacing: .45px; }
        .weather-cloud-scale { display: grid; grid-template-columns: repeat(5,1fr); gap: 2px; margin: 5px 0 7px; height: 5px; }
        .weather-cloud-scale i { display: block; border-radius: 3px; background: #24475f; }
        .weather-cloud-scale i:nth-child(2) { background: #4f89a8; }
        .weather-cloud-scale i:nth-child(3) { background: #83b8d0; }
        .weather-cloud-scale i:nth-child(4) { background: #bfd8e6; }
        .weather-cloud-scale i:nth-child(5) { background: #f4fbff; }

        .weather-center-current { padding: 14px; display: flex; flex-direction: column; gap: 10px; overflow: auto; scrollbar-width: none; -ms-overflow-style: none; }
        .weather-center-current::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .weather-current-hero { position: relative; flex: 0 0 auto; min-height: 82px; display: flex; align-items: stretch; justify-content: space-between; gap: 12px; padding: 10px 12px 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; overflow: hidden; background: linear-gradient(112deg,rgba(0,217,255,.08) 0%,rgba(79,137,168,.06) 42%,rgba(191,216,230,.07) 72%,rgba(244,251,255,.07) 100%); }
        .weather-current-hero::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: linear-gradient(90deg,#00d9ff 0 20%,#00ff8a 20% 40%,#ffe600 40% 60%,#ff9800 60% 80%,#ff3b81 80% 100%); opacity: .95; }
        .weather-current-cloud-kicker { color: rgba(255,255,255,.72); font: 900 clamp(10px,.90cqw,12px) Orbitron,sans-serif; letter-spacing: 1px; }
        .weather-current-cloud-row { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 10px; row-gap: 2px; margin-top: 4px; min-width: 0; }
        .weather-current-cloud-value { flex: 0 0 auto; font: 900 clamp(34px,4.25cqw,54px)/.96 Orbitron,sans-serif; letter-spacing: -1.5px; color: #fff; text-shadow: 0 0 12px rgba(255,255,255,.12); white-space: nowrap; }
        .weather-current-cloud-state { min-width: 0; font: 900 clamp(11px,1.05cqw,14px) Orbitron,sans-serif; letter-spacing: .75px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .weather-current-cloud-op { margin-top: 4px; color: rgba(255,255,255,.68); font: 800 clamp(9px,.82cqw,11px) Rajdhani,sans-serif; letter-spacing: .55px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .weather-current-side { flex: 0 0 auto; min-width: 92px; max-width: 118px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; text-align: right; padding-bottom: 5px; }
        .weather-current-icon { font-size: clamp(32px,4.0cqw,48px); line-height: 1; filter: drop-shadow(0 0 12px rgba(255,255,255,0.18)); }
        .weather-current-condition { margin-top: 6px; color: var(--green); font: 900 clamp(10px,.90cqw,12px) Orbitron, sans-serif; letter-spacing: .75px; white-space: nowrap; }
        .weather-center-metrics { flex: 0 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
        .weather-center-metric { min-width: 0; padding: 8px 9px; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; background: rgba(255,255,255,0.025); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .weather-center-metric span { flex: 1 1 auto; min-width: 0; color: rgba(255,255,255,0.66); font: 800 clamp(10px,.90cqw,12px) Rajdhani, sans-serif; letter-spacing: .65px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .weather-center-metric strong { flex: 0 0 auto; max-width: 58%; font: 900 clamp(12px,1.05cqw,14px) Orbitron, sans-serif; white-space: nowrap; text-align: right; }
        .weather-center-metric.temperature-highlight { border-color: rgba(255,255,255,.18); background: linear-gradient(90deg,rgba(255,255,255,.065),rgba(255,255,255,.018)); }
        .weather-center-metric.temperature-highlight strong { font-size: clamp(15px,1.25cqw,17px); }
        .weather-center-metric.cloud-highlight { border-color: rgba(255,204,0,.62); background: linear-gradient(90deg,rgba(255,204,0,.10),rgba(255,204,0,.025)); box-shadow: inset 3px 0 0 rgba(255,204,0,.75); }
        .weather-center-metric.rain-highlight { border-color: rgba(255,128,0,.35); background: rgba(255,128,0,.035); }
        .weather-center-metric.alert-highlight { border-color: rgba(255,51,81,.40); background: rgba(255,51,81,.035); }

        .weather-ops-grid { flex: 0 0 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: minmax(112px,1fr); gap: 8px; }
        .weather-ops-card { position: relative; min-width: 0; min-height: 0; padding: 9px; border-radius: 7px; border: 1px solid rgba(0,234,255,.20); background: linear-gradient(145deg,rgba(0,18,30,.86),rgba(0,8,16,.92)); overflow: hidden; }
        .weather-ops-card.cloud-card { border-color: rgba(191,216,230,.34); }
        .weather-ops-card.rain-card { border-color: rgba(255,128,0,.30); }
        .weather-ops-card.wind-card { border-color: rgba(0,234,255,.30); }
        .weather-ops-card.history-card { border-color: rgba(202,0,255,.24); }
        .weather-ops-title { color: rgba(255,255,255,.78); font: 900 clamp(9px,.82cqw,11px) Orbitron,sans-serif; letter-spacing: .6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .weather-cloud-card-body { height: calc(100% - 18px); display: grid; grid-template-rows: auto minmax(0,1fr); gap: 6px; align-items: stretch; }
        .weather-cloud-trend-legend { display: grid; grid-template-columns: auto minmax(70px,1fr) auto; align-items: center; gap: 6px; color: rgba(255,255,255,.56); font: 800 clamp(8px,.64cqw,9px) Rajdhani,sans-serif; letter-spacing: .35px; }
        .weather-cloud-gradient { height: 6px; border-radius: 5px; margin: 0; background: linear-gradient(90deg,#24475f 0 20%,#4f89a8 20% 40%,#83b8d0 40% 60%,#bfd8e6 60% 80%,#f4fbff 80% 100%); box-shadow: 0 0 9px rgba(255,255,255,.06); }
        .weather-cloud-trend { height: 70px; display: flex; align-items: flex-end; gap: 4px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .weather-cloud-trend-wrap { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
        .weather-cloud-trend-value { margin-bottom: 2px; text-align: center; color: #fff; font: 900 clamp(8px,.66cqw,10px) Orbitron,sans-serif; line-height: 1; white-space: nowrap; }
        .weather-cloud-trend-bar { min-height: 4px; border-radius: 3px 3px 0 0; box-shadow: 0 0 6px color-mix(in srgb,currentColor 25%,transparent); }
        .weather-cloud-trend-time { margin-top: 3px; text-align: center; color: rgba(255,255,255,.58); font: 800 clamp(7px,.60cqw,9px) Rajdhani,sans-serif; }
        .weather-mini-bars { height: 68px; display: flex; align-items: flex-end; gap: 4px; margin-top: 6px; }
        .weather-mini-bar-wrap { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; }
        .weather-mini-bar { min-height: 3px; border-radius: 3px 3px 1px 1px; background: linear-gradient(180deg,#ff3b5c,#ffb000 58%,#00d9ff); box-shadow: 0 0 7px rgba(255,176,0,.12); }
        .weather-mini-bar-time { margin-top: 3px; text-align: center; color: rgba(255,255,255,.58); font: 800 clamp(8px,.62cqw,9px) Rajdhani,sans-serif; }
        .weather-rain-summary { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 4px; }
        .weather-rain-summary strong { color: var(--gold); font: 900 12px Orbitron,sans-serif; }
        .weather-rain-summary span { color: rgba(255,255,255,.62); font: 800 clamp(8px,.66cqw,10px) Rajdhani,sans-serif; }
        .weather-wind-body { height: calc(100% - 18px); display: grid; grid-template-columns: 88px 1fr; gap: 8px; align-items: center; }
        .weather-compass { position: relative; width: 78px; height: 78px; margin: auto; border: 1px solid rgba(0,234,255,.38); border-radius: 50%; box-shadow: inset 0 0 18px rgba(0,234,255,.08); }
        .weather-compass .cardinal { position: absolute; color: rgba(255,255,255,.78); font: 900 clamp(8px,.66cqw,10px) Orbitron,sans-serif; }
        .weather-compass .n { top: 2px; left: 50%; transform: translateX(-50%); }
        .weather-compass .s { bottom: 2px; left: 50%; transform: translateX(-50%); }
        .weather-compass .w { left: 4px; top: 50%; transform: translateY(-50%); }
        .weather-compass .e { right: 4px; top: 50%; transform: translateY(-50%); }
        .weather-compass-arrow { position: absolute; inset: 13px; transform-origin: 50% 50%; display: flex; align-items: flex-start; justify-content: center; }
        .weather-compass-arrow::before { content: ''; width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 19px solid var(--cyan); filter: drop-shadow(0 0 6px rgba(0,234,255,.35)); }
        .weather-wind-copy strong { display: block; color: var(--cyan); font: 900 15px Orbitron,sans-serif; }
        .weather-wind-copy span { display: block; margin-top: 5px; color: rgba(255,255,255,.66); font: 800 clamp(8px,.68cqw,10px) Rajdhani,sans-serif; line-height: 1.35; }
        .weather-history-bars { height: 68px; display: flex; align-items: flex-end; gap: 5px; margin-top: 7px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .weather-history-bar { flex: 1; min-width: 0; border-radius: 3px 3px 0 0; background: linear-gradient(180deg,#c000ff,#00d9ff); box-shadow: 0 0 7px rgba(192,0,255,.10); }
        .weather-history-summary { display: flex; justify-content: space-between; gap: 8px; margin-top: 5px; color: rgba(255,255,255,.62); font: 800 clamp(8px,.66cqw,10px) Rajdhani,sans-serif; }
        .weather-history-summary strong { color: #e9a6ff; font: 900 clamp(10px,.78cqw,12px) Orbitron,sans-serif; }

        .weather-strip { display: grid; grid-template-columns: repeat(8, minmax(88px,1fr)); gap: 7px; }
        .weather-hour { min-width: 0; padding: 9px 6px; border: 1px solid rgba(0,234,255,0.16); border-top-width: 2px; border-radius: 7px; background: rgba(0,18,30,0.74); text-align: center; box-shadow: inset 0 0 10px rgba(0,234,255,.02); }
        .weather-hour time { display: block; color: var(--cyan); font: 900 clamp(10px,.80cqw,12px) Orbitron, sans-serif; }
        .weather-hour .ico { font-size: 21px; line-height: 1.15; margin: 5px 0; }
        .weather-hour strong { display: block; font: 900 clamp(16px,1.45cqw,19px) Orbitron, sans-serif; text-shadow: 0 0 8px currentColor; }
        .weather-hour small { display: block; margin-top: 4px; color: rgba(255,255,255,0.68); font: 800 clamp(9px,.72cqw,11px) Rajdhani, sans-serif; line-height: 1.25; }
        .weather-days { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
        .weather-day { min-width: 0; padding: 10px; border: 1px solid rgba(0,255,102,0.16); border-left-width: 2px; border-radius: 7px; background: linear-gradient(145deg,rgba(0,22,23,0.68),rgba(0,13,20,.68)); display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; }
        .weather-day .ico { grid-row: 1 / span 2; font-size: 27px; }
        .weather-day strong { color: #fff; font: 900 clamp(11px,.84cqw,13px) Orbitron, sans-serif; white-space: nowrap; }
        .weather-day small { color: rgba(255,255,255,0.70); font: 800 clamp(9px,.70cqw,11px) Rajdhani, sans-serif; line-height: 1.25; }
        .weather-section-label { margin: 0 0 7px; color: rgba(255,255,255,0.74); font: 900 clamp(10px,.82cqw,12px) Orbitron, sans-serif; letter-spacing: .85px; }
        .weather-center-footer { height: 29px; flex: 0 0 29px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-top: 1px solid rgba(0,234,255,0.18); color: rgba(255,255,255,0.52); font: 800 clamp(9px,.66cqw,10px) Rajdhani, sans-serif; letter-spacing: .55px; }
        @container (max-width: 980px) {
          .weather-center-body { grid-template-rows: minmax(360px,1fr) auto auto; }
          .weather-center-top { grid-template-columns: minmax(440px,1.12fr) minmax(330px,.88fr); }
          .weather-ops-grid { grid-auto-rows: minmax(100px,1fr); }
          .weather-cloud-trend { height: 62px; }
          .weather-current-cloud-value { font-size: clamp(32px,4.0cqw,48px); }
          .weather-current-side { min-width: 82px; max-width: 100px; }
          .weather-center-metric strong { max-width: 54%; font-size: clamp(12px,1.0cqw,14px); }
          .weather-center-metric.temperature-highlight strong { font-size: clamp(15px,1.2cqw,17px); }
          .weather-compass { width: 66px; height: 66px; }
          .weather-wind-body { grid-template-columns: 72px 1fr; }
        }
        @container (max-width: 900px) { .weather-center-top { grid-template-columns: 1fr; grid-template-rows: 300px auto; } .weather-strip { grid-template-columns: repeat(4, 1fr); } .weather-days { grid-template-columns: repeat(3, 1fr); } }
        @container (max-width: 680px) { .weather-center-header { padding: 0 10px; } .weather-center-sub { display: none; } .weather-center-body { padding: 8px; } .weather-center-top { grid-template-rows: 250px auto; } .weather-center-metrics { grid-template-columns: 1fr; } .weather-ops-grid { grid-template-columns: 1fr; } .weather-strip { grid-template-columns: repeat(2, 1fr); } .weather-days { grid-template-columns: 1fr 1fr; } .weather-map-legend { display:none; } }
        @media (max-height: 900px) {
          .weather-center-header { height: 58px; flex-basis: 58px; padding: 0 14px; }
          .weather-center-body { padding: 10px; gap: 8px; grid-template-rows: minmax(315px,1fr) auto auto; }
          .weather-center-top { gap: 8px; }
          .weather-center-current { padding: 10px; gap: 7px; }
          .weather-current-hero { min-height: 74px; padding-bottom: 7px; }
          .weather-current-cloud-value { font-size: clamp(30px,3.8cqw,46px); }
          .weather-current-icon { font-size: clamp(30px,3.8cqw,44px); }
          .weather-center-metrics { gap: 5px; }
          .weather-center-metric { padding: 6px 8px; }
          .weather-ops-grid { grid-auto-rows: minmax(92px,1fr); gap: 6px; }
          .weather-ops-card { padding: 7px; }
          .weather-cloud-card-body { grid-template-rows: auto minmax(0,1fr); gap: 5px; }
          .weather-cloud-trend { height: 52px; }
          .weather-mini-bars, .weather-history-bars { height: 53px; }
          .weather-compass { width: 60px; height: 60px; }
          .weather-wind-body { grid-template-columns: 66px 1fr; gap: 6px; }
          .weather-strip { gap: 5px; }
          .weather-hour { padding: 7px 5px; }
          .weather-day { padding: 8px; gap: 6px 8px; }
          .weather-section-label { margin-bottom: 5px; }
        }
        /* A bounded dashboard on large hosts; explicit views on compact hosts. */
        .weather-center-frame { container-name: weather; }
        .weather-center-header { height: auto; min-height: 62px; flex: 0 0 auto; padding: 9px 12px; flex-wrap: wrap; gap: 7px 12px; }
        .weather-center-header > div:first-child { flex: 1 1 200px; }
        .weather-center-title { font-size: calc(clamp(16px, 1.8cqw, 24px) * var(--sat-text-scale,1)); white-space: normal; line-height: 1.2; }
        .weather-center-sub { display: block; font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.25; white-space: normal; overflow: visible; text-overflow: clip; margin-top: 4px; }
        .weather-window-controls { flex: 0 0 auto; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
        .weather-center-btn { width: 34px; height: 34px; flex-shrink: 0; }
        .weather-view-tabs { flex: 0 0 auto; display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; padding: 5px 8px; border-bottom: 1px solid #23404b; background: #03111b; }
        .weather-view-tabs button, .weather-pager button { border: 1px solid #356174; border-radius: 4px; background: #0a2432; color: #c7f7ff; padding: 5px 9px; cursor: pointer; font: 800 calc(12px * var(--sat-text-scale,1))/1.1 Rajdhani,Arial,sans-serif; min-height: 30px; }
        .weather-view-tabs button.active { border-color: var(--cyan); background: #104050; color: #fff; }
        .weather-pager { flex: 0 0 auto; min-height: 32px; display: flex; justify-content: center; align-items: center; gap: 9px; padding-top: 5px; font: 700 calc(12px * var(--sat-text-scale,1)) Rajdhani,Arial,sans-serif; color: #c4e6ef; }
        .weather-pager button { min-width: 32px; font-size: 20px; padding: 2px 7px; }
        .weather-pager button:disabled { opacity: .35; cursor: default; }
        .weather-center-body { flex: 1 1 0; min-height: 0; min-width: 0; overflow: hidden; padding: 8px; display: grid; grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(0,1fr); gap: 0; }
        .weather-center-top, .weather-center-current { display: contents; }
        .weather-map-panel, .weather-current-hero, .weather-metrics-section, .weather-trends-section, .weather-hours-section, .weather-days-section, .weather-current-feedback { display: none; }
        .weather-center-frame[data-view="map"] .weather-map-panel { display: block; grid-area: 1 / 1; min-height: 0; }
        .weather-center-frame[data-view="now"] .weather-center-body { grid-template-rows: auto minmax(0,1fr); gap: 8px; }
        .weather-center-frame[data-view="now"] .weather-current-hero { display: flex; grid-area: 1 / 1; }
        .weather-center-frame[data-view="now"] .weather-metrics-section { display: flex; flex-direction: column; grid-area: 2 / 1; min-height: 0; }
        .weather-center-frame[data-view="now"] .weather-current-feedback { display: block; grid-area: 1 / 1 / -1 / -1; }
        .weather-center-frame[data-view="trends"] .weather-trends-section,
        .weather-center-frame[data-view="hours"] .weather-hours-section,
        .weather-center-frame[data-view="days"] .weather-days-section { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
        .weather-center-frame[data-view="trends"] .weather-current-feedback { display: block; grid-area: 1 / 1 / -1 / -1; }
        .weather-current-hero { min-height: 0; padding: 8px 10px; gap: 8px; align-items: center; }
        .weather-current-cloud-kicker { font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.25; }
        .weather-current-cloud-value { font-size: calc(clamp(28px,3.3cqw,46px) * var(--sat-text-scale,1)); }
        .weather-current-cloud-state { font-size: calc(12px * var(--sat-text-scale,1)); white-space: normal; text-overflow: clip; overflow: visible; }
        .weather-current-cloud-op { font-size: calc(11px * var(--sat-text-scale,1)); white-space: normal; text-overflow: clip; overflow: visible; line-height: 1.2; }
        .weather-current-side { min-width: 66px; max-width: 112px; }
        .weather-current-icon { font-size: 32px; }
        .weather-current-condition { font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.2; white-space: normal; }
        .weather-center-metrics { flex: 1 1 0; min-height: 0; grid-template-columns: repeat(var(--weather-metric-cols,2),minmax(0,1fr)); grid-auto-rows: minmax(0,1fr); gap: 6px; }
        .weather-center-metric { flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; padding: 6px 8px; min-width: 0; min-height: 0; }
        .weather-center-metric span { flex: 0 0 auto; font-size: calc(12px * var(--sat-text-scale,1)); white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.1; }
        .weather-center-metric strong, .weather-center-metric.temperature-highlight strong { flex: 0 0 auto; max-width: 100%; font-size: calc(14px * var(--sat-text-scale,1)); line-height: 1.2; text-align: left; white-space: normal; }
        .weather-ops-grid { flex: 1 1 0; min-height: 0; grid-template-columns: repeat(var(--weather-trend-cols,2),minmax(0,1fr)); grid-auto-rows: minmax(0,1fr); gap: 8px; }
        .weather-ops-card { display: flex; flex-direction: column; min-height: 0; padding: 8px; }
        .weather-ops-card[hidden] { display: none!important; }
        .weather-ops-title { flex: 0 0 auto; font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.2; white-space: normal; overflow: visible; text-overflow: clip; }
        .weather-cloud-card-body { height: auto; flex: 1 1 0; min-height: 0; grid-template-rows: auto minmax(0,1fr); gap: 5px; padding-top: 5px; }
        .weather-cloud-trend, .weather-mini-bars, .weather-history-bars { height: auto; min-height: 0; flex: 1 1 0; }
        .weather-cloud-trend-legend, .weather-cloud-trend-time, .weather-mini-bar-time, .weather-rain-summary span, .weather-history-summary, .weather-wind-copy span { font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.15; }
        .weather-cloud-trend-value, .weather-rain-summary strong, .weather-history-summary strong { font-size: calc(12px * var(--sat-text-scale,1)); line-height: 1.2; }
        .weather-rain-summary { flex-wrap: wrap; gap: 3px 8px; flex: 0 0 auto; }
        .weather-history-summary { flex: 0 0 auto; }
        .weather-wind-body { height: auto; flex: 1 1 0; min-height: 0; grid-template-columns: 72px minmax(0,1fr); gap: 8px; }
        .weather-compass { width: 66px; height: 66px; }
        .weather-wind-copy { min-width: 0; }
        .weather-wind-copy strong { font-size: calc(14px * var(--sat-text-scale,1)); }
        .weather-strip { flex: 1 1 0; min-height: 0; grid-template-columns: repeat(var(--weather-hour-cols,4),minmax(0,1fr)); grid-auto-rows: minmax(0,1fr); gap: 7px; }
        .weather-hour { padding: 8px 6px; display: flex; flex-direction: column; justify-content: space-evenly; min-height: 0; }
        .weather-hour time { font-size: calc(12px * var(--sat-text-scale,1)); }
        .weather-hour .ico { font-size: 25px; margin: 3px 0; }
        .weather-hour strong { font-size: calc(18px * var(--sat-text-scale,1)); }
        .weather-hour small { font-size: calc(12px * var(--sat-text-scale,1)); line-height: 1.3; }
        .weather-days { flex: 1 1 0; min-height: 0; grid-template-columns: repeat(var(--weather-day-cols,2),minmax(0,1fr)); grid-auto-rows: minmax(0,1fr); gap: 8px; }
        .weather-day { padding: 8px; gap: 4px 8px; min-height: 0; grid-template-columns: 30px minmax(0,1fr); }
        .weather-day strong { font-size: calc(12px * var(--sat-text-scale,1)); white-space: normal; line-height: 1.2; }
        .weather-day small { font-size: calc(12px * var(--sat-text-scale,1)); line-height: 1.25; }
        .weather-section-label { flex: 0 0 auto; font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.2; margin-bottom: 7px; }
        .weather-center-footer { height: auto; min-height: 28px; flex: 0 0 auto; flex-wrap: wrap; gap: 3px 12px; padding: 5px 10px; font-size: calc(10px * var(--sat-text-scale,1)); line-height: 1.2; letter-spacing: .2px; }
        .weather-center-footer > span:first-child { flex: 1 1 580px; min-width: 0; }
        .weather-center-footer > span:last-child { flex: 0 1 auto; }
        .weather-center-frame[data-view="overview"] .weather-center-body { grid-template-columns: repeat(12,minmax(0,1fr)); grid-template-rows: minmax(calc(96px * var(--sat-text-scale,1)),.8fr) minmax(calc(104px * var(--sat-text-scale,1)),1fr) minmax(calc(128px * var(--sat-text-scale,1)),1.2fr) minmax(calc(128px * var(--sat-text-scale,1)),1fr) minmax(calc(104px * var(--sat-text-scale,1)),.8fr); gap: 8px; }
        .weather-center-frame[data-view="overview"] .weather-map-panel { display: block; grid-column: 1 / 5; grid-row: 1 / 3; }
        .weather-center-frame[data-view="overview"] .weather-current-hero { display: flex; grid-column: 5 / -1; grid-row: 1; }
        .weather-center-frame[data-view="overview"] .weather-metrics-section { display: flex; grid-column: 5 / -1; grid-row: 2; }
        .weather-center-frame[data-view="overview"] .weather-center-metrics { grid-template-columns: repeat(5,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-center-metric strong { font-size: calc(12px * var(--sat-text-scale,1)); }
        .weather-center-frame[data-view="overview"] .weather-trends-section { display: flex; grid-column: 1 / -1; grid-row: 3; }
        .weather-center-frame[data-view="overview"] .weather-ops-grid { grid-template-columns: repeat(4,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-hours-section { display: flex; flex-direction: column; grid-column: 1 / -1; grid-row: 4; }
        .weather-center-frame[data-view="overview"] .weather-strip { grid-template-columns: repeat(8,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-days-section { display: flex; flex-direction: column; grid-column: 1 / -1; grid-row: 5; }
        .weather-center-frame[data-view="overview"] .weather-days { grid-template-columns: repeat(5,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-hour { padding: 5px; }
        .weather-center-frame[data-view="overview"] .weather-hour .ico { font-size: 20px; margin: 1px 0; }
        .weather-center-frame[data-view="overview"] .weather-hour strong { font-size: calc(16px * var(--sat-text-scale,1)); }
        .weather-center-frame[data-view="overview"] .weather-hour small, .weather-center-frame[data-view="overview"] .weather-day small { font-size: calc(11px * var(--sat-text-scale,1)); }
        .weather-center-frame[data-view="overview"] .weather-day { padding: 5px; gap: 3px 6px; }
        .weather-center-frame[data-view="overview"] .weather-day .ico { font-size: 22px; }
        .weather-center-frame[data-view="overview"] .weather-current-feedback { display: block; grid-column: 5 / -1; grid-row: 1 / 3; }
        .weather-map-label { top: 8px; left: 8px; right: 8px; width: fit-content; max-width: calc(100% - 16px); box-sizing: border-box; font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.2; padding: 5px 7px; }
        .weather-map-actions { top: 44px; right: 8px; }
        .weather-map-layers { top: 44px; left: 8px; right: 48px; flex-wrap: wrap; justify-content: flex-start; }
        .weather-map-layers button { font-size: calc(10px * var(--sat-text-scale,1)); height: 30px; padding: 0 6px; }
        .weather-map-coord { left: 8px; right: 8px; bottom: 4px; font-size: calc(11px * var(--sat-text-scale,1)); line-height: 1.15; padding: 4px 6px; }
        .weather-map-legend { display: block; right: 8px; bottom: 36px; width: min(225px,55%); padding: 5px 7px; }
        .weather-map-legend-row { font-size: calc(11px * var(--sat-text-scale,1)); }
        .weather-map-legend-row strong { font-size: calc(12px * var(--sat-text-scale,1)); }
        .weather-map-legend small { font-size: calc(10px * var(--sat-text-scale,1)); line-height: 1.15; }
        .weather-cloud-scale { margin: 3px 0; }
        .weather-map-error { max-width: calc(100% - 24px); font-size: calc(11px * var(--sat-text-scale,1)); text-align: center; }
        .weather-center-frame[data-view="overview"] .weather-map-legend { bottom: 31px; width: 155px; padding: 4px; }
        .weather-center-frame[data-view="overview"] .weather-map-legend small { display: none; }
        @container weather (max-width: 560px) {
          .weather-center-header { padding: 7px 9px; gap: 6px; }
          .weather-center-header > div:first-child { flex-basis: 100%; }
          .weather-window-controls { width: 100%; justify-content: flex-end; }
          .weather-center-title { font-size: calc(16px * var(--sat-text-scale,1)); }
          .weather-center-sub { font-size: calc(10px * var(--sat-text-scale,1)); }
          .weather-current-side { min-width: 58px; max-width: 85px; }
          .weather-current-icon { font-size: 27px; }
        }
        /* WEATHER CENTER MASTER v1.2 — Ground Station Operational Weather Dashboard */
        .weather-center-frame { --wx-gap: clamp(7px,.62cqw,12px); --wx-card: rgba(4,18,29,.86); --wx-border: rgba(0,234,255,.18); }
        .weather-center-header { min-height: 68px; padding: 10px clamp(12px,1.25cqw,22px); }
        .weather-center-title { font-size: calc(clamp(22px,2.0cqw,31px) * var(--sat-text-scale,1)); }
        .weather-center-sub { font-size: calc(clamp(11px,.86cqw,14px) * var(--sat-text-scale,1)); letter-spacing:.75px; }
        .weather-view-tabs { gap: clamp(6px,.55cqw,10px); padding: 8px 10px; }
        .weather-view-tabs button { min-height: 38px; padding: 7px clamp(10px,1.05cqw,17px); border-radius: 6px; font: 900 calc(clamp(13px,.9cqw,16px) * var(--sat-text-scale,1))/1 Orbitron,Arial,sans-serif; letter-spacing:.45px; display:inline-flex; align-items:center; gap:7px; }
        .weather-view-tabs button.active { background: linear-gradient(180deg,#125066,#0b3444); box-shadow: 0 0 14px rgba(0,234,255,.18), inset 0 -3px 0 var(--cyan); }
        .weather-tab-glyph { color: var(--cyan); font-size: 1.08em; }
        .weather-center-body { padding: var(--wx-gap); }
        .weather-map-valid { position:absolute; z-index:5; left:12px; bottom:42px; padding:5px 8px; border-radius:5px; background:rgba(0,8,14,.84); border:1px solid rgba(0,234,255,.28); color:#dffbff; font:900 10px Orbitron,sans-serif; letter-spacing:.6px; pointer-events:none; }
        .weather-map-panel { box-shadow: inset 0 0 25px rgba(0,234,255,.05); }
        .weather-map-label { font-size: calc(clamp(11px,.82cqw,14px) * var(--sat-text-scale,1)); }
        .weather-map-layers button { min-height: 34px; font-size: calc(clamp(10px,.72cqw,13px) * var(--sat-text-scale,1)); }
        .weather-map-coord,.weather-map-legend-row,.weather-map-legend small { font-size: calc(clamp(10px,.72cqw,13px) * var(--sat-text-scale,1)); }
        .weather-current-hero { background: radial-gradient(circle at 78% 25%,rgba(0,234,255,.08),transparent 34%), linear-gradient(112deg,rgba(0,217,255,.08),rgba(5,18,29,.92)); min-height: 102px; padding: 12px 15px 15px; }
        .weather-current-cloud-kicker { font-size: calc(clamp(12px,.9cqw,15px) * var(--sat-text-scale,1)); }
        .weather-current-cloud-value { font-size: calc(clamp(40px,4.5cqw,68px) * var(--sat-text-scale,1)); }
        .weather-current-cloud-state { font-size: calc(clamp(13px,1.05cqw,17px) * var(--sat-text-scale,1)); }
        .weather-current-cloud-op { font-size: calc(clamp(10px,.76cqw,13px) * var(--sat-text-scale,1)); }
        .weather-current-icon .weather-glyph,.weather-current-side .weather-glyph { width:52px; height:52px; color:#fff; filter: drop-shadow(0 0 12px rgba(255,255,255,.16)); }
        .weather-current-condition { font-size: calc(clamp(11px,.86cqw,14px) * var(--sat-text-scale,1)); }
        .weather-current-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px; }
        .weather-data-badge,.weather-impact-badge { padding:4px 7px; border-radius:4px; border:1px solid rgba(255,255,255,.16); font:900 calc(10px * var(--sat-text-scale,1)) Orbitron,sans-serif; letter-spacing:.45px; }
        .weather-data-badge.current { color:var(--green); border-color:rgba(0,255,102,.4); background:rgba(0,255,102,.06); }
        .weather-data-badge.stale { color:var(--gold); border-color:rgba(255,204,0,.45); background:rgba(255,204,0,.06); }
        .weather-impact-badge.normal { color:var(--green); border-color:rgba(0,255,102,.35); }
        .weather-impact-badge.caution { color:var(--gold); border-color:rgba(255,204,0,.45); }
        .weather-impact-badge.risk { color:#ff5a67; border-color:rgba(255,90,103,.5); }
        .weather-center-metrics { gap: var(--wx-gap); }
        .weather-center-metric { position:relative; overflow:hidden; align-items:flex-start; justify-content:center; min-height:78px; padding:10px 11px 10px 48px; border-color:var(--wx-border); background:linear-gradient(145deg,rgba(6,24,37,.92),rgba(3,12,21,.92)); }
        .weather-metric-glyph { position:absolute; left:11px; top:50%; transform:translateY(-50%); width:27px; height:27px; display:flex; align-items:center; justify-content:center; border:1px solid rgba(0,234,255,.38); border-radius:50%; color:var(--cyan); font:900 9px Orbitron,sans-serif; box-shadow:0 0 12px rgba(0,234,255,.08); }
        .weather-center-metric span:not(.weather-metric-glyph) { font-size:calc(clamp(11px,.8cqw,14px) * var(--sat-text-scale,1)); letter-spacing:.55px; }
        .weather-center-metric strong,.weather-center-metric.temperature-highlight strong { font-size:calc(clamp(17px,1.35cqw,23px) * var(--sat-text-scale,1)); }
        .weather-section-label { font-size:calc(clamp(12px,.88cqw,15px) * var(--sat-text-scale,1)); letter-spacing:.75px; }
        .weather-glyph { width:1em; height:1em; display:inline-block; vertical-align:middle; }
        .weather-hour .ico .weather-glyph { width:34px; height:34px; color:#fff; }
        .weather-day .ico .weather-glyph { width:42px; height:42px; color:#fff; }
        .weather-trend-card { min-width:0; min-height:0; padding:10px 12px; border:1px solid var(--wx-border); border-radius:8px; background:linear-gradient(145deg,rgba(5,21,33,.94),rgba(2,10,18,.96)); display:flex; flex-direction:column; gap:7px; }
        .weather-trend-head { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
        .weather-trend-title { color:#e9fbff; font:900 calc(clamp(11px,.8cqw,14px) * var(--sat-text-scale,1)) Orbitron,sans-serif; letter-spacing:.55px; }
        .weather-trend-stats { text-align:right; color:#a9c7d3; font:800 calc(clamp(9px,.68cqw,11px) * var(--sat-text-scale,1)) Rajdhani,sans-serif; line-height:1.2; }
          .weather-number-trends { align-items:stretch; }
          .weather-number-card { display:flex; flex-direction:column; justify-content:flex-start; min-height:0; padding:clamp(12px,1.1cqw,18px); }
          .weather-number-main { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:clamp(10px,1.4cqh,18px) 0; border-bottom:1px solid rgba(0,234,255,.16); padding-bottom:clamp(9px,1.2cqh,15px); }
          .weather-number-main strong { color:#f4fbff; font:900 calc(clamp(28px,3.0cqw,52px) * var(--sat-text-scale,1))/1 Orbitron,sans-serif; font-variant-numeric:tabular-nums; }
          .weather-number-main span { color:#8fb1bd; font:800 calc(clamp(11px,1.0cqw,15px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; letter-spacing:.7px; text-align:right; }
          .weather-number-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; flex:1; }
          .weather-number-grid > span, .weather-summary-grid > span { min-width:0; border:1px solid rgba(0,234,255,.16); border-radius:7px; background:linear-gradient(145deg,rgba(3,17,27,.86),rgba(1,12,20,.72)); padding:clamp(9px,1cqw,14px); display:flex; flex-direction:column; justify-content:center; gap:5px; }
          .weather-number-grid small, .weather-summary-grid small { color:#7f9da8; font:800 calc(clamp(10px,.9cqw,13px) * var(--sat-text-scale,1))/1.1 Rajdhani,sans-serif; letter-spacing:.6px; }
          .weather-number-grid b, .weather-summary-grid strong { color:#ecfaff; font:900 calc(clamp(15px,1.45cqw,23px) * var(--sat-text-scale,1))/1.05 Orbitron,sans-serif; font-variant-numeric:tabular-nums; }
          .weather-summary-panel { height:auto; min-height:0; }
          .weather-summary-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; padding:8px 10px 10px; }
          .weather-summary-grid-5 { grid-template-columns:repeat(5,minmax(0,1fr)); }
          .weather-summary-grid .normal { border-color:rgba(0,255,102,.45); } .weather-summary-grid .normal strong { color:var(--green); }
          .weather-summary-grid .caution { border-color:rgba(255,204,0,.45); } .weather-summary-grid .caution strong { color:var(--gold); }
          .weather-summary-grid .risk { border-color:rgba(255,51,51,.45); } .weather-summary-grid .risk strong { color:var(--red); }
          @container (max-width:900px) { .weather-summary-grid, .weather-summary-grid-5 { grid-template-columns:repeat(2,minmax(0,1fr)); } .weather-number-grid { gap:6px; } }
        .weather-24-timeline,.weather-5day-summary { flex:0 0 28%; min-height:110px; display:grid; grid-template-columns:minmax(0,1fr); gap:5px; padding:8px 10px; border:1px solid var(--wx-border); border-radius:8px; background:rgba(3,14,24,.82); }
        .weather-timeline-title { display:flex; justify-content:space-between; align-items:center; gap:8px; color:#dffaff; font:900 calc(11px * var(--sat-text-scale,1)) Orbitron,sans-serif; }
        .weather-strip { flex:1 1 0; min-height:0; }
        .weather-hour { min-height:0; padding:9px 7px; background:linear-gradient(180deg,rgba(4,24,38,.92),rgba(2,12,21,.92)); }
        .weather-hour time { font-size:calc(clamp(12px,.82cqw,15px) * var(--sat-text-scale,1)); }
        .weather-hour strong { font-size:calc(clamp(20px,1.45cqw,27px) * var(--sat-text-scale,1)); }
        .weather-hour small { font-size:calc(clamp(10px,.76cqw,13px) * var(--sat-text-scale,1)); }
        .weather-days { flex:1 1 0; min-height:0; }
        .weather-day { position:relative; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-start; gap:8px; padding:12px; border-left-width:3px; background:linear-gradient(155deg,rgba(4,24,30,.92),rgba(2,12,20,.95)); }
        .weather-day-top { width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; }
        .weather-day strong { font-size:calc(clamp(13px,.9cqw,16px) * var(--sat-text-scale,1)); }
        .weather-day-temp { font:900 calc(clamp(25px,2.0cqw,34px) * var(--sat-text-scale,1)) Orbitron,sans-serif; color:#fff; }
        .weather-day-condition { color:#cfe9f2; font:800 calc(clamp(11px,.76cqw,13px) * var(--sat-text-scale,1)) Rajdhani,sans-serif; }
        .weather-day-details { color:#a9bec8; font:800 calc(clamp(10px,.7cqw,12px) * var(--sat-text-scale,1)) Rajdhani,sans-serif; line-height:1.35; }
        .weather-day-impact { align-self:flex-start; }
        .weather-center-footer { font-size:calc(clamp(9px,.62cqw,11px) * var(--sat-text-scale,1)); }
        .weather-center-frame[data-view="overview"] .weather-center-body { grid-template-columns:repeat(12,minmax(0,1fr)); grid-template-rows:minmax(112px,.55fr) minmax(190px,1.2fr) minmax(170px,.95fr) minmax(150px,.8fr); gap:var(--wx-gap); }
        .weather-center-frame[data-view="overview"] .weather-map-panel { grid-column:1 / 7; grid-row:1 / 3; }
        .weather-center-frame[data-view="overview"] .weather-current-hero { grid-column:7 / -1; grid-row:1; }
        .weather-center-frame[data-view="overview"] .weather-metrics-section { grid-column:7 / -1; grid-row:2; }
        .weather-center-frame[data-view="overview"] .weather-center-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-trends-section { grid-column:1 / -1; grid-row:3; }
        .weather-center-frame[data-view="overview"] .weather-ops-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
        .weather-center-frame[data-view="overview"] .weather-hours-section { grid-column:1 / -1; grid-row:4; }
        .weather-center-frame[data-view="overview"] .weather-days-section { display:none; }
        .weather-center-frame[data-view="now"] .weather-center-body { grid-template-rows:auto minmax(0,1fr); }
        .weather-center-frame[data-view="now"] .weather-center-metrics { grid-template-columns:repeat(4,minmax(0,1fr)); grid-template-rows:repeat(3,minmax(0,1fr)); }
        .weather-center-frame[data-view="trends"] .weather-ops-grid { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); }
        .weather-center-frame[data-view="hours"] .weather-hours-section { gap:8px; }
        .weather-center-frame[data-view="hours"] .weather-strip { flex-basis:62%; }
        .weather-center-frame[data-view="days"] .weather-days-section { gap:8px; }
        .weather-center-frame[data-view="days"] .weather-days { grid-template-columns:repeat(5,minmax(0,1fr)); }
        @container weather (max-width: 980px) {
          .weather-center-frame[data-view="overview"] .weather-center-body { grid-template-rows:minmax(230px,.95fr) minmax(180px,.8fr) minmax(160px,.7fr); }
          .weather-center-frame[data-view="overview"] .weather-map-panel { grid-column:1 / 7; grid-row:1; }
          .weather-center-frame[data-view="overview"] .weather-current-hero { grid-column:7 / -1; grid-row:1; }
          .weather-center-frame[data-view="overview"] .weather-metrics-section { grid-column:1 / -1; grid-row:2; }
          .weather-center-frame[data-view="overview"] .weather-trends-section { display:none; }
          .weather-center-frame[data-view="overview"] .weather-hours-section { grid-row:3; }
          .weather-center-frame[data-view="now"] .weather-center-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); grid-auto-rows:minmax(84px,1fr); }
          .weather-center-frame[data-view="days"] .weather-days { grid-template-columns:repeat(3,minmax(0,1fr)); }
        }
        @container weather (max-width: 680px) {
          .weather-view-tabs { justify-content:flex-start; overflow-x:auto; flex-wrap:nowrap; }
          .weather-view-tabs button { flex:0 0 auto; }
          .weather-map-valid { bottom:38px; }
          .weather-center-frame[data-view="overview"] .weather-center-body { grid-template-columns:1fr; grid-template-rows:minmax(220px,.9fr) auto minmax(160px,.7fr); overflow:auto; }
          .weather-center-frame[data-view="overview"] .weather-map-panel,.weather-center-frame[data-view="overview"] .weather-current-hero,.weather-center-frame[data-view="overview"] .weather-metrics-section,.weather-center-frame[data-view="overview"] .weather-hours-section { grid-column:1; }
          .weather-center-frame[data-view="overview"] .weather-map-panel { grid-row:1; }
          .weather-center-frame[data-view="overview"] .weather-current-hero { grid-row:2; }
          .weather-center-frame[data-view="overview"] .weather-metrics-section { grid-row:3; }
          .weather-center-frame[data-view="overview"] .weather-hours-section { display:none; }
          .weather-center-frame[data-view="now"] .weather-center-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
          .weather-center-frame[data-view="trends"] .weather-ops-grid { grid-template-columns:1fr; grid-template-rows:repeat(4,minmax(180px,1fr)); overflow:auto; }
          .weather-center-frame[data-view="days"] .weather-days { grid-template-columns:1fr 1fr; }
          .weather-24-timeline,.weather-5day-summary { min-height:95px; }
        }

        @media (pointer: coarse) {
          .weather-center-btn, .weather-window-controls button, .weather-view-tabs button, .weather-pager button, .weather-map-actions button { min-height: 40px; min-width: 40px; touch-action: manipulation; }
          .weather-map-layers button { min-height: 36px; touch-action: manipulation; }
        }
      `}</style>
      <div ref={frameRef} className="weather-center-frame" data-view={activeWeatherTab} data-hosted={hosted} style={{ ...frameStyle, '--sat-text-scale': scale, '--weather-metric-cols': metricsColumns, '--weather-trend-cols': trendColumns, '--weather-hour-cols': hourColumns, '--weather-day-cols': dayColumns }} onPointerDownCapture={onFocus}>
        <div className="weather-center-header" onPointerDown={startDrag} style={{ touchAction: 'none', cursor: hosted || isMaximized ? 'default' : (isDragging ? 'grabbing' : 'grab') }}>
          <div style={{ minWidth: 0, pointerEvents: 'none' }}>
            <div className="weather-center-title">WEATHER CENTER</div>
            <div className="weather-center-sub">GISTDA — {station?.id || 'SRC'} GROUND STATION • LAT {fmt(station?.lat,4)}° • LON {fmt(station?.lng,4)}° • ALT {fmt(station?.alt,0)} m • OBSERVED {observedUtc} UTC • {weatherStatus}</div>
          </div>
          <div className="weather-window-controls">
            {windowControl}
            <button className="weather-center-btn" onClick={() => setRefreshKey((v) => v + 1)} title="Refresh weather" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>↻</button>
            <button className="weather-center-btn" onClick={() => hosted ? toggleSatOwnedFullscreen(hostWindow) : setIsMaximized((v) => !v)} title={hosted ? 'Fullscreen' : isMaximized ? 'Restore window' : 'Maximize'}><SatWindowIcon kind={isMaximized ? 'restore' : 'maximize'} /></button>
            <button className="weather-center-btn" onClick={onClose} title="Close" style={{ color: 'var(--red)', borderColor: 'var(--red)', background: 'rgba(255,51,51,0.06)' }}>×</button>
          </div>
        </div>

        {weatherIsStale && <div role="status" style={{ padding: '5px 14px', color: 'var(--gold)', font: '700 12px Rajdhani', background: 'rgba(255,204,0,.08)' }}>{weatherError || 'FORECAST NEEDS REFRESH'} • Showing the last forecast for {station?.id}; updated UTC {formatUtcHour(new Date(weatherRecord.fetchedAt).toISOString())}.</div>}
        <nav className="weather-view-tabs" aria-label="Weather views">
          {[["overview", "OVERVIEW"], ["map", "MAP"], ["now", "NOW"], ["trends", "TRENDS"], ["hours", "24H"], ["days", "5 DAY"]].map(([id, label]) =>
            id === 'overview' && !overviewAvailable ? null : <button key={id} type="button" aria-pressed={activeWeatherTab === id} className={activeWeatherTab === id ? 'active' : ''} onClick={() => setWeatherTab(id)}><span className="weather-tab-glyph">{weatherTabGlyph(id)}</span>{label}</button>
          )}
        </nav>
        <div ref={bodyRef} className="weather-center-body">
          <div className="weather-center-top">
            <div className="weather-center-panel weather-map-panel">
              <WeatherInteractiveMap station={station} fmt={fmt} cloudCover={current.cloud_cover} precipitationNow={precipNow} validTime={observedUtc} active={activeWeatherTab === 'map'} hostWindow={hostWindow} hostRevision={hostRevision} />
            </div>

            <div className="weather-center-panel weather-center-current">
              {isLoading && !weatherData ? (
                <div className="weather-current-feedback" style={{ margin: 'auto', textAlign: 'center', color: 'var(--cyan)', fontFamily: 'Orbitron', fontWeight: 900 }}>LOADING WEATHER DATA...</div>
              ) : weatherError && !weatherData ? (
                <div className="weather-current-feedback" style={{ margin: 'auto', textAlign: 'center' }}>
                  <div style={{ color: 'var(--red)', fontFamily: 'Orbitron', fontWeight: 900, marginBottom: '8px' }}>{weatherError}</div>
                  <button className="weather-center-btn" onClick={() => setRefreshKey((v) => v + 1)} style={{ width: 'auto', padding: '0 12px', color: 'var(--gold)', borderColor: 'var(--gold)' }}>RETRY</button>
                </div>
              ) : (
                <>
                  <div className="weather-current-hero" style={{ boxShadow: `inset 4px 0 0 ${cloudHeroColor}, 0 0 20px ${cloudHeroColor}14` }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="weather-current-cloud-kicker">CLOUD COVER • UTC {formatUtcHour(current.time)}</div>
                      <div className="weather-current-cloud-row">
                        <span className="weather-current-cloud-value">{fmt(cloudPct,0)}%</span>
                        <span className="weather-current-cloud-state" style={{ color: cloudHeroColor }}>{cloudState}</span>
                      </div>
                      <div className="weather-current-cloud-op">{cloudOperationalLabel}</div>
                      <div className="weather-current-meta">
                        <span className={`weather-data-badge ${weatherIsStale ? 'stale' : 'current'}`}>{dataFreshLabel}</span>
                        <span className={`weather-impact-badge ${currentImpact.level}`}>GROUND STATION • {currentImpact.label} · DERIVED</span>
                      </div>
                    </div>
                    <div className="weather-current-side">
                      <div className="weather-current-icon">{weatherIcon(current.weather_code)}</div>
                      <div className="weather-current-condition">{weatherLabel(current.weather_code)}</div>
                    </div>
                  </div>
                  <div className="weather-metrics-section">
                    <div className="weather-center-metrics">{pageItems(visibleWeatherMetrics, metricPage, metricPageSize).map(args => metric(...args))}</div>
                    {pager('METRICS', metricPage, setMetricPage, visibleWeatherMetrics.length, metricPageSize)}
                  </div>

                  <div className="weather-trends-section"><div className="weather-ops-grid weather-number-trends">
                    <div className="weather-trend-card weather-number-card">
                      <div className="weather-trend-title">TEMPERATURE / HUMIDITY</div>
                      <div className="weather-number-main"><strong>{fmt(trendTempStats.now,1)}°C</strong><span>NOW</span></div>
                      <div className="weather-number-grid"><span><small>6H CHANGE</small><b>{deltaText(trendTempDelta,1,'°C')}</b></span><span><small>HUMIDITY</small><b>{fmt(current.relative_humidity_2m,0)}%</b></span><span><small>TREND</small><b>{directionText(trendTempDelta,.15,'WARMING','COOLING')}</b></span><span><small>RANGE</small><b>{fmt(trendTempStats.min,1)}–{fmt(trendTempStats.max,1)}°C</b></span></div>
                    </div>
                    <div className="weather-trend-card weather-number-card">
                      <div className="weather-trend-title">PRESSURE</div>
                      <div className="weather-number-main"><strong>{fmt(trendPressureStats.now,0)} hPa</strong><span>NOW</span></div>
                      <div className="weather-number-grid"><span><small>6H CHANGE</small><b>{deltaText(trendPressureDelta,0,' hPa')}</b></span><span><small>TREND</small><b>{directionText(trendPressureDelta,.4)}</b></span><span><small>MIN</small><b>{fmt(trendPressureStats.min,0)} hPa</b></span><span><small>MAX</small><b>{fmt(trendPressureStats.max,0)} hPa</b></span></div>
                    </div>
                    <div className="weather-trend-card weather-number-card">
                      <div className="weather-trend-title">WIND / GUST</div>
                      <div className="weather-number-main"><strong>{fmt(trendWindStats.now,0)} km/h</strong><span>{windCardinal(windDirection)} {fmt(windDirection,0)}°</span></div>
                      <div className="weather-number-grid"><span><small>6H CHANGE</small><b>{deltaText(trendWindDelta,0,' km/h')}</b></span><span><small>MAX GUST</small><b>{fmt(trendGustStats.max,0)} km/h</b></span><span><small>TREND</small><b>{directionText(trendWindDelta,.8,'INCREASING','DECREASING')}</b></span><span><small>NOW GUST</small><b>{fmt(current.wind_gusts_10m,0)} km/h</b></span></div>
                    </div>
                    <div className="weather-trend-card weather-number-card">
                      <div className="weather-trend-title">PRECIPITATION / CLOUD</div>
                      <div className="weather-number-main"><strong>{fmt(rainHistoryTotal,1)} mm</strong><span>RAIN · LAST 6H</span></div>
                      <div className="weather-number-grid"><span><small>CLOUD NOW</small><b>{fmt(trendCloudStats.now,0)}%</b></span><span><small>CLOUD CHANGE</small><b>{deltaText(trendCloudDelta,0,'%')}</b></span><span><small>RAIN PEAK</small><b>{fmt(trendRainStats.max,1)} mm/h</b></span><span><small>CLOUD TREND</small><b>{directionText(trendCloudDelta,2,'INCREASING','DECREASING')}</b></span></div>
                    </div>
                  </div></div>
                </>
              )}
            </div>
          </div>

          <div className="weather-hours-section">
            <div className="weather-section-label">NEXT 24 HOURS • 3-HOUR INTERVAL • UTC</div>
            <div className="weather-strip">
              {next24.length ? pageItems(next24, hourPage, hourPageSize).map((item, index) => (
                <div className="weather-hour" key={`${item.time}-${index}`} style={{ borderTopColor: weatherAccent(item.code) }}>
                  <time>{formatUtcHour(item.time)}</time>
                  <div className="ico">{weatherIcon(item.code)}</div>
                  <strong style={{ color: temperatureColor(item.temp) }}>{fmt(item.temp,0)}°C</strong>
                  <small>{weatherLabel(item.code)}<br/>CLOUD {fmt(item.cloud,0)}% · RAIN {fmt(item.pop,0)}%<br/>{windCardinal(item.windDir)} {fmt(item.wind,0)} km/h</small>
                </div>
              )) : <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Rajdhani' }}>Forecast unavailable.</div>}
            </div>
            <div className="weather-24-timeline weather-summary-panel">
              <div className="weather-timeline-title"><span>24-HOUR OPERATIONAL SUMMARY</span><span>GROUND STATION FORECAST</span></div>
              <div className="weather-summary-grid">
                <span><small>TEMP RANGE</small><strong>{next24.length ? `${fmt(Math.min(...next24.map(d=>Number(d.temp)).filter(Number.isFinite)),0)}–${fmt(Math.max(...next24.map(d=>Number(d.temp)).filter(Number.isFinite)),0)}°C` : 'N/A'}</strong></span>
                <span><small>MAX RAIN PROB.</small><strong>{next24.length ? `${fmt(Math.max(...next24.map(d=>Number(d.pop)).filter(Number.isFinite)),0)}%` : 'N/A'}</strong></span>
                <span><small>RAIN TOTAL</small><strong>{next24.length ? `${fmt(next24.map(d=>Number(d.rain)).filter(Number.isFinite).reduce((a,b)=>a+b,0),1)} mm` : 'N/A'}</strong></span>
                <span><small>MAX WIND</small><strong>{next24.length ? `${fmt(Math.max(...next24.map(d=>Number(d.wind)).filter(Number.isFinite)),0)} km/h` : 'N/A'}</strong></span>
              </div>
            </div>
            {pager('24H', hourPage, setHourPage, next24.length, hourPageSize)}
          </div>

          <div className="weather-days-section">
            <div className="weather-section-label">5-DAY FORECAST • GROUND STATION OPERATIONAL OUTLOOK</div>
            <div className="weather-days">
              {dailyCards.length ? pageItems(dailyCards, dayPage, dayPageSize).map((item, index) => {
                const impact = groundStationImpact({ code:item.code, gust:item.gust, rain:item.rain, pop:item.pop });
                return <div className="weather-day" key={`${item.time}-${index}`} style={{ borderLeftColor: weatherAccent(item.code) }}>
                  <div className="weather-day-top"><strong>{formatUtcDate(item.time)}</strong><div className="ico">{weatherIcon(item.code)}</div></div>
                  <div className="weather-day-temp"><span style={{ color: temperatureColor(item.tMax) }}>{fmt(item.tMax,0)}°</span> / <span style={{ color: temperatureColor(item.tMin) }}>{fmt(item.tMin,0)}°C</span></div>
                  <div className="weather-day-condition">{weatherLabel(item.code)}</div>
                  <div className="weather-day-details">RAIN {fmt(item.pop,0)}% · {fmt(item.rain,1)} mm<br/>WIND {fmt(item.wind,0)} km/h · GUST {fmt(item.gust,0)} km/h</div>
                  <span className={`weather-impact-badge weather-day-impact ${impact.level}`}>GROUND STATION • {impact.label} · DERIVED</span>
                </div>;
              }) : <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Rajdhani' }}>Daily forecast unavailable.</div>}
            </div>
            <div className="weather-5day-summary weather-summary-panel">
              <div className="weather-timeline-title"><span>5-DAY OPERATIONAL SUMMARY</span><span>GROUND STATION OUTLOOK</span></div>
              <div className="weather-summary-grid weather-summary-grid-5">
                {(() => {
                  const impacts = dailyCards.map(item => groundStationImpact({ code:item.code, gust:item.gust, rain:item.rain, pop:item.pop }));
                  const count = (level) => impacts.filter(item => item.level === level).length;
                  const pops = dailyCards.map(d=>Number(d.pop)).filter(Number.isFinite);
                  const gusts = dailyCards.map(d=>Number(d.gust)).filter(Number.isFinite);
                  return <>
                    <span className="normal"><small>NORMAL</small><strong>{count('normal')} DAYS</strong></span>
                    <span className="caution"><small>CAUTION</small><strong>{count('caution')} DAYS</strong></span>
                    <span className="risk"><small>WEATHER RISK</small><strong>{count('risk')} DAYS</strong></span>
                    <span><small>MAX RAIN PROB.</small><strong>{pops.length ? `${fmt(Math.max(...pops),0)}%` : 'N/A'}</strong></span>
                    <span><small>MAX GUST</small><strong>{gusts.length ? `${fmt(Math.max(...gusts),0)} km/h` : 'N/A'}</strong></span>
                  </>;
                })()}
              </div>
            </div>
            {pager('5 DAY', dayPage, setDayPage, dailyCards.length, dayPageSize)}
          </div>
        </div>

        <div className="weather-center-footer">
          <span>MODEL FORECAST: OPEN-METEO BEST MATCH • BASE: OPENSTREETMAP • CLOUD: NASA GIBS/VIIRS NOAA-20 • SATELLITE: NASA GIBS/VIIRS NOAA-20 • RAIN: NASA GIBS/GPM IMERG</span>
          <span>{dataFreshLabel} • CURRENT WEATHER • INDEPENDENT OF SIM CLOCK</span>
        </div>
      </div>
    </div>
  );
}


// Data tools share measured, readable pages; only their visible rows are mounted.
// The same component and selection state survive a move to another document.
const SatDataScaleContext = React.createContext(1);
function useSatDataScale(readingScale = 1) {
  return readingScale * React.useContext(SatDataScaleContext);
}

const SAT_DATA_TOOL_CSS = `
  .sat-data-modal { container-type: inline-size; padding: 0!important; box-sizing: border-box; min-width: 0!important; max-width: 100vw!important; max-height: 100dvh!important; --sat-data-accent: var(--cyan); font-family: Rajdhani,Arial,sans-serif; }
  .sat-data-modal *, .sat-data-header * { box-sizing: border-box; }
  .sat-data-header { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--sat-data-accent); background: linear-gradient(180deg,rgba(0,234,255,.10),transparent); user-select: none; }
  .sat-data-title { margin: 0; min-width: 0; flex: 1; font: 800 calc(16px * var(--sat-text-scale,1))/1.35 Orbitron,Arial,sans-serif; color: var(--sat-data-accent); letter-spacing: .5px; overflow-wrap: normal; }
  .sat-data-title small { display: block; margin-top: 3px; font: 700 calc(12px * var(--sat-text-scale,1))/1.3 Rajdhani,Arial,sans-serif; color: #dbe8ed; letter-spacing: .3px; }
  .sat-data-header-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .sat-data-header-actions > button { min-width: 34px; min-height: 34px; padding: 4px 7px; margin: 0; }
  .sat-data-action, .sat-data-modal select, .sat-data-modal input[type="search"], .sat-page-nav button { border: 1px solid var(--sat-data-accent); border-radius: 4px; background: #061823; color: #e7f9ff; font: 700 calc(13px * var(--sat-text-scale,1))/1.2 Rajdhani,Arial,sans-serif; padding: 6px 9px; min-height: 34px; min-width: 0; cursor: pointer; }
  .sat-data-action[aria-pressed="true"] { background: var(--sat-data-accent); color: #001018; }
  .sat-data-action:disabled, .sat-page-nav button:disabled { opacity: .35; cursor: default; }
  .sat-data-action:hover:not(:disabled), .sat-page-nav button:hover:not(:disabled) { background: #174251; }
  .sat-data-action:focus-visible, .sat-page-nav button:focus-visible, .sat-data-row:focus-visible { outline: 2px solid #fff; outline-offset: -3px; }
  .sat-data-body { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; overflow: hidden; position: relative; z-index: 1; font-size: calc(14px * var(--sat-text-scale,1)); }
  .sat-data-toolbar { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
  .sat-data-toolbar > select { flex: 1 1 220px; max-width: 100%; width: 0; }
  .sat-data-toolbar > input[type="search"] { flex: 1 1 150px; width: 0; }
  .sat-data-toolbar small { font-size: calc(12px * var(--sat-text-scale,1)); color: #bfd0d9; }
  .sat-page-viewport { min-width: 0; min-height: 0; flex: 1; overflow: hidden; position: relative; scrollbar-width:none; -ms-overflow-style:none; }
  .sat-page-viewport::-webkit-scrollbar { width:0!important; height:0!important; display:none!important; }
  .sat-page-nav { flex: 0 0 auto; display: grid; grid-template-columns: max-content minmax(0,1fr) max-content; align-items: center; gap: 6px; border-top: 1px solid rgba(255,255,255,.18); padding-top: 6px; color: #c4d5dd; font: 700 calc(12px * var(--sat-text-scale,1))/1.3 Rajdhani,Arial,sans-serif; }
  .sat-page-info { min-width: 0; text-align: center; font-variant-numeric: tabular-nums; }
  .sat-page-info > span { display: block; white-space: nowrap; }
  .sat-page-nav button { padding: 5px 9px; }
  .sat-data-empty { margin: auto; padding: 12px; text-align: center; color: var(--sat-data-accent); font-size: calc(15px * var(--sat-text-scale,1)); overflow-wrap: anywhere; }
  .sat-db-cards { display: grid; align-content: start; gap: 8px; }
  .sat-db-card { min-width: 0; width: 100%; padding: 8px 10px; border: 1px solid rgba(0,255,102,.4); border-radius: 5px; background: rgba(0,255,102,.05); color: #fff; text-align: left; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 3px; font: 700 calc(14px * var(--sat-text-scale,1))/1.25 Rajdhani,Arial,sans-serif; }
  .sat-db-card:disabled { opacity: .42; cursor: default; }
  .sat-db-card[data-selected="main"] { background: linear-gradient(135deg,#b7202a,#601016); border-color: #ffacac; }
  .sat-db-card[data-selected="secondary"] { background: linear-gradient(135deg,#007b38,#00481f); border-color: var(--green); }
  .sat-db-card-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .sat-db-card-line strong { flex: 1; min-width: 0; overflow-wrap: normal; }
  .sat-db-card-line img { width: 24px; height: 16px; object-fit: contain; flex: 0 0 auto; }
  .sat-db-card small { font: 600 calc(11px * var(--sat-text-scale,1))/1.2 Rajdhani,Arial,sans-serif; color: #d5e5dd; overflow-wrap: normal; }
  .sat-db-card-state { font-size: calc(11px * var(--sat-text-scale,1)); white-space: nowrap; }
  .sat-data-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; }
  .sat-data-table th { padding: 6px 4px; color: #cbdae3; font: 700 calc(11px * var(--sat-text-scale,1))/1.25 Orbitron,Arial,sans-serif; border-bottom: 1px solid var(--sat-data-accent); overflow-wrap: normal; text-align: center; }
  .sat-data-table td { padding: 5px 3px; font-size: calc(14px * var(--sat-text-scale,1)); line-height: 1.2; text-align: center; border-bottom: 1px dashed rgba(255,255,255,.13); }
  .sat-data-table time { white-space: nowrap; }
  .sat-data-row { cursor: pointer; }
  .sat-data-row[data-status="active"] { background: rgba(0,255,102,.16); box-shadow: inset 3px 0 var(--green); }
  .sat-data-row[data-status="past"] { color: #a0aab3; }
  .sat-data-row:hover { background: rgba(255,255,255,.08); }
  .sat-data-summary { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; border: 1px solid rgba(0,234,255,.32); border-radius: 4px; font-size: calc(13px * var(--sat-text-scale,1)); color: #dae9ef; }
  .sat-data-summary strong { color: var(--sat-data-accent); }
  .sat-data-summary button { margin-left: auto; }
  .sat-pass-card { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 6px 9px; border: 1px solid rgba(255,204,0,.22); border-radius: 5px; background: rgba(255,204,0,.035); color: #fff; text-align: left; width: 100%; font-family: Rajdhani,Arial,sans-serif; }
  .sat-pass-card-head { display: flex; justify-content: space-between; align-items: center; gap: 5px; margin-bottom: 5px; font-size: calc(13px * var(--sat-text-scale,1)); }
  .sat-pass-card-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 3px 8px; }
  .sat-pass-card-grid div { min-width: 0; display: flex; flex-direction: column; font-size: calc(14px * var(--sat-text-scale,1)); }
  .sat-pass-card-grid small { color: #a5b6c1; font-size: calc(10px * var(--sat-text-scale,1)); line-height: 1.15; }
  .sat-pass-card-grid strong { line-height: 1.3; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sat-pass-table th { font-size:calc(10px * var(--sat-text-scale,1)); padding:5px 3px; white-space:nowrap; }
  .sat-pass-table td { font-size:calc(12px * var(--sat-text-scale,1)); padding:5px 2px; white-space:nowrap; }
  @container (max-width: 900px) { .sat-pass-table th { font-size:calc(9px * var(--sat-text-scale,1)); letter-spacing:0; } .sat-pass-table td { font-size:calc(11px * var(--sat-text-scale,1)); } }
  .sat-gs-stations { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; }
  .sat-gs-details { display: grid; grid-template-columns: minmax(0,1fr); min-height: 0; gap: 0 18px; flex: 1; align-content: center; }
  .sat-gs-detail { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.2fr); gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px dashed rgba(255,102,0,.28); }
  .sat-gs-detail dt { color: #c2bdba; font-size: calc(12px * var(--sat-text-scale,1)); }
  .sat-gs-detail dd { margin: 0; text-align: right; color: #fff; font-size: calc(15px * var(--sat-text-scale,1)); font-weight: 800; font-variant-numeric: tabular-nums; }
  .sat-angles-summary { display: grid; flex: 0 0 auto; grid-template-columns: 1.25fr .8fr repeat(3,1fr); gap: 6px; }
  .sat-angles-summary > div { min-width: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; background: rgba(0,234,255,.07); border: 1px solid rgba(0,234,255,.28); border-radius: 4px; padding: 5px 3px; }
  .sat-angles-summary small { color: #adc3ce; font-size: calc(10px * var(--sat-text-scale,1)); }
  .sat-angles-summary strong { font: 800 calc(14px * var(--sat-text-scale,1))/1.4 Rajdhani,Arial,sans-serif; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sat-angle-table { background: #f8fafc; color: #0f172a; }
  .sat-angle-table th { background: #0b1121; }
  .sat-angle-table td { font-family: monospace; font-size: calc(13px * var(--sat-text-scale,1)); border-bottom: 1px solid #dbe3e9; }
  .sat-angle-table tr:nth-child(even) td { background: #edf3f8; }
  .sat-angle-table .sat-pointing-value { white-space: nowrap; }
  .sat-angle-table .sat-pointing-time { white-space: nowrap; }
  .sat-mission-layout { display: flex; flex: 1; min-width: 0; min-height: 0; gap: 10px; }
  .sat-mission-list-pane { flex: 0 0 42%; min-width: 0; min-height: 0; max-width: calc(420px * var(--sat-data-growth,1)); display: flex; }
  .sat-mission-map-pane { min-width: 0; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .sat-mission-map-canvas { container-type: size; }
  .sat-mission-map-image { width: min(100cqw,200cqh)!important; height: min(50cqw,100cqh)!important; max-width: none!important; max-height: none!important; flex: 0 0 auto; }
  .sat-mission-map-tools { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 5px; align-items: center; }
  .sat-mission-map-tools span { color: #d8e9ef; font-size: calc(12px * var(--sat-text-scale,1)); margin-right: auto; }
  .sat-mission-upload { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: 1px dashed var(--cyan); border-radius: 4px; background: rgba(0,234,255,.08); color: var(--cyan); padding: 6px 9px; font-size: calc(12px * var(--sat-text-scale,1)); min-height: 34px; cursor: pointer; }
  .sat-mission-layout[data-compact="true"] .sat-mission-list-pane { flex: 1; max-width: none; }
  .sat-mission-layout [data-hidden="true"] { display: none; }
  .sat-mission-list { min-height: 0; min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .sat-mission-list .sat-data-table th { font-family: Rajdhani,Arial,sans-serif; font-size: calc(12px * var(--sat-text-scale,1)); }
  @container (min-width: 780px) { .sat-gs-details { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @container (max-width: 620px) { .sat-angles-summary { grid-template-columns: repeat(3,minmax(0,1fr)); } .sat-angles-summary > div:first-child { grid-column: span 2; } }
  @container (max-width: 460px) { .sat-data-header { gap: 6px; padding: 8px; } .sat-data-title { font-size: calc(13px * var(--sat-text-scale,1)); } .sat-data-header-actions { gap: 4px; } .sat-data-header-actions > button { min-width: 30px; padding: 3px 5px; } .sat-data-body { padding: 8px; } .sat-gs-detail { grid-template-columns: 1fr 1.2fr; } .sat-page-nav { grid-template-columns: 1fr 1fr; } .sat-page-info { grid-column: 1 / -1; grid-row: 1; } .sat-page-nav button { justify-self: start; } .sat-page-nav button:last-child { justify-self: end; } }
  @media (pointer: coarse) { .sat-data-modal button, .sat-data-modal select, .sat-data-modal input[type="search"], .sat-mission-upload { min-height: 40px; } .sat-data-modal input[type="range"] { min-height: 36px; } }
`;

function useSatDataMetrics(ref, hostRevision, scale = 1) {
  const [bounds, setBounds] = useState({ width: 700, height: 300, touch: false });
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const owner = node.ownerDocument.defaultView || window;
    let active = true;
    const measure = () => {
      if (!active) return;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const width = Math.floor(rect.width), height = Math.floor(rect.height);
      const touch = !!owner.matchMedia?.('(pointer: coarse)').matches;
      setBounds(previous => previous.width === width && previous.height === height && previous.touch === touch ? previous : { width, height, touch });
    };
    measure();
    const observer = owner.ResizeObserver ? new owner.ResizeObserver(measure) : null;
    observer?.observe(node);
    owner.addEventListener('resize', measure);
    node.ownerDocument.fonts?.ready.then(measure);
    return () => { active = false; observer?.disconnect(); owner.removeEventListener('resize', measure); };
  }, [ref, hostRevision, scale]);
  return bounds;
}

function useSatDataPage(total, pageSize, resetKey) {
  const [anchor, setAnchor] = useState(0);
  const count = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(count - 1, Math.floor(anchor / pageSize));
  useEffect(() => setAnchor(0), [resetKey]);
  return { page, count, start: page * pageSize, end: Math.min(total, (page + 1) * pageSize),
    go: next => setAnchor(Math.max(0, Math.min(count - 1, next)) * pageSize),
    jump: index => setAnchor(Math.max(0, Math.min(Math.max(0, total - 1), index))) };
}

function SatDataPager({ paging, total, label = 'items' }) {
  return <nav className="sat-page-nav" aria-label={`${label} pagination`}>
    <button type="button" disabled={paging.page === 0} onClick={() => paging.go(paging.page - 1)}>‹ PREVIOUS</button>
    <span className="sat-page-info"><span>PAGE {paging.page + 1} / {paging.count}</span><span>{total ? paging.start + 1 : 0}–{paging.end} / {total} {label}</span></span>
    <button type="button" disabled={paging.page >= paging.count - 1} onClick={() => paging.go(paging.page + 1)}>NEXT ›</button>
  </nav>;
}

function SatDataHeader({ title, subtitle, windowControl, onMaximize, onClose, onDrag, maximized }) {
  return <>
    <style>{SAT_DATA_TOOL_CSS}</style>
    <header className="sat-data-header" onMouseDown={event => { if (!event.target.closest('button,input,select,label')) onDrag?.(event); }}>
      <h2 className="sat-data-title">{title}{subtitle && <small>{subtitle}</small>}</h2>
      <div className="sat-data-header-actions" onMouseDown={event => event.stopPropagation()}>
        {windowControl}
        <button type="button" className="sat-data-action" aria-label={`Maximize ${title}`} title="Maximize / Restore" onClick={onMaximize}><SatWindowIcon kind={maximized ? 'restore' : 'maximize'} /></button>
        <button type="button" className="sat-data-action" aria-label={`Close ${title}`} title="Close Tool" onClick={onClose}>✕</button>
      </div>
    </header>
  </>;
}

function SatDataWindow({ id, position, maximized, width, height, zIndex, accent = 'var(--cyan)', onFocus, dragging, hostRevision, scale = 1, children }) {
  const frameRef = useRef(null), bounds = useSatDataMetrics(frameRef, hostRevision, scale);
  // Grow type only when both panel dimensions provide room. The same factor
  // reaches the row budgets below, so TV text never outruns its measured page.
  const growth = Math.max(1, Math.min(2, bounds.width / 1280, bounds.height / 800));
  return <SatDataScaleContext.Provider value={growth}><div ref={frameRef} className={`modal-box ${id}-modal sat-data-modal`} onMouseDownCapture={onFocus} style={{
    position: 'fixed', top: maximized ? 0 : position.y, left: maximized ? 0 : position.x,
    width: maximized ? '100vw' : `min(${width}px,95vw)`, height: maximized ? '100dvh' : `min(${height}px,85dvh)`,
    minWidth: 'min(320px,95vw)', minHeight: 'min(360px,85dvh)', resize: maximized ? 'none' : 'both', overflow: 'hidden',
    background: id === 'gs' ? 'linear-gradient(145deg,rgba(20,5,0,.96),rgba(10,2,0,.99))' : id === 'pass' ? 'linear-gradient(145deg,rgba(20,10,0,.96),rgba(10,5,0,.99))' : 'linear-gradient(145deg,rgba(0,10,25,.96),rgba(0,5,10,.99))',
    backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)', border: maximized ? 'none' : `2px solid ${accent}`,
    borderRadius: maximized ? 0 : 10, boxShadow: `0 0 28px color-mix(in srgb,${accent} 22%,transparent)`,
    display: 'flex', flexDirection: 'column', zIndex, '--sat-data-accent': accent, '--sat-data-growth': growth, '--sat-text-scale': scale * growth,
    transition: dragging ? 'none' : 'border-color .15s ease'
  }}>{children}</div></SatDataScaleContext.Provider>;
}

function SatGroundStationData({ station, onStation, mask, antennaMode, linkActive }) {
  const details = [
    ['LOCATION', station.name], ['LATITUDE', `${Math.abs(station.lat).toFixed(4)}° ${station.lat >= 0 ? 'N' : 'S'}`],
    ['LONGITUDE', `${Math.abs(station.lng).toFixed(4)}° ${station.lng >= 0 ? 'E' : 'W'}`], ['ALTITUDE (ASL)', `${station.alt} m`],
    ['S-BAND (TT&C)', '2.0 – 2.3 GHz'], ['X-BAND (DOWNLINK)', '8.0 – 8.4 GHz'],
    ['SYSTEM HARDWARE', 'VIASAT / KRATOS'], ['HORIZON MASK', `${Number(mask).toFixed(1)}°`]
  ];
  return <div className="sat-data-body">
    <strong style={{ color: 'var(--cyan)', fontSize: 'calc(13px * var(--sat-text-scale,1))' }}>ACTIVE GROUND STATION NETWORK</strong>
    <div className="sat-gs-stations">{GS_NETWORK.map(item => <button key={item.id} type="button" className="sat-data-action" aria-pressed={station.id === item.id} onClick={() => onStation(item)}>{item.id}</button>)}</div>
    <dl className="sat-gs-details" style={{ margin: 0 }}>{details.map(([label, value]) => <div className="sat-gs-detail" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="sat-data-summary" style={{ borderColor: linkActive ? 'var(--green)' : '#ff6600', justifyContent: 'space-between' }}><span>ANTENNA STATUS</span><strong style={{ color: linkActive ? 'var(--green)' : '#ff6600' }}>{antennaMode}</strong></div>
  </div>;
}

function SatDatabaseData({ options, satrecs, selectedCatnr, selectedCatnrs, onToggle, onGroupToggle, onClear, hostRevision, scale: readingScale }) {
  const scale = useSatDataScale(readingScale);
  const [group, setGroup] = useState('ALL');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => Array.from(new Set(options.map(sat => sat.group))), [options]);
  const filtered = useMemo(() => options.filter(sat => (group === 'ALL' || sat.group === group) && `${sat.displayName} ${sat.catnr} ${sat.group}`.toLowerCase().includes(query.trim().toLowerCase())), [options, group, query]);
  const viewportRef = useRef(null), bounds = useSatDataMetrics(viewportRef, hostRevision, scale);
  const columns = Math.max(1, Math.floor((bounds.width + 8) / (260 * scale + 8)));
  const rowHeight = Math.ceil(88 * scale);
  const perPage = columns * Math.max(1, Math.floor((bounds.height + 8) / (rowHeight + 8)));
  const paging = useSatDataPage(filtered.length, perPage, `${group}|${query}`);
  const groupCatnrs = options.filter(sat => sat.group === group && satrecs[sat.catnr]).map(sat => sat.catnr);
  const allSelected = groupCatnrs.length > 0 && groupCatnrs.every(cat => selectedCatnrs.includes(cat));
  return <div className="sat-data-body">
    <div className="sat-data-toolbar">
      <select aria-label="Satellite group" value={group} onChange={event => setGroup(event.target.value)}><option value="ALL">ALL GROUPS</option>{groups.map(name => <option key={name} value={name}>{name}</option>)}</select>
      <input type="search" aria-label="Search satellites" placeholder="Search name / NORAD" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <div className="sat-data-toolbar"><small>{selectedCatnrs.length} SELECTED · MAIN {options.find(sat => sat.catnr === selectedCatnr)?.displayName || selectedCatnr}</small>
      {group !== 'ALL' && <button type="button" className="sat-data-action" disabled={!groupCatnrs.length} onClick={() => onGroupToggle(groupCatnrs, allSelected)}>{groupCatnrs.length ? (allSelected ? '− DESELECT GROUP' : '+ SELECT GROUP') : 'NO VALID TLE'}</button>}
      <button type="button" className="sat-data-action" style={{ marginLeft: 'auto' }} onClick={onClear} title="Remove all secondary satellites">🧹 CLEAR</button>
    </div>
    <div className="sat-page-viewport" ref={viewportRef}>
      {filtered.length ? <div className="sat-db-cards" style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gridAutoRows: `${rowHeight}px` }}>{filtered.slice(paging.start, paging.end).map(sat => {
        const hasTle = Boolean(satrecs[sat.catnr]);
        return <button type="button" key={sat.catnr} className="sat-db-card" disabled={!hasTle} data-selected={sat.catnr === selectedCatnr ? 'main' : selectedCatnrs.includes(sat.catnr) ? 'secondary' : 'none'} aria-pressed={selectedCatnrs.includes(sat.catnr)} onClick={() => onToggle(sat)} title={hasTle ? sat.displayName : `${sat.displayName}: NO VALID TLE`}>
          <div className="sat-db-card-line">{sat.flag && <img src={`https://flagcdn.com/w40/${sat.flag.toLowerCase()}.png`} alt="" />}<strong>{sat.displayName}</strong><span className="sat-db-card-state">{!hasTle ? 'NO TLE' : sat.catnr === selectedCatnr ? '🎯 MAIN' : selectedCatnrs.includes(sat.catnr) ? '● ON' : ''}</span></div>
          <small>NORAD {sat.catnr} · {sat.group}</small>
        </button>;
      })}</div> : <div className="sat-data-empty">NO SATELLITES MATCH THE SEARCH</div>}
    </div>
    <SatDataPager paging={paging} total={filtered.length} label="satellites" />
  </div>;
}

function SatPassData({ passes, simTime, days, onDays, calculating, note, onReplay, hostRevision, scale: readingScale }) {
  const scale = useSatDataScale(readingScale);
  const viewportRef = useRef(null), bounds = useSatDataMetrics(viewportRef, hostRevision, scale);
  const nextIndex = passes.findIndex(pass => pass.losTime >= simTime), next = passes[nextIndex];
  const status = pass => simTime > pass.losTime ? 'past' : simTime >= pass.aosTime ? 'active' : new Date(simTime).toISOString().slice(0,10) === new Date(pass.aosTime).toISOString().slice(0,10) ? 'today' : 'future';
  const formatTime = time => new Date(time).toISOString().slice(11,19);
  const duration = pass => `${Math.floor(pass.durationMs / 60000)}m ${pad2(Math.floor((pass.durationMs % 60000) / 1000))}s`;
  const values = pass => [
    ['AOS', formatTime(pass.aosTime), 'var(--green)'], ['MAX EL TIME', formatTime(pass.peakTime), 'var(--gold)'], ['LOS', formatTime(pass.losTime), 'var(--red)'],
    ['DURATION', duration(pass), 'var(--cyan)'], ['MAX EL', `${pass.maxEl.toFixed(2)}°`, '#fff'], ['AOS / LOS AZ', `${pass.aosAz.toFixed(1)}° / ${pass.losAz.toFixed(1)}°`, '#d0dae0']
  ];
  const scrollToNext = () => {
    if (nextIndex < 0 || !viewportRef.current) return;
    const row = viewportRef.current.querySelector(`[data-pass-index="${nextIndex}"]`);
    row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  return <div className="sat-data-body">
    <div className="sat-data-toolbar">{[1,3,7].map(value => <button type="button" key={value} className="sat-data-action" aria-pressed={days === value} onClick={() => onDays(value)}>±{value} DAYS</button>)}<small>Click a pass to replay in SIM</small></div>
    {next && <div className="sat-data-summary"><strong>{simTime >= next.aosTime ? 'ACTIVE PASS' : 'NEXT PASS'}</strong><span>{new Date(next.aosTime).toISOString().slice(0,10)} · {formatTime(next.aosTime)} UTC</span><button type="button" className="sat-data-action" onClick={scrollToNext}>GO TO PASS</button></div>}
    <div className="sat-page-viewport" ref={viewportRef} style={{ overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch', scrollbarWidth:'none' }}>
      {calculating ? <div className="sat-data-empty">CALCULATING ORBITAL TRAJECTORY…</div> : !passes.length ? <div className="sat-data-empty">{note || 'NO PASSES DETECTED IN THIS TIMEFRAME'}</div> :
        <table className="sat-data-table sat-pass-table">
          <colgroup><col style={{width:'10%'}}/><col style={{width:'13%'}}/><col style={{width:'10%'}}/><col style={{width:'12%'}}/><col style={{width:'10%'}}/><col style={{width:'10%'}}/><col style={{width:'10%'}}/><col style={{width:'25%'}}/></colgroup>
          <thead style={{ position:'sticky', top:0, zIndex:4, background:'rgba(10,5,0,.98)' }}><tr>{['STATUS','DATE (UTC)','AOS','MAX EL TIME','LOS','DURATION','MAX EL','AOS / LOS AZ'].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{passes.map((pass,index) => <tr key={pass.aosTime} data-pass-index={index} className="sat-data-row" data-status={status(pass)} tabIndex={0} onClick={() => onReplay(pass)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onReplay(pass); } }}>
            <td style={{ fontWeight:800, color: status(pass)==='active' ? 'var(--green)' : undefined }}>{status(pass).toUpperCase()}</td><td>{new Date(pass.aosTime).toISOString().slice(0,10)}</td>{values(pass).map(([label,value,color]) => <td key={label} style={{ color }}>{value}</td>)}
          </tr>)}</tbody>
        </table>}
    </div>
  </div>;
}

function SatPointingData({ targetSatrec, passes, simTime, station, interval, onInterval, orbit, hostRevision, scale: readingScale }) {
  const scale = useSatDataScale(readingScale);
  const targetPass = passes.find(pass => pass.losTime > simTime) || passes[passes.length - 1];
  const rows = useMemo(() => {
    if (!targetSatrec || !targetPass) return [];
    const getSunPos = timestamp => {
      const d = new Date(timestamp), tDays = (d.getTime()/86400000)+2440587.5-2451545.0;
      const L=(280.460+0.9856474*tDays)%360, g=(357.528+0.9856003*tDays)%360;
      const lambda=L+1.915*Math.sin(g*Math.PI/180)+0.020*Math.sin(2*g*Math.PI/180), eps=23.439-0.0000004*tDays;
      const alpha=Math.atan2(Math.cos(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180),Math.cos(lambda*Math.PI/180))*180/Math.PI;
      const delta=Math.asin(Math.sin(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180))*180/Math.PI;
      const gmst=(18.697374558+24.06570982441908*tDays)%24, lmst=(gmst*15+station.lng)%360, ha=(lmst-alpha+360)%360;
      const latRad=station.lat*Math.PI/180, decRad=delta*Math.PI/180, haRad=ha*Math.PI/180;
      const sunElArg=Math.max(-1,Math.min(1,Math.sin(decRad)*Math.sin(latRad)+Math.cos(decRad)*Math.cos(latRad)*Math.cos(haRad)));
      const sunElRad=Math.asin(sunElArg), sunEl=sunElRad*180/Math.PI, azDen=Math.cos(sunElRad)*Math.cos(latRad);
      const azCos=azDen===0?1:Math.max(-1,Math.min(1,(Math.sin(decRad)-Math.sin(sunElRad)*Math.sin(latRad))/azDen));
      let sunAz=Math.acos(azCos)*180/Math.PI; if(Math.sin(haRad)>0) sunAz=360-sunAz;
      return {el:sunEl,az:sunAz};
    };
    const result=[], stepMs=Math.max(1,Number(interval)||1)*1000;
    for(let time=targetPass.aosTime;time<=targetPass.losTime;time+=stepMs){const pos=calculateSatData(new Date(time),targetSatrec,station),sun=getSunPos(time);result.push({time:new Date(time),satEl:pos?Math.max(0,pos.elevationDeg):0,satAz:pos?pos.azimuthDeg:0,sunEl:sun.el,sunAz:sun.az});}
    return result;
  }, [targetSatrec,targetPass?.aosTime,targetPass?.losTime,station.lat,station.lng,station.alt,interval]);
  const fmtTime=time=>new Date(time).toISOString().slice(11,19);
  return <div className="sat-data-body">
    {targetPass && <div className="sat-angles-summary">{[['DATE',new Date(targetPass.aosTime).toISOString().slice(0,10)],['ORBIT',orbit],['AOS',fmtTime(targetPass.aosTime)],['PCA',fmtTime(targetPass.peakTime)],['LOS',fmtTime(targetPass.losTime)]].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>}
    <div className="sat-data-toolbar"><label htmlFor="sat-angle-interval" style={{color:'var(--cyan)',fontWeight:800}}>INTERVAL</label><input id="sat-angle-interval" type="range" min="1" max="60" value={interval} onChange={event=>onInterval(Number(event.target.value))} className="sci-fi-slider" style={{flex:1,minWidth:'60px','--thumb-color':'var(--cyan)'}}/><strong style={{minWidth:'55px',textAlign:'right'}}>{interval} SEC</strong></div>
    <div className="sat-page-viewport" style={{border:'1px solid var(--cyan)',borderRadius:'4px',overflowY:'auto',overflowX:'hidden',overscrollBehavior:'contain',WebkitOverflowScrolling:'touch'}}>
      {!rows.length ? <div className="sat-data-empty">NO PASS SCHEDULE AVAILABLE</div> : <table className="sat-data-table sat-angle-table"><colgroup><col style={{width:'31%'}}/>{[0,1,2,3].map(n=><col key={n} style={{width:'17.25%'}}/>)}</colgroup><thead style={{position:'sticky',top:0,zIndex:4,background:'#0b1121'}}><tr><th rowSpan={2}>TIME (UTC)</th><th colSpan={2}>PREDICTED SATELLITE</th><th colSpan={2}>SUN POSITION</th></tr><tr><th>EL (°)</th><th>AZ (°)</th><th>EL (°)</th><th>AZ (°)</th></tr></thead><tbody>{rows.map(row=><tr key={row.time.getTime()}><td className="sat-pointing-time">{row.time.toISOString().slice(11,23)}</td><td className="sat-pointing-value" style={{color:'#0369a1'}}>{formatPointingAngle(row.satEl)}</td><td className="sat-pointing-value" style={{color:'#0369a1'}}>{formatPointingAngle(row.satAz)}</td><td className="sat-pointing-value" style={{color:'#b45309'}}>{formatPointingAngle(row.sunEl)}</td><td className="sat-pointing-value" style={{color:'#b45309'}}>{formatPointingAngle(row.sunAz)}</td></tr>)}</tbody></table>}
    </div>
  </div>;
}

function SatMissionListData({ plans, selectedId, onSelect, onReplay, hostRevision, scale: readingScale }) {
  useSatDataScale(readingScale);
  return <div className="sat-mission-list" style={{minHeight:0}}><div className="sat-page-viewport" style={{overflowY:'auto',overflowX:'hidden',WebkitOverflowScrolling:'touch',overscrollBehavior:'contain'}}>
    {plans.length ? <table className="sat-data-table"><colgroup><col style={{width:'50%'}}/><col style={{width:'27%'}}/><col style={{width:'23%'}}/></colgroup><thead style={{position:'sticky',top:0,zIndex:3,background:'#07121d'}}><tr><th>DATE / TIME UTC</th><th>DURATION</th><th>PLAY</th></tr></thead><tbody>{plans.map(plan => {
      const time = new Date(plan.start).toISOString();
      return <tr key={plan.id} className="sat-data-row" style={{ background: selectedId === plan.id ? 'rgba(0,234,255,.18)' : undefined }} tabIndex={0} onClick={() => onSelect(selectedId === plan.id ? null : plan.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(selectedId === plan.id ? null : plan.id); } }}><td><strong>{time.slice(11,19)}</strong><small style={{display:'block',fontSize:'calc(11px * var(--sat-text-scale,1))',color:'#adc0cc'}}>{time.slice(0,10)}</small></td><td>{plan.duration.toFixed(0)} s</td><td><button type="button" className="sat-data-action" aria-label={`Play mission ${time}`} onClick={event => { event.stopPropagation(); onReplay(plan); }}>▶</button></td></tr>;
    })}</tbody></table> : <div className="sat-data-empty">NO MISSION PLANS</div>}
  </div></div>;
}

function SatMissionWorkspace({ list, children, showList, upload, mapTools, hostRevision, scale: readingScale }) {
  const scale = useSatDataScale(readingScale);
  const bodyRef = useRef(null), bounds = useSatDataMetrics(bodyRef, hostRevision, scale);
  const [tab, setTab] = useState('map');
  const compact = bounds.width < 730 * scale;
  return <div className="sat-data-body" ref={bodyRef}>
    <div className="sat-data-toolbar">{compact && showList && <><button type="button" className="sat-data-action" aria-pressed={tab === 'map'} onClick={() => setTab('map')}>MAP</button><button type="button" className="sat-data-action" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>MISSION LIST</button></>}{upload}</div>
    <div className="sat-mission-layout" data-compact={compact}>
      <div className="sat-mission-list-pane" data-hidden={!showList || (compact && tab !== 'list')}>{list}</div>
      <div className="sat-mission-map-pane" data-hidden={compact && showList && tab !== 'map'}>{mapTools}{children}</div>
    </div>
  </div>;
}


// Visual-only layouts share the existing RF state and clock. No new renderer loop.
const SAT_VISUAL_CSS = `
  .sat-visual-header { display:grid!important; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:6px!important; padding:7px 10px!important; flex:0 0 auto; box-sizing:border-box; position:relative; z-index:20; }
  .sat-visual-heading { min-width:0; display:flex!important; flex-direction:column; align-items:flex-start; justify-content:center; gap:3px!important; }
  .sat-visual-heading strong { color:#fff; font:900 calc(clamp(12px,1.65cqw,26px) * var(--sat-text-scale,1))/1.25 Orbitron,sans-serif; letter-spacing:.35px; overflow-wrap:normal; }
  .sat-visual-heading .sat-visual-meta { display:flex; flex-wrap:wrap; gap:3px 9px; font:700 calc(clamp(12px,1.05cqw,20px) * var(--sat-text-scale,1))/1.2 Rajdhani,sans-serif; color:#bed4de; min-width:0; }
  .sat-visual-heading .sat-visual-meta span { overflow-wrap:normal; }
  .sat-visual-actions { display:flex!important; flex-wrap:wrap; justify-content:flex-end; align-items:center; gap:5px!important; min-width:0; }
  .sat-visual-actions button, .sat-visual-actions .modal-close-btn { box-sizing:border-box; min-width:30px; min-height:30px; width:auto!important; height:auto!important; padding:5px 7px!important; line-height:1.1; font-size:13px!important; border-radius:4px; }
  .sat-visual-actions .modal-close-btn { color:#c4f6ff; border:1px solid #337689; }
  .sat-visual-actions .modal-close-btn[aria-label^="Close"] { color:var(--red); border-color:#805050; }
  .sat-radar-header { align-items:flex-start!important; padding:10px 16px!important; }
  .sat-radar-title-stack { display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0; }
  .sat-radar-title-badge { display:inline-flex; align-items:center; gap:9px; min-width:0; padding:5px 12px; border:1px solid var(--green); border-radius:7px; background:linear-gradient(135deg,rgba(0,255,102,.12),rgba(0,10,15,.88)); box-shadow:0 0 18px rgba(0,255,102,.28),inset 0 0 10px rgba(0,255,102,.08); }
  .sat-radar-title-badge img { width:clamp(28px,2.6cqw,42px); height:auto; border:1px solid var(--cyan); border-radius:3px; box-shadow:0 0 9px rgba(0,234,255,.35); flex:0 0 auto; }
  .sat-radar-title-badge strong { color:#fff; font:900 calc(clamp(18px,2cqw,30px) * var(--sat-text-scale,1))/1 Orbitron,sans-serif; letter-spacing:1px; white-space:nowrap; text-shadow:0 0 12px rgba(255,255,255,.24); }
  .sat-radar-metrics { display:grid; grid-template-columns:1fr 1fr; align-items:start; gap:12px; padding:2px 18px 8px; z-index:10; flex:0 0 auto; pointer-events:none; }
  .sat-radar-metric-card { display:inline-flex!important; align-items:baseline!important; justify-content:space-between!important; gap:8px!important; width:clamp(122px,13.5cqw,184px); min-width:0; box-sizing:border-box; padding:7px 12px; border:1px solid currentColor; border-radius:7px; background:linear-gradient(135deg,rgba(5,10,20,.92),rgba(0,5,10,.96)); box-shadow:0 0 16px rgba(0,0,0,.45),inset 0 0 10px rgba(255,255,255,.04); white-space:nowrap; }
  .sat-radar-metric-card:first-child { justify-self:start; text-align:left; }
  .sat-radar-metric-card:last-child { justify-self:end; text-align:right; }
  .sat-radar-metric-label { color:#dbe3e8; font:900 calc(clamp(12px,1.05cqw,17px) * var(--sat-text-scale,1))/1 Rajdhani,sans-serif; letter-spacing:.5px; }
  .sat-radar-metric-card strong { font:900 calc(clamp(22px,2.45cqw,38px) * var(--sat-text-scale,1))/1 Orbitron,sans-serif; letter-spacing:.3px; font-variant-numeric:tabular-nums; }
  .sat-radar-max-el { position:absolute!important; right:18px; bottom:12px; z-index:25; pointer-events:none; color:var(--cyan); }
  .sat-radar-audio { color:var(--green); background:#06231a; border:1px solid currentColor; border-radius:4px; padding:5px 8px; min-height:28px; cursor:pointer; font:700 calc(12px * var(--sat-text-scale,1)) Rajdhani,sans-serif; }
  .sat-radar-plot { position:relative; min-width:0; min-height:0; flex:1 1 0; z-index:5; font-family:Rajdhani,sans-serif; }
  .sat-radar-legend { position:relative; z-index:10; display:flex; flex-wrap:wrap; justify-content:center; gap:3px 13px; padding:4px 8px 7px; color:#c2d5db; flex:0 0 auto; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1.2 Rajdhani,sans-serif; }
  .sat-radar-legend span { white-space:nowrap; }
  /* RADAR SKYPLOT LOCK: medium/large hosts use overlays so Browser Full Screen and
     detached windows preserve the same center/radius and do not lose plot height.
     Compact Classic popups keep the existing stacked layout. No tracking math changes. */
  @container (min-width: 650px) and (min-height: 560px) {
    .sat-radar-metrics { position:absolute; top:72px; left:0; right:0; z-index:25; pointer-events:none; padding:0 24px; }
    .sat-radar-max-el { right:26px; bottom:24px; }
    .sat-radar-legend { position:absolute; left:26px; right:auto; bottom:24px; z-index:25; pointer-events:none; flex-direction:column; align-items:flex-start; justify-content:flex-start; gap:5px; padding:9px 13px; border:1px solid #51646d; border-radius:6px; background:rgba(2,10,16,.82); box-shadow:0 5px 18px rgba(0,0,0,.55); }
    .sat-radar-plot { flex:1 1 0; margin:0; min-height:0; }
  }
  .analyzer-modal { container-type:size; container-name:sat-analyzer; }
  .rf-analyzer-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:5px 10px; padding:3px 9px 6px; flex:0 0 auto; color:#b5c8d6; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; }
  .rf-analyzer-toolbar button { border:1px solid currentColor; border-radius:4px; min-height:27px; padding:4px 8px; font:700 calc(clamp(12px,1.1cqw,22px) * var(--sat-text-scale,1))/1.1 Rajdhani,sans-serif; cursor:pointer; }
  .rf-analyzer-body { display:grid!important; grid-template-columns:minmax(78px,.7fr) minmax(0,2fr); gap:8px!important; padding:0 8px 8px!important; min-width:0; min-height:0; flex:1 1 0; }
  .rf-iq-pane { min-width:0; min-height:0; padding:7px!important; display:flex; flex-direction:column; gap:5px; }
  .rf-iq-heading { flex:0 0 auto; color:#afc3d3; text-align:center; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1.25 Rajdhani,sans-serif; }
  .rf-iq-heading strong { display:block; color:#e6f2fa; }
  .rf-iq-plot { flex:1 1 0; position:relative; min-width:0; min-height:0; }
  .rf-iq-mod { flex:0 0 auto; display:flex; flex-wrap:wrap; justify-content:center; gap:3px 9px; color:#d8e6ef; text-align:center; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1.2 Rajdhani,sans-serif; }
  .rf-channel-stack { display:flex; flex-direction:column; gap:7px!important; min-width:0; min-height:0; overflow:visible; }
  .rf-spectrum-channel { flex:1 1 0!important; min-height:0!important; min-width:0; display:flex; flex-direction:column; gap:3px; padding:5px 7px!important; box-sizing:border-box; }
  .rf-channel-header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:2px 8px; flex:0 0 auto; min-width:0; margin:0!important; color:#c3d8e5; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif!important; }
  .rf-channel-header strong { font-weight:900; }
  .rf-channel-header > * { white-space:normal!important; }
  .rf-span-controls { display:flex; align-items:center; gap:7px; flex:0 0 auto; min-width:0; }
  .rf-span-controls button { flex:0 0 auto; background:transparent; border:1px solid currentColor; border-radius:3px; padding:3px 5px; min-height:24px; color:inherit; font:700 calc(clamp(10px,1cqw,18px) * var(--sat-text-scale,1))/1 Rajdhani,sans-serif; cursor:pointer; }
  .rf-span-controls input[type=range] { flex:1; min-width:28px; width:0!important; margin:0!important; height:5px!important; }
  .rf-span-controls output { flex:0 0 auto; font:700 calc(clamp(11px,1.05cqw,20px) * var(--sat-text-scale,1))/1 Rajdhani,sans-serif; white-space:nowrap; }
  .rf-spectrum-plot { flex:1 1 0; position:relative; width:100%; min-height:20px!important; min-width:0; }
  .rf-spectrum-plot > canvas, .rf-iq-plot > canvas { position:absolute; inset:0; width:100%; height:100%; }
  .rf-spectrum-readout { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:2px 7px; flex:0 0 auto; min-width:0; color:#acc1d1; font:700 calc(clamp(10.5px,1cqw,18px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; font-variant-numeric:tabular-nums; }
  .rf-spectrum-readout span { white-space:nowrap; }
  .rf-spectrum-readout b { color:#e8f5fa; }
  .rf-analyzer-body.rf-spectrum-only { display:flex!important; padding:0 8px 8px!important; min-width:0; min-height:0; flex:1 1 0; }
  .rf-analyzer-body.rf-spectrum-only .rf-channel-stack { flex:1 1 0; width:100%; }
  .rf-instrument-grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:3px 8px; padding:3px 2px 1px; color:#aebdca; font:700 calc(clamp(9.5px,.82cqw,15px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; font-variant-numeric:tabular-nums; }
  .rf-instrument-grid span { min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rf-instrument-grid b { color:#f0f7fb; font-weight:900; }
  .rf-analyzer-toolbar .rf-iq-open-btn { margin-left:auto; color:#aef7ff; border-color:#00a9c7; background:linear-gradient(180deg,#06202b,#03131b); box-shadow:inset 0 0 10px rgba(0,234,255,.08); }
  .rf-analyzer-toolbar .rf-sim-badge { color:#9fb2c0; margin-left:2px; white-space:nowrap; }

  /* SIGNAL ANALYZER INSTRUMENT UI — presentation only.
     Keep the RF/DSP model untouched; this layer makes the popup read like a
     professional bench/field spectrum analyzer without copying a vendor chassis. */
  .analyzer-modal {
    background:linear-gradient(180deg,#080b0f 0%,#05070a 100%)!important;
    border-color:#43515b!important; border-radius:4px!important;
    box-shadow:0 12px 42px rgba(0,0,0,.82),inset 0 0 0 1px rgba(255,255,255,.035)!important;
  }
  .analyzer-modal .sat-visual-header {
    min-height:52px; padding:7px 12px!important; gap:10px!important;
    background:linear-gradient(180deg,#20252a 0%,#12161a 100%);
    border-bottom:1px solid #46515a; box-shadow:inset 0 -1px 0 #050607;
  }
  .analyzer-modal .sat-visual-heading { gap:1px!important; }
  .analyzer-modal .sat-visual-heading strong {
    font-family:Rajdhani,Arial,sans-serif!important; font-weight:900!important;
    letter-spacing:.8px!important; color:#f4f7f9!important; text-shadow:none!important;
  }
  .analyzer-modal .sat-visual-heading .sat-visual-meta {
    font-family:Rajdhani,Arial,sans-serif!important; color:#d0d8dd!important; gap:2px 10px!important;
  }
  .analyzer-modal .sat-visual-actions button,
  .analyzer-modal .sat-visual-actions .modal-close-btn {
    background:#11171b!important; border-color:#586873!important; border-radius:3px!important;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);
  }
  .analyzer-modal .rf-analyzer-toolbar {
    min-height:39px; padding:5px 11px!important; gap:6px 10px!important;
    background:linear-gradient(180deg,#11161a,#0b0e11); border-bottom:1px solid #39444c;
  }
  .analyzer-modal .rf-analyzer-toolbar button {
    min-height:28px; border-radius:3px; background:#0a0d10!important;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.025); letter-spacing:.2px;
  }
  .analyzer-modal .rf-analyzer-toolbar button[aria-pressed="true"] {
    box-shadow:0 0 9px color-mix(in srgb,currentColor,transparent 68%),inset 0 0 0 1px currentColor;
  }
  .analyzer-modal .rf-analyzer-toolbar .rf-iq-open-btn {
    margin-left:auto; color:#c9f8ff!important; border-color:#528292!important;
    background:linear-gradient(180deg,#15242a,#0b1418)!important; box-shadow:none;
  }
  .analyzer-modal .rf-analyzer-body.rf-spectrum-only { padding:7px 9px 9px!important; background:#05070a; }
  .analyzer-modal .rf-channel-stack { gap:8px!important; }
  .analyzer-modal .rf-spectrum-channel {
    padding:0!important; gap:0!important; overflow:hidden;
    background:#080b0f!important; border:1px solid #46545f!important; border-radius:3px!important;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.025);
  }
  .analyzer-modal .rf-channel-header {
    min-height:29px; align-items:center; padding:4px 8px!important; margin:0!important;
    background:linear-gradient(180deg,#181d22,#101419); border-bottom:1px solid #3d4850;
  }
  .analyzer-modal .rf-channel-header strong { letter-spacing:.25px; }
  .analyzer-modal .rf-span-controls {
    min-height:31px; padding:3px 8px; gap:8px; background:#0d1115; border-bottom:1px solid #2b343b;
  }
  .analyzer-modal .rf-span-controls button {
    min-height:24px; border-radius:2px; background:#090b0e!important; font-weight:900;
  }
  .analyzer-modal .rf-span-controls input[type=range] { height:4px!important; }
  .analyzer-modal .rf-span-controls output { min-width:78px; text-align:right; font-weight:900; }
  .analyzer-modal .rf-instrument-grid {
    grid-template-columns:repeat(8,minmax(0,1fr)); gap:2px 8px; padding:5px 8px;
    background:#11161a; border-bottom:1px solid #303941; color:#b7c2c9;
  }
  .analyzer-modal .rf-instrument-grid span { text-align:left; }
  .analyzer-modal .rf-instrument-grid b { color:#edf2f5; }
  .analyzer-modal .rf-spectrum-plot { background:#07090c; min-height:70px!important; }
  .analyzer-modal .rf-spectrum-readout {
    min-height:27px; padding:4px 8px; background:linear-gradient(180deg,#11161a,#0b0e11);
    border-top:1px solid #303941; color:#b8c5cc;
  }
  .analyzer-modal .rf-spectrum-readout b { color:#f0f4f6; }
  @container sat-analyzer (max-width:1100px) {
    .analyzer-modal .rf-instrument-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
  }
  @container sat-analyzer (max-width:650px) {
    .analyzer-modal .rf-instrument-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .analyzer-modal .rf-analyzer-toolbar .rf-iq-open-btn { margin-left:0; }
  }

  /* Analyzer only: independent frequency axes for simultaneous polarization paths. */
  .analyzer-modal .rf-channel-stack[data-dual-x="true"] {
    display:grid; grid-template-columns:repeat(2,minmax(0,1fr));
    grid-auto-rows:minmax(260px,1fr); overflow:auto;
  }
  .analyzer-modal .rf-channel-stack[data-dual-x="true"] > [data-band="s"] { grid-column:1 / -1; }
  .analyzer-modal .rf-channel-stack[data-dual-x="true"] > [data-band="x"] .rf-instrument-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
  @container sat-analyzer (max-width:720px) {
    .analyzer-modal .rf-channel-stack[data-dual-x="true"] { grid-template-columns:minmax(0,1fr); grid-auto-rows:minmax(280px,1fr); }
  }

  .iq-modal { container-type:size; container-name:sat-iq; }
  .rf-iq-popup-body { display:flex; flex-direction:column; flex:1 1 0; min-width:0; min-height:0; gap:7px; padding:0 10px 10px; }
  .rf-iq-popup-toolbar { display:flex; align-items:center; gap:7px; flex-wrap:wrap; color:#b8cad5; font:700 calc(clamp(11px,1.05cqw,18px) * var(--sat-text-scale,1))/1.1 Rajdhani,sans-serif; }
  .rf-iq-popup-toolbar button { border:1px solid currentColor; border-radius:4px; background:#06111c; padding:5px 9px; color:#b8cad5; cursor:pointer; font:800 inherit; }
  .rf-iq-popup-toolbar button[data-active="true"] { color:#fff; box-shadow:0 0 12px currentColor; }
  .rf-iq-popup-plot { flex:1 1 0; min-width:0; min-height:0; position:relative; border:1px solid #223445; border-radius:7px; background:#0b1121; overflow:hidden; }
  .rf-iq-popup-plot > canvas { position:absolute; inset:0; width:100%; height:100%; }
  .rf-iq-popup-footer { display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px 12px; color:#9eb1bf; font:700 calc(clamp(10px,1cqw,16px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; }
  @container sat-analyzer (max-width:720px) { .rf-instrument-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } .rf-analyzer-toolbar .rf-iq-open-btn { margin-left:0; } }
  .iq-modal .rf-iq-pol-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:minmax(150px,1fr); flex:1 1 0; min-height:0; gap:8px; overflow:auto; }
  .iq-modal .rf-iq-pol-cell { display:flex; flex-direction:column; min-width:0; min-height:0; gap:4px; }
  .iq-modal .rf-iq-pol-cell[data-band="s"] { grid-column:1 / -1; }
  .iq-modal .rf-iq-pol-label { flex:0 0 auto; font:700 clamp(11px,1.2cqw,20px)/1.2 Rajdhani,sans-serif; color:#ffcc00; }
  @container sat-iq (max-width:480px) { .iq-modal .rf-iq-pol-grid { grid-template-columns:minmax(0,1fr); } }
  .flow-viewport { flex:1 1 0; min-width:0; min-height:0; overflow:visible!important; }
  .flow-content { width:100%; height:100%; min-width:0!important; min-height:0!important; position:relative; container-type:size; container-name:sat-flow; }
  .sat-flow-layout { height:100%; width:100%; box-sizing:border-box; display:grid; grid-template-rows:minmax(38px,.22fr) minmax(0,1fr); gap:5px; padding:0 8px 8px; }
  .sat-flow-spacecraft { min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; gap:12px; position:relative; }
  .sat-flow-spacecraft img { height:100%; max-height:100px; width:clamp(46px,14cqw,135px); min-width:0; object-fit:contain; filter:drop-shadow(0 5px 8px #000); }
  .sat-flow-spacecraft span { color:#8ec8d4; font:700 calc(clamp(11px,1.4cqw,16px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; text-align:center; }
  .sat-flow-lanes { min-height:0; min-width:0; display:grid; grid-template-rows:repeat(2,minmax(0,1fr)); gap:7px; }
  @keyframes sat-flow-pulse { 0%,100% { opacity:.45; } 50% { opacity:1; } }
  .sat-flow-lanes[data-active="true"] .flow-node::before, .sat-flow-lanes[data-active="true"] .sat-flow-monitor::before { animation:sat-flow-pulse 1.1s infinite; }
  .sat-flow-lane { display:flex; flex-direction:column; gap:4px; min-width:0; min-height:0; }
  .sat-flow-lane-heading { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; column-gap:8px; row-gap:1px; flex:0 0 auto; color:var(--lane-color); font:700 calc(clamp(11px,1.35cqw,15px) * var(--sat-text-scale,1))/1.15 Rajdhani,sans-serif; }
  .sat-flow-lane-heading span { white-space:nowrap; }
  .sat-flow-chain { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.3fr); column-gap:13px; min-width:0; min-height:0; flex:1 1 0; }
  .sat-flow-chain .flow-node { width:auto; height:auto; min-width:0; min-height:0; margin:0; padding:4px; position:relative; transform:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; background:linear-gradient(145deg,#041927ee,#01060bee); border:1px solid var(--lane-color); border-radius:5px; box-sizing:border-box; box-shadow:inset 0 0 12px #002b3833; }
  .sat-flow-chain .flow-node.active { box-shadow:0 0 7px color-mix(in srgb,var(--lane-color),transparent 65%),inset 0 0 10px #00362699; }
  .sat-flow-chain .flow-node:not(:first-child)::before, .sat-flow-chain .sat-flow-monitor::before { content:attr(data-arrow); position:absolute; right:calc(100% + 1px); top:50%; width:11px; color:var(--lane-color); text-align:center; font:900 16px/1 Rajdhani,sans-serif; transform:translateY(-50%); }
  .sat-flow-chain .n-icon { width:clamp(22px,3.4cqw,42px); height:clamp(22px,3.4cqw,42px); flex:0 0 auto; margin:0; }
  .sat-flow-chain .n-title { color:#f3faff; font:900 calc(clamp(11px,1.4cqw,22px) * var(--sat-text-scale,1))/1.15 Orbitron,sans-serif; letter-spacing:0; text-align:center; max-width:100%; white-space:normal; overflow-wrap:normal; }
  .sat-flow-chain .n-sub { color:#c6e0e9; font:700 calc(clamp(11px,1.35cqw,20px) * var(--sat-text-scale,1))/1.25 Rajdhani,sans-serif; letter-spacing:0; text-align:center; max-width:100%; white-space:normal; overflow-wrap:normal; margin:0; }
  .sat-flow-monitor { min-width:0; min-height:0; position:relative; display:flex; flex-direction:column; gap:3px; padding:4px; color:var(--lane-color); background:#020b14; border:1px solid var(--lane-color); border-radius:5px; cursor:pointer; box-sizing:border-box; text-align:left; }
  .sat-flow-monitor-header { display:flex; flex-wrap:wrap; justify-content:space-between; gap:1px 5px; font:700 calc(clamp(10px,1.2cqw,14px) * var(--sat-text-scale,1))/1.1 Rajdhani,sans-serif; }
  .sat-flow-monitor-header span { white-space:nowrap; }
  .sat-flow-monitor-charts { flex:1 1 0; min-width:0; min-height:0; display:flex; gap:4px; }
  .sat-flow-mini-iq { width:36%; min-width:0; height:100%; }
  .sat-flow-mini-spectrum { flex:1; min-width:0; height:100%; }
  .sat-flow-monitor svg { background:#0b1121; border:1px solid #294357; border-radius:3px; box-sizing:border-box; }
  @container sat-flow (max-width:540px) and (min-height:300px) {
    .sat-flow-layout { grid-template-rows:minmax(40px,.15fr) minmax(0,1fr); }
    .sat-flow-lanes { grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:minmax(0,1fr); gap:9px; }
    .sat-flow-lane-heading { min-height:calc(3.45em + 2px); flex-direction:column; justify-content:center; align-items:flex-start; }
    .sat-flow-lane-heading span { white-space:normal; max-width:100%; }
    .sat-flow-chain { grid-template-columns:minmax(0,1fr); grid-template-rows:repeat(3,minmax(0,1fr)) minmax(48px,1.25fr); row-gap:11px; }
    .sat-flow-chain .flow-node { display:grid; grid-template-columns:28px minmax(0,1fr); grid-template-rows:auto auto; column-gap:4px; align-content:center; padding:4px; }
    .sat-flow-chain .n-icon { grid-row:1/3; width:26px; height:26px; }
    .sat-flow-chain .n-title, .sat-flow-chain .n-sub { text-align:left; }
    .sat-flow-chain .flow-node:not(:first-child)::before, .sat-flow-chain .sat-flow-monitor::before { content:attr(data-down-arrow); left:50%; right:auto; top:-11px; width:16px; height:10px; transform:translateX(-50%); line-height:10px; }
  }
  @container sat-flow (max-height:265px) {
    .sat-flow-layout { grid-template-rows:30px minmax(0,1fr); gap:3px; padding:0 6px 6px; }
    .sat-flow-lanes { gap:5px; }
    .sat-flow-lane { gap:2px; }
    .sat-flow-chain .n-icon { width:22px; height:22px; }
    .sat-flow-chain .flow-node { padding:3px; gap:1px; }
  }
  @media (pointer:coarse) {
    .sat-visual-actions button, .sat-visual-actions .modal-close-btn { min-height:36px; min-width:36px; }
    .sat-radar-audio, .rf-analyzer-toolbar button, .rf-span-controls button { min-height:32px; }
    .rf-span-controls input[type=range] { min-height:24px!important; }
  }
`;

function SatSignalFlow({ rfState, rfProfile, satSpecs, stationId, satelliteImage, onSatelliteError, openReceiver }) {
  const hardware = (kind, label, title, subtitle, color, arrow, downArrow, extra = null) => (
    <div className={`flow-node ${rfState.locked ? 'active' : ''}`} data-arrow={arrow} data-down-arrow={downArrow}>
      <FlowHardwareIcon kind={kind} color={color} label={label} />
      <div className="n-title">{title}</div><div className="n-sub">{subtitle}</div>
      {extra}
    </div>
  );
  const constellationPoints = channel => channel.mod.includes('BPSK')
    ? [[22,50],[78,50]]
    : [[22,22],[78,22],[22,78],[78,78]];
  const miniSpectrumPath = isX => {
    if (!rfState.eligible) return 'M0 91 L8 89 L16 92 L24 90 L32 93 L40 90 L48 92 L56 89 L64 92 L72 90 L80 93 L88 90 L100 92';
    if (!rfState.locked) return isX
      ? 'M0 92 L28 92 C38 91 42 70 50 66 C58 70 62 91 72 92 L100 92'
      : 'M0 94 L40 94 C45 93 47 72 50 62 C53 72 55 93 60 94 L100 94';
    return isX
      ? 'M0 92 L24 92 C34 92 38 36 50 28 C62 36 66 92 76 92 L100 92'
      : 'M0 94 L42 94 C46 94 47.5 28 50 12 C52.5 28 54 94 58 94 L100 94';
  };
  const monitor = (channel, isX) => {
    const points = constellationPoints(channel);
    return (
      <div className="sat-flow-monitor" data-arrow="→" data-down-arrow="↓" onClick={() => openReceiver(isX ? 'x' : 's', 'spectrum')}>
        <div className="sat-flow-monitor-header"><strong>{isX ? 'BASEBAND' : 'TT&C'}</strong><span>{channel.mod} · IF {channel.freq} MHz</span></div>
        <div className="sat-flow-monitor-charts">
          <svg className="sat-flow-mini-iq" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="button" tabIndex={0} onClick={e => { e.stopPropagation(); openReceiver(isX ? 'x' : 's', 'iq'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openReceiver(isX ? 'x' : 's', 'iq'); } }} aria-label={`Open SIM ${isX ? 'X-band' : 'S-band'} IQ constellation`}>
            <path d="M0 50 H100 M50 0 V100" stroke="#63748d" strokeWidth="1"/><circle cx="50" cy="50" r="35" fill="none" stroke="#607580" strokeDasharray="4 4"/>
            {rfState.locked && points.map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="4" fill={isX?'#ff6666':'#00eaff'}/>)}
          </svg>
          <svg className="sat-flow-mini-spectrum" preserveAspectRatio="none" viewBox="0 0 100 100" role="button" tabIndex={0} onClick={e => { e.stopPropagation(); openReceiver(isX ? 'x' : 's', 'spectrum'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openReceiver(isX ? 'x' : 's', 'spectrum'); } }} aria-label={`Open SIM ${isX ? 'X-band' : 'S-band'} spectrum`}>
            <title>{`SIM · ${channel.mod} · ${isX ? 'X-BAND PAYLOAD' : 'S-BAND TM'}`}</title>
            <path d="M0 25H100 M0 50H100 M0 75H100 M25 0V100 M50 0V100 M75 0V100" stroke="#324251" strokeWidth=".6" fill="none"/>
            <path d={miniSpectrumPath(isX)} fill="none" stroke={rfState.eligible?(isX?'#ffcc00':'#00eaff'):'#7b8e9d'} strokeWidth="1.7"/>
          </svg>
        </div>
      </div>
    );
  };
  return <div className="sat-flow-layout">
    <div className="sat-flow-spacecraft">
      <span>S-BAND TM ↓<br/>TC ↑ · SIM</span>
      <img src={satelliteImage} onError={onSatelliteError} alt="Satellite"/>
      <span>X-BAND PAYLOAD ↓<br/>GROUND PROCESSING</span>
    </div>
    <div className="sat-flow-lanes" data-active={rfState.locked}>
      <section className="sat-flow-lane" style={{'--lane-color':'var(--cyan)'}} aria-label="S-band signal path">
        <div className="sat-flow-lane-heading"><span><b>S-BAND</b> · TM ↓ {satSpecs.tmFreq}</span><span>TC ↑ {satSpecs.tcFreq}</span><span>IF 70 MHz</span></div>
        <div className="sat-flow-chain">
          {hardware('antenna','S-band antenna',stationId,'S-BAND ANTENNA','var(--cyan)','⇄','↕')}
          {hardware('converter','S-band converter','UP/DOWN','S-BAND CONVERTER','var(--cyan)','⇄','↕', <span className="sat-flow-node-tag">HPA · TC UP</span>)}
          {hardware('router','TT and C baseband','TT&C','BASEBAND SYSTEM','var(--gold)','⇄','↕')}
          {monitor(rfProfile.sBand,false)}
        </div>
      </section>
      <section className="sat-flow-lane" style={{'--lane-color':'var(--green)'}} aria-label="X-band signal path">
        <div className="sat-flow-lane-heading"><span><b>X-BAND</b> · DOWNLINK ↓ {satSpecs.xBandFreq}</span><span>IF 720 MHz</span></div>
        <div className="sat-flow-chain">
          {hardware('antenna','X-band antenna',stationId,'X-BAND ANTENNA','var(--green)','→','↓')}
          {hardware('tuner','Downconverter','X-BAND',<>DOWN<wbr/>CONVERTER</>,'#00aaff','→','↓')}
          {hardware('baseband','Baseband demodulator','BASEBAND','DEMODULATOR','var(--red)','→','↓')}
          {monitor(rfProfile.xBand,true)}
        </div>
      </section>
    </div>
  </div>;
}

// A tool keeps one portal container across hosts. Moving it never mounts another
// SatOrbitCore, orbit clock, audio engine, network poller or notification sender.
const SAT_WORKSPACE_TOOLS = {
  radar: 'Radar Skyplot', diagram: 'Signal Flow', analyzer: 'Signal Analyzer', iq: 'IQ Constellation',
  antenna3d: 'Antenna 3D', weather: 'Weather Center', gs: 'Ground Station',
  db: 'Satellite Database', pass: 'Pass Schedule', angles: 'Pointing Angles', img: 'Imaging Plan'
};
// These three tools, plus the existing Globe, are the optional Quad workspace.
const SAT_QUAD_TOOL_IDS = ['radar', 'diagram', 'analyzer'];

const SAT_WORKSPACE_CSS = `
  .sat-globe-host { position: fixed; inset: 0; overflow: hidden; }
  .sat-globe-host[data-quad="true"] { border: 1px solid #244755; border-radius: 8px; z-index: 20000; }
  .sat-globe-host[data-quad="true"] .flat-map-wrap { position: absolute!important; inset: 0!important; width: 100%!important; height: 100%!important; margin: 0!important; transform: none!important; }
  .sat-globe-host[data-quad="true"] .flat-map-container { width: 100%!important; max-height: 100%!important; transform: none!important; }
  .sat-tool-placeholder { display: contents; }
  .sat-tool-surface[data-host="quad"], .sat-tool-surface[data-host="window"] { position: fixed; overflow: hidden; z-index: 20001; border-radius: 8px; background: #010408; }
  .sat-tool-surface[data-host="window"] { inset: 0 0 var(--sat-viewer-status-height,26px); border-radius: 0; }
  .sat-tool-surface[data-host="quad"] > div, .sat-tool-surface[data-host="window"] > div {
    position: absolute!important; inset: 0!important; width: 100%!important; height: 100%!important;
    min-width: 0!important; min-height: 0!important; max-width: none!important; max-height: none!important;
    resize: none!important; transform: none!important; margin: 0!important; transition: none!important; box-sizing: border-box;
  }
  .sat-tool-surface:not([data-host="classic"]) .modal-header { cursor: default!important; gap: 8px; padding: 8px 12px!important; }
  .sat-tool-surface:not([data-host="classic"]) .modal-header > div { min-width: 0; }
  .sat-tool-surface .modal-header { box-sizing: border-box; }
  .sat-tool-surface .sat-popout-btn { flex-shrink: 0; }

  /* MULTI-VIEW 4-UP NORMALIZATION — equal visual density inside equal 50/50 cells.
     Classic windows and detached windows are intentionally excluded. */
  .sat-tool-surface[data-host="quad"] {
    --sat-text-scale:.78;
    container-type:size;
  }
  .sat-tool-surface[data-host="quad"] > div {
    inset:0!important; width:100%!important; height:100%!important;
    min-width:0!important; min-height:0!important; max-width:none!important; max-height:none!important;
    border-radius:8px!important; box-sizing:border-box!important;
  }
  .sat-tool-surface[data-host="quad"] .modal-header,
  .sat-tool-surface[data-host="quad"] .sat-visual-header {
    flex:0 0 46px!important; min-height:46px!important; max-height:46px!important;
    padding:6px 10px!important; margin:0!important; box-sizing:border-box!important; overflow:hidden!important;
  }
  .sat-tool-surface[data-host="quad"] .sat-visual-actions button,
  .sat-tool-surface[data-host="quad"] .modal-header button {
    min-width:28px!important; min-height:28px!important; width:28px!important; height:28px!important;
    padding:3px!important; margin:0!important;
  }

  /* Radar: metrics/legend become overlays in 4-UP so the circle receives the same
     usable vertical area as the other three cells. */
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-header {
    align-items:center!important; padding:5px 10px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-title-badge {
    padding:3px 8px!important; gap:6px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-title-badge img { width:26px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-title-badge strong { font-size:16px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metrics {
    position:absolute!important; top:50px!important; left:0!important; right:0!important; z-index:25!important;
    padding:0 12px!important; gap:8px!important; pointer-events:none!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metric-card {
    min-width:104px!important; padding:4px 8px!important; gap:5px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metric-label { font-size:10px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metric-card strong { font-size:22px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-plot {
    flex:1 1 0!important; margin:0!important; min-height:0!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-legend {
    position:absolute!important; left:50%!important; bottom:7px!important; transform:translateX(-50%)!important;
    z-index:25!important; display:flex!important; flex-direction:row!important; flex-wrap:nowrap!important;
    gap:10px!important; padding:3px 7px!important; border:0!important; background:rgba(1,4,8,.62)!important;
    font-size:10px!important; white-space:nowrap!important;
  }

  /* Detached Radar keeps the same visual balance as Browser Full Screen. */
  .sat-tool-surface[data-host="window"][data-tool="radar"] .sat-radar-header {
    align-items:center!important; min-height:58px!important; padding:8px 14px!important;
  }
  .sat-tool-surface[data-host="window"][data-tool="radar"] .sat-radar-plot {
    flex:1 1 0!important; min-height:0!important; margin:0!important;
  }

  /* Analyzer: reserve the same header baseline and compact the toolbar uniformly. */
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-analyzer-toolbar {
    min-height:34px!important; max-height:34px!important; padding:3px 8px!important; gap:4px 8px!important; overflow:hidden!important;
    font-size:10px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-analyzer-toolbar button {
    min-height:24px!important; padding:3px 6px!important; font-size:10px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-analyzer-body {
    padding:0 7px 7px!important; gap:7px!important;
  }

  /* Signal Flow: the original Classic header uses presentation-size inline fonts.
     Normalize only inside 4-UP so the content area matches Radar/Analyzer visually. */
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header {
    display:grid!important; grid-template-columns:minmax(0,1fr) auto!important; align-items:center!important; gap:8px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:first-child {
    flex:initial!important; min-width:0!important; gap:8px!important; overflow:hidden!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:first-child > div:first-child {
    font-size:13px!important; letter-spacing:1px!important; white-space:nowrap!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:first-child > div:first-child span { font-size:15px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .status-badge-top {
    padding:2px 7px!important; border-width:1px!important; gap:4px!important; box-shadow:none!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .status-badge-top > div { width:7px!important; height:7px!important; margin-right:4px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .status-badge-top span { font-size:9px!important; letter-spacing:.7px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(2) { display:none!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) {
    flex:initial!important; min-width:0!important; gap:7px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:first-child {
    padding-right:7px!important; min-width:0!important; overflow:hidden!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:first-child img { width:22px!important; margin-right:6px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:first-child span {
    font-size:13px!important; letter-spacing:1px!important; overflow:hidden!important; text-overflow:ellipsis!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:last-child { gap:5px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .flow-content { overflow:hidden!important; }
  /* TSX SIGNAL FLOW MULTI-VIEW FIX: preserve the LOCKED Standalone geometry.
     The quad view scales the complete Signal Flow body uniformly instead of
     moving individual RF labels/HPA elements, so all lanes keep their spacing. */
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal {
    --sat-flow-quad-scale:.82;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal > .modal-header + div {
    position:absolute!important; left:0!important; top:40px!important;
    width:121.951%!important; height:calc(121.951% - 48.78px)!important;
    flex:none!important; transform:scale(var(--sat-flow-quad-scale))!important;
    transform-origin:top left!important; overflow:visible!important;
  }
  /* 4-UP ONLY: use the dedicated responsive Signal Flow renderer at native cell size.
     Focus/expanded Multi-View and Classic/Alone keep the locked engineering blueprint. */
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal.diagram-quad-compact > .modal-header + div {
    position:relative!important; left:auto!important; top:auto!important;
    width:100%!important; height:auto!important; min-height:0!important;
    flex:1 1 0!important; transform:none!important; transform-origin:center!important;
    overflow:hidden!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal.diagram-quad-compact .sat-flow-layout {
    padding:1px 8px 8px!important; gap:5px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal.diagram-quad-compact .sat-flow-chain .flow-node {
    aspect-ratio:auto!important; border-width:1px!important; border-color:var(--lane-color)!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .diagram-modal.diagram-quad-compact .sat-flow-node-tag {
    display:inline-flex; align-items:center; justify-content:center; margin-top:2px;
    padding:1px 4px; border:1px solid rgba(255,204,0,.72); border-radius:3px;
    color:#ffe66a; background:rgba(255,204,0,.07); white-space:nowrap;
    font:900 calc(clamp(8px,.95cqw,11px) * var(--sat-text-scale,1))/1.05 Rajdhani,sans-serif;
    letter-spacing:.3px;
  }
  /* MULTI-VIEW FINAL PHASE — presentation dashboard only.
     Protected full-size tools remain untouched; every rule below applies ONLY in 4-UP. */
  .sat-globe-host[data-quad="true"],
  .sat-tool-surface[data-host="quad"] {
    background:#010408!important;
    box-shadow:0 0 0 1px rgba(255,255,255,.025), 0 10px 28px rgba(0,0,0,.48)!important;
    box-sizing:border-box!important;
    overflow:hidden!important;
  }
  .sat-globe-host[data-quad="true"] { border-color:rgba(0,234,255,.42)!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] { border:1px solid rgba(0,255,102,.52)!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] { border:1px solid rgba(255,0,255,.42)!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] { border:1px solid rgba(0,234,255,.42)!important; }

  /* Keep the 4-UP dashboard clean: detailed controls stay available after Expand. */
  .sat-tool-surface[data-host="quad"] .sat-popout-btn { display:none!important; }
  /* TSX FINAL POLISH: Radar keeps a compact mute control in 4-UP. The button
     uses the existing global isMuted state; no new audio state or radar geometry. */
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-audio {
    display:flex!important; align-items:center!important; justify-content:center!important;
    width:30px!important; min-width:30px!important; height:30px!important; min-height:30px!important;
    padding:0!important; font-size:14px!important; line-height:1!important; letter-spacing:0!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-visual-actions .modal-close-btn:last-child,
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .sat-visual-actions .modal-close-btn:last-child,
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:last-child .modal-close-btn:last-child {
    display:none!important;
  }

  /* Analyzer compact summary: two live traces remain visible; dense instrument rows move to Expand view. */
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-iq-open-btn,
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-instrument-grid { display:none!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .sat-visual-heading strong { font-size:15px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .sat-visual-meta { font-size:9px!important; gap:2px 6px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-analyzer-toolbar {
    flex-wrap:nowrap!important; min-height:30px!important; max-height:30px!important; padding:3px 7px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-analyzer-toolbar .rf-sim-badge {
    overflow:hidden!important; text-overflow:ellipsis!important; white-space:nowrap!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-channel-stack { gap:5px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-channel-header {
    min-height:22px!important; padding:2px 6px!important; font-size:9px!important; flex-wrap:nowrap!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-channel-header > * {
    white-space:nowrap!important; overflow:hidden!important; text-overflow:ellipsis!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-span-controls {
    min-height:22px!important; padding:2px 6px!important; gap:5px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-span-controls button {
    min-height:20px!important; padding:2px 4px!important; font-size:9px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-span-controls output { min-width:58px!important; font-size:9px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-spectrum-readout {
    min-height:20px!important; padding:2px 6px!important; font-size:9px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="analyzer"] .rf-spectrum-plot { min-height:34px!important; }

  /* Radar summary keeps the locked geometry but removes header clutter in 4-UP. */
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-header { min-height:40px!important; max-height:40px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metrics { top:44px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="radar"] .sat-radar-metric-card strong { font-size:20px!important; }

  /* Signal Flow uses the exact locked diagram; only its chrome is compressed in 4-UP. */
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header {
    min-height:40px!important; max-height:40px!important; padding:4px 8px!important;
  }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:first-child > div:first-child { font-size:12px!important; }
  .sat-tool-surface[data-host="quad"][data-tool="diagram"] .modal-header > div:nth-child(3) > div:first-child span { font-size:12px!important; }

  /* Toolbar remains one stable presentation strip on 1920/4K screens. */
  .sat-workspace-toolbar {
    flex-wrap:nowrap!important; overflow-x:auto!important; overflow-y:hidden!important; scrollbar-width:none;
  }
  .sat-workspace-toolbar::-webkit-scrollbar { display:none; }
  .sat-workspace-toolbar > strong {
    color:#ffffff; font-family:Orbitron,Rajdhani,sans-serif; font-weight:900; letter-spacing:1px; white-space:nowrap;
  }
  .sat-workspace-toolbar .sat-workspace-time { margin-left:auto; color:#8ff7ff; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .sat-workspace-toolbar select { min-width:140px; max-width:190px; }
  .sat-globe-caption {
    background:linear-gradient(90deg,rgba(1,10,18,.86),rgba(1,10,18,.28),transparent);
    border-left:2px solid rgba(0,234,255,.7); border-radius:4px; padding:4px 6px;
  }

  @media (max-width:1450px) {
    .sat-workspace-toolbar { gap:4px!important; padding:4px 6px!important; }
    .sat-workspace-toolbar button, .sat-workspace-toolbar select { padding:4px 6px!important; font-size:10px!important; }
    .sat-workspace-toolbar select { min-width:112px; max-width:150px; }
    .sat-tool-surface[data-host="quad"] { --sat-text-scale:.72; }
  }
  .sat-workspace-toolbar { position: fixed; top: 0; left: 0; right: 0; min-height: 46px; box-sizing: border-box; z-index: 20010; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 10px; background: #06101b; border-bottom: 1px solid #285462; color: #e6fbff; font: 600 calc(clamp(12px,.7vw,20px) * var(--sat-text-scale,1)) Rajdhani,Arial,sans-serif; }
  .sat-workspace-toolbar button, .sat-workspace-toolbar select, .sat-popout-btn, .sat-workspace-toggle { border: 1px solid #337689; border-radius: 4px; background: #0c2431; color: #b7f6ff; padding: 5px 9px; cursor: pointer; font: 600 12px Rajdhani,Arial,sans-serif; white-space: nowrap; }
  .sat-workspace-toolbar select { max-width: 180px; }
  .sat-workspace-toolbar button:hover, .sat-popout-btn:hover, .sat-workspace-toggle:hover { background: #164559; color: white; }
  .sat-workspace-toggle { margin: 0; padding: 4px 8px; }
  .sat-hud-multiview { margin-left:auto; flex:0 0 auto; padding:3px 7px!important; min-height:24px!important; font-size:10px!important; letter-spacing:.5px; line-height:1!important; }
  .sat-empty-tool { position: fixed; z-index: 20000; box-sizing:border-box; overflow:hidden; border: 1px dashed #337689; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: #040e18; color: #acc7d3; font: 16px Rajdhani,Arial,sans-serif; }
  .sat-empty-tool button { cursor: pointer; padding: 8px 16px; border: 1px solid #00eaff; color: #00eaff; background: #06202b; border-radius: 5px; }
  .sat-globe-caption { position: absolute; left: 10px; right: 10px; top: 8px; z-index: 2; color: #d6f5ff; font: 600 calc(clamp(12px,.9vw,22px) * var(--sat-text-scale,1)) Rajdhani,Arial,sans-serif; pointer-events: none; text-shadow: 0 1px 5px #000; }
  .sat-globe-caption > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .sat-tool-surface[data-host="classic"] { display: contents; container-type: normal; }
  .sat-tool-surface:not([data-host="classic"]) { container-type: inline-size; }
  .sat-tool-surface .modal-header, .sat-tool-surface .sat-data-header { touch-action: none; }
  .sat-popout-btn, .sat-reading-btn { min-height: 30px; min-width: 30px; touch-action: manipulation; }
  .sat-popout-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
  .sat-window-icon { display: inline-block; width: 16px; height: 16px; vertical-align: middle; flex-shrink: 0; }
  .sat-reading-btn { padding: 3px 6px; font-family: Arial,sans-serif; }
  .sat-reading-btn[aria-pressed="true"] { background: #184d5c; color: white; border-color: #83f4ff; }
  .sat-workspace-toolbar > * { min-width: 0; }
  .sat-workspace-toolbar button, .sat-workspace-toolbar select { min-height: 32px; font-size: calc(clamp(12px,.7vw,20px) * var(--sat-text-scale, 1)); }
  .sat-workspace-toolbar select { flex: 0 1 180px; }
  .sat-workspace-time { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sat-notice { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); width: min(580px, calc(100vw - 24px)); box-sizing: border-box; padding: 14px 48px 14px 18px; z-index: 1000000; background: #081d28; border: 1px solid #50d9e8; border-radius: 9px; color: white; box-shadow: 0 8px 40px #000b; font: 600 16px/1.45 Rajdhani,Arial,sans-serif; overflow-wrap: anywhere; }
  .sat-notice[data-error="true"] { border-color: #ff736a; background: #2b1114; }
  .sat-notice p { margin: 5px 0 0; max-height: 55vh; overflow: auto; white-space: pre-wrap; }
  .sat-notice button { position: absolute; right: 8px; top: 8px; width: 32px; height: 32px; border: 1px solid #7293a0; border-radius: 4px; color: white; background: transparent; cursor: pointer; }
  /* Full Classic keeps its floating globe and both complete side panels. */
  .ui-layer .sat-tle-source { white-space:normal!important; overflow:visible!important; text-overflow:clip!important; overflow-wrap:break-word; line-height:1.25!important; }
  .ui-layer .sat-hud-weather [style*="text-overflow"], .ui-layer .sat-hud-status strong { white-space:normal!important; overflow:visible!important; text-overflow:clip!important; overflow-wrap:break-word; }
  .ui-layer[data-hud-fit="true"] .left-panel, .ui-layer[data-hud-fit="true"] .right-panel { gap:7px!important; padding-bottom:0!important; }
  .ui-layer[data-hud-fit="true"] .left-container > div:first-child, .ui-layer[data-hud-fit="true"] .right-container > div:first-child { margin-bottom:10px!important; }
  .ui-layer[data-hud-fit="true"] .global-clock-hud { padding:8px 14px!important; }
  .ui-layer[data-hud-fit="true"] .panel-box, .ui-layer[data-hud-fit="true"] .control-group { padding:8px 11px!important; }
  .ui-layer[data-hud-fit="true"] .control-group { margin-top:0!important; }
  .ui-layer[data-hud-fit="true"] .target-header { gap:10px!important; margin-bottom:6px!important; padding-bottom:6px!important; }
  .ui-layer[data-hud-fit="true"] .target-header img { width:48px!important; height:32px; object-fit:cover; }
  .ui-layer[data-hud-fit="true"] .target-header h2 { font-size:24px!important; letter-spacing:1px!important; white-space:normal!important; overflow-wrap:break-word; }
  .ui-layer[data-hud-fit="true"] .status-banner { gap:3px!important; padding:8px 10px!important; margin-bottom:7px!important; }
  .ui-layer[data-hud-fit="true"] .status-banner > span { font-size:12px!important; line-height:1.2; }
  .ui-layer[data-hud-fit="true"] .status-banner > span:nth-child(2) { font-size:26px!important; margin:2px 0!important; line-height:1!important; }
  .ui-layer[data-hud-fit="true"] .status-banner > span > strong { font-size:20px!important; }
  .ui-layer[data-hud-fit="true"] .telemetry-grid { gap:5px!important; margin-bottom:6px!important; }
  .ui-layer[data-hud-fit="true"] .t-box { box-sizing:border-box; padding:4px 10px; min-height:46px; }
  .ui-layer[data-hud-fit="true"] .t-box span { line-height:1.15; letter-spacing:.8px; }
  .ui-layer[data-hud-fit="true"] .t-box strong { font-size:20px; line-height:1.1; }
  .ui-layer[data-hud-fit="true"] .info-list { margin-top:5px; padding-top:5px; line-height:1.25; }
  .ui-layer[data-hud-fit="true"] .info-list li { gap:8px; padding-bottom:2px; margin-bottom:3px; align-items:flex-start; }
  .ui-layer[data-hud-fit="true"] .info-list span, .ui-layer[data-hud-fit="true"] .info-list strong { font-size:14px; letter-spacing:.4px; }
  .ui-layer[data-hud-fit="true"] .info-list li > span { flex:0 0 130px; max-width:45%; }
  .ui-layer[data-hud-fit="true"] .info-list li > strong { min-width:0; overflow-wrap:break-word; }
  .ui-layer[data-hud-fit="true"] .info-list .sat-hud-tle-row > span { flex-basis:56px; }
  .ui-layer[data-hud-fit="true"] .sat-tle-source { font-size:12px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-antenna .status-badge { width:auto; min-width:88px; padding:3px 8px!important; font-size:11px!important; letter-spacing:1px; }
  .ui-layer[data-hud-fit="true"] .sat-hud-antenna > div:first-child > span:first-child { font-size:12px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-weather > div:first-child { margin-bottom:5px!important; padding-bottom:4px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-weather > div:first-child > span:first-child { font-size:12px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-weather > div:nth-child(2) > div:first-child { width:50px!important; height:50px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-weather > div:nth-child(2) > div:nth-child(2) > div:nth-child(2) { font-size:14px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-weather > div:nth-child(2) > div:last-child > div { font-size:24px!important; }
  .ui-layer[data-hud-fit="true"] .control-group div[style*="grid"] { gap:5px!important; }
  .ui-layer[data-hud-fit="true"] .btn { min-height:34px; box-sizing:border-box; padding:6px 7px!important; font-size:15px!important; line-height:1.2; letter-spacing:1px!important; margin-bottom:0!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-time > button { padding:8px!important; margin-bottom:6px!important; font-size:16px!important; line-height:1.2; letter-spacing:1.5px!important; }
  .ui-layer[data-hud-fit="true"] .speed-row { margin-top:6px!important; margin-bottom:6px!important; }
  .ui-layer[data-hud-fit="true"] .speed-row .btn { min-height:28px; padding:4px 2px!important; font-size:13px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-transport { height:34px!important; margin-top:6px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-transport .status-badge { box-sizing:border-box; padding:3px 0!important; }
  .ui-layer[data-hud-fit="true"] .time-scrubber-container { margin-top:7px!important; padding-top:7px!important; }
  .ui-layer[data-hud-fit="true"] .scrubber-labels { margin-bottom:4px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-time-track .sci-fi-slider { margin:6px 0; }
  .ui-layer[data-hud-fit="true"] .sat-hud-time-track > div { top:6px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-current-time { margin-top:6px!important; font-size:14px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-current-time > strong { font-size:20px!important; margin-left:8px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-season { margin-top:6px!important; padding-top:6px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-season > div:first-child { margin-bottom:5px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-season button { padding:4px!important; font-size:12px!important; line-height:1.15!important; white-space:normal!important; overflow:visible!important; text-overflow:clip!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-tools > div { margin-bottom:6px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-tools > div:last-child { margin-bottom:0!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-status { margin-top:0!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-status > div:first-child { margin-bottom:5px!important; padding-bottom:4px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-status > div:nth-child(2) { row-gap:4px!important; }
  .ui-layer[data-hud-fit="true"] .sat-hud-credits { margin-top:0!important; font-size:14px!important; line-height:1.2!important; }

  .sat-hud-pages, .sat-hud-page { display: contents; }
  .sat-hud-tabs { display: none; }
  .sat-hud-pages[data-paged="true"] { display: flex; flex: 1; flex-direction: column; min-height: 0; width: 100%; gap: 8px; }
  .sat-hud-pages[data-paged="true"] .sat-hud-tabs { display: flex; flex-wrap: wrap; gap: 4px; flex-shrink: 0; padding: 5px; background: #061420ed; border: 1px solid #285462; border-radius: 6px; }
  .sat-hud-tabs button { flex: 1 1 auto; min-height: 32px; padding: 5px 8px; border: 1px solid #306477; border-radius: 4px; background: #091f2b; color: #cbeaf0; font: 700 14px Rajdhani,Arial,sans-serif; cursor: pointer; }
  .sat-hud-tabs button[aria-selected="true"] { background: #154654; border-color: #00eaff; color: white; }
  .sat-hud-pages[data-paged="true"] .sat-hud-page { display: block; min-width: 0; min-height: 0; }
  .sat-hud-pages[data-paged="true"] .sat-hud-page[hidden] { display: none; }
  .sat-hud-pages[data-paged="true"] .control-group { margin-top: 0!important; }
  .ui-layer[data-compact="true"] { flex-direction: row; overflow: hidden; gap: 12px; }
  .ui-layer[data-compact="true"] .left-container, .ui-layer[data-compact="true"] .right-container { width: min(420px, calc(50vw - 28px))!important; min-width: 0; }
  .ui-layer[data-compact="true"] .left-panel, .ui-layer[data-compact="true"] .right-panel { overflow: hidden!important; padding-bottom: 0; }
  .ui-layer[data-compact="true"] .sat-hud-page [style*="text-overflow"] { white-space: normal!important; overflow-wrap: break-word; overflow: visible!important; text-overflow: clip!important; }
  .ui-layer[data-compact="true"] .sat-tle-source { font-size: calc(12px * var(--sat-text-scale, 1))!important; line-height: 1.25!important; }
  .ui-layer[data-compact="true"] .target-header h2 { white-space: normal!important; overflow-wrap: break-word; font-size: 22px!important; letter-spacing: .5px!important; }
  .ui-layer[data-compact="true"] .global-clock-hud { padding: 8px!important; }
  .ui-layer[data-compact="true"] .global-clock-hud strong { font-size: 22px!important; letter-spacing: .5px!important; }
  .ui-layer[data-compact="true"] .panel-box, .ui-layer[data-compact="true"] .control-group { padding: 10px!important; }
  .ui-layer[data-compact="true"] .btn { font-size: 14px!important; letter-spacing: .6px!important; }
  .ui-layer[data-compact="true"] .sat-hud-page > .control-group > div { gap: 8px!important; }
  .ui-layer[data-compact="true"] .t-box strong { font-size: 18px!important; }
  .ui-layer[data-narrow="true"] { display: block; padding: 8px!important; }
  .ui-layer[data-narrow="true"] .left-container, .ui-layer[data-narrow="true"] .right-container { position: absolute; top: 8px; width: calc(50% - 12px)!important; height: calc(100% - 16px)!important; transform: none!important; }
  .ui-layer[data-narrow="true"] .left-container { left: 8px; }
  .ui-layer[data-narrow="true"] .right-container { right: 8px; }
  .ui-layer[data-narrow="true"] .left-container > div:first-child, .ui-layer[data-narrow="true"] .right-container > div:first-child { gap: 6px!important; margin-bottom: 8px!important; }
  .ui-layer[data-narrow="true"] .menu-toggle-btn-left { margin-right: 0; }
  .ui-layer[data-narrow="true"] .global-clock-hud { min-width: 0; padding: 6px!important; }
  .ui-layer[data-narrow="true"] .global-clock-hud strong { font-size: clamp(14px, 2.4vw, 20px)!important; }
  .ui-layer[data-narrow="true"] .global-clock-hud span { font-size: 10px; letter-spacing: .2px!important; }
  .ui-layer[data-narrow="true"] .global-clock-hud strong span { font-size: inherit; }
  .ui-layer[data-narrow="true"] .left-panel, .ui-layer[data-narrow="true"] .right-panel { position: fixed; left: 8px; right: 8px; top: 84px; bottom: 8px; width: calc(100vw - 16px)!important; background: #010b14f5; border: 1px solid #285462; border-radius: 8px; padding: 8px!important; box-sizing: border-box; }
  .ui-layer[data-narrow="true"]:not([data-active-hud="left"]) .left-panel, .ui-layer[data-narrow="true"]:not([data-active-hud="right"]) .right-panel { display: none; }
  /* ---------------------------------------------------------------------
     INTERNATIONAL MASTER v1.1 — ADAPTIVE HUD BALANCE
     Viewport tiers + Globe Safe Zone + equal HUD baselines.
     These rules intentionally override older fixed widths without changing
     orbit/RF/TLE/antenna calculations or the Classic visual identity.
     --------------------------------------------------------------------- */
  .ui-layer[data-master-responsive="true"] {
    padding: var(--sat-hud-outer)!important;
    gap: 0!important;
  }
  .ui-layer[data-master-responsive="true"] .left-container,
  .ui-layer[data-master-responsive="true"] .right-container {
    width: var(--sat-hud-panel-width)!important;
    max-width: var(--sat-hud-panel-width)!important;
    min-width: 0!important;
    /* FIX6: do not override inline height compensation after HUD scale.
       The Classic production build relies on logical height = viewport / scale,
       so the whole side HUD remains visible in both browser and Full Screen modes. */
    box-sizing: border-box!important;
  }
  .ui-layer[data-master-responsive="true"] .left-panel,
  .ui-layer[data-master-responsive="true"] .right-panel {
    width: 100%!important;
    min-height: 0!important;
    box-sizing: border-box!important;
  }
  /* Use spare vertical space before growing horizontally. */
  .ui-layer[data-hud-fill="true"] .left-panel,
  .ui-layer[data-hud-fill="true"] .right-panel {
    /* HUD AUTOFIT COMPACT: never distribute spare viewport height between cards.
       Auto-scale already guarantees the whole stack fits; keep the Classic cards
       visually grouped from top to bottom in Browser and Full Screen. */
    justify-content: flex-start!important;
    gap: clamp(7px, 0.9vh, 10px)!important;
    padding-bottom: 0!important;
    overflow-y: hidden!important;
  }
  .ui-layer[data-hud-fill="true"] .panel-box,
  .ui-layer[data-hud-fill="true"] .control-group {
    flex-shrink: 0!important;
  }
  /* Wide TV / presentation canvases: one-screen Classic HUD, no side scrolling. */
  .ui-layer[data-wide-tv="true"] .left-panel,
  .ui-layer[data-wide-tv="true"] .right-panel {
    overflow-y:hidden!important; overflow-x:hidden!important; scrollbar-width:none!important;
    /* Do not stretch the gaps on 16:9 TV / Full Screen. */
    justify-content:flex-start!important; gap:clamp(7px, 0.9vh, 10px)!important; padding-bottom:0!important;
  }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .left-container > div:first-child,
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .right-container > div:first-child { margin-bottom:6px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .panel-box,
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .control-group { padding:6px 10px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .target-header { margin-bottom:4px!important; padding-bottom:4px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .status-banner { padding:6px 8px!important; margin-bottom:4px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .t-box { min-height:40px!important; padding:3px 8px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .info-list { margin-top:3px!important; padding-top:3px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .info-list li { margin-bottom:1px!important; padding-bottom:1px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .btn { min-height:31px!important; padding:4px 6px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .speed-row { margin-top:4px!important; margin-bottom:4px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .sat-hud-season { margin-top:4px!important; padding-top:4px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .sat-hud-tools > div { margin-bottom:4px!important; }
  .ui-layer[data-wide-tv="true"][data-hud-fit="true"] .sat-hud-credits { font-size:11px!important; line-height:1.05!important; }
  /* Desktop keeps the full Classic HUD; only truly narrow/portrait screens page it. */
  .ui-layer[data-hud-tier="desktop"] .sat-hud-tabs,
  .ui-layer[data-hud-tier="presentation"] .sat-hud-tabs,
  .ui-layer[data-hud-tier="compact"] .sat-hud-tabs { display:none!important; }

  /* Presentation / large TV: improve distance readability while retaining hierarchy. */
  .ui-layer[data-hud-tier="presentation"] .global-clock-hud { padding:14px 18px!important; }
  .ui-layer[data-hud-tier="presentation"] .global-clock-hud strong { font-size:32px!important; }
  .ui-layer[data-hud-tier="presentation"] .panel-box,
  .ui-layer[data-hud-tier="presentation"] .control-group { padding:13px 15px!important; }
  .ui-layer[data-hud-tier="presentation"] .status-banner > span:nth-child(2) { font-size:30px!important; }
  .ui-layer[data-hud-tier="presentation"] .t-box { min-height:50px!important; padding:6px 11px!important; }
  .ui-layer[data-hud-tier="presentation"] .t-box strong { font-size:22px!important; }
  .ui-layer[data-hud-tier="presentation"] .info-list span,
  .ui-layer[data-hud-tier="presentation"] .info-list strong { font-size:14px!important; }
  .ui-layer[data-hud-tier="presentation"] .btn { min-height:42px!important; font-size:16px!important; padding:8px 7px!important; }
  .ui-layer[data-hud-tier="presentation"] .speed-row .btn { min-height:32px!important; font-size:13px!important; }
  .ui-layer[data-hud-tier="presentation"] .sat-hud-tools .btn { min-height:48px!important; }
  .ui-layer[data-hud-tier="presentation"] .sat-hud-status strong { font-size:13px!important; }

  /* Desktop: full Classic panels, balanced top/bottom baseline. */
  .ui-layer[data-hud-tier="desktop"] .left-panel,
  .ui-layer[data-hud-tier="desktop"] .right-panel,
  .ui-layer[data-hud-tier="presentation"] .left-panel,
  .ui-layer[data-hud-tier="presentation"] .right-panel { overflow-y:hidden!important; overflow-x:hidden!important; scrollbar-width:none!important; }
  .ui-layer[data-hud-tier="desktop"] .btn { min-height:36px; }

  /* Compact landscape: reduce whitespace/padding first; do not uniformly shrink text. */
  .ui-layer[data-hud-tier="compact"] { padding:10px!important; }
  .ui-layer[data-hud-tier="compact"] .left-container,
  .ui-layer[data-hud-tier="compact"] .right-container {
    width: var(--sat-hud-panel-width)!important;
    /* FIX6: height is intentionally supplied inline as viewport/scale. */
  }
  .ui-layer[data-hud-tier="compact"] .left-panel,
  .ui-layer[data-hud-tier="compact"] .right-panel { gap:5px!important; overflow-y:hidden!important; overflow-x:hidden!important; scrollbar-width:none!important; }
  .ui-layer[data-hud-tier="compact"] .panel-box,
  .ui-layer[data-hud-tier="compact"] .control-group { padding:7px 9px!important; margin-top:4px!important; }
  .ui-layer[data-hud-tier="compact"] .target-header { margin-bottom:4px!important; padding-bottom:4px!important; }
  .ui-layer[data-hud-tier="compact"] .status-banner { padding:6px 8px!important; margin-bottom:5px!important; }
  .ui-layer[data-hud-tier="compact"] .t-box { min-height:39px!important; padding:3px 8px!important; }
  .ui-layer[data-hud-tier="compact"] .t-box strong { font-size:17px!important; }
  .ui-layer[data-hud-tier="compact"] .info-list span,
  .ui-layer[data-hud-tier="compact"] .info-list strong { font-size:12px!important; }
  .ui-layer[data-hud-tier="compact"] .btn { min-height:30px!important; padding:4px 5px!important; font-size:13px!important; }
  .ui-layer[data-hud-tier="compact"] .sat-hud-tools .btn { min-height:34px!important; }
  .ui-layer[data-hud-tier="compact"] .sat-hud-credits { font-size:11px!important; }


  /* DEPLOY HUD LOCK — desktop / TV / Full Screen only.
     Match the working deployed reference; adaptive MASTER overrides are reserved for compact/narrow. */
  .ui-layer:not([data-master-responsive="true"]) .left-container {
    width: clamp(380px, 28vw, 460px)!important; max-width:none!important; min-width:0!important;
  }
  .ui-layer:not([data-master-responsive="true"]) .right-container {
    width: clamp(380px, 28vw, 460px)!important; max-width:none!important; min-width:0!important;
  }
  .ui-layer:not([data-master-responsive="true"]) .left-container,
  .ui-layer:not([data-master-responsive="true"]) .right-container {
    box-sizing:border-box!important;
  }
  .ui-layer:not([data-master-responsive="true"]) .left-container > div:first-child,
  .ui-layer:not([data-master-responsive="true"]) .right-container > div:first-child {
    gap:15px!important; margin-bottom:15px!important;
  }
  .ui-layer:not([data-master-responsive="true"]) .left-panel,
  .ui-layer:not([data-master-responsive="true"]) .right-panel {
    justify-content:flex-start!important; gap:clamp(9px, 1.45vh, 16px)!important;
    padding-bottom:clamp(10px, 2vh, 20px)!important;
    overflow-y:auto!important; overflow-x:hidden!important; scrollbar-width:none!important;
  }
  .ui-layer:not([data-master-responsive="true"]) .left-panel::-webkit-scrollbar,
  .ui-layer:not([data-master-responsive="true"]) .right-panel::-webkit-scrollbar { display:none!important; }

  /* TSX browser-only bottom safety: keep the locked Browser layout unchanged,
     but lift the final Weather card enough to preserve its cyan bottom border. */
  .ui-layer:not([data-main-fullscreen="true"]):not([data-master-responsive="true"]) .sat-hud-weather {
    transform:translateY(-8px)!important;
  }

  /* TSX FINAL POLISH 2026-10-26: Fullscreen vertical fit also applies to compact TV CSS viewports; narrow/portrait remains paged. */
  /* FULL SCREEN ONLY — Browser mode is intentionally untouched.
     Native Fullscreen and browser/F11 fullscreen-like viewports share the same rule.
     Both HUD columns consume the exact same remaining height and distribute their
     existing cards between one top baseline and one bottom baseline. */
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .left-panel,
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .right-panel {
    display:flex!important;
    flex-direction:column!important;
    flex:1 1 0!important;
    height:auto!important;
    min-height:0!important;
    justify-content:space-between!important;
    gap:clamp(10px,1.15vh,16px)!important;
    padding-bottom:0!important;
    overflow-y:hidden!important;
  }
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .sat-hud-status,
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .sat-hud-credits {
    margin-top:0!important;
  }

  /* FULL SCREEN ONLY — SatHudPages is the real direct child of each side panel.
     Stretch that wrapper and distribute its section pages, otherwise space-between on
     left/right-panel sees only one child and leaves a large unused band at the bottom. */
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .left-panel > .sat-hud-pages,
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .right-panel > .sat-hud-pages {
    display:flex!important;
    flex-direction:column!important;
    flex:1 1 0!important;
    width:100%!important;
    height:100%!important;
    min-height:100%!important;
    align-self:stretch!important;
    justify-content:space-between!important;
    gap:clamp(10px,1.15vh,16px)!important;
  }
  .ui-layer[data-main-fullscreen="true"]:not([data-hud-tier="narrow"]) .sat-hud-pages > .sat-hud-page {
    display:block!important;
    flex:0 0 auto!important;
    width:100%!important;
    min-height:0!important;
    margin:0!important;
  }

  /* Narrow / portrait: the globe remains unobstructed; side HUD becomes an intentional drawer. */
  .ui-layer[data-hud-tier="narrow"] { display:block!important; padding:8px!important; }
  .ui-layer[data-hud-tier="narrow"] .left-container,
  .ui-layer[data-hud-tier="narrow"] .right-container {
    position:absolute!important; top:8px!important; height:calc(100dvh - 16px)!important;
    max-height:calc(100dvh - 16px)!important; transform:none!important;
  }
  .ui-layer[data-hud-tier="narrow"] .left-container { left:8px!important; width:calc(50% - 12px)!important; max-width:none!important; }
  .ui-layer[data-hud-tier="narrow"] .right-container { right:8px!important; width:calc(50% - 12px)!important; max-width:none!important; }
  .ui-layer[data-hud-tier="narrow"] .left-panel,
  .ui-layer[data-hud-tier="narrow"] .right-panel {
    position:fixed!important; left:8px!important; right:8px!important; top:84px!important; bottom:8px!important;
    width:calc(100vw - 16px)!important; height:auto!important; max-height:none!important;
    overflow:auto!important; background:#010b14f5; border:1px solid #285462; border-radius:8px; padding:8px!important;
  }

  /* Keep the center visually clean: panel width is calculated in JS from --sat-globe-safe-min. */
  .ui-layer[data-master-responsive="true"] .left-container { margin-right:auto; }
  .ui-layer[data-master-responsive="true"] .right-container { margin-left:auto; }

  @media (pointer: coarse) {
    .sat-popout-btn, .sat-reading-btn, .sat-workspace-toolbar button, .sat-workspace-toolbar select, .sat-hud-tabs button { min-width: 40px; min-height: 40px; }
    .sat-tool-surface button { touch-action: manipulation; }
    .sat-tool-surface input[type="range"] { min-height: 32px; }
    .menu-toggle-btn, .menu-toggle-btn-left { width: 40px; height: 40px; }
  }
`;

function SatToolSurface({ id, viewer, quad, rect, hidden, children }) {
  const homeRef = useRef(null);
  const [container] = useState(() => {
    const node = document.createElement('div');
    node.className = 'sat-tool-surface';
    node.dataset.tool = id;
    return node;
  });
  React.useLayoutEffect(() => {
    const destination = viewer?.mount?.isConnected ? viewer.mount : homeRef.current;
    if (destination && container.parentNode !== destination) destination.appendChild(container);
    return () => { if (container.parentNode) container.parentNode.removeChild(container); };
  }, [container, viewer]);
  React.useLayoutEffect(() => {
    container.dataset.host = viewer ? 'window' : quad ? 'quad' : 'classic';
    container.style.cssText = '';
    if (quad && !viewer && rect) Object.assign(container.style, {
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      visibility: hidden ? 'hidden' : 'visible'
    });
  }, [container, viewer, quad, rect?.left, rect?.top, rect?.width, rect?.height, hidden]);
  useEffect(() => {
    let pointer = null;
    const mouse = (type, event, target) => target.dispatchEvent(new (container.ownerDocument.defaultView.MouseEvent)(type, {
      bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY, button: 0, buttons: type === 'mouseup' ? 0 : 1
    }));
    const down = event => {
      if (pointer !== null || event.isPrimary === false || event.pointerType === 'mouse' || container.dataset.host !== 'classic') return;
      const header = event.target.closest('.modal-header,.sat-data-header');
      if (!header || event.target.closest('button,input,select,a,label')) return;
      event.preventDefault(); pointer = event.pointerId;
      container.setPointerCapture?.(pointer);
      mouse('mousedown', event, header);
    };
    // Bubble through document and window: Classic tools use both listener hosts.
    const move = event => { if (pointer === event.pointerId) { event.preventDefault(); mouse('mousemove', event, container.ownerDocument); } };
    const up = event => {
      if (pointer !== event.pointerId) return;
      const releasedPointer = pointer; pointer = null;
      mouse('mouseup', event, container.ownerDocument);
      if (container.hasPointerCapture?.(releasedPointer)) container.releasePointerCapture?.(releasedPointer);
    };
    container.addEventListener('pointerdown', down);
    container.addEventListener('pointermove', move);
    container.addEventListener('pointerup', up);
    container.addEventListener('pointercancel', up);
    container.addEventListener('lostpointercapture', up);
    return () => { container.removeEventListener('pointerdown', down); container.removeEventListener('pointermove', move); container.removeEventListener('pointerup', up); container.removeEventListener('pointercancel', up); container.removeEventListener('lostpointercapture', up); };
  }, [container]);
  return <div className="sat-tool-placeholder" data-sat-home={id} ref={homeRef}>{createPortal(children, container, id)}</div>;
}


// TSX FINAL POLISH 2026-10-26: self-contained HUD weather glyphs.
// These SVGs remove the runtime dependency on api.iconify.design so the TSX demo
// remains visually complete even when the venue network is unavailable.
function HudWeatherIcon({ kind = 'unknown' }) {
  const common = {
    width: 'clamp(30px, 3vw, 40px)',
    height: 'clamp(30px, 3vw, 40px)',
    display: 'block',
    overflow: 'visible'
  };
  if (kind === 'clear') {
    return <svg viewBox="0 0 64 64" role="img" aria-label="Clear" style={{ ...common, color: '#00ff66', filter: 'drop-shadow(0 0 8px rgba(0,255,102,0.75))' }}>
      <circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" strokeWidth="4" />
      <g stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M32 7v8M32 49v8M7 32h8M49 32h8" />
        <path d="M14.3 14.3l5.7 5.7M44 44l5.7 5.7M49.7 14.3L44 20M20 44l-5.7 5.7" />
      </g>
    </svg>;
  }
  if (kind === 'partly') {
    return <svg viewBox="0 0 64 64" role="img" aria-label="Partly Cloudy" style={{ ...common, filter: 'drop-shadow(0 0 8px rgba(255,204,0,0.55))' }}>
      <g stroke="#ffcc00" strokeWidth="3.5" strokeLinecap="round" fill="none">
        <circle cx="22" cy="21" r="8" />
        <path d="M22 6v5M22 31v5M7 21h5M32 21h5M11.4 10.4l3.6 3.6M29 28l3.6 3.6M32.6 10.4L29 14M15 28l-3.6 3.6" />
      </g>
      <g fill="#f8fafc">
        <circle cx="26" cy="39" r="9" />
        <circle cx="37" cy="34" r="12" />
        <circle cx="49" cy="40" r="8" />
        <rect x="18" y="39" width="39" height="10" rx="5" />
      </g>
    </svg>;
  }
  if (kind === 'overcast') {
    return <svg viewBox="0 0 64 64" role="img" aria-label="Overcast" style={{ ...common, filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.25))' }}>
      <g fill="#94a3b8" opacity="0.72">
        <circle cx="22" cy="28" r="8" /><circle cx="32" cy="24" r="10" /><circle cx="43" cy="29" r="7" /><rect x="15" y="28" width="35" height="9" rx="4.5" />
      </g>
      <g fill="#f8fafc">
        <circle cx="25" cy="41" r="8" /><circle cx="36" cy="36" r="11" /><circle cx="48" cy="42" r="8" /><rect x="18" y="41" width="38" height="10" rx="5" />
      </g>
    </svg>;
  }
  return <svg viewBox="0 0 64 64" role="img" aria-label="Weather unavailable" style={{ ...common, opacity: 0.5 }}>
    <g fill="#94a3b8">
      <circle cx="23" cy="37" r="9" /><circle cx="34" cy="31" r="12" /><circle cx="47" cy="38" r="8" /><rect x="15" y="37" width="40" height="10" rx="5" />
    </g>
  </svg>;
}

// Main HUD only: preserve the deployed scale unless either column actually overflows.
function useMainHudHeightFit(baseScale, narrow, fullscreen, leftOpen, rightOpen, width, height) {
  const layerRef = useRef(null);
  React.useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer || narrow) return;
    let frame = 0, disposed = false;
    const columns = Array.from(layer.querySelectorAll(':scope > .left-container, :scope > .right-container'));
    const applyScale = (scale) => columns.forEach(column => {
      column.style.transform = `scale(${scale})`;
      column.style.height = column.style.maxHeight = `calc(100% / ${scale})`;
    });
    const fit = () => {
      if (disposed) return;
      applyScale(baseScale);
      const panels = columns.map(column => column.querySelector('.left-panel, .right-panel')).filter(Boolean);
      // Leave fitting TV/desktop layouts at their original scale and height.
      if (!panels.some(panel => panel.scrollHeight > panel.clientHeight + 1)) return;
      const layerStyle = getComputedStyle(layer);
      const px = value => parseFloat(value) || 0;
      const available = layer.clientHeight - px(layerStyle.paddingTop) - px(layerStyle.paddingBottom);
      let required = 0;
      columns.forEach(column => {
        const panel = column.querySelector('.left-panel, .right-panel');
        if (!panel) return;
        const pages = panel.querySelector(':scope > .sat-hud-pages');
        // Measure intrinsic content, not the fullscreen wrapper's forced 100% height.
        // Restore synchronously before paint; no global CSS or content changes.
        const saved = [panel, pages].filter(Boolean).map(node => [node, node.getAttribute('style')]);
        try {
          [panel, pages].filter(Boolean).forEach(node => {
            node.style.setProperty('height', 'auto', 'important');
            node.style.setProperty('min-height', '0', 'important');
            node.style.setProperty('max-height', 'none', 'important');
            node.style.setProperty('flex', '0 0 auto', 'important');
          });
          const header = column.firstElementChild;
          const headerStyle = getComputedStyle(header);
          const panelStyle = getComputedStyle(panel);
          const naturalHeight = header.getBoundingClientRect().height / baseScale
            + px(headerStyle.marginTop) + px(headerStyle.marginBottom)
            + panel.getBoundingClientRect().height / baseScale
            + px(panelStyle.marginTop) + px(panelStyle.marginBottom);
          required = Math.max(required, naturalHeight);
        } finally {
          saved.forEach(([node, style]) => style === null ? node.removeAttribute('style') : node.setAttribute('style', style));
        }
      });
      if (required > 0 && available > 0) applyScale(Math.min(baseScale, (available - 2) / required));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    // Observe intrinsic cards/header, not the height-compensated container (avoids feedback).
    const observer = new ResizeObserver(schedule);
    columns.forEach(column => {
      observer.observe(column.firstElementChild);
      column.querySelectorAll('.sat-hud-page > *').forEach(card => observer.observe(card));
    });
    document.fonts?.ready.then(() => { if (!disposed) schedule(); });
    fit();
    schedule(); // Base stylesheet is injected by the existing mount effect.
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [baseScale, narrow, fullscreen, leftOpen, rightOpen, width, height]);
  return layerRef;
}

// Pagination changes visibility only; the original controls keep their React state.
function SatHudPages({ active, labels, children }) {
  const [page, setPage] = useState(0);
  const items = React.Children.toArray(children).filter(React.isValidElement);
  const selected = Math.min(page, Math.max(0, items.length - 1));
  return <div className="sat-hud-pages" data-paged={active}>
    <div className="sat-hud-tabs" role="tablist" aria-label="Control sections">
      {items.map((_, i) => <button key={i} role="tab" aria-selected={selected === i} onClick={() => setPage(i)}>{labels[i] || `SECTION ${i + 1}`}</button>)}
    </div>
    {items.map((item, i) => <div className="sat-hud-page" data-section-index={i} key={item.key || i} hidden={active && selected !== i}>{item}</div>)}
  </div>;
}

function SatFeedback({ alert, onDismiss }) {
  if (!alert?.show) return null;
  return <aside className="sat-notice" role="alert" data-error={alert.type === 'error'}>
    <strong>{alert.type === 'error' ? 'SAT-Orbit · ERROR' : 'SAT-Orbit · NOTICE'}</strong>
    <p>{alert.message}</p><button onClick={onDismiss} aria-label="Dismiss notification">✕</button>
  </aside>;
}

function SatWindowIcon({ kind = 'maximize' }) {
  return <svg className="sat-window-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'detach' ? <><path d="M14 4h6v6M20 4l-9 9"/><path d="M10 5H4v15h15v-6"/></>
      : kind === 'return' ? <><path d="M13 4h7v16H4v-7"/><path d="M4 4v6h6M4 10l9-9"/></>
      : kind === 'restore' ? <><path d="M8 8V4h12v12h-4"/><rect x="4" y="8" width="12" height="12" rx="1"/></>
      : <rect x="4" y="4" width="16" height="16" rx="1"/>}
  </svg>;
}

function buildSatDetachedUrl(toolId, sessionId = '') {
  const url = new URL(window.location.href);
  url.searchParams.set('satDetached', toolId);
  if (sessionId) url.searchParams.set('satSession', sessionId);
  else url.searchParams.delete('satSession');
  url.hash = '';
  return url.toString();
}

function getSatDetachedToolFromLocation(targetWindow = window) {
  try {
    const url = new URL(targetWindow.location.href);
    const toolId = url.searchParams.get('satDetached');
    return toolId && SAT_WORKSPACE_TOOLS[toolId] ? toolId : null;
  } catch (_) {
    return null;
  }
}

function rehomeSatToolSurface(toolId, viewerMount) {
  // Keep the single live React/Canvas surface inside the MAIN document before a
  // detached browser document disappears. Moving it while the child document is
  // still alive preserves event bindings, canvas state and the existing React tree.
  try {
    const home = document.querySelector(`[data-sat-home="${toolId}"]`);
    const liveSurface = viewerMount?.querySelector?.('.sat-tool-surface');
    if (!home || !liveSurface) return false;
    if (liveSurface.parentNode !== home) home.appendChild(liveSurface);
    return true;
  } catch (_) {
    return false;
  }
}

function createSatViewerDocument(viewerWindow, title, toolId, sessionId = '') {
  // Detached tools use a real SAT-Orbit URL while the live DOM stays owned by the main Core.
  const doc = viewerWindow.document;
  doc.documentElement.lang = document.documentElement.lang || 'th';
  doc.head.replaceChildren();
  const titleNode = doc.createElement('title');
  titleNode.textContent = `SAT-Orbit — ${title}`;
  doc.head.appendChild(titleNode);
  doc.title = `SAT-Orbit — ${title}`;
  try {
    viewerWindow.history.replaceState(
      { satOrbitDetached: true, toolId, sessionId },
      '',
      buildSatDetachedUrl(toolId, sessionId)
    );
  } catch (_) { /* Keep the viewer alive even if browser URL decoration is restricted. */ }
  const base = doc.createElement('base');
  base.href = document.baseURI;
  doc.head.appendChild(base);
  const viewport = doc.createElement('meta');
  viewport.name = 'viewport';
  viewport.content = 'width=device-width, initial-scale=1';
  doc.head.appendChild(viewport);
  let measureStatus = () => {};
  const syncStyles = () => {
    doc.querySelectorAll('[data-sat-copied-style]').forEach(node => node.remove());
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => {
      const copy = node.cloneNode(true);
      copy.setAttribute('data-sat-copied-style', 'true');
      doc.head.appendChild(copy);
    });
    doc.documentElement.style.cssText = document.documentElement.style.cssText;
    measureStatus();
  };
  syncStyles();
  const style = doc.createElement('style');
  style.textContent = SAT_WORKSPACE_CSS + '\nhtml,body {margin:0!important;width:100%;height:100%;overflow:hidden!important;background:#010408;color:#e6fbff;} #sat-viewer-status{position:fixed;bottom:0;left:0;right:0;min-height:26px;box-sizing:border-box;padding:5px 10px;background:#071720;border-top:1px solid #244755;color:#a5c4ce;font:calc(clamp(12px,.7vw,20px) * var(--sat-text-scale,1))/1.3 Arial,sans-serif;z-index:50000;white-space:normal;overflow-wrap:break-word;}';
  doc.head.appendChild(style);
  doc.body.replaceChildren();
  const mount = doc.createElement('div');
  mount.id = 'sat-viewer-mount';
  doc.body.appendChild(mount);
  const status = doc.createElement('div');
  status.id = 'sat-viewer-status';
  status.textContent = 'CONNECTING TO MAIN SAT-ORBIT SESSION…';
  doc.body.appendChild(status);
  let active = true;
  let teardownRescued = false;

  // Browser-X / tab-close / detached navigation hardening:
  // rescue the live surface synchronously BEFORE the child document is destroyed.
  // The existing 500 ms controller poll remains responsible for state cleanup and
  // reload re-attachment, so this handler never resets tool/application state.
  const rescueBeforeDetachedTeardown = () => {
    if (!active || teardownRescued) return;
    teardownRescued = true;
    rehomeSatToolSurface(toolId, mount);
  };

  measureStatus = () => {
    if (!active || viewerWindow.closed) return;
    const height = `${Math.ceil(status.getBoundingClientRect().height)}px`;
    if (mount.style.getPropertyValue('--sat-viewer-status-height') !== height) mount.style.setProperty('--sat-viewer-status-height', height);
  };
  measureStatus();
  const statusObserver = viewerWindow.ResizeObserver ? new viewerWindow.ResizeObserver(measureStatus) : null;
  statusObserver?.observe(status);
  viewerWindow.addEventListener('resize', measureStatus);
  // pagehide fires while the detached document is still valid, which is the safe
  // moment to adopt the live surface back into the main SAT-Orbit document.
  viewerWindow.addEventListener('pagehide', rescueBeforeDetachedTeardown);
  // unload is a fallback for browser/window-close paths that skip pagehide. The
  // rescue function is idempotent, so receiving both events is safe.
  viewerWindow.addEventListener('unload', rescueBeforeDetachedTeardown);
  doc.fonts?.addEventListener?.('loadingdone', measureStatus);
  return { win: viewerWindow, mount, status, syncStyles, measureStatus, document: doc, rescueBeforeDetachedTeardown, dispose: () => {
    active = false;
    statusObserver?.disconnect();
    viewerWindow.removeEventListener('resize', measureStatus);
    viewerWindow.removeEventListener('pagehide', rescueBeforeDetachedTeardown);
    viewerWindow.removeEventListener('unload', rescueBeforeDetachedTeardown);
    doc.fonts?.removeEventListener?.('loadingdone', measureStatus);
  } };
}

function getWorkspaceRects(width, height, toolbarHeight = 46) {
  const gap = 8, top = toolbarHeight + gap;
  const cellWidth = Math.max(1, (width - gap * 3) / 2);
  const cellHeight = Math.max(1, (height - top - gap * 2) / 2);
  return {
    globe: { left: gap, top, width: cellWidth, height: cellHeight },
    radar: { left: gap * 2 + cellWidth, top, width: cellWidth, height: cellHeight },
    diagram: { left: gap, top: top + gap + cellHeight, width: cellWidth, height: cellHeight },
    analyzer: { left: gap * 2 + cellWidth, top: top + gap + cellHeight, width: cellWidth, height: cellHeight }
  };
}

// One RF simulation model supplies the Analyzer, Signal Flow and status labels.
// These are existing application presets at the IF outputs, not verified hardware
// specifications or measurements from a receiver. Real carrier lock requires RF telemetry.
const SIM_RF_PROFILES = {
  // RF = spacecraft downlink center; freq = receiver IF used by this simulator.
  // THEOS-2 symbol rates are the engineering baseline used by the SIM trace model.
  '33396': { name: 'THEOS', xBand: { freq: 720, rf: 8140, bw: 120, mod: 'QPSK' }, sBand: { freq: 70, rf: 2211, bw: 0.8, mod: 'BPSK' } },
  '58016': { name: 'THEOS-2', xBand: { freq: 720, rf: 8150, bw: 310, mod: 'O-QPSK', symbolRateMsps: 155 }, sBand: { freq: 70, rf: 2244.228, bw: 0.235, mod: 'QPSK', symbolRateMsps: 0.117647 } },
  '27424': { name: 'AQUA', xBand: { freq: 720, bw: 15, mod: 'SQPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
  '25994': { name: 'TERRA', xBand: { freq: 720, bw: 15, mod: 'SQPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
  '49260': { name: 'LANDSAT-9', xBand: { freq: 720, bw: 384, mod: 'O-QPSK' }, sBand: { freq: 70, bw: 3, mod: 'BPSK' } },
  '39084': { name: 'LANDSAT-8', xBand: { freq: 720, bw: 384, mod: 'O-QPSK' }, sBand: { freq: 70, bw: 3, mod: 'BPSK' } },
  '54234': { name: 'NOAA-21', xBand: { freq: 720, bw: 30, mod: 'QPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
  '43013': { name: 'NOAA-20', xBand: { freq: 720, bw: 30, mod: 'QPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
  '37849': { name: 'SUOMI NPP', xBand: { freq: 720, bw: 30, mod: 'QPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
  '39634': { name: 'SENTINEL-1A', xBand: { freq: 720, bw: 300, mod: 'QPSK' }, sBand: { freq: 70, bw: 2, mod: 'BPSK' } },
};

// Analyzer-only receive paths. THEOS-2 dual polarization is operator-confirmed;
// existing RF/IF/BW/modulation remain SIM presets, not measured receiver data.
// Other spacecraft retain one path with unknown polarization; never infer dual-pol.
const ANALYZER_X_PATHS = {
  '58016': [{ id: 'rhcp', polarization: 'RHCP' }, { id: 'lhcp', polarization: 'LHCP' }],
};
function getAnalyzerXPaths(catnr, xBand) {
  return (ANALYZER_X_PATHS[catnr] || [{ id: 'single', polarization: 'UNKNOWN' }])
    .map(path => ({ ...xBand, ...path }));
}

function getRfProfile(catnr, config = {}) {
  if (SIM_RF_PROFILES[catnr]) return SIM_RF_PROFILES[catnr];
  let xBand = { freq: 720, bw: 100, mod: 'QPSK' };
  if (config.group === 'SYNTHETIC APERTURE RADAR (SAR)') xBand = { freq: 720, bw: 300, mod: 'QPSK' };
  else if (config.group === 'WEATHER & EARTH RESOURCES' || config.group === 'GLOBAL EESS & SCIENCE') xBand = { freq: 720, bw: 150, mod: 'O-QPSK' };
  else if (config.group === 'MEGA CONSTELLATIONS') xBand = { freq: 720, bw: 250, mod: 'QPSK' };
  else if (config.group === 'GLOBAL NAVIGATION (GNSS)') xBand = { freq: 720, bw: 20, mod: 'BPSK' };
  else if (config.group === 'THAI CUBESAT & MICROSAT') xBand = { freq: 720, bw: 5, mod: 'BPSK' };
  return { name: config.name || 'UNKNOWN', xBand, sBand: { freq: 70, bw: 1, mod: 'BPSK' } };
}

function getRfState(target, stationMask) {
  const elevationDeg = Number.isFinite(target?.elevationDeg) ? target.elevationDeg : null;
  const mask = Number.isFinite(stationMask) ? Math.max(0, stationMask) : 0;
  const acquisitionEl = Math.max(3, mask);
  const visible = elevationDeg !== null && elevationDeg >= 0;
  const eligible = visible && elevationDeg >= mask;
  const locked = eligible && elevationDeg >= acquisitionEl;
  const status = !visible ? 'NO_CARRIER' : !eligible ? 'MASKED' : locked ? 'LOCKED' : 'ACQUIRING';
  const label = { NO_CARRIER: 'NO CARRIER', MASKED: 'BELOW MASK', LOCKED: 'RF LOCKED (SIM)', ACQUIRING: 'ACQUIRING' }[status];
  const color = locked ? '#00ff66' : eligible ? '#ffcc00' : '#ff5555';
  const acquisitionProgress = !eligible ? 0 : locked ? 1 : acquisitionEl <= mask + 1e-6 ? 1 : Math.max(0, Math.min(1, (elevationDeg - mask) / (acquisitionEl - mask)));
  const quality = locked ? 1 : eligible ? 0.18 + acquisitionProgress * 0.62 : 0;
  const geometricRatio = Number.isFinite(target?.altKm) && Number.isFinite(target?.rangeKm) && target.rangeKm > 0
    ? Math.max(0, Math.min(1, target.altKm / target.rangeKm)) : 0.25;
  const strength = locked ? 0.82 + 0.18 * Math.sqrt(geometricRatio) : eligible ? 0.20 + 0.45 * acquisitionProgress : 0;
  return { mode: 'SIM', elevationDeg, stationMask: mask, acquisitionEl, visible, eligible, locked, status, label, color, quality, acquisitionProgress, strength };
}

function rfConstellationAngles(modulation) {
  return modulation === 'BPSK' ? [0, Math.PI] : [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4];
}

// Deterministic visual noise follows simulation time, so a paused replay stays still.
function rfVisualNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function rfSpectrumPowerDb(channel, offsetMHz, state, simulatedTimeMs, isXBand) {
  const referenceDbm = isXBand ? -35 : -20;
  // Bench-analyzer visual cadence: keep the deterministic SIM noise alive, but
  // update it slowly enough that a stable carrier does not appear to "breathe".
  const tick = Math.floor(simulatedTimeMs / 220);
  const t = simulatedTimeMs / 1000;


  // CH1 X-BAND: restore the ACTUAL continuously-rendered reference silhouette
  // from Sat-Orbit-23202026-Old(4).txt. The deployed reference did NOT use the
  // later flat-top/RRC block for the visible moving trace; it used a linear
  // amplitude-domain cos^0.6 main lobe plus two sidelobe regions.
  //
  // Keep the current analyzer dBm grid/readouts, but map the old amplitude
  // silhouette linearly onto that 50 dB display range. This preserves the old
  // visual geometry while keeping the present instrument UI and SIM labeling.
  if (isXBand) {
    const progress = state.locked ? 1 : Math.max(0, Math.min(1, state.acquisitionProgress ?? state.quality ?? 0));
    const residual = 1 - progress;

    // NO CARRIER must be instrument noise only. Do not render a synthetic payload
    // envelope before acquisition begins. Noise still moves subtly like a real trace.
    if (!state.eligible) {
      const floorNoise = (rfVisualNoise(tick * 0.73 + offsetMHz * 173.1 + 11) - 0.5) * 1.2;
      return referenceDbm - 44 + floorNoise;
    }

    // Same AFC search used before lock. It collapses completely at LOCK.
    const driftMHz = state.locked
      ? 0
      : (Number(channel.bw) || 310) * 0.055 * residual * Math.sin(t * 1.15 + 0.3);
    const effectiveOffset = offsetMHz - driftMHz;

    // EXACT reference horizontal geometry.
    const visualCompression = 0.65;
    const halfBwMHz = Math.max(1e-9, (Number(channel.bw) || 310) * visualCompression / 2);
    const xNorm = Math.abs(effectiveOffset) / halfBwMHz;

    let shapeAmp = 0;
    if (xNorm <= 1.0) {
      shapeAmp = Math.pow(Math.max(0, Math.cos((xNorm * Math.PI) / 2)), 0.6);
    } else if (xNorm < 1.85) {
      // Smooth first sidelobe: sin^2 starts and ends with zero slope, avoiding the
      // synthetic-looking hook/kink where the lobe meets the analyzer noise floor.
      const u = (xNorm - 1.0) / 0.85;
      const lobe = Math.pow(Math.sin(Math.PI * u), 2);
      shapeAmp = lobe * 0.24 / Math.pow(Math.max(xNorm, 1), 0.40);
    } else if (xNorm < 2.55) {
      // Lower second sidelobe with the same C1-like visual transition.
      const u = (xNorm - 1.85) / 0.70;
      const lobe = Math.pow(Math.sin(Math.PI * u), 2);
      shapeAmp = lobe * 0.10 / Math.pow(Math.max(xNorm, 1), 0.50);
    }

    // Reference trace noise was 0.02..0.08 plus a small per-pixel vertical jitter.
    // Use deterministic SIM noise so PAUSE still freezes the current application.
    const noiseAmp = 0.02 + 0.06 * rfVisualNoise(tick * 0.73 + effectiveOffset * 173.1 + 11);
    // Keep the locked payload silhouette stationary. Any visible motion belongs to
    // the noise floor, not to the occupied-band envelope itself.
    const jitterAmp = state.locked
      ? 0
      : (rfVisualNoise(tick * 1.37 + effectiveOffset * 91.7 + 211) - 0.5) * 0.008;

    // Acquisition envelope: just above AOS the payload should remain close to the
    // noise floor, then rise progressively as AFC/AGC/carrier recovery converges.
    // Keep a small acquisition-only amplitude flutter; it decays continuously and
    // disappears at RF LOCK so the locked analyzer trace remains bench-stable.
    const acquisitionBaseGain = state.locked
      ? 1
      : Math.max(0, Math.min(1, 0.055 + 0.945 * Math.pow(progress, 1.35)));
    const acquisitionFlutter = state.locked
      ? 1
      : 1 + residual * (
          0.13 * Math.sin(t * 2.05 + 0.45) +
          0.055 * Math.sin(t * 4.60 + 1.30)
        );
    const acquisitionGain = Math.max(0, Math.min(1, acquisitionBaseGain * acquisitionFlutter));
    const signalAmp = shapeAmp * acquisitionGain;
    // Smoothly blend the deterministic floor and modeled signal instead of using a
    // hard Math.max() corner. p=8 keeps the stronger component dominant while
    // removing the visible elbow at the sidelobe/noise transition.
    const mergedAmp = Math.pow(Math.pow(noiseAmp, 8) + Math.pow(signalAmp, 8), 1 / 8);
    const totalAmp = Math.max(0, Math.min(1, mergedAmp + jitterAmp * (0.25 + 0.75 * shapeAmp)));

    // Old canvas Y was linear in amplitude. Because the present Y axis is linear
    // in dB, a linear amplitude->display-dB mapping reproduces that silhouette.
    // Floor ~= -80 dBm and locked center ~= -40 dBm, matching the old marker text.
    const noiseFloorDbm = referenceDbm - 45;
    const peakDbm = referenceDbm - 5;
    return noiseFloorDbm + totalAmp * (peakDbm - noiseFloorDbm);
  }

  // Engineering SIM model: QPSK and O-QPSK have the same ideal PSD when the
  // pulse shape is the same. With no receiver ICD pulse-shaping coefficient in
  // this UI, use the rectangular-symbol reference PSD: sinc^2(f/Rs).  The first
  // nulls occur at +/-Rs, so the null-to-null width is 2Rs.  THEOS-2 therefore
  // uses Rs=155 MSym/s for the 310 MHz X-band model and 117.647 kSym/s for the
  // 0.235 MHz S-band telemetry model.  This is a SIM reference, not an RF capture.
  const symbolRateMHz = Math.max(1e-6, Number(channel.symbolRateMsps) || Math.max(1e-6, Number(channel.bw) / 2));

  // Instrument-like noise floor: deterministic in SIM time so PAUSE freezes the trace.
  const fastNoise = (rfVisualNoise(tick * 0.731 + offsetMHz * (isXBand ? 47.3 : 811.7) + (isXBand ? 13 : 37)) - 0.5) * (isXBand ? 1.2 : 1.0);
  // At RF LOCK the spectral envelope is stationary; only the noise floor updates.
  // Before lock, a small correlated component remains to suggest acquisition activity.
  const correlatedTime = state.locked ? 0 : t;
  const correlatedNoise =
    Math.sin(offsetMHz * (isXBand ? 0.043 : 19.0) + correlatedTime * 0.91) * (isXBand ? 0.22 : 0.12) +
    Math.sin(offsetMHz * (isXBand ? 0.017 : 7.3) - correlatedTime * 0.47) * (isXBand ? 0.12 : 0.08);
  const noiseDbm = referenceDbm - 44 + fastNoise + correlatedNoise;
  if (!state.eligible) return noiseDbm;

  const progress = state.locked ? 1 : Math.max(0, Math.min(1, state.acquisitionProgress ?? state.quality ?? 0));
  const residual = 1 - progress;

  // AFC/AGC search during acquisition. Drift and amplitude breathing collapse at lock.
  const driftMHz = state.locked ? 0 : symbolRateMHz * (isXBand ? 0.08 : 0.22) * residual * Math.sin(t * (isXBand ? 0.73 : 1.17) + (isXBand ? 0.35 : 1.1));
  const effectiveOffset = offsetMHz - driftMHz;
  const x = effectiveOffset / symbolRateMHz;
  const ax = Math.abs(x);

  // sinc^2 power spectral density of NRZ QPSK/O-QPSK symbols.
  const sinc = ax < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
  let psdLinear = sinc * sinc;

  // A practical receiver chain suppresses very distant sidelobes. This gentle
  // envelope keeps the first sidelobes visible while preventing an unrealistic
  // comb across a wide display span.
  const receiverEnvelope = Math.exp(-0.10 * Math.pow(ax, 1.35));
  psdLinear *= receiverEnvelope;

  // S-BAND acquisition dynamics only: below the 3 deg lock threshold, keep the
  // carrier close to the analyzer noise floor just after AOS, then let it emerge
  // progressively as AFC/AGC/carrier recovery converges. At RF LOCK this term is
  // exactly 0 dB, so the already-approved locked QPSK spectrum shape is unchanged.
  const acquisitionSuppressionDb = state.locked ? 0 : 36 * Math.pow(residual, 1.75);
  const peakDbm = referenceDbm - 5 - (1 - state.strength) * 12 - (state.locked ? 0 : 9 * residual) - acquisitionSuppressionDb;
  let signalPower = Math.pow(10, peakDbm / 10) * psdLinear;

  // Small in-band texture represents modulation statistics / detector variance,
  // not a second synthetic lobe generator.
  if (signalPower > 0) {
    const textureWindow = Math.exp(-0.22 * ax * ax);
    const textureTime = state.locked ? 0 : t;
    const textureDb = textureWindow * (
      (isXBand ? 0.26 : 0.16) * Math.sin(effectiveOffset * (isXBand ? 0.091 : 28.0) + textureTime * 0.42) +
      (isXBand ? 0.15 : 0.09) * Math.sin(effectiveOffset * (isXBand ? 0.027 : 11.0) - textureTime * 0.31)
    );
    signalPower *= Math.pow(10, textureDb / 10);
  }

  if (!state.locked && signalPower > 0) {
    const flutterDb = residual * (
      0.8 * Math.sin(t * 2.1 + (isXBand ? 0.4 : 1.7)) +
      0.35 * Math.sin(t * 4.3 + (isXBand ? 2.2 : 0.6))
    );
    signalPower *= Math.pow(10, flutterDb / 10);
  }

  const floorPower = Math.pow(10, noiseDbm / 10);
  return 10 * Math.log10(Math.max(1e-30, signalPower + floorPower));
}

function formatRfMHz(valueMHz, digits = 3) {
  const value = Number(valueMHz);
  if (!Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1000) return `${value.toFixed(digits)} MHz`;
  if (Math.abs(value) >= 1) return `${value.toFixed(digits)} MHz`;
  if (Math.abs(value) >= 0.001) return `${(value * 1000).toFixed(3)} kHz`;
  return `${(value * 1e6).toFixed(1)} Hz`;
}

function getRfInstrumentSettings(channel, span, isXBand) {
  // Use conservative AUTO display settings: resolve at least ~40 points across
  // the modeled occupied band while keeping the analyzer span responsive.
  const bw = Math.max(1e-6, Number(channel?.bw) || 1);
  const displaySpan = Math.max(1e-6, Number(span) || bw * 3);
  const rbwMHz = Math.max(0.000001, Math.min(displaySpan / 106, bw / 40));
  const vbwMHz = rbwMHz * 3;
  return {
    refDbm: isXBand ? -35 : -20,
    rbwMHz,
    vbwMHz,
    detector: 'RMS',
    attenuationDb: 10,
  };
}

function drawRfSpectrumFrame(surface, channel, span, state, simulatedTimeMs, isXBand) {
  const { ctx, width: w, height: h } = surface;
  const externalLabels = !!surface.externalLabels;
  if (w < 30 || h < (externalLabels ? 16 : 50)) return;
  ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, w, h);
  const left = externalLabels && w >= 360 ? 42 : 10, right = w - 10, graphW = right - left;
  const top = externalLabels ? 7 : 18, bottom = Math.max(top + 1, h - (externalLabels ? 7 : 32));
  const referenceDbm = isXBand ? -35 : -20;
  const dbToY = db => Math.max(top, Math.min(bottom, top + (referenceDbm - db) / 50 * (bottom - top)));
  ctx.strokeStyle = 'rgba(150,165,174,0.20)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const x = left + i * graphW / 10, y = top + i * (bottom - top) / 10;
    ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    ctx.moveTo(left, y); ctx.lineTo(right, y);
  }
  ctx.stroke(); ctx.setLineDash([]);
  if (externalLabels && w >= 360 && h >= 90) {
    ctx.save();
    ctx.fillStyle = '#93a2aa';
    ctx.font = '700 10px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 10; i += 2) {
      const y = top + i * (bottom - top) / 10;
      ctx.fillText(String(referenceDbm - i * 5), left - 7, y);
    }
    ctx.restore();
  }
  const traceColor = isXBand ? '#ffcc00' : '#00eaff';
  const sampleCount = Math.max(2, Math.ceil(graphW) + 1);
  const rawDb = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const plotX = Math.min(i, graphW);
    const offset = (plotX / graphW - 0.5) * span;
    rawDb[i] = rfSpectrumPowerDb(channel, offset, state, simulatedTimeMs, isXBand);
  }
  // Display detector / VBW smoothing. The S-band trace stays narrow but no
  // longer becomes a one-pixel carrier; X-band keeps the physical sinc^2 sidelobes.
  const settings = getRfInstrumentSettings(channel, span, isXBand);
  const rbwPixels = Math.max(1, Math.round((settings.rbwMHz / Math.max(1e-9, span)) * graphW));
  const halfKernel = Math.max(1, Math.min(isXBand ? 4 : 3, Math.ceil(rbwPixels * 0.8)));
  // The old X-band reference was drawn sample-for-sample with no RBW/VBW
  // convolution. Do not smooth CH1 or its deep nulls / small sidelobes disappear.
  // Keep the current S-band detector smoothing unchanged.
  const smoothedDb = isXBand ? rawDb : rawDb.map((value, i) => {
    let weighted = 0, weightSum = 0;
    for (let k = -halfKernel; k <= halfKernel; k++) {
      const idx = Math.max(0, Math.min(sampleCount - 1, i + k));
      const weight = halfKernel + 1 - Math.abs(k);
      weighted += rawDb[idx] * weight;
      weightSum += weight;
    }
    return weighted / Math.max(1, weightSum);
  });
  ctx.strokeStyle = traceColor; ctx.lineWidth = 1.35; ctx.beginPath();
  for (let i = 0; i < sampleCount; i++) {
    const plotX = Math.min(i, graphW);
    const y = dbToY(smoothedDb[i]);
    if (i === 0) ctx.moveTo(left + plotX, y); else ctx.lineTo(left + plotX, y);
  }
  ctx.stroke();
  if (externalLabels) {
    if (state.eligible) {
      const markerDbm = rfSpectrumPowerDb(channel, 0, state, simulatedTimeMs, isXBand);
      const markerX = left + graphW / 2, markerY = dbToY(markerDbm);
      ctx.fillStyle = traceColor; ctx.beginPath();
      ctx.moveTo(markerX, markerY); ctx.lineTo(markerX - 4, markerY - 6); ctx.lineTo(markerX + 4, markerY - 6); ctx.closePath(); ctx.fill();
    }
    return;
  }
  ctx.font = 'bold 11px Rajdhani, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#e2e8f0';
  const utcTime = new Date(simulatedTimeMs).toISOString().slice(11, 19);
  ctx.fillText(`${utcTime} UTC · SIM`, left + 4, 13);
  // dBm values belong to the synthetic trace; marker uses the exact same function.
  if (h >= 130) ctx.fillText(`REF ${referenceDbm.toFixed(1)} dBm · 5 dB/div`, left + 4, 29);
  ctx.fillStyle = state.color;
  ctx.fillText(`${state.label} · EL ≥ ${state.acquisitionEl.toFixed(1)}°`, left + 4, h >= 130 ? 44 : 28);
  if (state.eligible) {
    const markerDbm = rfSpectrumPowerDb(channel, 0, state, simulatedTimeMs, isXBand);
    const markerX = left + graphW / 2, markerY = dbToY(markerDbm);
    ctx.fillStyle = traceColor; ctx.beginPath();
    ctx.moveTo(markerX, markerY); ctx.lineTo(markerX - 4, markerY - 7); ctx.lineTo(markerX + 4, markerY - 7); ctx.closePath(); ctx.fill();
    ctx.textAlign = 'right';
    if (w >= 340) {
      ctx.fillText(`MKR ${channel.freq.toFixed(1)} MHz`, right - 4, 13);
      ctx.fillStyle = '#fff'; ctx.fillText(`${markerDbm.toFixed(2)} dBm (SIM)`, right - 4, 29);
    }
  }
  ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left';
  ctx.fillText(`IF CENTER ${channel.freq.toFixed(1)} MHz`, left + 4, h - 17);
  ctx.textAlign = 'right';
  ctx.fillText(`SPAN ${span >= 1000 ? (span / 1000).toFixed(3) + ' GHz' : span.toFixed(1) + ' MHz'}`, right - 4, h - 17);
  ctx.textAlign = 'left'; ctx.fillStyle = '#91a2ba';
  ctx.fillText(`SIM PRESET · BW ${channel.bw} MHz`, left + 4, h - 4);
  if (w >= 340) { ctx.textAlign = 'right'; ctx.fillText('SYNTHETIC RF', right - 4, h - 4); }
  ctx.textAlign = 'left';
}

function drawRfIqFrame(surface, profile, state, simulatedTimeMs, showXBand, showSBand) {
  const { ctx, width: w, height: h } = surface;
  if (w < 10 || h < 10) return;
  ctx.fillStyle = '#0b1121'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * 0.35;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,204,0,0.35)'; ctx.setLineDash([4, 4]); ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  const tick = Math.floor(simulatedTimeMs / 40), t = simulatedTimeMs / 1000;

  const gaussianPair = (seed) => {
    const u1 = Math.max(0.0001, rfVisualNoise(seed + 1));
    const u2 = rfVisualNoise(seed + 2);
    const mag = Math.sqrt(-2 * Math.log(u1));
    return [mag * Math.cos(2 * Math.PI * u2), mag * Math.sin(2 * Math.PI * u2)];
  };

  const drawChannel = (channel, color, seedOffset) => {
    const angles = rfConstellationAngles(channel.mod); // BPSK=2, QPSK/O-QPSK=4 ideal symbols.
    const count = angles.length === 2 ? 150 : 260;
    const progress = state.locked ? 1 : Math.max(0, Math.min(1, state.acquisitionProgress ?? 0));
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const seed = tick * 4096 + seedOffset + i * 11;
      let x, y;
      if (!state.eligible) {
        // No carrier: thermal/noise cloud remains around the origin, not a square of random symbols.
        const [gx, gy] = gaussianPair(seed);
        const sigma = radius * 0.22;
        x = cx + gx * sigma; y = cy + gy * sigma;
      } else {
        const ideal = angles[i % angles.length];
        const [gx, gy] = gaussianPair(seed);
        if (state.locked) {
          const sigma = radius * (channel.mod === 'O-QPSK' ? 0.038 : 0.030);
          x = cx + radius * Math.cos(ideal) + gx * sigma;
          y = cy - radius * Math.sin(ideal) + gy * sigma;
        } else {
          // Acquisition: residual carrier/phase error produces a rotating arc/ring that
          // progressively collapses into the correct 2- or 4-cluster constellation.
          const residual = 1 - progress;
          const phaseError = residual * (0.95 * Math.sin(t * 1.35 + seedOffset * 0.001) + 0.38 * Math.sin(t * 3.7));
          const phaseJitter = gx * (0.42 * residual + 0.06);
          const r = radius * (0.72 + 0.28 * progress) + gy * radius * (0.20 * residual + 0.045);
          const angle = ideal + phaseError + phaseJitter;
          x = cx + r * Math.cos(angle);
          y = cy - r * Math.sin(angle);
        }
      }
      ctx.globalAlpha = 0.55 + rfVisualNoise(seed + 3) * 0.45;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  };
  if (showXBand) drawChannel(profile.xBand, '#ffcc00', profile.xBand.polarization === 'LHCP' ? 1000 : 0);
  if (showSBand) drawChannel(profile.sBand, '#00eaff', 2000);
}

// TSX 2026: Premium neutral spacecraft used only when the selected satellite
// does not have a verified mission-specific image asset.  This avoids visually
// misrepresenting another spacecraft as THEOS/THEOS-2 while keeping the TSX
// demonstration polished and self-contained (no extra /textures file required).
const GENERIC_LEO_SATELLITE_SVG = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 430" role="img" aria-label="Generic LEO satellite">
  <defs>
    <linearGradient id="busGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1aa"/>
      <stop offset="0.22" stop-color="#d6a83d"/>
      <stop offset="0.58" stop-color="#8d5f18"/>
      <stop offset="1" stop-color="#f1cc67"/>
    </linearGradient>
    <linearGradient id="busSide" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6c4610"/>
      <stop offset="1" stop-color="#2f1d08"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#163d74"/>
      <stop offset="0.52" stop-color="#071d43"/>
      <stop offset="1" stop-color="#020c25"/>
    </linearGradient>
    <radialGradient id="aperture" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#f8fbff"/>
      <stop offset="0.42" stop-color="#99b6c9"/>
      <stop offset="0.72" stop-color="#26394c"/>
      <stop offset="1" stop-color="#08111c"/>
    </radialGradient>
    <filter id="shadow" x="-30%" y="-50%" width="160%" height="200%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000000" flood-opacity="0.75"/>
    </filter>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g transform="translate(500 215) rotate(-4)" filter="url(#shadow)">
    <g transform="translate(-300 -8) skewY(-5)">
      <polygon points="-165,-63 122,-48 122,54 -165,73" fill="url(#panel)" stroke="#7197c8" stroke-width="5"/>
      <g stroke="#315f9d" stroke-width="3" opacity="0.9">
        <path d="M-118 -61V70M-70 -58V67M-22 -56V64M26 -53V61M74 -51V58"/>
        <path d="M-160 -26L120 -15M-162 8L120 18M-164 42L120 50"/>
      </g>
      <path d="M122 -26L177 -18V28L122 34Z" fill="#7b8790" stroke="#c6d0d7" stroke-width="4"/>
    </g>
    <g transform="translate(300 8) skewY(5)">
      <polygon points="-122,-54 165,-73 165,63 -122,48" fill="url(#panel)" stroke="#7197c8" stroke-width="5"/>
      <g stroke="#315f9d" stroke-width="3" opacity="0.9">
        <path d="M-74 -51V45M-26 -54V48M22 -57V51M70 -60V54M118 -64V58"/>
        <path d="M-120 -18L163 -39M-120 15L164 -6M-120 47L164 27"/>
      </g>
      <path d="M-122 -31L-177 -28V18L-122 26Z" fill="#7b8790" stroke="#c6d0d7" stroke-width="4"/>
    </g>
    <g>
      <polygon points="-104,-115 82,-92 108,72 -70,110 -122,24" fill="url(#busGold)" stroke="#f6df8a" stroke-width="5"/>
      <polygon points="82,-92 139,-48 150,43 108,72" fill="url(#busSide)" stroke="#b17b27" stroke-width="4"/>
      <polygon points="-70,110 108,72 150,43 -27,89" fill="#51350d" opacity="0.8"/>
      <g fill="none" stroke="#fff0a1" stroke-width="3" opacity="0.55">
        <path d="M-91 -79L78 -60M-104 -32L94 -15M-104 18L103 30M-90 66L82 57"/>
        <path d="M-53 -106L-61 95M-2 -101L-9 91M48 -96L42 83"/>
      </g>
      <circle cx="-5" cy="-14" r="58" fill="#d9e4ea" stroke="#fff7cb" stroke-width="8"/>
      <circle cx="-5" cy="-14" r="45" fill="url(#aperture)" stroke="#607c8d" stroke-width="5"/>
      <circle cx="-17" cy="-26" r="13" fill="#ffffff" opacity="0.75" filter="url(#softGlow)"/>
      <path d="M-25 49L21 42L28 76L-20 84Z" fill="#202c35" stroke="#d4b55b" stroke-width="4"/>
      <path d="M-95 0L-143 10L-147 43L-106 37Z" fill="#4e5960" stroke="#d6bd72" stroke-width="4"/>
      <path d="M76 -69L112 -89L128 -74L94 -52Z" fill="#d9e3e7" stroke="#fff" stroke-width="3" opacity="0.9"/>
    </g>
    <g transform="translate(40 95)">
      <path d="M0 0L16 34" stroke="#cbd5dc" stroke-width="7"/>
      <ellipse cx="22" cy="46" rx="39" ry="17" fill="#c8d1d6" stroke="#f7fbff" stroke-width="5"/>
      <ellipse cx="22" cy="46" rx="24" ry="10" fill="#50616d"/>
    </g>
  </g>
</svg>`)}`;

function SatOrbitCore() {
  
  // 📍 ฟันธง: สร้างสมองกลควบคุมหน้าจอ Loading (Splash Screen) สไตล์ Sci-Fi
  const [loadingPct, setLoadingPct] = useState(0);
  const [isAppReady, setIsAppReady] = useState(false);

 // 📍 OK17.2 ASSET RESIDENCY FIX: keep compressed bytes inside this page for the
  // full App lifetime. Unlike a normal <img> preload, Blob URLs can be decoded again
  // without re-requesting /textures/* from the WebContainer/Vite dev server after a
  // long idle session or browser memory-pressure eviction.
  const runtimeAssetUrlsRef = useRef({});
  const runtimeAssetBlobsRef = useRef({});
  const [runtimeAssetRevision, setRuntimeAssetRevision] = useState(0);

  const runtimeAsset = (src) => runtimeAssetUrlsRef.current[src] || src;

  useEffect(() => {
    let cancelled = false;
    const createdUrls = [];
    const criticalAssets = [
      '/textures/Blue_marble_depth.webp',
      '/textures/8k_earth_daymap.webp',
      '/textures/Earth_nightmap.webp',
      '/textures/Blue_Marble_BG.webp',
      '/textures/Flat_earth_Largest.webp',
      '/textures/THEOS-2.webp',
      '/textures/THEOS.webp',
      '/textures/THEOS-2-1.webp'
    ];

    const fetchResidentBlob = async (src) => {
      // The first request normally succeeds while the WebContainer preview is awake.
      // Retry briefly so a transient dev-server/HMR refresh cannot leave a hole.
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          try {
            const response = await fetch(src, { cache: 'force-cache', signal: controller.signal });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.blob();
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
        }
      }
      throw lastError || new Error(`Unable to pin ${src}`);
    };

    (async () => {
      const results = await Promise.allSettled(
        criticalAssets.map(async (src) => {
          const blob = await fetchResidentBlob(src);
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(blob);
          runtimeAssetBlobsRef.current[src] = blob;
          runtimeAssetUrlsRef.current[src] = objectUrl;
          createdUrls.push(objectUrl);
        })
      );

      if (!cancelled) {
        const failed = results.filter(r => r.status === 'rejected').length;
        if (failed) console.warn(`[AssetResidency] ${failed} critical asset(s) could not be pinned; direct URL fallback remains active.`);
        setRuntimeAssetRevision(v => v + 1);
      }
    })();

    return () => {
      cancelled = true;
      createdUrls.forEach(url => URL.revokeObjectURL(url));
      runtimeAssetUrlsRef.current = {};
      runtimeAssetBlobsRef.current = {};
    };
  }, []);

  useEffect(() => {
    let pct = 0;
    let readyTimer = null;
    const interval = setInterval(() => {
      // ⚙️ จุดปรับที่ 1: ความก้าวหน้า (สุ่มบวกทีละ 2% ถึง 6% จะทำให้หลอดเต็มไวขึ้น)
      pct += Math.floor(Math.random() * 2) + 1; 
      
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        // ⚙️ จุดปรับที่ 2: เวลาค้างหน้าจอ 100% (หน่วยเป็นมิลลิวินาที / 2000 = ค้าง 2 วินาทีแล้วเข้าแอป)
        readyTimer = setTimeout(() => setIsAppReady(true), 2000); 
      }
      setLoadingPct(pct);
    // ⚙️ จุดปรับที่ 3: ความเร็วในการรีเฟรชตัวเลข (หน่วยเป็นมิลลิวินาที / 50 = อัปเดตไวขึ้น ลื่นไหลขึ้น)
    }, 50); 
    return () => {
      clearInterval(interval);
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, []);

  // 📍 ฟันธง 2: กู้คืนสมองกลควบคุมปุ่มสลับสถานี
  const [activeStation, setActiveStation] = useState(GS_NETWORK[0]);

  const globeRef = useRef(null);
// Optional workspaces start in Classic every time. Keep the Globe and Core alive.
const [workspaceMode, setWorkspaceMode] = useState('classic');
const [presentationScale, setPresentationScale] = useState(1);
const [narrowHudPanel, setNarrowHudPanel] = useState(null);
const workspaceToolbarRef = useRef(null);
const [workspaceToolbarHeight, setWorkspaceToolbarHeight] = useState(46);
React.useLayoutEffect(() => {
  document.documentElement.style.setProperty('--sat-text-scale', String(presentationScale));
}, [presentationScale]);
React.useLayoutEffect(() => {
  const bar = workspaceToolbarRef.current;
  if (!bar) return;
  const measure = () => setWorkspaceToolbarHeight(value => {
    const height = Math.ceil(bar.getBoundingClientRect().height);
    return height > 0 && value !== height ? height : value;
  });
  measure();
  const observer = new ResizeObserver(measure); observer.observe(bar);
  return () => observer.disconnect();
}, [workspaceMode]);
const [focusedWorkspacePanel, setFocusedWorkspacePanel] = useState(null);
const [toolWindows, setToolWindows] = useState({});
const toolWindowsRef = useRef({});
const [toolHostRevision, setToolHostRevision] = useState(0);
const classicToolsRef = useRef(null);
const workspaceSessionRef = useRef(`sat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
const workspaceRuntimeRef = useRef({});
const globeHostRef = useRef(null);
const [globeSize, setGlobeSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

const publishToolWindows = (next) => {
  toolWindowsRef.current = next;
  setToolWindows(next);
  setToolHostRevision(revision => revision + 1);
};

const setToolOpen = (id, open) => {
  if (id === 'radar') setIsRadarOpen(open);
  if (id === 'analyzer') setIsAnalyzerOpen(open);
  if (id === 'iq') setIsIqOpen(open);
  if (id === 'diagram') setIsDiagramOpen(open);
  if (id === 'antenna3d') setIsAntenna3DOpen(open);
  if (id === 'weather') setIsWeatherOpen(open);
  if (id === 'gs') setIsGsModalOpen(open);
  if (id === 'db') setIsModalOpen(open);
  if (id === 'pass') setIsPassModalOpen(open);
  if (id === 'angles') setIsAnglesOpen(open);
  if (id === 'img') setIsImgOpen(open);
};

const returnToolToMain = (id, closeWindow = true) => {
  const viewer = toolWindowsRef.current[id];
  if (!viewer) return;
  // Normal RETURN and browser-X recovery now share the same safe re-home path.
  // If pagehide already rescued the surface this is intentionally a no-op.
  rehomeSatToolSurface(id, viewer.mount);
  viewer.dispose?.();
  const next = { ...toolWindowsRef.current };
  delete next[id];
  publishToolWindows(next);
  setToolOpen(id, true);
  if (closeWindow && !viewer.win.closed) viewer.win.close();
};

const openToolWindow = (id) => {
  if (!SAT_WORKSPACE_TOOLS[id]) return;
  const existing = toolWindowsRef.current[id];
  if (existing && !existing.win.closed) { existing.win.focus(); return; }
  let child;
  let attachTimer = null;
  try {
    const width = Math.min(id === 'radar' ? 760 : 1180, window.screen?.availWidth || window.innerWidth);
    const height = Math.min(820, Math.max(400, (window.screen?.availHeight || window.innerHeight) - 70));
    const detachedUrl = buildSatDetachedUrl(id, workspaceSessionRef.current);
    child = window.open(detachedUrl, `${workspaceSessionRef.current}-${id}`, `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=no`);
    if (!child) throw new Error('POPUP_BLOCKED');

    const attachViewer = () => {
      try {
        if (!child || child.closed) { if (attachTimer) clearInterval(attachTimer); return; }
        const childUrl = new URL(child.location.href);
        const correctTool = childUrl.origin === window.location.origin && childUrl.searchParams.get('satDetached') === id;
        if (!correctTool || child.document.readyState !== 'complete') return;
        if (attachTimer) clearInterval(attachTimer);
        attachTimer = null;
        const viewer = createSatViewerDocument(child, SAT_WORKSPACE_TOOLS[id], id, workspaceSessionRef.current);
        publishToolWindows({ ...toolWindowsRef.current, [id]: viewer });
        setToolOpen(id, true);
        child.focus();
      } catch (_) { /* Navigation is still completing; the short poll will retry. */ }
    };

    attachTimer = setInterval(attachViewer, 50);
    attachViewer();
    setTimeout(() => {
      if (!attachTimer) return;
      clearInterval(attachTimer);
      attachTimer = null;
      try { if (child && !child.closed) child.close(); } catch (_) {}
      setCustomAlert({ show: true, type: 'error', message: 'Detached tool did not finish loading. Allow pop-ups for SAT-Orbit and press ↗ again. The tool remains available in the main window.' });
    }, 6000);
  } catch (error) {
    if (attachTimer) clearInterval(attachTimer);
    if (child && !child.closed) child.close();
    setCustomAlert({ show: true, type: 'error', message: 'Unable to open a detached window. Allow pop-ups for SAT-Orbit and press ↗ again. The tool remains available in the main window.' });
  }
};

const toggleToolVisibility = (id, currentlyOpen) => {
  const viewer = toolWindowsRef.current[id];
  if (viewer && !viewer.win.closed) { viewer.win.focus(); return; }
  setToolOpen(id, !currentlyOpen);
  if (!currentlyOpen) bringToFront(id);
};

const closeTool = (id) => {
  if (toolWindowsRef.current[id]) returnToolToMain(id);
  else setToolOpen(id, false);
};

const startQuadWorkspace = () => {
  if (workspaceMode === 'quad') return;
  // MULTI-VIEW FINAL: guarantee a deterministic 4-UP dashboard. If one of the
  // protected tools is detached, return that SAME live surface before arranging it.
  SAT_QUAD_TOOL_IDS.forEach(id => { if (toolWindowsRef.current[id]) returnToolToMain(id); });
  classicToolsRef.current = {
    radar: isRadarOpen, analyzer: isAnalyzerOpen, diagram: isDiagramOpen,
    showXBand, showSBand
  };
  // Dashboard summary always presents both receiver channels. Classic state is restored on exit.
  setShowXBand(true); setShowSBand(true);
  setIsRadarOpen(true); setIsAnalyzerOpen(true); setIsDiagramOpen(true);
  setFocusedWorkspacePanel(null);
  setWorkspaceMode('quad');
};

const returnClassicWorkspace = () => {
  const before = classicToolsRef.current;
  if (before) {
    SAT_QUAD_TOOL_IDS.forEach(id => setToolOpen(id, !!toolWindowsRef.current[id] || before[id]));
    if (typeof before.showXBand === 'boolean') setShowXBand(before.showXBand);
    if (typeof before.showSBand === 'boolean') setShowSBand(before.showSBand);
  }
  classicToolsRef.current = null;
  setFocusedWorkspacePanel(null);
  setWorkspaceMode('classic');
};

const toolDetachButton = (id) => <button className="sat-popout-btn" aria-label={toolWindows[id] ? `Return ${SAT_WORKSPACE_TOOLS[id]} to main` : `Detach ${SAT_WORKSPACE_TOOLS[id]}`}
    title={toolWindows[id] ? 'Return tool to main window' : 'Open tool in a detachable window'}
    onMouseDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); toolWindows[id] ? returnToolToMain(id) : openToolWindow(id); }}>
    <SatWindowIcon kind={toolWindows[id] ? 'return' : 'detach'} />{toolWindows[id] && 'RETURN'}
  </button>;
const toolWindowButton = (id) => <>{toolDetachButton(id)}</>;

React.useLayoutEffect(() => {
  const host = globeHostRef.current;
  if (!host) return;
  const measure = () => {
    const rect = host.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) setGlobeSize(previous => {
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      return previous.width === next.width && previous.height === next.height ? previous : next;
    });
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(host);
  return () => observer.disconnect();
}, []);

useEffect(() => {
  const timer = setInterval(() => {
    for (const [id, viewer] of Object.entries(toolWindowsRef.current)) {
      try {
        if (viewer.win.closed) { returnToolToMain(id, false); continue; }
        // Reloading a detached SAT-Orbit URL reattaches the live panel without starting a second Core.
        if (viewer.win.document !== viewer.document || !viewer.mount.isConnected) {
          let detachedTool = null;
          try { detachedTool = getSatDetachedToolFromLocation(viewer.win); } catch (_) {}
          if (detachedTool !== id) { returnToolToMain(id, false); continue; }
          if (viewer.win.document.readyState !== 'complete') continue;
          viewer.dispose?.();
          const refreshed = createSatViewerDocument(viewer.win, SAT_WORKSPACE_TOOLS[id], id, workspaceSessionRef.current);
          publishToolWindows({ ...toolWindowsRef.current, [id]: refreshed });
          continue;
        }
        viewer.mount.style.pointerEvents = '';
        viewer.mount.style.opacity = '';
        viewer.status.style.background = '';
        const state = workspaceRuntimeRef.current;
        viewer.status.textContent = `${state.clockMode || 'SIM'} · ${state.isPlaying ? 'RUNNING' : 'PAUSED'} · ${new Date(state.time || Date.now()).toISOString().replace('T', ' ').slice(0, 19)} UTC · ${state.station || ''} · ${state.muted ? 'MUTE' : 'AUDIO'} · CONTROLLED BY MAIN WINDOW`;
        viewer.measureStatus?.();
      } catch (_) { returnToolToMain(id, false); }
    }
  }, 500);
  const syncTheme = () => Object.values(toolWindowsRef.current).forEach(viewer => {
    try { if (!viewer.win.closed) viewer.syncStyles(); } catch (_) { /* window closed */ }
  });
  const styles = new MutationObserver(syncTheme);
  styles.observe(document.head, { childList: true, subtree: true, characterData: true });
  const theme = new MutationObserver(syncTheme);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  const controllerStopped = () => Object.values(toolWindowsRef.current).forEach(viewer => {
    try {
      if (!viewer.win.closed) {
        viewer.status.textContent = 'MAIN SAT-ORBIT SESSION DISCONNECTED — DATA IS NO LONGER UPDATING. Reopen SAT-Orbit and detach this tool again.';
        viewer.status.style.background = '#5b1414';
        viewer.mount.style.pointerEvents = 'none';
        viewer.mount.style.opacity = '.45';
      }
    } catch (_) { /* window closed */ }
  });
  window.addEventListener('pagehide', controllerStopped);
  return () => {
    clearInterval(timer); styles.disconnect(); theme.disconnect();
    window.removeEventListener('pagehide', controllerStopped);
    controllerStopped();
  };
}, []);

  const fileInputRef = useRef(null); 
  const isTrackingRef = useRef(false);
  // 📍 ฟันธง: ประกาศ State ควบคุม Station Mask (มุมเงยรับสัญญาณ)
  const [stationMask, setStationMask] = useState(0);

  // 📍 ฟันธง: ตัวแปรควบคุมการแสดงผลสถานี (มี 4 โหมด: 'both', 'icon', 'name', 'none')
  const [stationDisplayMode, setStationDisplayMode] = useState('both');

  const [size, setSize] = useState(() => ({ width: typeof window !== 'undefined' ? window.innerWidth : 1920, height: typeof window !== 'undefined' ? window.innerHeight : 1080 }));
  // Full Screen is handled separately from normal Browser mode so the already-correct
  // Browser layout remains byte-for-byte visually unchanged.
  const [isMainFullscreen, setIsMainFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));

  // MAIN HUD — DEPLOY-LOCKED RESPONSIVE BEHAVIOR.
  // Desktop/TV uses the proven deployed HUD scale directly from viewport width + height.
  // Compact/Narrow keeps the newer adaptive drawer behavior; no Globe/orbit logic is touched.
  
  const [tles, setTles] = useState(() => {
    try {
      const saved = safeStorageGet('localStorage', 'gistda_tles');
      const parsed = saved ? sanitizeTleMap(JSON.parse(saved)) : {};
      // Keep fallbacks for resilience, but only merge validated cached pairs.
      return { ...FALLBACK_TLES, ...parsed };
    } catch(e) { return FALLBACK_TLES; }
  });

  const [tleSource, setTleSource] = useState(() => {
    const saved = safeStorageGet('localStorage', 'gistda_tles');
    if (!saved) return 'Fallback / Built-in (DEGRADED)';
    try {
      const parsed = sanitizeTleMap(JSON.parse(saved));
      return Object.keys(parsed).length > 0
        ? 'Restored from Memory'
        : 'Fallback / Built-in (DEGRADED)';
    } catch (_) {
      return 'Fallback / Built-in (DEGRADED)';
    }
  });

  const [tleUpdatedAtMs, setTleUpdatedAtMs] = useState(() => {
    const saved = Number(safeStorageGet('localStorage', 'gistda_tle_updated_at'));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const markTleUpdated = (timestamp = Date.now()) => {
    setTleUpdatedAtMs(timestamp);
    safeStorageSet('localStorage', 'gistda_tle_updated_at', String(timestamp));
  };

  const [isUpdatingTle, setIsUpdatingTle] = useState(false);
  const tleFetchControllerRef = useRef(null);
  const [selectedCatnr, setSelectedCatnr] = useState(SATELLITE_OPTIONS[0].catnr);
  const [selectedCatnrs, setSelectedCatnrs] = useState([SATELLITE_OPTIONS[0].catnr]); 
  
  const [simulatedTimeMs, setSimulatedTimeValue] = useState(Date.now());
  const [clockMode, setClockModeValue] = useState('LIVE');
  const clockModeRef = useRef('LIVE');
  const setClockMode = (mode) => { clockModeRef.current = mode; setClockModeValue(mode); };
  const manualSeekRevisionRef = useRef(0);
  const setSimulatedTimeMs = (value) => {
    manualSeekRevisionRef.current += 1;
    setClockMode('SIM');
    setSimulatedTimeValue(value);
  };
  
  const [sliderMode, setSliderMode] = useState('DAILY');

// 📍 สมองกลควบคุมการกดค้างปุ่มข้ามเวลา (Hold to Seek)
const seekRef = useRef({ isHolding: false, interval: null, timeout: null });

const handleSeekDown = (amount) => {
  // 📍 ฟันธง: ล้างวงจรเก่าทิ้งก่อนเสมอ ป้องกันบั๊กกดรัวๆ แล้วเวลาวิ่งทะลุพิกัด (Memory Leak)
  clearTimeout(seekRef.current.timeout);
  if (seekRef.current.interval) clearInterval(seekRef.current.interval);

  seekRef.current.isHolding = false;
  // รอ 300ms (0.3 วิ) ถ้ายังกดอยู่ถึงจะเริ่มเข้าโหมดไถลเวลาแบบสมูท (Smooth Scrubbing)
  seekRef.current.timeout = setTimeout(() => {
    seekRef.current.isHolding = true;
    seekRef.current.interval = setInterval(() => {
      setSimulatedTimeMs(prev => prev + (amount > 0 ? 1500 : -1500)); // ไถลเวลาความเร็ว 30X
    }, 50); // อัปเดตเฟรมเรตทุก 50ms ให้ภาพบนโลกไหลลื่น
  }, 300); 
};

const handleSeekUp = (amount) => {
  clearTimeout(seekRef.current.timeout);
  if (seekRef.current.interval) clearInterval(seekRef.current.interval);
  
  // ถ้าปล่อยเมาส์เร็วกว่า 0.3 วิ (แค่คลิก ไม่ได้กดค้าง) ให้กระโดดทีเดียว 30 วิ
  if (!seekRef.current.isHolding && amount !== 0) {
     setSimulatedTimeMs(prev => prev + amount); 
  }
  seekRef.current.isHolding = false;
};

useEffect(() => {
  return () => {
    clearTimeout(seekRef.current.timeout);
    if (seekRef.current.interval) clearInterval(seekRef.current.interval);
  };
}, []);

  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);
  const [realtimeSun, setRealtimeSun] = useState(true);
  const [validationMode, setValidationMode] = useState(null); // 2D Day/Night seasonal validation only
  
  const [showGroundTrack, setShowGroundTrack] = useState(false);
  
  const [isFlatMap, setIsFlatMap] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true); 
  const [cameraMode, setCameraMode] = useState('FREE LOOK');


// 📍 สมองกลควบคุม Theme แผนที่ 2D & 3D
// 📍 ฟันธง: สมองกลควบคุม Theme สี Sci-Fi ทั่วทั้งแอป (UI Colors)
const [uiThemeIdx, setUiThemeIdx] = useState(0);
const uiThemes = [
  { name: 'DEEP SPACE', colors: { '--cyan': '#00eaff', '--gold': '#ffcc00', '--green': '#00ff66', '--red': '#ff3333' } },
  { name: 'TACTICAL AMBER', colors: { '--cyan': '#ffb703', '--gold': '#fb8500', '--green': '#ffcc00', '--red': '#d00000' } },
  { name: 'MATRIX PROTOCOL', colors: { '--cyan': '#00ff41', '--gold': '#008f11', '--green': '#33ff77', '--red': '#ff0033' } },
  { name: 'CYBERPUNK NEON', colors: { '--cyan': '#f72585', '--gold': '#4cc9f0', '--green': '#b5179e', '--red': '#ffcc00' } }
];

useEffect(() => {
  const root = document.documentElement;
  const theme = uiThemes[uiThemeIdx].colors;
  Object.keys(theme).forEach(key => {
    root.style.setProperty(key, theme[key]); // สับสวิตช์สีทุกตัวในแอปทันที
  });
}, [uiThemeIdx]);

// 📍 สมองกลควบคุม Theme แผนที่ 2D & 3D
const [mapThemeIdx, setMapThemeIdx] = useState(0);
const mapThemes = [
  { 
    name: 'BLUE MARBLE (TRUE COLOR)', 
    url: '/textures/Blue_marble_depth.webp', 
    filter: 'none' 
  },
  { 
    name: 'NATURAL DAYMAP', 
    url: '/textures/8k_earth_daymap.webp', 
    filter: 'none' 
  },
  { 
    name: 'TACTICAL DEPTH (ENHANCED)', 
    url: '/textures/Blue_marble_depth.webp', 
    filter: 'saturate(1.3) brightness(1.05) contrast(1.35)' 
  },
  { 
    name: 'NIGHT CITY LIGHTS', 
    url: '/textures/Earth_nightmap.webp', 
    filter: 'none' 
  },
  { 
    name: 'DEEP SPACE MARBLE', 
    url: '/textures/Blue_Marble_BG.webp', 
    filter: 'none' 
  },
  { 
    name: 'NASA ATMOSPHERE (VISUAL)', 
    url: '/textures/Flat_earth_Largest.webp', 
    filter: 'contrast(1.1) saturate(1.1)' 
  }
];
  
  const [isModalOpen, setIsModalOpen] = useState(false);

// 📍 สมองกลดึงข้อมูลเปอร์เซ็นต์เมฆจาก Open-Meteo API
const cloudStationKey = weatherStationKey(activeStation);
const [cloudSample, setCloudSample] = useState({ stationKey: null, value: null });
const setCloudCover = (value) => setCloudSample({ stationKey: cloudStationKey, value });
const cloudCover = cloudSample.stationKey === cloudStationKey ? cloudSample.value : null;
const [isFetchingCloud, setIsFetchingCloud] = useState(false);
const [cloudDataCache, setCloudDataCache] = useState(null);
const [cloudDataOutOfRange, setCloudDataOutOfRange] = useState(false);
const [storedCloudDataMode, setCloudDataMode] = useState('SIM');
const cloudDataMode = cloudSample.stationKey === cloudStationKey ? storedCloudDataMode : 'SIM';
const [cloudRefreshKey, setCloudRefreshKey] = useState(0);
useEffect(() => {
  const refreshTimer = setInterval(() => setCloudRefreshKey((value) => value + 1), WEATHER_REFRESH_MS);
  return () => clearInterval(refreshTimer);
}, []);

// 1. Refresh the station forecast periodically; never retain another station's data.
useEffect(() => {
  const controller = new AbortController();
  let active = true;
  const lat = activeStation.lat;
  const lng = activeStation.lng;
  setIsFetchingCloud(true);
  setCloudDataCache(null);
  setCloudCover(null);
  setCloudDataOutOfRange(false);
  setCloudDataMode('SIM');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=cloud_cover&hourly=cloud_cover&past_days=7&forecast_days=7&timezone=UTC`;
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  
  fetch(url, { signal: controller.signal })
    .then(r => {
      if (!r.ok) throw new Error(`Weather HTTP ${r.status}`);
      return r.json();
    })
    .then(data => {
      if (!active) return;
      if (data && data.hourly && Array.isArray(data.hourly.time) && Array.isArray(data.hourly.cloud_cover)) {
        setCloudDataCache({ stationKey: cloudStationKey, hourly: data.hourly, current: data.current || null, fetchedAt: Date.now() });
      } else if (weatherHasNumber(data?.current?.cloud_cover)) {
        setCloudDataCache({ stationKey: cloudStationKey, hourly: { time: [], cloud_cover: [] }, current: data.current, fetchedAt: Date.now() });
      } else {
        throw new Error('Cloud forecast unavailable');
      }
      setIsFetchingCloud(false);
    })
    .catch(err => {
      if (!active) return;
      if (err?.name !== 'AbortError') console.warn('Cloud API Error:', err);
      setCloudDataCache(null);
      setCloudCover(null);
      setCloudDataMode('OFFLINE');
      setCloudDataOutOfRange(true);
      setIsFetchingCloud(false);
    })
    .finally(() => clearTimeout(timeoutId));

  return () => {
    active = false;
    clearTimeout(timeoutId);
    controller.abort();
  };
}, [activeStation.id, activeStation.lat, activeStation.lng, cloudRefreshKey]);

// 2. Use forecast data only inside the actual forecast window. Seasonal validation dates must not display fake weather.
useEffect(() => {
  if (cloudDataCache?.stationKey !== cloudStationKey) return;
  const hourly = cloudDataCache?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.cloud_cover)) return;

  const samples = hourly.time
    .map((tStr, idx) => { const stamp = /(?:Z|[+-]\d{2}:?\d{2})$/.test(tStr) ? tStr : `${tStr}Z`; return { t: new Date(stamp).getTime(), value: hourly.cloud_cover[idx] }; })
    .filter(s => Number.isFinite(s.t) && weatherHasNumber(s.value));

  const liveValue = cloudDataCache?.current?.cloud_cover;
  const liveFallback = weatherHasNumber(liveValue) ? Number(liveValue) : NaN;
  if (samples.length === 0) {
    if (Number.isFinite(liveFallback)) {
      setCloudCover(liveFallback);
      setCloudDataMode('LIVE');
      setCloudDataOutOfRange(false);
    } else {
      setCloudCover(null);
      setCloudDataMode('OFFLINE');
      setCloudDataOutOfRange(true);
    }
    return;
  }

  const nowMs = simulatedTimeMs;
  const FORECAST_TOLERANCE_MS = 60 * 60 * 1000;
  const firstMs = samples[0].t;
  const lastMs = samples[samples.length - 1].t;

  if (nowMs < firstMs - FORECAST_TOLERANCE_MS || nowMs > lastMs + FORECAST_TOLERANCE_MS) {
    // Do not fabricate weather for a far-away simulation date. Keep the panel useful
    // by falling back to the station's current cloud cover and mark it as LIVE.
    if (Number.isFinite(liveFallback)) {
      setCloudCover(liveFallback);
      setCloudDataMode('LIVE');
      setCloudDataOutOfRange(false);
    } else {
      setCloudCover(null);
      setCloudDataMode('OFFLINE');
      setCloudDataOutOfRange(true);
    }
    return;
  }

  let closest = samples[0];
  let minDiff = Math.abs(samples[0].t - nowMs);
  for (let i = 1; i < samples.length; i++) {
    const diff = Math.abs(samples[i].t - nowMs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = samples[i];
    }
  }

  setCloudDataOutOfRange(false);
  setCloudDataMode('SIM');
  setCloudCover(Number(closest.value));
}, [Math.floor(simulatedTimeMs / 3600000), cloudDataCache, cloudStationKey]);

  // --- ระบบ PASS PREDICTION ---
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [passSchedule, setPassSchedule] = useState([]);
  const [isCalculatingPass, setIsCalculatingPass] = useState(false);
  const [passPredictionDays, setPassPredictionDays] = useState(3);
  const [selectedPassIndex, setSelectedPassIndex] = useState(null);
  const [passScheduleNote, setPassScheduleNote] = useState(null);
  const passCalcRequestRef = useRef(0);
  const passCalcTimerRef = useRef(null);
  const passScheduleCenterRef = useRef(null);

  const calculateFuturePasses = (catnr, days = passPredictionDays) => {
    const requestId = ++passCalcRequestRef.current;
    if (passCalcTimerRef.current) clearTimeout(passCalcTimerRef.current);

    setIsCalculatingPass(true);
    setSelectedPassIndex(null);
    setPassScheduleNote(null);

    const rec = satrecs[catnr];
    if (!rec) {
      passCalcTimerRef.current = null;
      setPassSchedule([]);
      setIsCalculatingPass(false);
      return;
    }

    const stationSnapshot = activeStation;
    const stationMaskSnapshot = stationMask;
    const simTimeSnapshot = simulatedTimeMs;
    passScheduleCenterRef.current = simTimeSnapshot;

    passCalcTimerRef.current = setTimeout(() => {
      const passes = [];
      let isPassActive = false;
      let currentPass = null;
      let prevT = null;
      let prevPos = null;
      let firstValidAbove = null;
      let lastValidAbove = null;
      const now = new Date(simTimeSnapshot);
      const lookBackMs = days * 24 * 60 * 60 * 1000;
      const stepMs = 60000;
      const startTime = Math.floor((now.getTime() - lookBackMs) / stepMs) * stepMs;
      const maxTime = startTime + (days * 2 * 24 * 60 * 60 * 1000);

      const posAt = (timeMs) => calculateSatData(new Date(timeMs), rec, stationSnapshot);
      const refineCrossing = (leftMs, rightMs, rising) => {
        let left = leftMs;
        let right = rightMs;
        while (right - left > 1000) {
          const mid = Math.floor((left + right) / 2);
          const midPos = posAt(mid);
          if (!midPos || !Number.isFinite(midPos.elevationDeg)) break;
          const above = midPos.elevationDeg >= stationMaskSnapshot;
          if (rising ? above : !above) right = mid;
          else left = mid;
        }
        return Math.round((left + right) / 2);
      };
      const refinePeak = (coarsePeakMs, aosMs, losMs) => {
        let left = Math.max(aosMs, coarsePeakMs - stepMs);
        let right = Math.min(losMs, coarsePeakMs + stepMs);
        for (let i = 0; i < 18 && right - left > 1000; i++) {
          const m1 = left + (right - left) / 3;
          const m2 = right - (right - left) / 3;
          const p1 = posAt(m1);
          const p2 = posAt(m2);
          if (!p1 || !p2) break;
          if (p1.elevationDeg < p2.elevationDeg) left = m1;
          else right = m2;
        }
        const peakTime = Math.round((left + right) / 2);
        const peakPos = posAt(peakTime);
        return peakPos ? { peakTime, maxEl: peakPos.elevationDeg } : null;
      };

      for (let t = startTime; t < maxTime; t += stepMs) {
        const pos = posAt(t);
        if (!pos || !Number.isFinite(pos.elevationDeg)) {
          prevT = null;
          prevPos = null;
          continue;
        }

        const aboveMask = pos.elevationDeg >= stationMaskSnapshot;
        if (firstValidAbove === null) firstValidAbove = aboveMask;
        lastValidAbove = aboveMask;

        if (aboveMask) {
          if (!isPassActive) {
            isPassActive = true;
            const aosTime = prevT !== null && prevPos && prevPos.elevationDeg < stationMaskSnapshot
              ? refineCrossing(prevT, t, true)
              : t;
            const aosPos = posAt(aosTime) || pos;
            currentPass = { aosTime, aosAz: aosPos.azimuthDeg, maxEl: pos.elevationDeg, peakTime: t };
          } else if (pos.elevationDeg > currentPass.maxEl) {
            currentPass.maxEl = pos.elevationDeg;
            currentPass.peakTime = t;
          }
        } else if (isPassActive && currentPass) {
          isPassActive = false;
          const losTime = prevT !== null && prevPos && prevPos.elevationDeg >= stationMaskSnapshot
            ? refineCrossing(prevT, t, false)
            : t;
          const losPos = posAt(losTime) || pos;
          currentPass.losTime = losTime;
          currentPass.losAz = losPos.azimuthDeg;
          const refinedPeak = refinePeak(currentPass.peakTime, currentPass.aosTime, currentPass.losTime);
          if (refinedPeak) {
            currentPass.peakTime = refinedPeak.peakTime;
            currentPass.maxEl = refinedPeak.maxEl;
          }
          currentPass.durationMs = currentPass.losTime - currentPass.aosTime;
          passes.push(currentPass);
          currentPass = null;
        }

        prevT = t;
        prevPos = pos;
      }

      if (passCalcRequestRef.current !== requestId) return;

      // GEO/long-duration targets can remain above the station mask for the entire window.
      // Do not invent artificial AOS/LOS at the prediction-window edges; report the condition explicitly.
      if (passes.length === 0 && firstValidAbove === true && lastValidAbove === true && isPassActive) {
        setPassScheduleNote(`CONTINUOUS VISIBILITY ABOVE ${stationMaskSnapshot.toFixed(1)}° MASK — NO DISCRETE AOS/LOS WITHIN ±${days} DAYS`);
      } else if (passes.length === 0 && isPassActive && currentPass) {
        setPassScheduleNote(`PASS EXTENDS BEYOND THE ±${days} DAY PREDICTION WINDOW`);
      } else {
        setPassScheduleNote(null);
      }

      setPassSchedule(passes);
      setIsCalculatingPass(false);
      passCalcTimerRef.current = null;
    }, 100);
  };

  useEffect(() => {
    if (selectedCatnr) calculateFuturePasses(selectedCatnr, passPredictionDays);
  }, [selectedCatnr, stationMask, passPredictionDays, activeStation.id, tles[selectedCatnr]?.line1, tles[selectedCatnr]?.line2]);

  // Refresh the pass window when simulated time moves materially (e.g. seasonal jumps / high-rate SIM).
  // This prevents NEXT PASS / AOS-LOS data from remaining anchored to an old simulation date.
  const passRefreshBucket = Math.floor(simulatedTimeMs / (6 * 60 * 60 * 1000));
  useEffect(() => {
    if (!selectedCatnr || !satrecs[selectedCatnr]) return;
    const center = passScheduleCenterRef.current;
    const refreshThresholdMs = Math.max(6, passPredictionDays * 6) * 60 * 60 * 1000;
    if (center === null || Math.abs(simulatedTimeMs - center) >= refreshThresholdMs) {
      calculateFuturePasses(selectedCatnr, passPredictionDays);
    }
  }, [passRefreshBucket, selectedCatnr, passPredictionDays, activeStation.id, stationMask]);

  useEffect(() => {
    return () => {
      passCalcRequestRef.current += 1;
      if (passCalcTimerRef.current) clearTimeout(passCalcTimerRef.current);
    };
  }, []);

  // ฟันธง: ตัวแปรควบคุมการเปิดปิดหน้าจอ Radar Skyplot
  const [isRadarOpen, setIsRadarOpen] = useState(false);

  // Internal vector antenna simulator popup (embedded in SAT-ORBIT).
  const [isAntenna3DOpen, setIsAntenna3DOpen] = useState(false);

  // Lightweight detailed weather popup. Detailed forecast/map load only when opened.
  const [isWeatherOpen, setIsWeatherOpen] = useState(false);

  // 📍 ฟันธง 1: ตัวแปรควบคุมการเปิด/ปิดเสียง Radar
  const [isMuted, setIsMuted] = useState(false);

  // ฟันธง: ระบบลากและขยายหน้าจอ Radar อย่างอิสระ (Draggable)
  const [radarPos, setRadarPos] = useState({ x: 380, y: 400 }); // ตำแหน่งเริ่มต้นตอนเปิด
  const [isDraggingRadar, setIsDraggingRadar] = useState(false);
  const dragRadarRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

  const handleRadarMouseDown = (e) => {
    if (workspaceMode !== 'classic' || toolWindowsRef.current.radar || e.target.closest('button,input,select')) return;
    setIsDraggingRadar(true);
    dragRadarRef.current = { startX: e.clientX, startY: e.clientY, initX: radarPos.x, initY: radarPos.y };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRadar) return;
      setRadarPos({
        x: dragRadarRef.current.initX + (e.clientX - dragRadarRef.current.startX),
        y: dragRadarRef.current.initY + (e.clientY - dragRadarRef.current.startY)
      });
    };
    const handleMouseUp = () => setIsDraggingRadar(false);
    
    if (isDraggingRadar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingRadar]);

  // 📍 ฟันธง: สมองกลระบบลากและขยายหน้าจอ Database
  const [dbPos, setDbPos] = useState({ x: 80, y: 80 }); // ตำแหน่งเกิด
  const [isDraggingDb, setIsDraggingDb] = useState(false);
  const dragDbRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

  const handleDbMouseDown = (e) => {
    setIsDraggingDb(true);
    dragDbRef.current = { startX: e.clientX, startY: e.clientY, initX: dbPos.x, initY: dbPos.y };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingDb) return;
      setDbPos({ x: dragDbRef.current.initX + (e.clientX - dragDbRef.current.startX), y: dragDbRef.current.initY + (e.clientY - dragDbRef.current.startY) });
    };
    const handleMouseUp = () => setIsDraggingDb(false);
    if (isDraggingDb) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isDraggingDb]);

  // 📍 ฟันธง: สมองกลระบบลากและขยายหน้าจอ Pass Schedule
  const [passPos, setPassPos] = useState({ x: 120, y: 120 }); // ตำแหน่งเกิด
  const [isDraggingPass, setIsDraggingPass] = useState(false);
  const dragPassRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

  const [windowZ, setWindowZ] = useState({ radar: 9997, pass: 9998, db: 9999, gs: 9996, img: 10000, analyzer: 10001, iq: 10002, angles: 10003, diagram: 10004, antenna3d: 10005, weather: 10006 });
  const [maximizedWins, setMaximizedWins] = useState({ radar: false, pass: false, db: false, img: false, gs: false, analyzer: false, iq: false, angles: false });

  const toggleMaximize = (winName) => {
    const viewer = toolWindowsRef.current[winName];
    if (viewer && !viewer.win.closed) {
      const doc = viewer.win.document;
      const action = doc.fullscreenElement ? doc.exitFullscreen?.() : doc.documentElement.requestFullscreen?.();
      action?.catch?.(() => {});
      return;
    }
    if (workspaceMode === 'quad' && (SAT_QUAD_TOOL_IDS.includes(winName) || winName === 'globe')) {
      setFocusedWorkspacePanel(previous => previous === winName ? null : winName);
      return;
    }
    startTransition(() => {
      setMaximizedWins(prev => ({ ...prev, [winName]: !prev[winName] }));
      bringToFront(winName);
    });
  };
 
  const toggleWorkspacePanel = (id) => toggleMaximize(id);

  // POPUP FOCUS HOTFIX (2026-10-26): z-order is direct user feedback and must never
  // be scheduled as a low-priority transition. A pointer/click now promotes the
  // selected popup in the same discrete event instead of waiting behind Globe/RF renders.
  const bringToFront = (winName) => {
    setWindowZ(prev => {
      const maxZ = Math.max(workspaceMode === 'quad' ? 20020 : 9999, ...Object.values(prev).map(Number));
      if (prev[winName] === maxZ) return prev;
      return { ...prev, [winName]: maxZ + 1 };
    });
  };

 // 📍 ฟันธง: สมองกลควบคุมหน้าต่าง TRACKING ANGLES
 const [isAnglesOpen, setIsAnglesOpen] = useState(false);
 const [anglesPos, setAnglesPos] = useState({ x: 80, y: 80 });
 const [isDraggingAngles, setIsDraggingAngles] = useState(false);
 const dragAnglesRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
 const [angleInterval, setAngleInterval] = useState(27); // ค่าเริ่มต้น 27 วินาที

 const handleAnglesMouseDown = (e) => {
   setIsDraggingAngles(true);
   bringToFront('angles');
   dragAnglesRef.current = { startX: e.clientX, startY: e.clientY, initX: anglesPos.x, initY: anglesPos.y };
 };

 useEffect(() => {
   const handleMouseMove = (e) => {
     if (!isDraggingAngles) return;
     setAnglesPos({ x: dragAnglesRef.current.initX + (e.clientX - dragAnglesRef.current.startX), y: dragAnglesRef.current.initY + (e.clientY - dragAnglesRef.current.startY) });
   };
   const handleMouseUp = () => setIsDraggingAngles(false);
   if (isDraggingAngles) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
   return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
 }, [isDraggingAngles]);

 // 📍 ฟันธง: สมองกลควบคุมหน้าต่าง IMAGING PLAN VIEWER
 const [isImgOpen, setIsImgOpen] = useState(false);

 const [isImgListOpen, setIsImgListOpen] = useState(true);

 const [customAlert, setCustomAlert] = useState({ show: false, message: '', type: 'success' });

 const [sourcePlans, setSourcePlans] = useState(typeof THEOS2_IMAGING_PLAN !== 'undefined' ? THEOS2_IMAGING_PLAN : []);

// Read every selected file, then commit one merged dataset after all parsing finishes.
const missionUploadRunRef = useRef(0);
const handleMissionPlanUpload = async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  if (files.length > 10) {
    setCustomAlert({ show: true, message: '⚠️ Select no more than 10 files per import.', type: 'error' });
    return;
  }
  const run = ++missionUploadRunRef.current;
  const imported = [], failures = [];
  let validFiles = 0;
  for (const file of files) {
    try {
      const name = String(file.name || ''), lowerName = name.toLowerCase();
      let records;
      if (lowerName.endsWith('.pdf')) {
        if (file.size > 25 * 1024 * 1024) throw new Error('PDF exceeds the 25 MB limit');
        if (!window.pdfjsLib) throw new Error('PDF library failed to load. Check the network connection.');
        records = parseMissionPdfRecords(parsePlanText(await extractPdfText(file)), name);
      } else if (lowerName.endsWith('.json') || lowerName.endsWith('.geojson')) {
        if (file.size > 10 * 1024 * 1024) throw new Error('JSON exceeds the 10 MB limit');
        records = parseMissionGeoJson(JSON.parse(await file.text()), name);
      } else throw new Error('Only PDF, JSON and GeoJSON are supported');
      if (imported.length + records.length > 10000) throw new Error('Import exceeds 10,000 records');
      imported.push(...records);
      validFiles++;
    } catch (error) { failures.push(`${file.name}: ${error.message}`); }
  }
  if (run !== missionUploadRunRef.current) return;
  if (!imported.length) {
    setCustomAlert({ show: true, message: `⚠️ No valid mission plans were imported.\n${failures.join('\n')}`, type: 'error' });
    return;
  }
  const incoming = mergeMissionPlans(imported);
  setSourcePlans(previous => mergeMissionPlans([...previous.filter(plan => plan.sourceKind !== 'BUILTIN'), ...incoming]));
  setSelectedPlanId(null);
  setCustomAlert({ show: true,
    message: `Imported ${incoming.length} mission records from ${validFiles} file(s)${failures.length ? `\nFiles that failed:\n${failures.join('\n')}` : ''}`,
    type: failures.length ? 'error' : 'success' });
};
const handlePdfUpload = handleMissionPlanUpload;

 const [imgPos, setImgPos] = useState({ x: 150, y: 100 });
 const [isDraggingImg, setIsDraggingImg] = useState(false);
 const dragImgRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
 const [selectedPlanId, setSelectedPlanId] = useState(null);
 const missionOrbitLabel = useMemo(() => {
   const selected = sourcePlans.find(plan => plan.id === selectedPlanId);
   const orbits = [...new Set((selected ? [selected] : sourcePlans).map(plan => plan.orbit).filter(orbit => orbit !== null && orbit !== undefined && String(orbit).trim() !== '').map(String))];
   return orbits.length === 1 ? orbits[0] : orbits.length > 1 ? 'MULTI' : 'N/A';
 }, [sourcePlans, selectedPlanId]);


// 📍 ฟันธง: เพิ่มตัวแปรควบคุมระยะซูมของแผนที่ 2D (ค่าเริ่มต้น = 15 ให้เห็นกว้างระดับภูมิภาค)
// 📍 ฟันธง: เปลี่ยนมาใช้ระบบเลนส์ซูม (Scale) เริ่มต้นที่ 1X (ระดับโลก)
const [mapZoom, setMapZoom] = useState(1);

const [imgMapOrigin, setImgMapOrigin] = useState('center center');

const [tacticalZoom, setTacticalZoom] = useState(1);
// 📍 แทรกบรรทัดนี้ลงไป:
const [zoomOrigin, setZoomOrigin] = useState('center center');


 const handleImgMouseDown = (e) => {
   setIsDraggingImg(true);
   bringToFront('img');
   dragImgRef.current = { startX: e.clientX, startY: e.clientY, initX: imgPos.x, initY: imgPos.y };
 };

 useEffect(() => {
   const handleMouseMove = (e) => {
     if (!isDraggingImg) return;
     setImgPos({ x: dragImgRef.current.initX + (e.clientX - dragImgRef.current.startX), y: dragImgRef.current.initY + (e.clientY - dragImgRef.current.startY) });
   };
   const handleMouseUp = () => setIsDraggingImg(false);
   if (isDraggingImg) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
   return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
 }, [isDraggingImg]);

  const handlePassMouseDown = (e) => {
    setIsDraggingPass(true);
    dragPassRef.current = { startX: e.clientX, startY: e.clientY, initX: passPos.x, initY: passPos.y };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingPass) return;
      setPassPos({ x: dragPassRef.current.initX + (e.clientX - dragPassRef.current.startX), y: dragPassRef.current.initY + (e.clientY - dragPassRef.current.startY) });
    };
    const handleMouseUp = () => setIsDraggingPass(false);
    if (isDraggingPass) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isDraggingPass]);

// 📍 ฟันธง: กู้คืนสมองกลควบคุมหน้าต่าง Ground Station (ที่เผลอลบทับไป) กลับมา!
const [isGsModalOpen, setIsGsModalOpen] = useState(false);
const [gsPos, setGsPos] = useState({ x: 20, y: 60 });
const [isDraggingGs, setIsDraggingGs] = useState(false);
const dragGsRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });

const handleGsMouseDown = (e) => {
  setIsDraggingGs(true);
  bringToFront('gs');
  dragGsRef.current = { startX: e.clientX, startY: e.clientY, initialX: gsPos.x, initialY: gsPos.y };
};

useEffect(() => {
  const handleMouseMove = (e) => {
    if (isDraggingGs) {
      setGsPos({
        x: dragGsRef.current.initialX + (e.clientX - dragGsRef.current.startX),
        y: dragGsRef.current.initialY + (e.clientY - dragGsRef.current.startY)
      });
    }
  };
  const handleMouseUp = () => setIsDraggingGs(false);
  if (isDraggingGs) {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
  return () => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDraggingGs]);

// 📍 ฟันธง: สมองกลควบคุมหน้าต่าง SIGNAL ANALYZER (IQ)
const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);
const [analyzerPos, setAnalyzerPos] = useState({ x: 100, y: 300 });
const [isDraggingAnalyzer, setIsDraggingAnalyzer] = useState(false);
const dragAnalyzerRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

const handleAnalyzerMouseDown = (e) => {
  if (workspaceMode !== 'classic' || toolWindowsRef.current.analyzer || e.target.closest('button,input,select')) return;
  setIsDraggingAnalyzer(true);
  bringToFront('analyzer');
  dragAnalyzerRef.current = { startX: e.clientX, startY: e.clientY, initX: analyzerPos.x, initY: analyzerPos.y };
};

useEffect(() => {
  const handleMouseMove = (e) => {
    if (!isDraggingAnalyzer) return;
    setAnalyzerPos({
      x: dragAnalyzerRef.current.initX + (e.clientX - dragAnalyzerRef.current.startX),
      y: dragAnalyzerRef.current.initY + (e.clientY - dragAnalyzerRef.current.startY)
    });
  };
  const handleMouseUp = () => setIsDraggingAnalyzer(false);
  if (isDraggingAnalyzer) {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }
  return () => {
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };
}, [isDraggingAnalyzer]);

// SIGNAL ANALYZER PHASE: IQ is a separate popup so the spectrum display can
// behave like a real analyzer screen. This does not join Multi-View yet.
const [isIqOpen, setIsIqOpen] = useState(false);
const [iqDisplayChannel, setIqDisplayChannel] = useState('x');
const [iqPos, setIqPos] = useState({ x: 170, y: 150 });
const [isDraggingIq, setIsDraggingIq] = useState(false);
const dragIqRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
const handleIqMouseDown = (e) => {
  if (e.target.closest('button,input,select')) return;
  setIsDraggingIq(true);
  bringToFront('iq');
  dragIqRef.current = { startX: e.clientX, startY: e.clientY, initX: iqPos.x, initY: iqPos.y };
};
useEffect(() => {
  const move = (e) => {
    if (!isDraggingIq) return;
    setIqPos({ x: dragIqRef.current.initX + (e.clientX - dragIqRef.current.startX), y: dragIqRef.current.initY + (e.clientY - dragIqRef.current.startY) });
  };
  const up = () => setIsDraggingIq(false);
  if (isDraggingIq) { window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }
  return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
}, [isDraggingIq]);

  const toggleLeftPanel = () => {
    if (hudTier === 'narrow') { setIsLeftPanelOpen(true); setNarrowHudPanel(value => value === 'left' ? null : 'left'); }
    else setIsLeftPanelOpen(!isLeftPanelOpen);
  };

  const toggleRightPanel = () => {
    if (hudTier === 'narrow') { setIsRightPanelOpen(true); setNarrowHudPanel(value => value === 'right' ? null : 'right'); }
    else setIsRightPanelOpen(!isRightPanelOpen);
  };

// คำนวณตำแหน่งดวงอาทิตย์ (NOAA-style approximation: declination + equation of time)
  const currentSunPos = useMemo(() => {
    const d = new Date(simulatedTimeMs);
    const doy = getUtcDayOfYear(d);
    const utcHours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const year = d.getUTCFullYear();
    const isLeapYear = (year % 4 === 0) && (year % 100 !== 0 || year % 400 === 0);
    const daysInYear = isLeapYear ? 366 : 365;
    const gamma = (2 * Math.PI / daysInYear) * (doy - 1 + (utcHours - 12) / 24);

    const eqTimeMin = 229.18 * (
      0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)
    );

    const declinationRad =
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);

    const utcMinutes = utcHours * 60;
    let lon = (720 - utcMinutes - eqTimeMin) / 4;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;

    return { lat: toDegrees(declinationRad), lng: lon };
  }, [Math.floor(simulatedTimeMs / 60000)]);

  const satrecs = useMemo(() => {
    const recs = {};
    Object.keys(tles).forEach(cat => {
      if (tles[cat].line1 && tles[cat].line2) {
        // ฟันธง: ใส่เกราะป้องกัน ถ้า TLE ดวงไหนพัง ให้ข้ามไปดวงอื่น แอปจะได้ไม่แครช
        try {
          const rec = satelliteJs.twoline2satrec(tles[cat].line1, tles[cat].line2);
          if (!rec || (Number.isFinite(rec.error) && rec.error !== 0)) {
            throw new Error(`satellite.js parser error code ${rec?.error}`);
          }
          recs[cat] = rec;
        } catch (error) {
          console.warn(`[TLE ERROR] สแกนข้อมูลดาวเทียม NORAD: ${cat} ล้มเหลว โปรดตรวจสอบไฟล์`, error);
        }
      }
    });
    return recs;
  }, [tles]);

  useEffect(() => {
    injectStyles();
    const handleResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    const handleFullscreenChange = () => {
      setIsMainFullscreen(Boolean(document.fullscreenElement));
      handleResize();
    };
    window.addEventListener('resize', handleResize);
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    const initialCameraTimer = setTimeout(() => {
      if (globeRef.current) {
        globeRef.current.pointOfView({ lat: activeStation.lat, lng: activeStation.lng, altitude: 2.2 }, 1000);
        const controls = globeRef.current.controls();
        controls.autoRotate = false;
      }
    }, 500);

    return () => {
      clearTimeout(initialCameraTimer);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

 // 📍 1. สมองกลควบคุมเวลา (ล็อก Tick Rate ที่ 40ms ให้ CPU หายใจ และส่งไม้ต่อให้ WebGL เกลี่ยเฟรม)
 useEffect(() => {
  if (!isPlaying) return;
  let lastTick = performance.now();
  let cancelled = false;
  const timer = setInterval(() => {
    const now = Date.now();
    const tick = performance.now();
    const deltaMs = Math.max(0, tick - lastTick);
    lastTick = tick;

    const seekRevision = manualSeekRevisionRef.current;
    setSimulatedTimeValue(prev => {
      if (cancelled || seekRevision !== manualSeekRevisionRef.current || clockModeRef.current !== clockMode) return prev;
      if (!Number.isFinite(prev)) return now;
      // ป้องกัน Time Drift ตอนโหมด LIVE
      if (clockMode === 'LIVE' && speedMult === 1) return now;
      return prev + (deltaMs * speedMult);
    });
  }, 40); // 📍 ฟันธง: ล็อกรอบการอัปเดตที่ 40ms (25fps)
  return () => { cancelled = true; clearInterval(timer); };
}, [isPlaying, speedMult, clockMode]);

  // 📍 ฟันธง: เปลี่ยนกลับเป็น React.useEffect เพื่อให้กล้องขยับ "พร้อมกับ" การอัปเดตโมเดล 3D (สังหารบั๊กภาพสั่นเวลา Target Lock)
  React.useEffect(() => {
    if (isPlaying && globeRef.current && selectedCatnr && !isFlatMap && isTrackingRef.current) {
      try {
        const rec = satrecs[selectedCatnr];
        if (rec) {
          const pos = calculateSatData(new Date(simulatedTimeMs), rec, activeStation);
          if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
            globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
          }
        }
      } catch (err) { }
    }
  }, [simulatedTimeMs, selectedCatnr, isFlatMap, isPlaying, satrecs]);

// =========================================================================
// 📍 ฟันธง: ก้อนระบบประมวลผลแสง NASA + การยิงแจ้งเตือน LINE (อัปเกรดสมบูรณ์)
// =========================================================================

// REAL-TIME DAY/NIGHT ENGINE (NASA Cinematic Lighting & Nightmap - RESTORED)
useEffect(() => {
  if (!globeRef.current) return;
  const globe = globeRef.current;
  
  if (typeof globe.scene !== 'function' || typeof globe.camera !== 'function') return;
  const scene = globe.scene();
  if (!scene || !scene.children) return;

  // --- 1. แสงสว่างระดับ Cinematic (Lighting) ---
  const ambient = scene.children.find(c => c.type === 'AmbientLight');
  if (ambient) {
    // 📍 ฟันธง: ดับไฟบรรยากาศโลกให้มืดสนิท (0.0) ลบสีฟ้าทิ้ง 100%
    ambient.intensity = realtimeSun ? 0.0 : 1.2; 
    ambient.color.setHex(0xffffff); 
  }

  let sunLight = scene.children.find(c => c.name === 'SunLight');
  if (!sunLight) {
    sunLight = new THREE.DirectionalLight(0xfff5e6, 5.5); 
    sunLight.name = 'SunLight';
    scene.add(sunLight);
  }

  // ปั้นลูกไฟดวงอาทิตย์ (Lens Flare)
  let sunVisual = scene.children.find(c => c.name === 'SunVisual');
  if (!sunVisual) {
    const sGeo = new THREE.SphereGeometry(8, 32, 32); 
    const sMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    sunVisual = new THREE.Mesh(sGeo, sMat);
    sunVisual.name = 'SunVisual';
    
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.1, 'rgba(255, 240, 200, 0.8)');
    gradient.addColorStop(0.4, 'rgba(255, 180, 50, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    
    const spriteMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(500, 500, 1);
    sunVisual.add(sprite);
    scene.add(sunVisual);
  }

  let hemiLight = scene.children.find(c => c.name === 'HemiLight');
  if (!hemiLight) {
    // 📍 ฟันธง: ดับไฟ Hemisphere เป็น 0.0 ป้องกันน้ำทะเลเรืองแสง
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.0); 
    hemiLight.name = 'HemiLight';
    scene.add(hemiLight);
  } else {
    hemiLight.intensity = realtimeSun ? 0.0 : 0.6;
  }
  hemiLight.visible = realtimeSun;

  // 📍 ฟันธง (ไม้ตายสูงสุด): ระบบสมองกลตามล่าและล้างบางขอบเรืองแสง (Atmosphere) ทุกชนิด
  scene.traverse((child) => {
    // 1. ดับไฟทุกดวงบนโลก ยกเว้นดวงอาทิตย์ของเรา
    if (child.isLight && child.name !== 'SunLight') {
      child.intensity = realtimeSun ? 0.0 : 1.0;
      child.visible = !realtimeSun;
    }
    
    if (child.isMesh) {
      // 2. ดับความเงา (Specular/Shininess) ของผิวน้ำทะเลเดิมให้ดำสนิท
      if (child.material && realtimeSun) {
        if (child.material.shininess !== undefined) child.material.shininess = 0;
        if (child.material.specular) child.material.specular.setHex(0x000000);
      }
      
      // 📍 3. ฟันธงต้นเหตุ!: ฆ่าชั้นบรรยากาศจำลอง (Atmosphere Glow) ทิ้ง
      // ตัวไลบรารีแอบสร้างขอบเรืองแสงด้วย ShaderMaterial แบบ AdditiveBlending เราบังคับปิดทิ้งเลย!
      if (child.material && child.material.type === 'ShaderMaterial' && child.material.blending === THREE.AdditiveBlending) {
        child.visible = !realtimeSun; // ซ่อนชั้นบรรยากาศทิ้งไปเลยในโหมดกลางคืน
      }
    }
  });

  if (realtimeSun) {
    try {
      if (typeof globe.getCoords === 'function') {
        const sunPos = globe.getCoords(currentSunPos.lat, currentSunPos.lng, 25); 
        if (sunPos) {
          sunLight.position.set(sunPos.x, sunPos.y, sunPos.z);
          sunVisual.position.set(sunPos.x, sunPos.y, sunPos.z);
          sunLight.visible = true;
          sunVisual.visible = true;
        }
      }
    } catch(e) { 
      sunLight.visible = false; 
      if(sunVisual) sunVisual.visible = false;
    }
  } else {
    sunLight.visible = false;
    if(sunVisual) sunVisual.visible = false;
  }

  // --- 2. 🌑 คืนชีพ! ระบบแสดงแสงไฟเมืองฝั่งกลางคืน (NASA 3D Terminator Line) ---
  let nightMesh = scene.children.find(c => c.name === 'NightLights');
  
  if (!nightMesh) {
    try {
      const radius = typeof globe.getGlobeRadius === 'function' ? globe.getGlobeRadius() : 100;
      const geometry = new THREE.SphereGeometry(radius * 1.002, 64, 64);
      geometry.rotateY(-Math.PI / 2);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          tNight: { value: new THREE.TextureLoader().load(runtimeAsset('/textures/Earth_nightmap.webp')) },
          sunDirection: { value: new THREE.Vector3(1, 0, 0) }
        },
        vertexShader: `
          varying vec3 vWorldNormal;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,

        fragmentShader: `
          uniform sampler2D tNight;
          uniform vec3 sunDirection;
          varying vec3 vWorldNormal;
          varying vec2 vUv;
          
          void main() {
            float intensity = dot(normalize(vWorldNormal), normalize(sunDirection));
            float nightMix = 1.0 - smoothstep(-0.15, 0.15, intensity);
            
            vec4 nightTex = texture2D(tNight, vUv);
            
            // 1. คำนวณความสว่างของภาพ Nightmap
            float brightness = dot(nightTex.rgb, vec3(0.299, 0.587, 0.114));
            
            // 📍 2. ฟันธง: ดันเพดาน Threshold ขึ้นไปที่ 0.35! 
            // เพื่อฆ่า "พื้นหลังสีน้ำเงินเข้ม" ในภาพให้ตายสนิท (กลายเป็น 0) กรองเหลือแค่แสงไฟเมือง
            float mask = smoothstep(0.35, 0.55, brightness); 
            
            // 3. บูสต์เฉพาะไฟเมืองสีทองที่หลุดรอดการกรองมาได้
            vec3 cityLights = nightTex.rgb * mask * vec3(3.5, 2.5, 1.2);
            
            // 📍 4. ฟันธง: บังคับพ่น "สีดำสนิท (True Black 0,0,0)" ทับพื้นหลังทั้งหมดให้เป็นเนื้อเดียวกัน
            vec3 finalColor = vec3(0.0, 0.0, 0.0) + cityLights;
            
            gl_FragColor = vec4(finalColor, nightMix);
          }
        `,

        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false
      });

      nightMesh = new THREE.Mesh(geometry, material);
      nightMesh.name = 'NightLights';
      scene.add(nightMesh);
    } catch(e) { console.warn("NightLights Shader Error:", e); }
  }

  if (nightMesh && realtimeSun) {
    try {
      if (typeof globe.getCoords === 'function') {
        const sunPos = globe.getCoords(currentSunPos.lat, currentSunPos.lng, 100);
        nightMesh.material.uniforms.sunDirection.value.set(sunPos.x, sunPos.y, sunPos.z).normalize();
      }
      nightMesh.visible = true;
    } catch(e) {}
  } else if (nightMesh) {
    nightMesh.visible = false;
  }

}, [realtimeSun, currentSunPos]);

const currentDate = new Date(simulatedTimeMs);
const targetSatrec = selectedCatnr ? satrecs[selectedCatnr] : null;

// 📍 หุ้มเกราะ targetData
const targetData = useMemo(() => {
  return targetSatrec ? calculateSatData(new Date(simulatedTimeMs), targetSatrec, activeStation) : null;
}, [simulatedTimeMs, targetSatrec, activeStation.id]);

const targetConfig = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr) || SATELLITE_OPTIONS[0];
const selectedTlePair = selectedCatnr ? tles[selectedCatnr] : null;
const selectedTleEpochMs = selectedTlePair ? getTleEpochMs(selectedTlePair.line1) : null;
const selectedTleAgeDays = selectedTleEpochMs === null ? null : Math.abs(simulatedTimeMs - selectedTleEpochMs) / 86400000;
const selectedTleIsStale = selectedTleAgeDays !== null && selectedTleAgeDays > 14;
const selectedTleMatchesBuiltin = Boolean(selectedTlePair && selectedTlePair.line1 === FALLBACK_TLES[selectedCatnr]?.line1 && selectedTlePair.line2 === FALLBACK_TLES[selectedCatnr]?.line2);
const selectedTleSourceLabel = !selectedTlePair ? 'NO TLE' : selectedTleMatchesBuiltin ? 'Built-in match (DEGRADED)' : (tleSource === 'Live Sync' ? 'Live Sync / Stored' : tleSource === 'Manual Upload' ? 'Manual Upload / Stored' : 'Stored TLE');
const tleUpdateAgeMs = tleUpdatedAtMs ? Math.max(0, Date.now() - tleUpdatedAtMs) : null;
const tleUpdateAgeLabel = tleUpdateAgeMs === null ? 'N/A' : tleUpdateAgeMs < 60000 ? '<1 min ago' : tleUpdateAgeMs < 3600000 ? `${Math.floor(tleUpdateAgeMs / 60000)} min ago` : tleUpdateAgeMs < 86400000 ? `${Math.floor(tleUpdateAgeMs / 3600000)}h ${Math.floor((tleUpdateAgeMs % 3600000) / 60000)}m ago` : `${Math.floor(tleUpdateAgeMs / 86400000)}d ${Math.floor((tleUpdateAgeMs % 86400000) / 3600000)}h ago`;
const tleUpdatedLabel = tleUpdatedAtMs ? new Date(tleUpdatedAtMs).toISOString().replace('T',' ').slice(0,19) + ' UTC' : 'N/A';
const tleLastSyncTimeLabel = tleUpdatedAtMs ? new Date(tleUpdatedAtMs).toISOString().slice(11,19) + ' UTC' : 'N/A';
const tleCompactAgeLabel = tleUpdateAgeLabel === 'N/A' ? 'N/A' : tleUpdateAgeLabel.replace(/ ago$/, '');
const tleSyncStatusLabel = isUpdatingTle ? 'SYNCING' : tleSource.includes('Failed') ? 'FAILED' : tleUpdatedAtMs ? 'SYNCED' : 'NO SYNC';
const tleSyncStatusColor = isUpdatingTle ? 'var(--cyan)' : tleSource.includes('Failed') ? 'var(--red)' : tleUpdatedAtMs ? 'var(--green)' : 'var(--gold)';

// TV/F11 engineering telemetry is derived from the same TLE + SGP4 state as the main HUD.
// Throttle the station-relative range-rate/Doppler calculation to 4 Hz; the browser HUD itself remains unchanged.
const engineeringTelemetryTick = Math.floor(simulatedTimeMs / 250);
const engineeringData = useMemo(() => {
  const tleEngineering = selectedTlePair ? getTleEngineeringData(selectedTlePair.line1, selectedTlePair.line2) : null;
  const rangeRateKmS = targetSatrec ? getRangeRateKmS(engineeringTelemetryTick * 250, targetSatrec, activeStation) : null;
  const sCarrierMHz = getDownlinkCarrierMHz(targetConfig.telemetry, 's');
  const xCarrierMHz = getDownlinkCarrierMHz(targetConfig.payload, 'x');
  return {
    noradId: selectedCatnr || '—',
    cosparId: tleEngineering?.cosparId || '—',
    apogeeKm: tleEngineering?.apogeeKm ?? null,
    perigeeKm: tleEngineering?.perigeeKm ?? null,
    periodMin: tleEngineering?.periodMin ?? null,
    rangeRateKmS,
    sDopplerKhz: getDopplerShiftKhz(sCarrierMHz, rangeRateKmS),
    xDopplerKhz: getDopplerShiftKhz(xCarrierMHz, rangeRateKmS)
  };
}, [engineeringTelemetryTick, targetSatrec, selectedTlePair?.line1, selectedTlePair?.line2, selectedCatnr, targetConfig.telemetry, targetConfig.payload, activeStation.id]);

const linkActive = targetData && targetData.elevationDeg >= stationMask;
const rfProfile = useMemo(() => getRfProfile(selectedCatnr, targetConfig), [selectedCatnr, targetConfig]);
const rfState = getRfState(targetData, stationMask);

// TV/F11 operational summary: derived only from existing SAT-Orbit state.
// No extra network source and no control behavior is changed.
const rangeTrendLabel = !Number.isFinite(engineeringData.rangeRateKmS)
  ? 'N/A'
  : Math.abs(engineeringData.rangeRateKmS) < 0.05 ? 'STATIONARY'
  : engineeringData.rangeRateKmS < 0 ? 'APPROACHING' : 'RECEDING';
const passPhaseLabel = !targetData
  ? 'NO TRACK'
  : !Number.isFinite(engineeringData.rangeRateKmS)
    ? (rfState.visible ? 'IN PASS' : 'OFF PASS')
    : Math.abs(engineeringData.rangeRateKmS) < 0.05
      ? (rfState.visible ? 'CULMINATION' : 'OFF PASS')
      : rfState.visible
        ? (engineeringData.rangeRateKmS < 0 ? 'INBOUND PASS' : 'OUTBOUND PASS')
        : (engineeringData.rangeRateKmS < 0 ? 'PRE-AOS' : 'POST-LOS');
const visibilityLabel = rfState.eligible ? 'ABOVE MASK' : rfState.visible ? 'BELOW MASK' : 'BELOW HORIZON';
const visibilityColor = rfState.eligible ? 'var(--green)' : rfState.visible ? 'var(--gold)' : 'var(--red)';
const trackModeLabel = cameraMode === 'TRACKING' ? 'TARGET LOCK' : 'FREE LOOK';

// =========================================================================
// 📍 GISTDA ANTENNA BRIDGE v1.4 - MOUNT POINT
// =========================================================================

const bridgeState = useAntennaBridge({
  simTimeMs: simulatedTimeMs,
  isPlaying: isPlaying,
  speedMult: speedMult,

  targetData: targetData,
  targetConfig: targetConfig,
  targetSatrec: targetSatrec,

  selectedCatnr: selectedCatnr,
  passSchedule: passSchedule,

  stationMask: stationMask,
  activeStation: activeStation
});

// =========================================================================

// 📍 ระบบดักเวลา Pass ถัดไป
const nextPassTimestamp = useMemo(() => {
  if (linkActive || passSchedule.length === 0) return null;
  const upcomingPass = passSchedule.find(p => p.aosTime > simulatedTimeMs);
  
  if (upcomingPass) {
    return { time: upcomingPass.aosTime, maxEl: upcomingPass.maxEl };
  }
  return null;
}, [simulatedTimeMs, passSchedule, linkActive]);

// Shared by main telemetry and the 3D antenna view; closing a view does not reset it.
const antennaState = useAntennaSimulation({
  sourceKey: `${activeStation.id}:${selectedCatnr || ''}:${manualSeekRevisionRef.current}`,
  az: targetData?.azimuthDeg,
  el: targetData?.elevationDeg,
  linkActive: Boolean(linkActive),
  stationMask,
  simulatedTimeMs,
  nextPassTimeMs: nextPassTimestamp?.time ?? null,
  speedMult,
  isPlaying
});

// Production hardening: LINE alert delivery uses in-flight de-duplication, timeout and retry cooldown.
// The endpoint remains a client-visible integration URL; protect/rate-limit the Apps Script before public deployment.
const LINE_ALERT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec';
const lineAlertInFlightRef = useRef(new Set());
const lineAlertRetryAtRef = useRef(new Map());
const lineAlertControllersRef = useRef(new Set());

const sendLineAlert = async (alertId, payloadData) => {
  if (clockModeRef.current !== 'LIVE') return false;
  if (safeStorageGet('sessionStorage', alertId)) return true;
  if (lineAlertInFlightRef.current.has(alertId)) return false;
  const retryAt = lineAlertRetryAtRef.current.get(alertId) || 0;
  if (Date.now() < retryAt) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  lineAlertInFlightRef.current.add(alertId);
  lineAlertControllersRef.current.add(controller);

  try {
    const response = await fetch(LINE_ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payloadData),
      signal: controller.signal
    });
    if (!response.ok && response.type !== 'opaque') {
      throw new Error(`HTTP ${response.status}`);
    }
    safeStorageSet('sessionStorage', alertId, 'true');
    lineAlertRetryAtRef.current.delete(alertId);
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[LINE] Notify error:', error);
    else console.warn('[LINE] Notify timeout:', alertId);
    lineAlertRetryAtRef.current.set(alertId, Date.now() + 60000);
    return false;
  } finally {
    clearTimeout(timeoutId);
    lineAlertInFlightRef.current.delete(alertId);
    lineAlertControllersRef.current.delete(controller);
  }
};

useEffect(() => () => {
  lineAlertControllersRef.current.forEach(controller => controller.abort());
  lineAlertControllersRef.current.clear();
  lineAlertInFlightRef.current.clear();
  lineAlertRetryAtRef.current.clear();
}, []);

// 📍 เซนเซอร์จับเวลา PRE-PASS (แจ้งล่วงหน้า 10 นาทีลง LINE)
useEffect(() => {
  const isStrictLive = clockMode === 'LIVE' && Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
  if (!isStrictLive || !nextPassTimestamp || !nextPassTimestamp.time) return;
  
  const timeToAos = nextPassTimestamp.time - simulatedTimeMs;
  const TEN_MINUTES_MS = 600000; 
  
  const stableAosTime = Math.floor(nextPassTimestamp.time / 1800000) * 1800000;
  const passId = `AOS-${activeStation.id}-${selectedCatnr}-${stableAosTime}`;

  if (timeToAos <= TEN_MINUTES_MS && timeToAos > 0 && !safeStorageGet('sessionStorage', passId)) {
    const upcomingPass = passSchedule.find(p => p.aosTime === nextPassTimestamp.time);
    if (upcomingPass) {
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(upcomingPass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: false, satName: targetConfig.displayName, flagUrl: flagUrl, station: activeStation.name, doy: doyStr,
        aosUtc: new Date(upcomingPass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: formatBangkokTime(upcomingPass.aosTime) + ' THA',
        losUtc: new Date(upcomingPass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: formatBangkokTime(upcomingPass.losTime) + ' THA',
        maxEl: upcomingPass.maxEl.toFixed(1),
        duration: `${Math.floor(upcomingPass.durationMs / 60000)}m ${Math.floor((upcomingPass.durationMs % 60000)/1000)}s`
      };
      
      sendLineAlert(passId, payloadData).then(sent => {
        if (sent) console.log(`[LINE] ยิงแจ้งเตือน 10 นาที (AOS) สำเร็จ! ID: ${passId}`);
      });
    }
  }
}, [clockMode, simulatedTimeMs, nextPassTimestamp, selectedCatnr, targetConfig, speedMult, isPlaying, passSchedule, activeStation.id]);

// 📍 เซนเซอร์จับจังหวะจบ Pass (แจ้ง LOS ลง LINE)
useEffect(() => {
  const isLiveStrict = clockMode === 'LIVE' && Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
  if (!isLiveStrict || passSchedule.length === 0) return;

  passSchedule.forEach(pass => {
    const stableLosTime = Math.floor(pass.losTime / 1800000) * 1800000;
    const passIdLos = `LOS-${activeStation.id}-${selectedCatnr}-${stableLosTime}`;
    const timeSinceLos = simulatedTimeMs - pass.losTime;
    
    if (timeSinceLos >= 0 && timeSinceLos <= 120000 && !safeStorageGet('sessionStorage', passIdLos)) {
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(pass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: true, satName: targetConfig.displayName, flagUrl: flagUrl, station: activeStation.name, doy: doyStr,
        aosUtc: new Date(pass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: formatBangkokTime(pass.aosTime) + ' THA',
        losUtc: new Date(pass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: formatBangkokTime(pass.losTime) + ' THA',
        maxEl: pass.maxEl.toFixed(1),
        duration: `${Math.floor(pass.durationMs / 60000)}m ${Math.floor((pass.durationMs % 60000)/1000)}s`
      };
      
      sendLineAlert(passIdLos, payloadData).then(sent => {
        if (sent) console.log(`[LINE] ยิงแจ้งเตือน LOS สำเร็จ! ID: ${passIdLos}`);
      });
    }
  });
}, [clockMode, simulatedTimeMs, passSchedule, selectedCatnr, targetConfig, speedMult, isPlaying, activeStation.id]);

// =========================================================================
// 📍 จบก้อนระบบประมวลผล (ถัดจากบรรทัดนี้คือ return ( ... ) ของคุณครับ)
// =========================================================================

// 📍 ฟันธง: สร้างโกดังเก็บอ็อบเจ็กต์ดาวเทียม ป้องกันการสร้าง 3D Models รัวๆ ทุก 50ms (หยุด WebGL Memory Leak)
const satObjectsRef = useRef({});

const allSatObjects = useMemo(() => {
  const currentD = new Date(simulatedTimeMs);
  return SATELLITE_OPTIONS.filter(sat => selectedCatnrs.includes(sat.catnr)).map(sat => {
    if (!satrecs[sat.catnr]) return null;
    const data = calculateSatData(currentD, satrecs[sat.catnr], activeStation);
    if (!data) return null;
    
    // 📍 รีไซเคิลอ็อบเจ็กต์เดิม ไม่สร้างใหม่ (ป้องกัน GPU พัง)
    if (!satObjectsRef.current[sat.catnr]) {
      satObjectsRef.current[sat.catnr] = { type: 'satellite', catnr: sat.catnr, name: sat.displayName };
    }
    
    const obj = satObjectsRef.current[sat.catnr];
    obj.lat = data.lat;
    obj.lng = data.lng;
    obj.altKm = data.altKm;
    obj.altitude = Math.max(0.05, data.altKm / EARTH_RADIUS_KM);
    obj.isTarget = sat.catnr === selectedCatnr;
    
    // อัปเดตข้อมูลแกน Tracking ให้สมองกลอื่นๆ เอาไปใช้ต่อได้
    obj.elevationDeg = data.elevationDeg;
    obj.azimuthDeg = data.azimuthDeg;
    obj.rangeKm = data.rangeKm;
    obj.speedKmS = data.speedKmS;
    
    return obj;
  }).filter(Boolean);
}, [simulatedTimeMs, satrecs, selectedCatnr, selectedCatnrs, activeStation.id]);

// 📍 ฟันธง 1.1: สร้างสวิตช์หน่วงเวลา (Throttle) ตัดคอขวด CPU 
 // ถ้าเร่งเกิน 100X ให้วาดเส้นนำทางวงโคจรใหม่ทุกๆ 30 นาทีซิมูเลชัน (ลดภาระขยะใน Memory ได้ 1,000,000%)
 const orbitUpdateTrigger = Math.floor(simulatedTimeMs / (speedMult >= 100 ? 1800000 : 300000));

 // 📍 ฟันธง: อัปเกรดสมองกลวาดเส้นวงโคจร (Orbit Path) กลับมาวาดครบทุกดวงที่เลือก (ทั้ง LEO, MEO, GEO)
 const orbitVisualPath = useMemo(() => {
  const paths = [];

  // ฟังก์ชันคำนวณเส้นวงโคจรไม่ให้เบี้ยว
  const getFixed3DOrbitPath = (satrec, baseDate, durationMinutes, stepSize) => {
    const pts = [];
    try {
      const fixedGmst = satelliteJs.gstime(baseDate); 
      const startMinutes = -(durationMinutes / 2);
      const endMinutes = (durationMinutes / 2);
      for (let m = startMinutes; m <= endMinutes; m += stepSize) {
        const targetDate = new Date(baseDate.getTime() + m * 60 * 1000);
        const positionAndVelocity = satelliteJs.propagate(satrec, targetDate);
        if (positionAndVelocity.position && typeof positionAndVelocity.position !== 'boolean') {
          const geodetic = satelliteJs.eciToGeodetic(positionAndVelocity.position, fixedGmst);
          const lat = satelliteJs.degreesLat(geodetic.latitude);
          const rawLng = satelliteJs.degreesLong(geodetic.longitude);
          const normalizedLng = ((rawLng + 180) % 360 + 360) % 360 - 180;
          const altKm = geodetic.height;
          if (!isNaN(lat) && !isNaN(normalizedLng) && !isNaN(altKm)) {
            pts.push({ lat: lat, lng: normalizedLng, alt: Math.max(0.01, altKm / 6371) });
          }
        }
      }
    } catch(e) {}
    return pts;
  };

  // 📍 วนลูปวาดเส้นวงโคจรของ "ดาวเทียมทุกดวง" ที่เลือกไว้ใน Database
  selectedCatnrs.forEach(catnr => {
    const rec = satrecs[catnr];
    if (!rec) return;
    
    const initPos = calculateSatData(currentDate, rec);
    if (!initPos) return;

    const isPrimary = catnr === selectedCatnr;
    
    // 🎨 ฟันธง: แบ่งสีเส้นเป้าหลักสีทองทึบ (1.0) / เป้ารองสีเขียวสว่างขึ้น (0.75) และเพิ่มความหนาเส้น
    const pathColor = isPrimary ? 'rgba(255, 204, 0, 1.0)' : 'rgba(0, 255, 102, 0.75)';
    const strokeWidth = isPrimary ? 1.5 : 0.8;

    // 🟢 เคส 1: GEO (THAICOM)
    if (initPos.altKm > 30000 && Math.abs(initPos.lat) < 5) {
      const points = [];
      for (let lng = -180; lng <= 180; lng += 2) {
        points.push({ lat: 0, lng: lng, alt: initPos.altKm / 6371 }); 
      }
      paths.push({ points, color: pathColor, stroke: isPrimary ? 1.5 : 0.8 });
    } 
    // 🔵 เคส 2: MEO & LEO (GNSS, THEOS)
    else {
      let orbitDurationMinutes = 100;
      let timeStepMinutes = 0.5;

      if (initPos.altKm > 10000) {
        orbitDurationMinutes = 800;
        timeStepMinutes = 5;
      }

      const points = getFixed3DOrbitPath(rec, currentDate, orbitDurationMinutes, timeStepMinutes);
      if (points.length >= 2) {
        paths.push({ points, color: pathColor, stroke: strokeWidth });
      }
    }
  });

  return paths;
  /* 📍 ฟันธง: ลบ currentDate ทิ้ง! เพื่อไม่ให้มันคำนวณเส้นวงโคจรใหม่ทุกๆ 40ms ลดภาระ CPU มหาศาล! */
  }, [selectedCatnrs, selectedCatnr, satrecs, orbitUpdateTrigger]);


// Geometry/TLE propagation is cached independently of the simulation clock.
const missionPathData = useMemo(() => buildMissionPathData(sourcePlans, satrecs['58016'], calculateSatData), [sourcePlans, satrecs['58016']]);
const missionPathById = useMemo(() => new Map(missionPathData.map(plan => [plan.id, plan])), [missionPathData]);
const imagingSwathPaths = useMemo(() => {
  if (selectedCatnr !== '58016') return [];
  return missionPathData.flatMap(plan => {
    if (simulatedTimeMs > plan.end) return [];
    const active = simulatedTimeMs >= plan.start && simulatedTimeMs <= plan.end;
    return plan.paths.filter(points => points.length > 1).map((points, index) => ({ id: `${plan.id}-${index}`, points,
      color: active ? 'rgba(255,51,51,1)' : 'rgba(255,100,51,0.45)',
      stroke: plan.importedGeometry ? (active ? 2.5 : 1.5) : (active ? 6 : 4) }));
  });
}, [selectedCatnr, missionPathData, simulatedTimeMs]);

// Imported coordinates remain authoritative; only missing positions use a TLE estimate.
const imagingPlansData = useMemo(() => sourcePlans.map(plan => missionPlanCoordinates(plan, satrecs['58016'], calculateSatData)), [sourcePlans, satrecs['58016']]);

// 📍 ฟันธง 1.2: สังหารฟังก์ชัน getCirclePolygon ทิ้ง! คำนวณสดลงในโกดังรีไซเคิล (Zero Memory Allocation)
const footprintPtsRef = useRef({}); 
const footprintBoundaryPath = useMemo(() => {
  const paths = [];
  allSatObjects.forEach(sat => {
    if (selectedCatnrs.includes(sat.catnr)) {
      const isPrimary = sat.catnr === selectedCatnr;
      const radiusDeg = getFootprintRadiusDeg(sat.altKm, stationMask);
      if (!isNaN(radiusDeg)) {
        
        if (!footprintPtsRef.current[sat.catnr]) {
            footprintPtsRef.current[sat.catnr] = Array.from({length: 129}, () => ({lng: 0, lat: 0, alt: 0.005}));
        }
        const pts = footprintPtsRef.current[sat.catnr];
        
        // คำนวณสมการวงกลมสดๆ ยัดใส่พิกัดเดิม ไม่สร้าง Array ขยะแม้แต่ชิ้นเดียว!
        const lat1 = (sat.lat * Math.PI) / 180;
        const lon1 = (sat.lng * Math.PI) / 180;
        const d = (radiusDeg * Math.PI) / 180;
        
        for (let i = 0; i <= 128; i++) {
            const tc = (2 * Math.PI * i) / 128;
            const latArg = Math.max(-1, Math.min(1, Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(tc)));
            let lat = Math.asin(latArg);
            let lon = lon1 + Math.atan2(Math.sin(tc) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat));
            pts[i].lng = ((lon + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI;
            pts[i].lat = (lat * 180) / Math.PI;
        }

        paths.push({
          points: pts,
          color: isPrimary ? 'rgba(255, 51, 51, 0.95)' : 'rgba(255, 51, 51, 0.3)',
          stroke: isPrimary ? 2.5 : 1.0 
        });
      }
    }
  });
  return paths;
}, [allSatObjects, selectedCatnrs, selectedCatnr, stationMask]);

// Sonar is owned by the one controller, so child panels never create a second ping loop.
const sonarControllerRef = useRef(null);
useEffect(() => {
  if (!sonarControllerRef.current) {
    sonarControllerRef.current = createSonarAudioController(window.AudioContext || window.webkitAudioContext, window);
  }
  const controller = sonarControllerRef.current;
  if (rfState.locked && !isMuted) controller.start();
  else controller.stop();
  return () => controller.stop();
}, [rfState.locked, isMuted]);
useEffect(() => () => {
  sonarControllerRef.current?.dispose();
  sonarControllerRef.current = null;
}, []);
const toggleAudioMute = () => {
  const nextMuted = !isMuted;
  // Silence in the click event as well as in the effect, including clicks in a detached window.
  if (nextMuted) sonarControllerRef.current?.stop();
  setIsMuted(nextMuted);
};

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setTleSource('Update Failed (File Too Large)');
      setCustomAlert({ show: true, message: '⚠️ TLE file exceeds the 5 MB limit.', type: 'error' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUpdatingTle(true);
    setTleSource('Reading File...');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = typeof e.target?.result === 'string' ? e.target.result : '';
        if (!text.trim()) throw new Error('Empty TLE file');
        const lines = text.trim().split(/\r?\n/);
        const tleUpdates = {};
        let successCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('1 ')) {
            const line1 = line;
            const line2 = lines[i + 1] ? lines[i + 1].trim() : '';
            if (line2.startsWith('2 ')) {
              const catnr = line1.substring(2, 7).trim();
              const line2Catnr = line2.substring(2, 7).trim();
              if (line2Catnr === catnr && SATELLITE_OPTIONS.find(s => s.catnr === catnr) && isUsableTlePair(line1, line2, catnr)) {
                tleUpdates[catnr] = { line1, line2 };
                successCount++;
              }
            }
          }
        }

        if (successCount > 0) {
          setTles(prev => {
            const merged = { ...prev, ...tleUpdates };
            safeStorageSet('localStorage', 'gistda_tles', JSON.stringify(merged));
            return merged;
          });
          markTleUpdated(Date.now());
          setTleSource('Manual Upload');
        } else {
          setTleSource('Update Failed (No Match)');
        }
      } catch (err) {
        console.error(err);
        setTleSource('Update Failed (File Error)');
      } finally {
        setIsUpdatingTle(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setTleSource('Update Failed (File Read Error)');
      setIsUpdatingTle(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  // ฟันธง: ฟังก์ชันดึง TLE อัตโนมัติจาก Server ตัวกลาง 
  const handleAutoUpdateTle = async () => {
    if (tleFetchControllerRef.current) tleFetchControllerRef.current.abort();
    const controller = new AbortController();
    tleFetchControllerRef.current = controller;
    setIsUpdatingTle(true);
    setTleSource('Fetching Live TLE...');

    try {
     // เอา URL จาก Apps Script มาวางตรงนี้ครับ!!!
     const proxyUrl = "https://script.google.com/macros/s/AKfycbyv1ZA8fPvSlK3KhblBbkGTB4UC86nlpFES63jGvRlBiHSbuChYMs2BQgqsSXBQjDRf/exec";
      
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      let response;
      try {
        response = await fetch(proxyUrl, { signal: controller.signal, cache: 'no-store' });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);

      const text = await response.text();
      if (text.length > 5 * 1024 * 1024) throw new Error('TLE response exceeds 5 MB safety limit');
      const lines = text.trim().split(/\r?\n/);
      const tleUpdates = {};
      let successCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('1 ')) {
          const line1 = line;
          const line2 = lines[i + 1] ? lines[i + 1].trim() : '';
          if (line2.startsWith('2 ')) {
            const catnr = line1.substring(2, 7).trim();
            const line2Catnr = line2.substring(2, 7).trim();
            if (line2Catnr === catnr && SATELLITE_OPTIONS.find(s => s.catnr === catnr) && isUsableTlePair(line1, line2, catnr)) {
              tleUpdates[catnr] = { line1, line2 };
              successCount++;
            }
          }
        }
      }

      if (successCount > 0) {
        setTles(prev => {
          const merged = { ...prev, ...tleUpdates };
          safeStorageSet('localStorage', 'gistda_tles', JSON.stringify(merged));
          return merged;
        });
        markTleUpdated(Date.now());
        setTleSource('Live Sync');
      } else {
        setTleSource('Update Failed (Bad Data)');
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        // A timeout belongs to the current request; an abort caused by a newer request/unmount does not.
        if (tleFetchControllerRef.current === controller) setTleSource('Update Failed (Timeout)');
      } else {
        console.error(err);
        setTleSource('Update Failed (Network Error)');
      }
    } finally {
      if (tleFetchControllerRef.current === controller) {
        tleFetchControllerRef.current = null;
        setIsUpdatingTle(false);
      }
    }
  };

  // 📍 ฟันธง: สั่งกระตุกฟังก์ชันโหลด TLE อัตโนมัติ 1 ครั้ง ทันทีที่เปิดแอปหรือกด F5
  useEffect(() => {
    handleAutoUpdateTle();
    return () => {
      const controller = tleFetchControllerRef.current;
      tleFetchControllerRef.current = null;
      if (controller) controller.abort();
    };
  }, []);

  const thaiTime = new Date(currentDate.getTime() + 7 * 3600000);
  const formatTime = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

  // 📍 ฟันธง: นำตัวแปรเส้นสัญญาณ (Data Packets) ที่หายไปกลับมา!
  const signalVisualPath = useMemo(() => {
    if (!linkActive || !targetData || isNaN(targetData.lat) || isNaN(targetData.lng)) return [];
    if (targetData.altKm > 30000) return []; 

    const gsPoint = { lat: activeStation.lat, lng: activeStation.lng, alt: 0 };
    const satPoint = { lat: targetData.lat, lng: targetData.lng, alt: Math.max(0.01, targetData.altKm / EARTH_RADIUS_KM) };
    
    return [{ 
      points: [satPoint, gsPoint],
      color: 'rgba(0, 255, 102, 0.9)', 
      stroke: 1.5,
      isSignal: true
    }];
  }, [linkActive, targetData, activeStation.id]);

  const radarContainerRef = useRef(null);
  const [radarDim, setRadarDim] = useState({ w: 360, h: 360, textScale: 1, labelWidth: 76 });

  useEffect(() => {
    const node = radarContainerRef.current;
    if (!node) return;
    const owner = node.ownerDocument.defaultView || window;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const box = node.getBoundingClientRect();
      const computed = owner.getComputedStyle(node);
      const textScale = parseFloat(computed.getPropertyValue('--sat-text-scale')) || 1;
      const context = node.ownerDocument.createElement('canvas').getContext('2d');
      if (context) context.font = `900 15px ${computed.fontFamily}`;
      const labelWidth = context?.measureText('W (270°)').width || 76;
      setRadarDim(previous => previous.w === box.width && previous.h === box.height && previous.textScale === textScale && previous.labelWidth === labelWidth
        ? previous : { w: box.width, h: box.height, textScale, labelWidth });
    };
    measure();
    const Observer = owner.ResizeObserver || window.ResizeObserver;
    const observer = Observer ? new Observer(measure) : null;
    observer?.observe(node);
    const attributes = new MutationObserver(measure);
    attributes.observe(node.ownerDocument.documentElement, { attributes:true, attributeFilter:['style'] });
    owner.addEventListener('resize',measure);
    node.ownerDocument.fonts?.ready?.then(measure);
    node.ownerDocument.fonts?.addEventListener?.('loadingdone',measure);
    return () => { disposed = true; observer?.disconnect(); attributes.disconnect(); owner.removeEventListener('resize',measure); node.ownerDocument.fonts?.removeEventListener?.('loadingdone',measure); };
  }, [isRadarOpen, toolHostRevision]);

  const radarLayout = useMemo(() => {
    const fontScale = (radarDim.textScale || 1) * Math.max(1, Math.min(1.3, radarDim.w / 650, radarDim.h / 500));
    // Use the available plot more aggressively on large displays while preserving
    // a safe label ring around N/E/S/W. The metrics/legend overlay on large hosts
    // returns their former flex height to the radar circle.
    const sideMargin = (16 + radarDim.labelWidth + 2) * fontScale;
    const verticalMargin = 18 * fontScale;
    const R = Math.max(1, Math.min(radarDim.w - sideMargin * 2, radarDim.h - verticalMargin * 2) / 2);
    // Radar visual-only lock: keep the exact plot size/logic, but lift the whole
    // skyplot slightly so top/bottom breathing room is visually balanced.
    return { R, cx:radarDim.w / 2, cy:(radarDim.h / 2) - (32 * fontScale), fontScale };
  }, [radarDim]);

  const radarSampleEpoch = Math.floor(simulatedTimeMs / 30000) * 30000;
  const radarTrajectory = useMemo(() => {
    if (!isRadarOpen || !targetSatrec) return [];
    const samples = [];
    for (let offset = -900000; offset <= 900000; offset += 30000) {
      const time = radarSampleEpoch + offset;
      const position = calculateSatData(new Date(time), targetSatrec, activeStation);
      if (position && Number.isFinite(position.elevationDeg) && Number.isFinite(position.azimuthDeg)) samples.push({ time, elevationDeg: position.elevationDeg, azimuthDeg: position.azimuthDeg });
    }
    return samples;
  }, [isRadarOpen, targetSatrec, radarSampleEpoch, activeStation.id]);

  const radarData = useMemo(() => {
    if (!isRadarOpen || !targetSatrec || !targetData) return { segments: [], maxEl: 0, aosAz: null, losAz: null, sectorEdgePoints: [] };

    const nextPos = calculateSatData(new Date(currentDate.getTime() + 60000), targetSatrec, activeStation);
    const isDescending = nextPos && nextPos.elevationDeg < targetData.elevationDeg;

    if (targetData.elevationDeg <= 0 || (targetData.elevationDeg < stationMask && isDescending)) {
      return { segments: [], maxEl: 'N/A', aosAz: null, losAz: null, sectorEdgePoints: [] };
    }

    const segments = [];
    let prevPoint = null;
    let maxEl = -90;
    const { R, cx, cy } = radarLayout;
    let hasFutureVisibility = false; 

    // 📍 ฟันธง: ตัวแปรใหม่สำหรับคำนวณและวาดชิ้นพิซซ่า (Tracking Sector)
    let aosAz = null;
    let losAz = null;
    const sectorEdgePoints = [];

    for (const pos of radarTrajectory) {
      
      if (pos && !isNaN(pos.elevationDeg) && !isNaN(pos.azimuthDeg)) {
        if (pos.elevationDeg > maxEl) maxEl = pos.elevationDeg; 
        
        const isVis = pos.elevationDeg >= stationMask;
        
        if (isVis) {
          hasFutureVisibility = true;
          if (aosAz === null) aosAz = pos.azimuthDeg; // เก็บมุมแรกสุด (AOS)
          losAz = pos.azimuthDeg; // อัปเดตทับไปเรื่อยๆ จนได้มุมสุดท้าย (LOS)
          
          // คำนวณพิกัดจุดขอบวงนอกสุดตามองศา เพื่อวาดขอบโค้งของพิซซ่า
          const ex = cx + R * Math.sin((pos.azimuthDeg * Math.PI) / 180);
          const ey = cy - R * Math.cos((pos.azimuthDeg * Math.PI) / 180);
          sectorEdgePoints.push(`${ex},${ey}`);
        }
        
        if (pos.elevationDeg < 0) { prevPoint = null; continue; }
        
        const r = R * ((90 - pos.elevationDeg) / 90);
        const x = cx + r * Math.sin((pos.azimuthDeg * Math.PI) / 180);
        const y = cy - r * Math.cos((pos.azimuthDeg * Math.PI) / 180);
        const isPast = pos.time <= simulatedTimeMs; 

        if (prevPoint) {
          let lineColor, strokeWidth, strokeDash;
          if (isPast) {
            if (isVis || prevPoint.isVis) {
              lineColor = 'var(--cyan)'; strokeWidth = "3"; strokeDash = "none";
            } else {
              lineColor = 'rgba(0, 234, 255, 0.3)'; strokeWidth = "1.5"; strokeDash = "3 3";
            }
          } else {
            lineColor = 'var(--gold)'; strokeWidth = "1.5"; strokeDash = "3 3";
          }
          segments.push({ x1: prevPoint.x, y1: prevPoint.y, x2: x, y2: y, color: lineColor, width: strokeWidth, dash: strokeDash });
        }
        prevPoint = { x, y, isVis, isPast };
      }
    }
    
    if (!hasFutureVisibility && segments.length === 0) {
      return { segments: [], maxEl: 'N/A', aosAz: null, losAz: null, sectorEdgePoints: [] };
    }
    return { segments, maxEl: maxEl > 0 ? maxEl.toFixed(1) : 'N/A', aosAz, losAz, sectorEdgePoints };
  }, [isRadarOpen, targetSatrec, radarTrajectory, Math.floor(simulatedTimeMs / 1000), radarLayout, stationMask, activeStation.id]); // observer-dependent

  const radarCurrentPos = useMemo(() => {
    if (!targetData || isNaN(targetData.elevationDeg) || isNaN(targetData.azimuthDeg)) return null;
    
    // ฟันธง 3: ถ้ามุมเงยต่ำกว่า Station Mask (กราวด์เปลี่ยนเป็นสีแดง) ให้ซ่อนจุดเรดาร์สีส้มหายไปทันที
    if (targetData.elevationDeg < stationMask) return null;
    
    const { R, cx, cy } = radarLayout;
    const r = R * ((90 - targetData.elevationDeg) / 90);
    const x = cx + r * Math.sin((targetData.azimuthDeg * Math.PI) / 180);
    const y = cy - r * Math.cos((targetData.azimuthDeg * Math.PI) / 180);
    
    return { x, y, isVis: true, el: targetData.elevationDeg };
  }, [targetData, radarLayout, stationMask]);

 // =========================================================================
  // 📍 ฟันธง: กู้คืนสมองกล Ground Track สีเหลืองทอง 24 ชั่วโมงของคุณกลับมา! 
  // (ของเดิมที่คุณทำไว้ถูกต้องตามหลักวิศวกรรม 100% อยู่แล้วครับ)
  // =========================================================================
  const groundTrackPath = useMemo(() => {
    if (!targetSatrec || !showGroundTrack) return [];
    
    // เช็คสเปก ถ้าความสูงเกิน 30,000 กม. (GEO) ห้ามวาดเส้นรอบโลกเด็ดขาด!
    const initPos = calculateSatData(currentDate, targetSatrec);
    if (initPos && initPos.altKm > 30000) return []; 

    const points = [];
    
    // 🌟 ฟันธง: ใช้ลูป 1440 นาที (24 ชั่วโมง) แบบออริจินัลของคุณ เพื่อวาดเส้น Sine Wave ทำนายล่วงหน้าให้เต็มแผนที่
    for (let m = 0; m <= 1440; m += 1.5) {
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pos = calculateSatData(d, targetSatrec, activeStation);
      
      if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
        // 📍 ปรับแค่ alt เป็น 0.01 เพื่อไม่ให้เส้นจมหายไปในภูเขา 3D (Bump Map)
        points.push({ lat: pos.lat, lng: pos.lng, alt: 0.01 }); 
      }
    }
    
    if (points.length < 2) return [];
    
    return [{ 
      points: points, 
      color: 'rgba(255, 215, 0, 0.8)', // 🟡 กลับมาใช้สีเหลืองทองตามเดิมเป๊ะ
      stroke: 0.5 // ความหนาเส้นแบบเดิมของคุณ
    }];
  }, [selectedCatnr, targetSatrec, orbitUpdateTrigger, showGroundTrack]);


// =========================================================================
  // 📍 ฟันธง: สมองกลคำนวณเส้นนำทาง 2D (1 รอบวงโคจร = 100 นาที) เฉพาะดวง MAIN
  // ป้องกันไอดาวเทียมลอยเคว้งคว้างบนแผนที่ 2D โดยไม่มีทิศทาง
  // =========================================================================
  const guideTrack2DPath = useMemo(() => {
    if (!targetSatrec) return [];
    const initPos = calculateSatData(currentDate, targetSatrec);
    if (!initPos || initPos.altKm > 30000) return []; // ไม่วาดให้ GEO

    const pts = [];
    // วาด 1 รอบวงโคจร (-50 นาที ถึง +50 นาที)
    for (let m = -50; m <= 50; m += 2) { 
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pv = satelliteJs.propagate(targetSatrec, d);
      if (pv.position && typeof pv.position !== 'boolean') {
        const geo = satelliteJs.eciToGeodetic(pv.position, satelliteJs.gstime(d));
        const lat = satelliteJs.degreesLat(geo.latitude);
        let lng = satelliteJs.degreesLong(geo.longitude);
        lng = ((lng + 180) % 360 + 360) % 360 - 180;
        if (!isNaN(lat) && !isNaN(lng)) pts.push({ lat, lng });
      }
    }
    return pts;
  }, [targetSatrec, orbitUpdateTrigger]);


  // =========================================================================
  // 📍 ส่วนที่ 2: จุดประกอบร่าง pathsToDraw3D (Guard Clause ป้องกันจอดำ 100%)
  // =========================================================================
  const pathsToDraw3D = [
    ...(typeof orbitVisualPath !== 'undefined' && Array.isArray(orbitVisualPath) ? orbitVisualPath : []),
    ...(typeof signalVisualPath !== 'undefined' && Array.isArray(signalVisualPath) ? signalVisualPath : []),
    ...(typeof footprintBoundaryPath !== 'undefined' && Array.isArray(footprintBoundaryPath) ? footprintBoundaryPath : []),
    ...(typeof imagingSwathPaths !== 'undefined' && Array.isArray(imagingSwathPaths) ? imagingSwathPaths : []),
    ...(typeof groundTrackPath !== 'undefined' && Array.isArray(groundTrackPath) ? groundTrackPath : [])
  ];

// 📍 ฟันธง: สมองกล Cache ระบบแสง Day/Night 2D (แก้อาการกระตุกขั้นเด็ดขาด!)
const dayNightOverlay2D = useMemo(() => {
  if (!realtimeSun || typeof window === 'undefined' || typeof document === 'undefined') return null;

  // NASA-style 2D day/night geometry for an equirectangular map.
  // The physical day/night test is the solar-zenith dot product at every map cell.
  // This avoids artificial polygon closing at the poles or +/-180 deg map seam.
  const MASK_W = 1024;
  const MASK_H = 512;

  // Keep presentation smooth at high simulation speeds without changing orbit logic.
  // The Sun moves about 0.25 deg in longitude per simulated minute.
  const sunStepDeg = speedMult >= 600 ? 2.0 : (speedMult >= 60 ? 1.0 : 0.25);
  const maskSunLat = Math.round(currentSunPos.lat * 10) / 10;
  const maskSunLng = Math.round(currentSunPos.lng / sunStepDeg) * sunStepDeg;
  const themeFullNightAlpha = mapThemeIdx === 0 ? 0.80 : 0.72;
  const cacheKey = `${maskSunLat.toFixed(1)}|${maskSunLng.toFixed(2)}|T${mapThemeIdx}|A${themeFullNightAlpha.toFixed(2)}|${MASK_W}x${MASK_H}`;

  let shadowDataUrl = null;
  let cityMaskDataUrl = null;
  const cachedMask = window.__SAT_ORBIT_DAYNIGHT_2D_CACHE__;

  if (cachedMask && cachedMask.key === cacheKey) {
    shadowDataUrl = cachedMask.shadowDataUrl;
    cityMaskDataUrl = cachedMask.cityMaskDataUrl;
  } else {
    const shadowCanvas = document.createElement('canvas');
    const cityMaskCanvas = document.createElement('canvas');
    shadowCanvas.width = cityMaskCanvas.width = MASK_W;
    shadowCanvas.height = cityMaskCanvas.height = MASK_H;

    const shadowCtx = shadowCanvas.getContext('2d');
    const cityMaskCtx = cityMaskCanvas.getContext('2d');
    if (!shadowCtx || !cityMaskCtx) return null;

    const shadowImage = shadowCtx.createImageData(MASK_W, MASK_H);
    const cityMaskImage = cityMaskCtx.createImageData(MASK_W, MASK_H);

    const sunLatRad = maskSunLat * Math.PI / 180;
    const sunLngRad = maskSunLng * Math.PI / 180;
    const sinSunLat = Math.sin(sunLatRad);
    const cosSunLat = Math.cos(sunLatRad);

    // Scientific twilight model for the 2D presentation layer.
    // The physical terminator remains solar altitude = 0 deg.
    // Visual darkness then follows the standard twilight boundaries:
    // Civil -6 deg, Nautical -12 deg, Astronomical -18 deg.
    const SUN_HORIZON = 0.0;
    const CIVIL_END = Math.sin(-6 * Math.PI / 180);
    const NAUTICAL_END = Math.sin(-12 * Math.PI / 180);
    const ASTRONOMICAL_END = Math.sin(-18 * Math.PI / 180);
    const FULL_NIGHT_BLEND_END = Math.sin(-24 * Math.PI / 180);

    // Darkness targets are presentation opacities only; geometry is still solar-position driven.
    const CIVIL_ALPHA = 0.28;
    const NAUTICAL_ALPHA = 0.48;
    const ASTRONOMICAL_ALPHA = 0.64;
    const FULL_NIGHT_ALPHA = themeFullNightAlpha;

    // Night lights start shortly after sunset and reach full visibility during nautical twilight.
    const CITY_DAY = Math.sin(-3 * Math.PI / 180);
    const CITY_NIGHT = Math.sin(-12 * Math.PI / 180);

    const smooth01 = (v) => {
      const t = Math.max(0, Math.min(1, v));
      return t * t * (3 - 2 * t);
    };

    const blendBetween = (value, upper, lower) =>
      smooth01((upper - value) / (upper - lower));

    // Precompute the longitude term once per column.
    const cosDeltaLon = new Float32Array(MASK_W);
    for (let x = 0; x < MASK_W; x++) {
      const lng = -180 + ((x + 0.5) / MASK_W) * 360;
      const lngRad = lng * Math.PI / 180;
      cosDeltaLon[x] = Math.cos(lngRad - sunLngRad);
    }

    for (let y = 0; y < MASK_H; y++) {
      const lat = 90 - ((y + 0.5) / MASK_H) * 180;
      const latRad = lat * Math.PI / 180;
      const sinLat = Math.sin(latRad);
      const cosLat = Math.cos(latRad);

      for (let x = 0; x < MASK_W; x++) {
        // cos(zenith angle) = sin(solar altitude).
        // Positive = Sun above horizon, negative = Sun below horizon.
        const solarAltitudeSin =
          sinLat * sinSunLat +
          cosLat * cosSunLat * cosDeltaLon[x];

        let shadowAlpha = 0;
        if (solarAltitudeSin < SUN_HORIZON) {
          if (solarAltitudeSin >= CIVIL_END) {
            shadowAlpha = CIVIL_ALPHA * blendBetween(solarAltitudeSin, SUN_HORIZON, CIVIL_END);
          } else if (solarAltitudeSin >= NAUTICAL_END) {
            shadowAlpha = CIVIL_ALPHA +
              (NAUTICAL_ALPHA - CIVIL_ALPHA) * blendBetween(solarAltitudeSin, CIVIL_END, NAUTICAL_END);
          } else if (solarAltitudeSin >= ASTRONOMICAL_END) {
            shadowAlpha = NAUTICAL_ALPHA +
              (ASTRONOMICAL_ALPHA - NAUTICAL_ALPHA) * blendBetween(solarAltitudeSin, NAUTICAL_END, ASTRONOMICAL_END);
          } else if (solarAltitudeSin >= FULL_NIGHT_BLEND_END) {
            shadowAlpha = ASTRONOMICAL_ALPHA +
              (FULL_NIGHT_ALPHA - ASTRONOMICAL_ALPHA) * blendBetween(solarAltitudeSin, ASTRONOMICAL_END, FULL_NIGHT_BLEND_END);
          } else {
            shadowAlpha = FULL_NIGHT_ALPHA;
          }
        }

        const cityT = smooth01(
          (CITY_DAY - solarAltitudeSin) / (CITY_DAY - CITY_NIGHT)
        );

        const p = (y * MASK_W + x) * 4;

        // Deep-navy night tint: preserve terrain/ice detail without turning night into a flat black mask.
        shadowImage.data[p] = 2;
        shadowImage.data[p + 1] = 6;
        shadowImage.data[p + 2] = 16;
        shadowImage.data[p + 3] = Math.round(255 * shadowAlpha);

        // Grayscale luminance mask for the Black Marble night-lights texture.
        const maskValue = Math.round(255 * cityT);
        cityMaskImage.data[p] = maskValue;
        cityMaskImage.data[p + 1] = maskValue;
        cityMaskImage.data[p + 2] = maskValue;
        cityMaskImage.data[p + 3] = 255;
      }
    }

    shadowCtx.putImageData(shadowImage, 0, 0);
    cityMaskCtx.putImageData(cityMaskImage, 0, 0);

    shadowDataUrl = shadowCanvas.toDataURL('image/png');
    cityMaskDataUrl = cityMaskCanvas.toDataURL('image/png');

    window.__SAT_ORBIT_DAYNIGHT_2D_CACHE__ = {
      key: cacheKey,
      shadowDataUrl,
      cityMaskDataUrl
    };
  }

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1
      }}
    >
      <defs>
        <filter id="city-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feColorMatrix type="matrix" values="
            1.8 0 0 0 0
            0 1.4 0 0 0
            0 0 0.9 0 0
            0 0 0 1 0" />
        </filter>
        <mask id="night-mask-corrected" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <image
            href={cityMaskDataUrl}
            x="0"
            y="0"
            width="100"
            height="100"
            preserveAspectRatio="none"
          />
        </mask>
      </defs>

      <image
        href={shadowDataUrl}
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="none"
      />

      <image
        href={runtimeAsset('/textures/Earth_nightmap.webp')}
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="none"
        mask="url(#night-mask-corrected)"
        filter="url(#city-glow)"
        style={{ mixBlendMode: 'screen' }}
      />
    </svg>
  );
}, [realtimeSun, currentSunPos, speedMult, mapThemeIdx]);

// 📍 ฟันธง: สร้าง State ควบคุม SPAN และปุ่ม เปิด-ปิด กราฟ
const [xBandSpan, setXBandSpan] = useState(1000); // TSX TV default: wider engineering view 
const [sBandSpan, setSBandSpan] = useState(20);
const [showXBand, setShowXBand] = useState(true);
const [showSBand, setShowSBand] = useState(true);
// Signal Flow shortcuts select a band on every click, including already-open tools.
const openSignalFlowReceiver = (channel, view) => {
  if (view === 'iq') {
    setIqDisplayChannel(channel);
    setIsIqOpen(true);
    bringToFront('iq');
  } else {
    setShowXBand(channel === 'x');
    setShowSBand(channel === 's');
    setIsAnalyzerOpen(true);
    bringToFront('analyzer');
  }
};

// Canvas drawing is owned by this effect only. JSX below never draws.
const iqCanvasRef = useRef(null);
const iqPathCanvasRefs = useRef(new Map());
const xBandCanvasRefs = useRef(new Map());
const analyzerXPaths = useMemo(() => getAnalyzerXPaths(selectedCatnr, rfProfile.xBand), [selectedCatnr, rfProfile.xBand]);
const sBandCanvasRef = useRef(null);
const analyzerRuntimeRef = useRef(null);
analyzerRuntimeRef.current = { simulatedTimeMs, rfState, rfProfile, xBandSpan, sBandSpan, showXBand, showSBand, iqDisplayChannel, analyzerXPaths };
const analyzerModulationLabel = [showXBand && `CH1: ${rfProfile.xBand.mod}`, showSBand && `CH2: ${rfProfile.sBand.mod}`].filter(Boolean).join(' | ');

useEffect(() => {
  if (!isAnalyzerOpen && !isIqOpen) return;
  let disposed = false, animationFrameId = null, frameWindow = window, lastPaintMs = -Infinity;
  const surfaces = new Map();
  const surfaceFor = canvas => {
    if (!canvas || !canvas.parentElement) return null;
    const owner = canvas.ownerDocument.defaultView || window;
    let surface = surfaces.get(canvas);
    if (!surface || surface.parent !== canvas.parentElement || surface.owner !== owner) {
      if (surface?.observer) surface.observer.disconnect();
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      surface = { ctx, parent: canvas.parentElement, owner, width: 0, height: 0, dirty: true, dpr: 0, observer: null, externalLabels: true };
      const Observer = owner.ResizeObserver || window.ResizeObserver;
      if (Observer) {
        surface.observer = new Observer(() => { surface.dirty = true; });
        surface.observer.observe(surface.parent);
      }
      surfaces.set(canvas, surface);
    }
    const dpr = Math.min(3, Math.max(1, owner.devicePixelRatio || 1));
    if (surface.dirty || surface.dpr !== dpr || !surface.observer) {
      const bounds = surface.parent.getBoundingClientRect();
      surface.width = Math.max(0, bounds.width);
      surface.height = Math.max(0, bounds.height);
      surface.dpr = dpr;
      const width = Math.max(1, Math.round(surface.width * dpr));
      const height = Math.max(1, Math.round(surface.height * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      surface.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      surface.dirty = false;
    }
    return surface;
  };
  const draw = now => {
    if (disposed) return;
    const liveCanvases = [iqCanvasRef.current, ...iqPathCanvasRefs.current.values(), ...xBandCanvasRefs.current.values(), sBandCanvasRef.current].filter(Boolean);
    // Rebind automatically after a host/document change; never retain a closed window's canvas.
    for (const [canvas, surface] of surfaces) {
      if (!liveCanvases.includes(canvas)) { surface.observer?.disconnect(); surfaces.delete(canvas); }
    }
    if (now - lastPaintMs >= 48 || now < lastPaintMs) {
      lastPaintMs = now;
      const runtime = analyzerRuntimeRef.current;
      const iqSurface = surfaceFor(iqCanvasRef.current);
      if (iqSurface) drawRfIqFrame(iqSurface, runtime.rfProfile, runtime.rfState, runtime.simulatedTimeMs, runtime.iqDisplayChannel !== 's', runtime.iqDisplayChannel !== 'x');
      if (runtime.analyzerXPaths.length > 1 && runtime.iqDisplayChannel !== 's') {
        for (const path of runtime.analyzerXPaths) {
          const surface = surfaceFor(iqPathCanvasRefs.current.get(path.id));
          if (surface) drawRfIqFrame(surface, { ...runtime.rfProfile, xBand: path }, runtime.rfState, runtime.simulatedTimeMs, true, false);
        }
        if (runtime.iqDisplayChannel === 'both') {
          const surface = surfaceFor(iqPathCanvasRefs.current.get('s'));
          if (surface) drawRfIqFrame(surface, runtime.rfProfile, runtime.rfState, runtime.simulatedTimeMs, false, true);
        }
      }
      if (runtime.showXBand) {
        for (const path of runtime.analyzerXPaths) {
          const xSurface = surfaceFor(xBandCanvasRefs.current.get(path.id));
          if (xSurface) drawRfSpectrumFrame(xSurface, path, runtime.xBandSpan, runtime.rfState, runtime.simulatedTimeMs, true);
        }
      }
      if (runtime.showSBand) {
        const sSurface = surfaceFor(sBandCanvasRef.current);
        if (sSurface) drawRfSpectrumFrame(sSurface, runtime.rfProfile.sBand, runtime.sBandSpan, runtime.rfState, runtime.simulatedTimeMs, false);
      }
    }
    frameWindow = liveCanvases[0]?.ownerDocument.defaultView || window;
    if (frameWindow.closed) frameWindow = window;
    animationFrameId = frameWindow.requestAnimationFrame(draw);
  };
  draw(0);
  return () => {
    disposed = true;
    if (animationFrameId !== null) frameWindow.cancelAnimationFrame(animationFrameId);
    for (const surface of surfaces.values()) surface.observer?.disconnect();
    surfaces.clear();
  };
// The host revision rebinds even if closing a child window cancelled its last RAF.
}, [isAnalyzerOpen, isIqOpen, toolHostRevision]);

// 📍 WOW Feature 1: DIAGRAM STATE
const [isDiagramOpen, setIsDiagramOpen] = useState(false);
const [diagramPos, setDiagramPos] = useState(() => ({ x: Math.max(0, window.innerWidth / 2 - 550), y: Math.max(0, window.innerHeight / 2 - 325) }));
const [isDraggingDiagram, setIsDraggingDiagram] = useState(false);
const dragDiagramRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

// 📍 WOW Feature 2 & 3: AUTO-EARTH (visual rotation only) & DOWNLINK MATRIX STATE
// Legacy variable name is retained to minimize TSX-release risk; it now represents
// AUTO-EARTH only and must not control simulation time, popup tours or pass sequencing.
const [isAutoPilot, setIsAutoPilot] = useState(false);
const matrixRef = useRef(null);

// Logic ระบบลากหน้าต่าง Diagram
const handleDiagramMouseDown = (e) => { if (workspaceMode !== 'classic' || toolWindowsRef.current.diagram || e.target.closest('button,input,select')) return; setIsDraggingDiagram(true); bringToFront('diagram'); dragDiagramRef.current = { startX: e.clientX, startY: e.clientY, initX: diagramPos.x, initY: diagramPos.y }; };
useEffect(() => {
  const handleMouseMove = (e) => { if (isDraggingDiagram) setDiagramPos({ x: dragDiagramRef.current.initX + (e.clientX - dragDiagramRef.current.startX), y: dragDiagramRef.current.initY + (e.clientY - dragDiagramRef.current.startY) }); };
  const handleMouseUp = () => setIsDraggingDiagram(false);
  if (isDraggingDiagram) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
  return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
}, [isDraggingDiagram]);

// AUTO-EARTH: visual-only globe rotation. It must never change the clock, seek
// to a pass, or open/close any tool window. Target Lock can still turn it OFF.
useEffect(() => {
  const controls = globeRef.current?.controls?.();
  if (!controls) return;
  controls.autoRotate = Boolean(isAutoPilot);
  return () => {
    const currentControls = globeRef.current?.controls?.();
    if (currentControls) currentControls.autoRotate = false;
  };
}, [isAutoPilot]);

// 📍 ฟันธง: สมองกล "MISSION AUTO-SEQUENCER" (ระบบวนลูปตารางรับสัญญาณอัตโนมัติ)
const autoSnapRef = useRef({});
const missionJumpTimerRef = useRef(null);
const missionSequencerStateRef = useRef({});
// TSX safety gate: the legacy automatic pass sequencer is intentionally disabled.
// AUTO-EARTH is visual-only and cannot arm this subsystem.
const missionAutoSequencerEnabled = false;
missionSequencerStateRef.current = { validationMode, isPlaying, speedMult, selectedCatnr, stationId: activeStation.id, clockMode, isAutoPilot };

useEffect(() => {
  return () => {
    if (missionJumpTimerRef.current) clearTimeout(missionJumpTimerRef.current);
  };
}, []);

useEffect(() => {
  if (!passSchedule || passSchedule.length === 0) return;

  const now = Date.now();
  const activeRealPass = passSchedule.find(p => now >= p.aosTime && now <= p.losTime);

  // LIVE follows the clock in one place. Manual SIM is never intercepted at AOS.
  // Legacy automatic pass jumps remain preserved for future work, but the TSX safety
  // gate below keeps them disabled and fully independent from AUTO-EARTH.
  const isSimulating = missionAutoSequencerEnabled && clockMode === 'DEMO' && isAutoPilot && speedMult === 1 && isPlaying;

  if (!validationMode && isSimulating) {
    // 📍 ค้นหาว่าเพิ่งผ่าน LOS ของ Pass ปัจจุบันมา 10 ถึง 12 วินาทีหรือไม่ (หน่วง 10 วิเพื่อให้ผู้ชมเห็นจังหวะสัญญาณหลุด)
    const justFinishedPass = passSchedule.find(p => 
      simulatedTimeMs > p.losTime + 10000 && simulatedTimeMs < p.losTime + 12000
    );

    if (justFinishedPass) {
      // ค้นหา Pass คิวถัดไป
      const nextPass = passSchedule.find(p => p.aosTime > justFinishedPass.losTime);
      
      if (nextPass) {
        const jumpId = `AUTO-JUMP-${nextPass.aosTime}`;
        if (!autoSnapRef.current[jumpId]) {
          autoSnapRef.current[jumpId] = true;
          
          // 📍 เด้ง Popup Sci-Fi แจ้งเตือนผู้ชมบนจอใหญ่
          setCustomAlert({ 
            show: true, 
            message: `🛰️ MISSION SEQUENCER: Pass complete. Computing the next pass and advancing the simulation automatically.`, 
            type: 'success' 
          });
          
         // 📍 รออีก 4 วินาทีให้ผู้ชมอ่านข้อความจบ แล้วกระโดดเวลา (Time Jump) ไปรอที่ AOS - 10 วินาทีของ Pass ถัดไปทันที! (จังหวะเคาต์ดาวน์เป๊ะๆ)
         if (missionJumpTimerRef.current) clearTimeout(missionJumpTimerRef.current);
         const scheduledCatnr = selectedCatnr;
         const scheduledStationId = activeStation.id;
         const scheduledSeekRevision = manualSeekRevisionRef.current;
         missionJumpTimerRef.current = setTimeout(() => {
          const runtime = missionSequencerStateRef.current;
          missionJumpTimerRef.current = null;
          if (runtime.validationMode || !runtime.isPlaying || runtime.speedMult !== 1 || runtime.clockMode !== 'DEMO' || !runtime.isAutoPilot || manualSeekRevisionRef.current !== scheduledSeekRevision || runtime.selectedCatnr !== scheduledCatnr || runtime.stationId !== scheduledStationId) {
            delete autoSnapRef.current[jumpId];
            return;
          }
          manualSeekRevisionRef.current += 1;
          setSimulatedTimeValue(nextPass.aosTime - 10000);
        }, 4000);
      }
    }
    }
  }
}, [simulatedTimeMs, passSchedule, speedMult, isPlaying, validationMode, selectedCatnr, activeStation.id, clockMode, isAutoPilot]);

// MASTER RESPONSIVE REQUIREMENT: adapt by real viewport, not physical screen inches.
// Four tiers preserve the Classic HUD whenever there is enough room, reserve a central Globe Safe Zone,
// and only page the side HUD on genuinely narrow/portrait viewports.
const viewportAspect = size.height > 0 ? size.width / size.height : 16 / 9;
const isPortraitViewport = size.height > size.width;
// A 65-inch/large presentation screen can report a shorter CSS viewport because of
// browser chrome or OS scaling. Treat wide >=1600px canvases as full Classic HUD
// displays down to 700px height so the side menus never fall back to scroll mode.
const wideTvHud = size.width >= 1600 && size.height >= 700;
const hudTier = (size.width < 900 || (isPortraitViewport && size.width < 1200))
  ? 'narrow'
  : (wideTvHud
    ? ((size.width >= 2500 && size.height >= 1200) ? 'presentation' : 'desktop')
    : ((size.width < 1500 || size.height < 820) ? 'compact' : 'desktop'));
const compactHud = hudTier === 'compact' || hudTier === 'narrow';
const pagedHud = hudTier === 'narrow';
const hudOuterPadding = hudTier === 'presentation' ? 24 : (hudTier === 'desktop' ? 16 : (hudTier === 'compact' ? 10 : 8));
const globeSafeMin = hudTier === 'presentation'
  ? Math.max(1500, Math.round(size.width * 0.56))
  : (hudTier === 'desktop'
    ? Math.max(760, Math.round(size.width * 0.46))
    : (hudTier === 'compact' ? Math.max(460, Math.round(size.width * 0.42)) : size.width));
const preferredHudWidth = hudTier === 'presentation' ? 540 : (hudTier === 'desktop' ? 410 : 350);
const safeHudWidth = hudTier === 'narrow'
  ? Math.max(1, size.width - (hudOuterPadding * 2))
  : Math.max(260, Math.floor((size.width - globeSafeMin - (hudOuterPadding * 2)) / 2));
const hudPanelWidth = Math.max(260, Math.min(preferredHudWidth, safeHudWidth));
const hudFill = false;
// Use MASTER compact fitting only below desktop-class widths. Desktop/TV must match
// the deployed Classic HUD exactly rather than being compressed by the newer tier rules.
const hudFit = hudTier === 'compact' || hudTier === 'narrow';
const useAdaptiveHud = hudTier === 'compact' || hudTier === 'narrow';

// DEPLOYED CLASSIC AUTOSCALE — exact proven behavior from the working reference build.
// Scale BOTH axes against the 1920x1080 design canvas. Do not measure content and do not
// shrink the HUD a second time: that double-scaling was the reason the MASTER looked tiny.
const uiScale = hudTier === 'narrow' ? 1 : Math.min(1, size.width / 1920, size.height / 900);

// Native requestFullscreen sets document.fullscreenElement, but browser/F11 fullscreen
// may only expose itself through a viewport that nearly equals screen.avail*. Detect both
// without changing the normal maximized-browser layout.
const screenAvailWidth = typeof window !== 'undefined' ? (window.screen?.availWidth || size.width) : size.width;
const screenAvailHeight = typeof window !== 'undefined' ? (window.screen?.availHeight || size.height) : size.height;
const isMainFullscreenLayout = isMainFullscreen || (
  size.width >= Math.max(1, screenAvailWidth - 12) &&
  size.height >= Math.max(1, screenAvailHeight - 12)
);

const mainHudLayerRef = useMainHudHeightFit(uiScale, pagedHud, isMainFullscreenLayout,
  isLeftPanelOpen, isRightPanelOpen, size.width, size.height);

const workspaceRects = getWorkspaceRects(size.width, size.height, workspaceToolbarHeight);
const workspaceFullRect = { left: 8, top: workspaceToolbarHeight + 8, width: Math.max(1, size.width - 16), height: Math.max(1, size.height - workspaceToolbarHeight - 16) };
workspaceRuntimeRef.current = { time: simulatedTimeMs, station: activeStation.id, clockMode, isPlaying, muted: isMuted };
// 📍 ฟันธง 2: สมองกลป้องกันหน้าต่างทะลุขอบจอ (Anti-OutOfBounds System)
// หากผู้ใช้ลากหัวหน้าต่างหลุดขึ้นไปขอบบน (y < 0) ระบบจะดีดกลับมาที่ขอบบนสุดอัตโนมัติ!
useEffect(() => {
  // Keep the complete Classic panel in the current viewport, including a resized
  // panel. Quad, maximized and detached hosts retain their saved Classic position.
  if (workspaceMode !== 'classic') return;
  const specs = [
    ['radar', setRadarPos, 550, 550], ['analyzer', setAnalyzerPos, 880, 550],
    ['diagram', setDiagramPos, 1050, 600], ['gs', setGsPos, 520, 530],
    ['angles', setAnglesPos, 780, 520], ['db', setDbPos, 750, 480],
    ['pass', setPassPos, 800, 520], ['img', setImgPos, 780, 500]
  ];
  const panels = specs.filter(([id]) => !toolWindowsRef.current[id] && !maximizedWins[id]).map(([id, setter, width, height]) => ({
    setter, width: Math.min(width, size.width * .95), height: Math.min(height, size.height * .85),
    node: document.querySelector(`.sat-tool-surface[data-tool="${id}"][data-host="classic"]`)?.firstElementChild
  }));
  const keepVisible = () => panels.forEach(({setter, width, height, node}) => {
    const rect = node?.getBoundingClientRect();
    const panelWidth = rect?.width > 0 ? rect.width : width;
    const panelHeight = rect?.height > 0 ? rect.height : height;
    setter(previous => {
      const x = Math.max(0, Math.min(previous.x, Math.max(0, size.width - Math.min(panelWidth, size.width))));
      const y = Math.max(0, Math.min(previous.y, Math.max(0, size.height - Math.min(panelHeight, size.height))));
      return x === previous.x && y === previous.y ? previous : { ...previous, x, y };
    });
  });
  keepVisible();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(keepVisible) : null;
  panels.forEach(({node}) => { if (node) observer?.observe(node); });
  return () => observer?.disconnect();
}, [size.width, size.height, workspaceMode, toolHostRevision, maximizedWins,
  isRadarOpen, isAnalyzerOpen, isDiagramOpen, isGsModalOpen, isAnglesOpen, isModalOpen, isPassModalOpen, isImgOpen,
  radarPos.x, radarPos.y, gsPos.x, gsPos.y, anglesPos.x, anglesPos.y, dbPos.x, dbPos.y, passPos.x, passPos.y,
  diagramPos.x, diagramPos.y, analyzerPos.x, analyzerPos.y, imgPos.x, imgPos.y]);

return (
  <>

       {/* 🌟 หน้าจอ Loading Screen (Splash Screen) ปิดทับทุกสิ่งจนกว่าจะโหลดเสร็จ */}
      <div className={`loading-overlay ${isAppReady ? 'fade-out' : ''}`}>
        
     {/* 🌟 ฟันธง 1: ลบก้อนเมฆพื้นหลังออก ใช้แสง Drop-shadow ขอบคมๆ ซ้อน 2 ชั้นให้สว่างแบบรูปที่ 2 และคงความดุ๊กดิ๊กไว้ */}
     <div style={{ display: 'none', position: 'absolute', top: 'clamp(15px, 3vh, 40px)', left: 'clamp(20px, 3vw, 50px)', zIndex: 10, animation: 'float-sat 6s ease-in-out infinite' }}>
          <img src="/textures/GISTDA_Logo.webp" alt="GISTDA" style={{ 
            height: 'clamp(75px, 12vh, 160px)', 
            /* อัดแสงเงาสีขาวสว่างคมกริบที่ตัวโลโก้โดยตรง */
            filter: 'drop-shadow(0 0 15px rgba(255,255,255,0.9)) drop-shadow(0 0 5px rgba(255,255,255,1))' 
          }} />
        </div>

        {/* 🌟 ฟันธง 2: ขยาย อว. ให้ใหญ่สมมาตรคู่กับ GISTDA และสั่งลอยดุ๊กดิ๊กสลับจังหวะนิดๆ (7s) */}
        <div style={{ 
          position: 'absolute', top: 'clamp(15px, 3vh, 40px)', right: 'clamp(20px, 3vw, 50px)', zIndex: 10, 
          width: 'clamp(90px, 14vh, 180px)', height: 'clamp(90px, 14vh, 180px)', 
          borderRadius: '50%', border: '3px solid var(--cyan)', boxShadow: '0 0 25px rgba(0,234,255,0.8)', 
          display: 'none', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          animation: 'float-sat 7s ease-in-out infinite'
        }}>
          <img src="/textures/MHESI_Logo.webp" alt="MHESI" style={{ width: '125%', height: '125%', objectFit: 'cover' }} />
        </div>


        <div className="loading-logo">
          <div className="loading-badge">
            <img src="https://flagcdn.com/w80/th.png" alt="Thailand Flag" />
            <span>THEOS-2</span>
          </div>

          <img src="/textures/THEOS-2.webp" alt="THEOS-2 Satellite" className="hero-satellite" />

          <div className="loading-title">SATELLITE ORBIT</div>
          <div className="loading-subtitle">THAILAND GROUND STATION SYSTEM</div>
        </div>

        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${loadingPct}%` }}></div>
        </div>
        
        <div className="progress-text" style={{ 
            color: `hsl(${Math.floor((loadingPct / 100) * 120)}, 100%, 50%)`,
            textShadow: `0 0 8px hsl(${Math.floor((loadingPct / 100) * 120)}, 100%, 50%), 0 4px 6px rgba(0,0,0,0.8)` 
          }}>
          {loadingPct}%
        </div>
        <div className="loading-log" style={{ 
          color: loadingPct >= 85 ? 'var(--green)' : '#ffcc00', 
          textShadow: loadingPct >= 85 ? '0 0 10px var(--green)' : '0 0 10px rgba(255, 204, 0, 0.8)' 
        }}>
          {loadingPct < 25 ? 'Establishing connection to GISTDA Ground Station...' : 
           loadingPct < 55 ? 'Downloading TLE Orbital Elements...' : 
           loadingPct < 85 ? 'Rendering 3D Earth Topology & Textures...' : 
           'SYSTEM READY. INITIALIZING ORBIT.'}
        </div>
      </div>

  <style>{SAT_WORKSPACE_CSS}</style>
  <SatFeedback alert={customAlert} onDismiss={() => setCustomAlert(value => ({ ...value, show: false }))} />
  {customAlert.show && Object.entries(toolWindows).map(([id, viewer]) => viewer.mount?.isConnected ? createPortal(<SatFeedback alert={customAlert} onDismiss={() => setCustomAlert(value => ({ ...value, show: false }))} />, viewer.mount, `feedback-${id}`) : null)}
  {workspaceMode === 'quad' && <>
    <div style={{ position: 'fixed', inset: 0, background: '#010408', zIndex: 19999 }} />
    <nav className="sat-workspace-toolbar" ref={workspaceToolbarRef} aria-label="Workspace controls">
      <button onClick={returnClassicWorkspace}>← BACK TO CLASSIC</button>
      <strong>MULTI-VIEW</strong>
      {focusedWorkspacePanel && <button onClick={() => setFocusedWorkspacePanel(null)}>RETURN TO 4-UP</button>}
      <span className="sat-workspace-time">{clockMode} · {formatTime(currentDate)} UTC</span>
      <button onClick={() => { setClockMode('SIM'); setIsPlaying(value => !value); }}>{isPlaying ? 'Ⅱ PAUSE' : '▶ PLAY'}</button>
      <button onClick={toggleAudioMute} aria-pressed={isMuted}>{isMuted ? '🔇 MUTE' : '🔊 AUDIO'}</button>
      <select aria-label="Workspace satellite" value={selectedCatnr} onChange={event => { setSelectedCatnr(event.target.value); setSelectedCatnrs(values => Array.from(new Set([...values, event.target.value]))); }}>
        {SATELLITE_OPTIONS.map(sat => <option key={sat.catnr} value={sat.catnr}>{sat.displayName}</option>)}
      </select>
      <select aria-label="Workspace station" value={activeStation.id} onChange={event => setActiveStation(GS_NETWORK.find(station => station.id === event.target.value))}>
        {GS_NETWORK.map(station => <option key={station.id} value={station.id}>{station.name}</option>)}
      </select>
      <button onClick={() => setStationMask(value => value === 0 ? 3 : value === 3 ? 5 : 0)}>MASK {stationMask}°</button>
      <button onClick={() => setIsFlatMap(value => !value)}>{isFlatMap ? '3D GLOBE' : '2D MAP'}</button>
      <select aria-label="Open workspace tool" value="" onChange={event => {
        const id = event.target.value;
        if (!id) return;
        const viewer = toolWindowsRef.current[id];
        if (viewer && !viewer.win.closed) { viewer.win.focus(); return; }
        if (SAT_QUAD_TOOL_IDS.includes(id)) {
          // Core 4-UP tools stay inside MULTI-VIEW and use the existing full-panel focus mode.
          setToolOpen(id, true);
          bringToFront(id);
          setFocusedWorkspacePanel(id);
        } else {
          // Auxiliary tools (including IQ) must remain visible while MULTI-VIEW stays on screen.
          // Open them in the hardened detached viewer instead of underneath the 4-UP backdrop.
          openToolWindow(id);
        }
      }}>
        <option value="">TOOLS…</option>{Object.entries(SAT_WORKSPACE_TOOLS).map(([id, label]) => <option value={id} key={id}>{label}</option>)}
      </select>
    </nav>
    {SAT_QUAD_TOOL_IDS.map(id => {
      const opened = id === 'radar' ? isRadarOpen : id === 'diagram' ? isDiagramOpen : isAnalyzerOpen;
      if ((!toolWindows[id] && opened) || focusedWorkspacePanel) return null;
      return <div key={id} className="sat-empty-tool" style={workspaceRects[id]}>
        <strong>{SAT_WORKSPACE_TOOLS[id]}</strong>
        <span>{toolWindows[id] ? 'OPEN IN DETACHED WINDOW' : 'TOOL IS CLOSED'}</span>
        <button onClick={() => toolWindows[id] ? toolWindows[id].win.focus() : setToolOpen(id, true)}>{toolWindows[id] ? 'SHOW DETACHED WINDOW' : 'OPEN TOOL'}</button>
        {toolWindows[id] && <button onClick={() => returnToolToMain(id)}>RETURN HERE</button>}
      </div>;
    })}
  </>}
  <div className="sat-globe-host" ref={globeHostRef} data-quad={workspaceMode === 'quad'} style={workspaceMode === 'quad' ? { ...(focusedWorkspacePanel === 'globe' ? workspaceFullRect : workspaceRects.globe), right: 'auto', bottom: 'auto', visibility: focusedWorkspacePanel && focusedWorkspacePanel !== 'globe' ? 'hidden' : 'visible' } : undefined}>
    {workspaceMode === 'quad' && <div className="sat-globe-caption" style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}><span>LIVE GLOBE · {targetConfig.displayName} · {activeStation.id} · {cameraMode}</span><button className="sat-popout-btn" aria-label="Expand Globe" onClick={() => toggleMaximize('globe')}><SatWindowIcon kind={focusedWorkspacePanel === 'globe' ? 'restore' : 'maximize'} /></button></div>}
  {/* 📍 ฟันธง: ชุดโค้ด Globe ฉบับสมบูรณ์ แก้ปัญหาจอขาว + ป้าย 3D สมมาตร 100% */}
  {(() => {
      // 📍 ฟันธง: ลบดาวเทียมออกจาก HTML ทิ้งไปเลย เพราะเราย้ายป้ายชื่อเข้าโลก 3D แล้ว!
      const memoizedHtmlElements = [
        { type: 'station', lat: activeStation.lat, lng: activeStation.lng, name: activeStation.name, altitude: 0 }
      ];
      const memoizedRings = [{ lat: activeStation.lat, lng: activeStation.lng }];

      return (
        <Globe
            ref={globeRef} width={globeSize.width} height={globeSize.height}
            backgroundColor="#000000"
            globeImageUrl={runtimeAsset(mapThemes[mapThemeIdx].url)}

            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            
            /* 📍 ฟันธง: เปลี่ยนจาก true เป็น !realtimeSun เพื่อให้ชั้นบรรยากาศสีฟ้าดับมืดลงในโหมดกลางคืน */
            showAtmosphere={!realtimeSun} 
            
            atmosphereColor="#00b3ff"
            atmosphereAltitude={0.15}

            objectsData={allSatObjects}
            objectLat="lat" objectLng="lng" objectAltitude="altitude"
            
           /* 📍 ฟันธง: ประกอบร่างดาวเทียม 3D พร้อมป้ายชื่อ 3D ไว้ใน Group เดียวกัน! */
           objectThreeObject={(d) => {
            // 📍 STABILITY FIX: allSatObjects reuses the same data objects, so reuse the
            // complete THREE object too. This prevents repeated Group/Material/Sprite
            // allocation during the 25 Hz master-clock render cycle.
            const altitudeTier = d.altKm > 30000 ? 'GEO' : (d.altKm > 10000 ? 'MEO' : 'LEO');
            const threeCacheKey = `${d.catnr}|${d.isTarget ? 'TARGET' : 'SECONDARY'}|${altitudeTier}|A${runtimeAssetRevision}`;

            if (!d.__gistdaThreeObjects) d.__gistdaThreeObjects = {};
            if (d.__gistdaThreeObjects[threeCacheKey]) {
              return d.__gistdaThreeObjects[threeCacheKey];
            }

            const group = new THREE.Group();

            // 1. วาดตัวดาวเทียม
            if (d.catnr === '58016') {
              if (!window.theos2TextureCache) {
                window.theos2TextureCache = new THREE.TextureLoader().load(runtimeAsset('/textures/THEOS-2.webp'), (texture) => {
                  texture.minFilter = THREE.LinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                });
              }
              const material = new THREE.SpriteMaterial({ map: window.theos2TextureCache, color: 0xffffff, transparent: true, depthWrite: false });
              const satSprite = new THREE.Sprite(material);
              // 🌟 ฟันธง: สเกล THEOS-2 ให้สมมาตรพอดี ไม่ล้นจอ 
              const size = d.isTarget ? 20 : 8; 
              satSprite.scale.set(size * 1.8, size, 1);
              group.add(satSprite);
            } else if (d.catnr === '33396') {
              if (!window.theosTextureCache) {
                window.theosTextureCache = new THREE.TextureLoader().load(runtimeAsset('/textures/THEOS.webp'), (texture) => {
                  texture.minFilter = THREE.LinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                });
              }
              const material = new THREE.SpriteMaterial({ map: window.theosTextureCache, color: 0xffffff, transparent: true, depthWrite: false });
              const satSprite = new THREE.Sprite(material);
              // 🌟 ฟันธง: สเกล THEOS-1 ให้สมดุลกับ THEOS-2
              const size = d.isTarget ? 18 : 7; 
              satSprite.scale.set(size * 1.5, size, 1); 
              group.add(satSprite);
            } else {
              // 📍 ฟันธง: ใช้ THEOS-2-1.webp แทนกล่อง 3D ทั้งหมด
              if (!window.defaultSatTextureCache) {
                window.defaultSatTextureCache = new THREE.TextureLoader().load(runtimeAsset('/textures/THEOS-2-1.webp'), (texture) => {
                  texture.minFilter = THREE.LinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                });
              }
              const material = new THREE.SpriteMaterial({ map: window.defaultSatTextureCache, color: 0xffffff, transparent: true, depthWrite: false });
              const satSprite = new THREE.Sprite(material);
              
              // 📍 🌟 สมองกล Auto-Scale ที่คำนวณสมดุลระยะสายตาแล้ว 100% 🌟
              let baseSize = d.isTarget ? 14 : 5; // LEO (เช่น Starlink/ทั่วไป) อยู่ใกล้โลก
              
              if (d.altKm > 30000) {
                baseSize = d.isTarget ? 65 : 28; // GEO (เช่น THAICOM) อยู่ไกลมาก ต้องขยายใหญ่สุดเพื่อสู้ระยะทาง
              } else if (d.altKm > 10000) {
                baseSize = d.isTarget ? 40 : 18; // MEO (เช่น GNSS) อยู่ระยะกลาง ขยายขนาดกลางๆ
              }
              
              satSprite.scale.set(baseSize * 1.5, baseSize, 1); 
              group.add(satSprite);
            }

           // 2. 📍 นำป้ายชื่อ 3D มาแปะด้านบนดาวเทียม (เฉพาะเป้าหมายที่ถูกล็อก)
           if (d.isTarget) {
            const labelSprite = create3DLabel(d.name, d.catnr);
            // 📍 ฟันธง: ปรับระยะป้ายชื่อให้ขยับสูง-ต่ำ ตามขนาดของดาวเทียมแบบไดนามิก! (แก้บั๊กป้ายชื่อจมเข้าไปในตัวดาวเทียม)
            labelSprite.position.y = d.catnr === '58016' ? 10 : (d.catnr === '33396' ? 9 : (d.altKm > 30000 ? 35 : (d.altKm > 10000 ? 22 : 8))); 
            group.add(labelSprite);
         }

         d.__gistdaThreeObjects[threeCacheKey] = group;
         return group;
      }}
            
            /* 📍 ฟันธง: ปิด Auto-Tween สังหารอาการ Rubber-banding เวลาเร่งซิม 800X */
            objectsTransitionDuration={0}
            pathsTransitionDuration={0}
            ringsTransitionDuration={0}
            polygonsTransitionDuration={0}
            htmlElementsTransitionDuration={0}

           objectLabel={(d) => {
          if (d.type !== 'satellite') return '';
          const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === d.catnr);
          const flagHtml = satInfo?.flag ? `<img src="https://flagcdn.com/w40/${satInfo.flag}.png" width="20" style="vertical-align: middle; border-radius: 2px; margin-right: 6px; box-shadow: 0 0 4px rgba(255,255,255,0.4);" />` : '🛰️ ';
          
          return `
            <div style="font-variant-numeric: tabular-nums; min-width: 240px; padding: 6px;">
              <strong style="font-size: 12px; display: flex; align-items: center; border-bottom: 1px dashed rgba(0,234,255,0.5); padding-bottom: 6px; margin-bottom: 6px; text-shadow: 0 0 8px var(--cyan); letter-spacing: 1px; font-family: 'Orbitron', sans-serif; white-space: nowrap;">
                ${flagHtml}${satInfo?.displayName || d.name}
              </strong>
              <div style="font-weight: 900; line-height: 1.6; font-size: 11px; letter-spacing: 1px;">
                <div style="display: flex; justify-content: space-between; align-items: center;"><span style="color: var(--cyan);">NORAD:</span> <span style="font-family: 'Orbitron', sans-serif; font-size: 12px; color: #fff;">${d.catnr}</span></div>
                <div style="display: flex; justify-content: space-between; align-items: center;"><span style="color: var(--gold);">ALT:</span> <span style="font-family: 'Orbitron', sans-serif; font-size: 12px; color: #fff;">${Math.round(d.altKm).toLocaleString()} km</span></div>
                <div style="display: flex; justify-content: space-between; align-items: center;"><span style="color: var(--red);">SPD:</span> <span style="font-family: 'Orbitron', sans-serif; font-size: 12px; color: #fff;">${d.speedKmS ? d.speedKmS.toFixed(2) : '--'} km/s</span></div>
                <div style="display: flex; justify-content: space-between; align-items: center;"><span style="color: var(--green);">POS:</span> <span style="font-family: 'Orbitron', sans-serif; font-size: 12px; color: #fff;">${Math.abs(d.lat).toFixed(2)}°${d.lat >= 0 ? 'N' : 'S'} , ${Math.abs(d.lng).toFixed(2)}°${d.lng >= 0 ? 'E' : 'W'}</span></div>
              </div>
            </div>
          `;
        }}

            onObjectClick={(d) => {
              if (d.type === 'satellite') {
                setSelectedCatnr(d.catnr);
                if (!selectedCatnrs.includes(d.catnr)) setSelectedCatnrs([...selectedCatnrs, d.catnr]);
                isTrackingRef.current = true;
                setCameraMode('TRACKING');
                if (globeRef.current) {
                  const camAlt = Math.max(0.4, (d.altKm / EARTH_RADIUS_KM) + 0.5);
                  globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: camAlt }, 1000);
                }
              }
            }}

            htmlElementsData={memoizedHtmlElements}
            htmlLat="lat" htmlLng="lng" htmlAltitude="altitude"
            htmlElement={d => {
              const el = document.createElement('div');
              
             /* 📍 ถ้าเป็นสถานีภาคพื้นดิน (ลบเงื่อนไขดาวเทียมทิ้งไปแล้ว ไม่บั๊กแน่นอน!) */
             if (d.type === 'station') {
              if (stationDisplayMode === 'none') {
                el.innerHTML = ``; 
              } else {
                const showIcon = stationDisplayMode === 'both' || stationDisplayMode === 'icon';
                const showName = stationDisplayMode === 'both' || stationDisplayMode === 'name';
                
                el.innerHTML = `
                <div style="position: relative; display: flex; align-items: center; justify-content: center; pointer-events: none;">
                  ${showIcon ? `<span style="font-size: 18px; line-height: 1; filter: drop-shadow(0 0 10px #00eaff);">📡</span>` : `<span style="width: 18px; height: 18px; display: inline-block;"></span>`}
                  ${showName ? `<span style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%); color: #00eaff; font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 10px; text-shadow: 0 0 8px #000, 0 0 15px #00eaff; margin-top: 2px; letter-spacing: 1.5px; white-space: nowrap;">${d.name}</span>` : ''}
                </div>
              `;
              }
             }
             return el;
            }}

            pathsData={pathsToDraw3D}
            pathPoints="points"
            pathPointLat="lat" pathPointLng="lng" pathPointAlt="alt"
            pathColor="color" pathStroke="stroke"
            pathResolution={4}
            pathTransitionDuration={0}

            pathDashLength={d => d.isSignal ? 0.05 : 0}
            pathDashGap={d => d.isSignal ? 0.05 : 0}
            pathDashAnimateTime={d => d.isSignal ? 1500 : 0}
            
            ringsData={memoizedRings}
            ringColor={() => linkActive ? t => `rgba(255, 170, 0, ${1-t})` : t => `rgba(255, 51, 51, ${1-t})`}
            ringMaxRadius={linkActive ? 8 : 4}
            ringPropagationSpeed={1.5}
            ringRepeatPeriod={800}
        />
      );
    })()}

{isFlatMap && (
        <div className={`flat-map-wrap ${!isRightPanelOpen ? 'panel-closed' : ''} ${!isLeftPanelOpen ? 'left-panel-closed' : ''}`}>
          
          <div 
            className="flat-map-container"
            onWheel={(e) => {
              // 📍 1. คำนวณหาตำแหน่งเมาส์ (เปอรเซ็นต์ X, Y บนแผนที่)
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              
              // 📍 2. อัปเดตการซูมและจุดหมุน
              setTacticalZoom(prev => {
                const newZoom = Math.max(1, Math.min(25, prev + (e.deltaY < 0 ? 1 : -1)));
                // ถ้าถอยกลับมา 1X ให้เซ็ตจุดหมุนไว้ตรงกลางโลก
                if (newZoom === 1) setZoomOrigin('center center');
                // ถ้าเพิ่งเริ่มซูมจาก 1X ให้ล็อกเป้าพุ่งไปที่ปลายเมาส์ชี้!
                else if (prev === 1) setZoomOrigin(`${x}% ${y}%`);
                return newZoom;
              });
            }}
            style={{ backgroundColor: '#000', overflow: 'hidden' }}
          >
            
            {/* 📍 กล่องชั้นใน */}
            <div style={{
              width: '100%', height: '100%',
              transform: `scale(${tacticalZoom})`,
              // 📍 3. ดึงค่า zoomOrigin มาใช้เป็นเป้าหมายการซูม
              transformOrigin: (cameraMode === 'TRACKING' && targetData && !isNaN(targetData.lng)) 
                ? `${(targetData.lng + 180) / 360 * 100}% ${(90 - targetData.lat) / 180 * 100}%` 
                : zoomOrigin,
                transition: 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), filter 0.5s ease-in-out',
                /* 📍 ฟันธง: ดึงรูป 8K จาก Public/textures และทำตารางกริดตาข่าย 20px */
                /* 📍 ฟันธง: ถอด Grid ออกให้หมด โชว์ความสวยงามของภาพแผนที่ล้วนๆ */
              backgroundImage: `url('${runtimeAsset(mapThemes[mapThemeIdx].url)}')`,
              backgroundSize: '100% 100%', /* บังคับภาพให้กางเต็มจอพอดี */
                backgroundPosition: 'center',
                filter: mapThemes[mapThemeIdx].filter
              }}>
              
             {/* 📍 ดึงภาพ Cache แสงเงามาโชว์ (ภาพสวยเหมือนเดิม แต่เบาเครื่อง ลื่นปรึ๊ด 100%) */}
             {dayNightOverlay2D}


             <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-svg">

                  {/* 📍 ฟันธง 1: เส้นนำทาง 2D (สีฟ้า) โชว์เฉพาะตอน "ปิด" Ground Track สีเหลืองเท่านั้น! */}
                  {!showGroundTrack && splitMapPath(guideTrack2DPath).map((segment, index) => (
                    <polyline key={`main-guide-${index}`} points={mapSegmentPoints(segment)} fill="none" stroke="rgba(0,234,255,0.7)" strokeWidth="0.2" strokeDasharray="0.5 1.5" />
                  ))}

                  {/* 📍 ฟันธง 2: Ground Track 24 ชม. (สีเหลืองทอง) โชว์เมื่อ "เปิด" ปุ่มเท่านั้น */}
                  {showGroundTrack && groundTrackPath.map((pathObj, i) => {
                    const segments = [];
                    let currentPoints = [];
                    pathObj.points.forEach((p, idx) => {
                      if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 90) {
                        segments.push(currentPoints);
                        currentPoints = [];
                      }
                      currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                    });
                    if (currentPoints.length > 0) segments.push(currentPoints);
                    return segments.map((seg, j) => (
                      <polyline 
                                key={`gt-${i}-${j}`} 
                                points={seg.join(' ')} 
                                fill="none" 
                                /* 📍 ฟันธง: ลดความสว่างเหลือ 0.35 ให้เส้นโปร่งแสง ไม่แย่งซีนจุดหมายสำคัญ */
                                stroke="rgba(255, 204, 0, 0.35)" 
                                /* 📍 ฟันธง: ลบคำสั่งเส้นประทิ้งไปแล้ว มันจะกลายเป็นเส้นทึบบางๆ อัตโนมัติ */
                                strokeWidth="0.15" 
                              />
                    ));
                  })}

                  {/* วาดเส้นเชื่อมโยง (Line of Sight) ระหว่างสถานีกับดาวเทียม */}
                  {linkActive && targetData && !isNaN(targetData.lat) && !isNaN(targetData.lng) && (
                    <line
                      x1={`${(activeStation.lng + 180) / 360 * 100}`} y1={`${(90 - activeStation.lat) / 180 * 100}`}
                      x2={`${(targetData.lng + 180) / 360 * 100}`} y2={`${(90 - targetData.lat) / 180 * 100}`}
                      stroke="rgba(0, 234, 255, 0.8)" strokeWidth="0.3"
                    />
                  )}

                  {/* วาดรัศมีการมองเห็น (Footprint) ของดาวเทียมทุกดวงที่เลือก */}
                  {footprintBoundaryPath.flatMap((path, pathIndex) => splitMapPath(path.points).map((segment, segmentIndex) => (
                    <polyline key={`fp-${pathIndex}-${segmentIndex}`} points={mapSegmentPoints(segment)}
                      fill="none" stroke={path.color} strokeWidth="0.2" />
                  )))}
                </svg>
              <div className="map-marker" style={{ left: `${(activeStation.lng + 180) / 360 * 100}%`, top: `${(90 - activeStation.lat) / 180 * 100}%`, color: '#00eaff', zIndex: 5 }}>
                {/* 🌟 ฟันธงที่ 1: ลดขนาดอิโมจิจานรับสัญญาณจาก 24px เหลือ 16px */}
                <span style={{ fontSize: '16px', textShadow: '0 0 15px #00eaff', marginBottom: '2px' }}>📡</span>
                {/* 🌟 ฟันธงที่ 2: ลดขนาดป้ายชื่อ GISTDA จาก 10px เหลือ 8px (ขนาดกะทัดรัดไม่กวนแผนที่) */}
                <span className="label" style={{ fontSize: '8px', fontWeight: '900', textShadow: '0 0 8px #00eaff', color: '#00eaff' }}>{activeStation.name}</span>
              </div>

              {allSatObjects.map(sat => {
                const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === sat.catnr);
                const isSecondary = selectedCatnrs.includes(sat.catnr) && !sat.isTarget;

                return (
                <div
                  key={sat.catnr}
                  className="map-marker"
                  style={{
                    left: `${(sat.lng + 180) / 360 * 100}%`,
                    top: `${(90 - sat.lat) / 180 * 100}%`,
                    color: sat.isTarget ? '#ff3333' : isSecondary ? '#ffcc00' : '#00ff66',
                    zIndex: sat.isTarget ? 10 : isSecondary ? 8 : 2
                  }}
                  onClick={() => {
                    setSelectedCatnr(sat.catnr);
                    if (!selectedCatnrs.includes(sat.catnr)) setSelectedCatnrs([...selectedCatnrs, sat.catnr]);
                    isTrackingRef.current = true; 
                    setCameraMode('TRACKING');
                    setIsFlatMap(false); 
                  }}
                  >
                 {/* 📍 ฟันธง: ระบบสมองกลเปลี่ยนไอคอนดาวเทียม 2D อัตโนมัติ (อัปเกรดสเกล Tactical UI) */}
                 {(() => {
                    // 🌟 ฟันธง 1: ใช้รูป THEOS-2-1.webp เป็นภาพตั้งต้นสำหรับดาวเทียมทุกดวง
                    let iconSrc = runtimeAsset('/textures/THEOS-2-1.webp'); 
                    // ขยายขนาดไอคอนดาวเทียม 2D ให้ใหญ่และมองเห็นชัดเจนขึ้น
                    let iconWidth = sat.isTarget ? '60px' : '28px'; 
                    
                    if (sat.catnr === '58016') {
                      iconSrc = runtimeAsset('/textures/THEOS-2.webp');
                      iconWidth = sat.isTarget ? '75px' : '35px'; 
                    } else if (sat.catnr === '33396') {
                      iconSrc = runtimeAsset('/textures/THEOS.webp');
                      iconWidth = sat.isTarget ? '65px' : '30px';
                    }

                    // แสงออร่าบอกสถานะ (แดง=เป้าหลัก, ทอง=เป้ารอง, เขียว=อื่นๆ)
                    const shadowColor = sat.isTarget ? 'rgba(255, 51, 51, 0.95)' : isSecondary ? 'rgba(255, 204, 0, 0.95)' : 'rgba(0, 255, 102, 0.85)';

                    return (
                      <img 
                        src={iconSrc} 
                        alt={sat.name}
                        onError={(e) => handleRuntimeImageError(
                          e,
                          runtimeAsset('/textures/THEOS-2-1.webp')
                        )}
                        style={{ 
                          width: iconWidth, 
                          height: 'auto', 

                          objectFit: 'contain',
                          filter: `drop-shadow(0 0 15px ${shadowColor})`,
                          marginBottom: '6px',
                          transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                          transform: sat.isTarget ? 'rotate(-15deg)' : 'rotate(0deg)'
                        }} 
                      />
                    );
                  })()}

                  <span className="label" style={{ 
                    color: sat.isTarget ? '#ffffff' : isSecondary ? '#ffcc00' : '#00ff66', 
                    fontSize: sat.isTarget ? '13px' : isSecondary ? '12px' : '10px', 
                    opacity: 1, 
                    fontWeight: '900',
                    textShadow: sat.isTarget ? '0 0 10px #ff3333, 0 0 20px #ff3333' : isSecondary ? '0 0 8px #ffcc00, 0 0 15px #000' : '0 0 8px #00ff66, 0 0 15px #000' 
                  }}>
                    {sat.name}
                  </span>
                  
                 {/* 📍 ฟันธง: อัปเกรด 2D Tooltip พร้อมระบบหลบหลีกขอบจอ 4 ทิศทาง (ซ้าย/ขวา/บน/ล่าง) 100% */}
                 {(() => {
                    const pctX = (sat.lng + 180) / 360 * 100;
                    const pctY = (90 - sat.lat) / 180 * 100;
                    
                  // 2. สมองกลตัดสินใจพลิกหน้าต่างหลบขอบจอ
                  let tTop = 'auto', tBottom = '130%', tLeft = '50%', tRight = 'auto', tTransform = 'translateX(-50%)';

                  // 📍 ฟันธง: ขยายระยะเซนเซอร์ขอบบน (pctY) จาก 20% เป็น 35% เพื่อให้พลิกกรอบลงล่างเร็วขึ้น ไม่ทะลุขอบ
                  if (pctY < 35) { 
                    tTop = '130%'; tBottom = 'auto'; tLeft = '50%'; tRight = 'auto'; tTransform = 'translateX(-50%)';
                  } else if (pctX < 15) { 
                    tTop = '50%'; tBottom = 'auto'; tLeft = '130%'; tRight = 'auto'; tTransform = 'translateY(-50%)';
                  } else if (pctX > 85) { 
                    tTop = '50%'; tBottom = 'auto'; tLeft = 'auto'; tRight = '130%'; tTransform = 'translateY(-50%)';
                  }

                  return (
                    <div className="map-tooltip" style={{
                      position: 'absolute',
                      top: tTop, bottom: tBottom, left: tLeft, right: tRight, transform: tTransform,
                      
                      // 🌟 ฟันธง: บีบกล่องให้แคบลงอีก (กว้างสุดแค่ 125px)
                      width: 'clamp(110px, 8vw, 125px)', 
                      // 🌟 ฟันธง: ลดระยะขอบให้แนบเนื้อสุดๆ
                      padding: '4px 6px', 
                      background: 'rgba(0, 15, 30, 0.95)', 
                      border: '1px solid var(--cyan)', 
                      borderRadius: '4px', 
                      boxShadow: '0 2px 10px rgba(0,234,255,0.3)', 
                      fontFamily: 'Rajdhani', 
                      zIndex: 30 
                    }}>
                      
                      {/* Header: ชื่อดาวเทียม */}
                      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px dashed rgba(0,234,255,0.4)', paddingBottom: '3px', marginBottom: '3px' }}>
                        {satInfo?.flag ? (
                          <img src={`https://flagcdn.com/w40/${satInfo.flag}.png`} style={{ width: '10px', borderRadius: '2px', marginRight: '4px', boxShadow: '0 0 3px rgba(255,255,255,0.3)' }} alt="flag" />
                        ) : '🛰️ '}
                        {/* 🌟 ฟันธง: ย่อฟอนต์หัวข้อเหลือไม่เกิน 10px */}
                        <span style={{ fontSize: 'clamp(8px, 0.6vw, 10px)', fontWeight: '900', color: '#fff', fontFamily: 'Orbitron', letterSpacing: '0.5px', textShadow: '0 0 4px var(--cyan)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {satInfo?.displayName || sat.name}
                        </span>
                      </div>

                      {/* Data Rows */}
                      {/* 🌟 ฟันธง: ย่อฟอนต์ข้อมูลเหลือ 8px และลดช่องไฟ (gap) เหลือแค่ 1px */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', fontSize: 'clamp(7px, 0.5vw, 8px)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--cyan)' }}>NORAD:</span>
                          <span style={{ fontFamily: 'Orbitron', color: '#fff' }}>{sat.catnr}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--gold)' }}>ALT:</span>
                          <span style={{ fontFamily: 'Orbitron', color: '#fff' }}>{Math.round(sat.altKm).toLocaleString()} km</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--red)' }}>SPD:</span>
                          <span style={{ fontFamily: 'Orbitron', color: '#fff' }}>{sat.speedKmS ? sat.speedKmS.toFixed(2) : '--'} km/s</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--green)' }}>POS:</span>
                          <span style={{ fontFamily: 'Orbitron', color: '#fff' }}>
                            {Math.abs(sat.lat).toFixed(2)}°{sat.lat >= 0 ? 'N' : 'S'},{Math.abs(sat.lng).toFixed(2)}°{sat.lng >= 0 ? 'E' : 'W'}
                          </span>
                        </div>
                      </div>

                    </div>
                  );

                  })()}
                </div>
              )})}
              
            </div> {/* 📍 ปิดแท็กกล่อง Inner Wrapper */}
          </div>
        </div>
      )}

  </div>

      <div className="ui-layer" ref={mainHudLayerRef}
        data-master-responsive={useAdaptiveHud ? "true" : undefined}
        data-main-fullscreen={isMainFullscreenLayout ? "true" : undefined}
        data-hud-tier={useAdaptiveHud ? hudTier : undefined}
        data-hud-fit={useAdaptiveHud ? hudFit : undefined}
        data-hud-fill={undefined}
        data-wide-tv={undefined}
        data-compact={useAdaptiveHud ? compactHud : undefined}
        data-narrow={pagedHud}
        data-active-hud={narrowHudPanel || "none"}
        style={useAdaptiveHud ? {
          '--sat-hud-panel-width': `${hudPanelWidth}px`,
          '--sat-hud-outer': `${hudOuterPadding}px`,
          '--sat-globe-safe-min': `${globeSafeMin}px`,
          '--sat-viewport-aspect': String(viewportAspect)
        } : undefined}>

     {/* 📍 ฟันธง: ล็อกจุดหมุนการหดตัวมุมซ้ายบน พร้อมชดเชยความสูงที่หดไป (Height Compensation) แก้ปัญหาหลุมดำด้านล่าง */}
     <div className="left-container" style={{ transform: `scale(${uiScale})`, transformOrigin: 'top left', maxHeight: `calc(100% / ${uiScale})`, height: `calc(100% / ${uiScale})` }}>

    {/* 📍 แถวควบคุมหลักด้านบนซ้าย: THA LOCAL + DOY */}
    <div style={{ display: 'flex', width: '100%', gap: '15px', alignItems: 'flex-start', pointerEvents: 'none', marginBottom: '15px', zIndex: 100, flexShrink: 0 }}>
           <button 
             className="menu-toggle-btn-left"
             onClick={toggleLeftPanel}
             style={{ pointerEvents: 'auto', marginBottom: 0 }}
           >
             {pagedHud ? (narrowHudPanel === 'left' ? '✕' : '☰') : (isLeftPanelOpen ? '✕' : '☰')}
           </button>

           <div className="global-clock-hud" style={{ margin: 0, flex: 1, padding: '10px 15px' }}>
             <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
               
               <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                 <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', fontWeight: '900', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>THA LOCAL</span>
                 {/* 📍 ฟันธง: ขยายกล่องหุ้มตัวเลขเป็น 0.85em และโคลอน 0.4em ให้ถ่างออกโปร่งสบายตา */}
                 <strong style={{ display: 'flex', fontFamily: 'Orbitron', fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: '900', color: 'var(--red)', lineHeight: '1.1' }}>
                    {formatTime(thaiTime).split('').map((char, i) => (
                      <span key={i} style={{ display: 'inline-block', width: char === ':' ? '0.4em' : '0.85em', textAlign: 'center' }}>{char}</span>
                    ))}
                 </strong>
               </div>

               <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                 <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', fontWeight: '900', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>DAY OF YEAR</span>
                 {/* 📍 ฟันธง: ขยายกล่องหุ้มตัวเลข DAY OF YEAR เป็น 0.85em */}
                 <strong style={{ display: 'flex', fontFamily: 'Orbitron', fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: '900', color: 'var(--gold)', lineHeight: '1.1' }}>
                    {pad3(getUtcDayOfYear(currentDate)).split('').map((char, i) => (
                      <span key={i} style={{ display: 'inline-block', width: '0.85em', textAlign: 'center' }}>{char}</span>
                    ))}
                 </strong>
               </div>

             </div>
           </div>
         </div>
          
          {/* 📍 ปลดล็อก Scrollbar ให้แผงซ้าย */}
          {isLeftPanelOpen && (
          <div className="left-panel" style={{ width: '100%', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}><SatHudPages active={pagedHud} labels={["SATELLITE", "ANTENNA", "WEATHER"]}>

            <div className="panel-box mission-status">
              {/* 📍 ฟันธง: ขยายธงชาติให้กว้างขึ้น และขยายฟอนต์ชื่อดาวเทียมให้ใหญ่อลังการ */}
              <div className="target-header" style={{ display: 'flex', gap: '12px', paddingBottom: '10px', marginBottom: '10px', justifyContent: 'center', alignItems: 'center' }}>
                {targetConfig.flag ? <img src={`https://flagcdn.com/w80/${targetConfig.flag}.png`} alt="flag" style={{ width: 'clamp(45px, 4.5vw, 60px)', borderRadius: '4px', border: '2px solid var(--cyan)', boxShadow: '0 0 15px rgba(0,234,255,0.4)' }} /> : <span style={{fontSize: 'clamp(35px, 4vw, 50px)', filter: 'drop-shadow(0 0 10px var(--cyan))'}}>🛰️</span>}
                <h2 style={{ fontSize: 'clamp(20px, 2.2vw, 26px)', textShadow: '0 0 15px rgba(255,255,255,0.6)', letterSpacing: '2px', whiteSpace: 'nowrap', margin: 0 }}>{targetConfig.displayName}</h2>
              </div>

              <style>{`
                @keyframes pulse-glow {
                  0% { box-shadow: 0 0 15px rgba(0, 234, 255, 0.4), inset 0 0 10px rgba(0, 234, 255, 0.2); }
                  50% { box-shadow: 0 0 30px rgba(0, 234, 255, 1), inset 0 0 20px rgba(0, 234, 255, 0.8); }
                  100% { box-shadow: 0 0 15px rgba(0, 234, 255, 0.4), inset 0 0 10px rgba(0, 234, 255, 0.2); }
                }
                .status-banner.active { animation: pulse-glow 2s infinite ease-in-out; }
              `}</style>

             {/* 📍 ฟันธง: กรอบเวลานับถอยหลัง - ปิดแสงแฟลร์, แยกกล่องตัวเลขแบบ Fixed Width ป้องกันการดิ้นซ้ายขวา 100% */}
             <div className={`status-banner ${rfState.locked ? 'active' : 'standby'}`} style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '12px 10px', textAlign: 'center', borderRadius: '8px', marginBottom: '12px', border: `1px solid ${rfState.color}`, backgroundColor: 'rgba(0,0,0,0.2)' }}>
              {linkActive ? (
              <>
                <span style={{ fontSize: 'clamp(11px, 1.1vw, 14px)', fontWeight: '900', color: 'rgba(255,255,255,0.9)', letterSpacing: '1.5px' }}>{rfState.locked ? 'RF LOCKED (SIM)' : 'ACQUIRING (SIM)'}</span>
                <span style={{ display: 'flex', justifyContent: 'center', fontSize: 'clamp(22px, 2.5vw, 32px)', fontFamily: 'Orbitron', fontWeight: '900', color: rfState.locked ? 'var(--green)' : 'var(--gold)', textShadow: 'none', margin: '4px 0', lineHeight: 1 }}>
                  {(() => {
                    const activePass = passSchedule.find(p => simulatedTimeMs >= p.aosTime && simulatedTimeMs <= p.losTime);
                    if (activePass) {
                      const diffMs = activePass.losTime - simulatedTimeMs;
                      const mins = Math.floor(diffMs / 60000);
                      const secs = Math.floor((diffMs % 60000) / 1000);
                      const timeStr = `- ${pad2(mins)}m ${pad2(secs)}s`;
                      return timeStr.split('').map((char, i) => {
                        let w = '0.85em'; // ความกว้างตัวเลข
                        if (char === 'm' || char === 's') w = '1.1em'; // ความกว้างตัวอักษร
                        if (char === ' ' || char === '-') w = '0.5em'; // ความกว้างช่องว่าง
                        return <span key={i} style={{ display: 'inline-block', width: w, textAlign: 'center' }}>{char}</span>;
                      });
                    }
                    return "TRACKING...";
                  })()}
                </span>
                <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'var(--green)', letterSpacing: '1px', fontWeight: 'bold' }}>TIME TO LOS (END OF PASS)</span>
              </>
                ) : nextPassTimestamp && nextPassTimestamp.time && (nextPassTimestamp.time > simulatedTimeMs) ? (
                   <>
                     <span style={{ fontSize: 'clamp(11px, 1.1vw, 14px)', color: 'rgba(255, 255, 255, 0.8)', letterSpacing: '1.5px', fontWeight: 'bold' }}>NEXT PASS (AOS) IN</span>
                     <span style={{ display: 'flex', justifyContent: 'center', fontSize: 'clamp(22px, 2.5vw, 32px)', fontFamily: 'Orbitron', fontWeight: '900', color: 'var(--gold)', textShadow: 'none', margin: '4px 0', lineHeight: 1 }}>
                       {(() => {
                         const diffMs = nextPassTimestamp.time - simulatedTimeMs;
                         const hrs = Math.floor(diffMs / 3600000);
                         const mins = Math.floor((diffMs % 3600000) / 60000);
                         const secs = Math.floor((diffMs % 60000) / 1000);
                         const timeStr = `- ${pad2(hrs)}h ${pad2(mins)}m ${pad2(secs)}s`;
                         return timeStr.split('').map((char, i) => {
                            let w = '0.85em'; // ความกว้างตัวเลข
                            if (char === 'h' || char === 'm' || char === 's') w = '1.1em'; // ความกว้างตัวอักษร
                            if (char === ' ' || char === '-') w = '0.5em'; // ความกว้างช่องว่าง
                            return <span key={i} style={{ display: 'inline-block', width: w, textAlign: 'center' }}>{char}</span>;
                         });
                       })()}
                     </span>
                     <span style={{ fontSize: 'clamp(11px, 1.1vw, 14px)', color: 'rgba(255, 255, 255, 0.95)', fontWeight: 'bold', letterSpacing: '1px' }}>EXPECTED MAX EL: <strong style={{color: 'var(--cyan)', fontSize: 'clamp(18px, 2.2vw, 26px)', textShadow: 'none', marginLeft: '10px'}}>{nextPassTimestamp.maxEl.toFixed(1)}°</strong></span>
                   </>
                ) : (
                   <span style={{ fontSize: 'clamp(11px, 1.1vw, 14px)', fontWeight: 'bold', letterSpacing: '2px' }}>NO UPCOMING PASS</span>
                )}
              </div>

              {/* 📍 ฟันธง: ลบ textShadow ของตัวเลขในกล่อง Telemetry ออกทั้งหมดให้คมชัด */}
              <div className="telemetry-grid">
                <div className="t-box"><span>LATITUDE</span><strong style={{ color: '#33ccff', textShadow: 'none' }}>{targetData && !isNaN(targetData.lat) ? targetData.lat.toFixed(4) : '---'}°</strong></div>
                <div className="t-box"><span>LONGITUDE</span><strong style={{ color: '#33ccff', textShadow: 'none' }}>{targetData && !isNaN(targetData.lng) ? targetData.lng.toFixed(4) : '---'}°</strong></div>
                <div className={`t-box ${linkActive ? 'highlight' : ''}`}><span>ELEVATION</span><strong style={{ color: 'var(--green)', textShadow: 'none' }}>{targetData && !isNaN(targetData.elevationDeg) ? targetData.elevationDeg.toFixed(2) : '---'}°</strong></div>
                <div className="t-box"><span>AZIMUTH</span><strong style={{ color: 'var(--green)', textShadow: 'none' }}>{targetData && !isNaN(targetData.azimuthDeg) ? targetData.azimuthDeg.toFixed(2) : '---'}°</strong></div>
                <div className="t-box"><span>SLANT RANGE</span><strong style={{ color: 'var(--gold)', textShadow: 'none' }}>{targetData && !isNaN(targetData.rangeKm) ? Math.round(targetData.rangeKm).toLocaleString() : '---'} km</strong></div>
                <div className="t-box"><span>ALTITUDE</span><strong style={{ color: 'var(--gold)', textShadow: 'none' }}>{targetData && !isNaN(targetData.altKm) ? targetData.altKm.toFixed(0) : '---'} km</strong></div>
                <div className="t-box"><span>ORBITAL SPEED</span><strong style={{ color: '#ff6600', textShadow: 'none' }}>{targetData && !isNaN(targetData.speedKmS) ? targetData.speedKmS.toFixed(2) : '---'} km/s</strong></div>
                <div className="t-box"><span>INCLINATION</span><strong style={{ color: '#ff6600', textShadow: 'none' }}>{tles[selectedCatnr] ? getInclinationDeg(tles[selectedCatnr].line2).toFixed(4) : '---'}°</strong></div>
              </div>

              <ul className="info-list">
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Operator / Agency:</span><strong style={{ color: '#e2e8f0', textAlign: 'right' }}>{targetConfig.operator || 'Unknown'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Mission Type:</span><strong style={{ color: '#e2e8f0', textAlign: 'right' }}>{targetConfig.mission || 'Various'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Orbit Class:</span><strong style={{ color: 'var(--gold)', textAlign: 'right' }}>{targetData?.altKm > 2000 ? (targetData?.altKm > 30000 ? 'GEO' : 'MEO') : 'LEO'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Station Mask:</span><strong style={{ color: 'var(--green)', textShadow: '0 0 5px rgba(0, 255, 102, 0.4)', textAlign: 'right' }}>{stationMask.toFixed(1)}°</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Footprint Radius:</span><strong style={{ color: 'var(--green)', textShadow: '0 0 5px rgba(0, 255, 102, 0.4)', textAlign: 'right' }}>{targetData && !isNaN(targetData.altKm) ? Math.round(getFootprintRadiusDeg(targetData.altKm, stationMask) * (Math.PI / 180) * EARTH_RADIUS_KM).toLocaleString() : '---'} km</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Telemetry (TT&C):</span><strong style={{ color: 'var(--cyan)', textShadow: '0 0 5px rgba(0, 234, 255, 0.4)', textAlign: 'right' }}>{targetConfig.telemetry || 'N/A'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Payload Downlink:</span><strong style={{ color: 'var(--cyan)', textShadow: '0 0 5px rgba(0, 234, 255, 0.4)', textAlign: 'right' }}>{targetConfig.payload || 'N/A'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Epoch:</span><strong style={{ color: '#4ade80', fontWeight: '900', textAlign: 'right', textShadow: '0 0 8px rgba(74, 222, 128, 0.4)' }}>{tles[selectedCatnr] ? tles[selectedCatnr].line1.substring(18, 32) : '---'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Last TLE Sync:</span><strong title={`${tleUpdatedLabel} · ${tleUpdateAgeLabel}`} style={{ color: tleUpdatedAtMs ? 'var(--green)' : 'var(--gold)', fontWeight: '900', textAlign: 'right', fontSize: 'clamp(10px,0.82vw,12px)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tleLastSyncTimeLabel} · {tleCompactAgeLabel}</strong></li>
                <li className="sat-hud-tle-row">
                  <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Source:</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flex: '1 1 auto', minWidth: 0 }}>
                    <strong className="sat-tle-source" title={`Selected TLE epoch: ${selectedTleEpochMs === null ? 'N/A' : new Date(selectedTleEpochMs).toISOString()} | Offset from ${clockMode} time: ${selectedTleAgeDays === null ? 'N/A' : selectedTleAgeDays.toFixed(2) + ' days'} | Last batch operation: ${tleSource}`} style={{ 
                      /* Wrap the full source/status text and reserve fixed space for SYNC TLE. */
                      color: !selectedTlePair || tleSource.includes('Failed') ? 'var(--red)' : (selectedTleMatchesBuiltin || selectedTleIsStale ? 'var(--gold)' : 'var(--green)'), 
                      fontWeight: '900', textAlign: 'right', textShadow: 'none', flex: '1 1 auto', minWidth: 0,
                      fontSize: 'clamp(11px, 0.9vw, 13px)', whiteSpace: 'normal', overflow: 'visible', textOverflow: 'clip', lineHeight: 1.25
                    }}>
                      {selectedTleSourceLabel} • {tleSyncStatusLabel}{selectedTleIsStale ? ` • ${clockMode === 'LIVE' ? 'STALE' : 'EPOCH OFFSET'} ${Math.floor(selectedTleAgeDays)}d` : ''}
                    </strong>
                    {/* 📍 ฟันธง: กู้คืนปุ่ม SYNC TLE กลับมาแล้ว! */}
                    <button 
                      onClick={handleAutoUpdateTle} 
                      disabled={isUpdatingTle}
                      style={{ 
                        background: 'rgba(0, 234, 255, 0.1)', border: '1px solid var(--cyan)', color: 'var(--cyan)', 
                        padding: '4px 6px', borderRadius: '4px', cursor: isUpdatingTle ? 'wait' : 'pointer', 
                        fontSize: '10px', fontFamily: 'Orbitron', fontWeight: 'bold', letterSpacing: '0.7px',
                        opacity: isUpdatingTle ? 0.5 : 1, transition: 'all 0.2s', boxShadow: '0 0 5px rgba(0,234,255,0.2)',
                        whiteSpace: 'nowrap', flex: '0 0 76px', minWidth: '76px', lineHeight: 1.05
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.background = 'var(--cyan)'; e.currentTarget.style.color = '#000'; }}
                      onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(0, 234, 255, 0.1)'; e.currentTarget.style.color = 'var(--cyan)'; }}
                    >
                      {isUpdatingTle ? 'SYNCING...' : 'SYNC TLE'}
                    </button>
                  </div>
                </li>
              </ul>

              {isMainFullscreenLayout && (
                <div className="sat-hud-engineering">
                  <div className="sat-hud-engineering-title">ORBIT / RF ENGINEERING</div>
                  <div className="sat-hud-engineering-grid">
                    {[
                      ['NORAD ID', engineeringData.noradId, false],
                      ['COSPAR ID', engineeringData.cosparId, false],
                      ['APOGEE', Number.isFinite(engineeringData.apogeeKm) ? `${Math.round(engineeringData.apogeeKm).toLocaleString()} km` : '—', false],
                      ['PERIGEE', Number.isFinite(engineeringData.perigeeKm) ? `${Math.round(engineeringData.perigeeKm).toLocaleString()} km` : '—', false],
                      ['ORBITAL PERIOD', Number.isFinite(engineeringData.periodMin) ? `${engineeringData.periodMin.toFixed(2)} min` : '—', false],
                      ['RANGE RATE', Number.isFinite(engineeringData.rangeRateKmS) ? `${formatSigned(engineeringData.rangeRateKmS, 2)} km/s` : '—', false],
                      ['S DOPPLER', Number.isFinite(engineeringData.sDopplerKhz) ? `${formatSigned(engineeringData.sDopplerKhz, 1)} kHz` : '—', true],
                      ['X DOPPLER', Number.isFinite(engineeringData.xDopplerKhz) ? `${formatSigned(engineeringData.xDopplerKhz, 1)} kHz` : '—', true]
                    ].map(([label, value, rf]) => (
                      <div key={label} className="sat-hud-engineering-item" data-rf={rf ? 'true' : undefined} title={label === 'RANGE RATE' ? 'Negative = approaching station; positive = receding' : label.includes('DOPPLER') ? 'Calculated from station-relative range rate and configured downlink carrier' : undefined}>
                        <span>{label}</span><strong>{value}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
        {/* 📍 ANTENNA TELEMETRY - ย้ายมาไว้ฝั่งซ้ายเหนือ LOCAL WEATHER ตาม Mission/Tracking Status */}
        {/* 📍 คง Logic, สี, ขนาด, AZ/EL, TRACKING/STANDBY และ 3D SIMULATOR เดิมทั้งหมด */}
              <div className="panel-box sat-hud-antenna" style={{ padding: '8px 12px', background: 'linear-gradient(145deg, rgba(0, 25, 15, 0.85), rgba(0, 10, 5, 0.95))', border: '1px solid var(--green)', marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', borderBottom: '1px dashed rgba(0,255,102,0.3)', paddingBottom: '4px', gap: '4px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'var(--green)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap' }}>ANTENNA TELEMETRY</span>
                <span className={`status-badge ${linkActive ? 'live' : 'sim'}`} style={{ fontSize: 'clamp(9px, 0.9vw, 11px)', color: linkActive ? 'var(--green)' : 'var(--gold)', fontFamily: 'Orbitron', fontWeight: '900', padding: '2px 6px', background: linkActive ? 'rgba(0,255,102,0.1)' : 'rgba(255,204,0,0.1)', borderRadius: '4px', border: `1px solid ${linkActive ? 'var(--green)' : 'var(--gold)'}`, margin: 0 }}>
                  {antennaState.mode}
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                
               {/* ค่าองศาจานรับสัญญาณ (จำลองการทำงานจานจริง: นิ่งตอน Standby, หมุนตอน Tracking) */}
               <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(10px, 1vw, 11px)', color: 'rgba(255,255,255,0.6)', fontFamily: 'Orbitron', letterSpacing: '1px' }}>AZIMUTH</span>
                    <strong style={{ fontSize: 'clamp(14px, 1.4vw, 18px)', color: linkActive ? 'var(--cyan)' : 'rgba(255,255,255,0.3)', fontFamily: 'Orbitron', textShadow: 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {/* Shared simulated joint angle; STOW AZ = 0°. */}
                      {antennaState.az.toFixed(2).padStart(6, '0')}°
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(10px, 1vw, 11px)', color: 'rgba(255,255,255,0.6)', fontFamily: 'Orbitron', letterSpacing: '1px' }}>ELEVATION</span>
                    <strong style={{ fontSize: 'clamp(14px, 1.4vw, 18px)', color: linkActive ? 'var(--green)' : 'rgba(255,255,255,0.3)', fontFamily: 'Orbitron', textShadow: 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {/* Shared simulated joint angle; STOW EL = 90°. */}
                      {antennaState.el.toFixed(2).padStart(5, '0')}°
                    </strong>
                  </div>
                </div>
                
               {/* 📡 INTERNAL VECTOR ANTENNA 3D SIMULATOR */}
<button
  onClick={() => { toggleToolVisibility('antenna3d', false); }}
  style={{
    flex: '0 0 auto',
    background: 'linear-gradient(135deg, rgba(0,255,102,0.15) 0%, rgba(0,0,0,0.8) 100%)',
    border: '1px solid var(--green)',
    color: 'var(--green)',
    padding: '5px 9px',
    borderRadius: '6px',
    fontFamily: 'Rajdhani',
    fontSize: 'clamp(10px, 0.95vw, 12px)',
    fontWeight: '900',
    letterSpacing: '1px',
    cursor: 'pointer',
    opacity: 1,
    transition: 'all 0.3s ease',
    boxShadow: '0 0 10px rgba(0,255,102,0.1)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: '1.15',
    minWidth: '92px'
  }}
>
  <span style={{ fontSize: '15px', filter: 'none', textShadow: 'none' }}>📡</span>
  <span>3D SIMULATOR</span>
</button>
                
              </div>
            </div>
        {/* ☁️ CLOUD COVER FORECAST HUD */}
        <div className="panel-box sat-hud-weather" role="button" tabIndex={0} title="Open Weather Center" onClick={() => { toggleToolVisibility('weather', false); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { toggleToolVisibility('weather', false); } }} style={{ padding: '12px 15px', background: 'linear-gradient(145deg, rgba(0, 20, 35, 0.85), rgba(0, 5, 15, 0.95))', border: '1px solid var(--cyan)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px dashed rgba(0,234,255,0.3)', paddingBottom: '6px', gap: '4px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'var(--cyan)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>LOCAL WEATHER (METEO)</span>
                <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'var(--gold)', fontFamily: 'Orbitron', fontWeight: '900', whiteSpace: 'nowrap', flexShrink: 0, padding: '2px 6px', background: 'rgba(255,204,0,0.1)', borderRadius: '4px', border: '1px solid rgba(255,204,0,0.4)', boxShadow: '0 0 8px rgba(255,204,0,0.2)' }}>{activeStation.id} STATION ›</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                
                {/* 📍 ปรับขนาดกล่องไอคอนให้สมดุล */}
                <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', width: 'clamp(45px, 4.5vw, 60px)', height: 'clamp(45px, 4.5vw, 60px)', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)' }}>
                  {cloudCover === null ? (
                    <HudWeatherIcon kind="unknown" />
                  ) : cloudCover <= 30 ? (
                    <HudWeatherIcon kind="clear" />
                  ) : cloudCover <= 70 ? (
                    <HudWeatherIcon kind="partly" />
                  ) : (
                    <HudWeatherIcon kind="overcast" />
                  )}
                </div>

                <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                  <div style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'rgba(255,255,255,0.7)', fontFamily: 'Rajdhani', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>CLOUD COVER / VISIBILITY</div>
                  <div style={{ fontSize: 'clamp(12px, 1.2vw, 16px)', fontFamily: 'Orbitron', fontWeight: '900', color: cloudCover === null ? '#fff' : (cloudCover <= 30 ? 'var(--green)' : (cloudCover <= 70 ? 'var(--gold)' : '#ffffff')), lineHeight: '1.2', textShadow: (cloudCover === null || cloudCover > 70) ? 'none' : `0 0 8px ${cloudCover <= 30 ? 'rgba(0,255,102,0.6)' : 'rgba(255,204,0,0.6)'}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cloudCover === null ? (cloudDataMode === 'OFFLINE' ? 'WEATHER OFFLINE' : 'ANALYZING...') : `${cloudDataMode === 'LIVE' ? 'LIVE • ' : ''}${cloudCover <= 30 ? 'CLEAR (OPTICAL OK)' : (cloudCover <= 70 ? 'PARTLY CLOUDY' : 'OVERCAST (DEGRADED)')}`}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: '5px' }}>
                  {/* 📍 ฟันธง: ลบ textShadow ของตัวเลขเปอร์เซ็นต์เมฆออก */}
                  <div style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontFamily: 'Orbitron', fontWeight: '900', color: cloudCover === null ? '#fff' : (cloudCover <= 30 ? 'var(--green)' : (cloudCover <= 70 ? 'var(--gold)' : '#ffffff')), textShadow: 'none', lineHeight: '1' }}>
                    {isFetchingCloud ? '--' : (cloudCover === null ? '--' : `${cloudCover}%`)}
                  </div>
                </div>
              </div>
            </div>

          </SatHudPages></div>
          )}
        </div>

      {/* 📍 ฟันธง: ล็อกจุดหมุนการหดตัวมุมขวาบน พร้อมชดเชยความสูงที่หดไป (Height Compensation) แก้ปัญหาหลุมดำด้านล่าง */}
      <div className="right-container" style={{ transform: `scale(${uiScale})`, transformOrigin: 'top right', maxHeight: `calc(100% / ${uiScale})`, height: `calc(100% / ${uiScale})` }}>
          
      {/* 📍 แถวควบคุมหลักด้านบนขวา: ZONE + UTC TIME (สมมาตรกับฝั่งซ้ายเป๊ะ) */}
      <div style={{ display: 'flex', width: '100%', gap: '15px', alignItems: 'flex-start', pointerEvents: 'none', marginBottom: '15px', zIndex: 100, flexShrink: 0, flexDirection: 'row-reverse' }}>
            <button 
              className="menu-toggle-btn"
              onClick={toggleRightPanel}
              style={{ pointerEvents: 'auto', marginBottom: 0 }}
            >
              {pagedHud ? (narrowHudPanel === 'right' ? '✕' : '☰') : (isRightPanelOpen ? '✕' : '☰')}
            </button>

            <div className="global-clock-hud" style={{ margin: 0, flex: 1, padding: '10px 15px' }}>
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', fontWeight: '900', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>TIMEZONE</span>
                  <strong style={{ fontFamily: 'Orbitron', fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: '900', color: 'var(--cyan)', lineHeight: '1.1', letterSpacing: '3px' }}>UTC</strong>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'rgba(255, 255, 255, 0.6)', fontWeight: '900', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '2px' }}>UNIVERSAL TIME</span>
                  {/* 📍 ฟันธง: ขยายกล่องหุ้มตัวเลขเป็น 0.85em และโคลอน 0.4em เพื่อความสมดุล */}
                  <strong style={{ display: 'flex', fontFamily: 'Orbitron', fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: '900', color: 'var(--cyan)', lineHeight: '1.1' }}>
                    {formatTime(currentDate).split('').map((char, i) => (
                      <span key={i} style={{ display: 'inline-block', width: char === ':' ? '0.4em' : '0.85em', textAlign: 'center' }}>{char}</span>
                    ))}
                  </strong>
                </div>

              </div>
            </div>
          </div>
          
          {isRightPanelOpen && (
           <div className="right-panel"><SatHudPages active={pagedHud} labels={["TIME", "VIEW", "TOOLS", "STATUS", "ABOUT"]}>
              
     {/* กลุ่มที่ 1: การควบคุมเวลาและความเร็ว */}
     <div className="control-group sat-hud-time">
        {/* 📍 ฟันธง: ลบ <p>TIME & PLAYBACK</p> ทิ้งไปเลย พื้นที่จะโปร่งขึ้นทันที */}
        
        {(() => {
          // 📍 ฟันธง: สมองกลล็อกการจำลองเวลา (SIM Lock)
                // จะล็อกก็ต่อเมื่อ "เวลาคือ LIVE + มีสัญญาณดาวเทียมเข้าจริงๆ" (ห้ามกด SIM ข้ามเวลา!)
                const isRealtimePassLock = clockMode === 'LIVE' && speedMult === 1 && isPlaying && linkActive;

                // Seasonal validation: jump only the simulation clock.
                // Freeze playback so screenshots are repeatable and keep the existing orbit/day-night engines untouched.
                const validationYear = new Date(simulatedTimeMs).getUTCFullYear();
                const jumpToValidationDate = (key, monthIndex, day) => {
                  setValidationMode(key);
                  setIsAutoPilot(false);
                  setIsPlaying(false);
                  setSpeedMult(1);
                  setSliderMode('DAILY');
                  setRealtimeSun(true);
                  setSimulatedTimeMs(Date.UTC(validationYear, monthIndex, day, 12, 0, 0));
                };
                const returnToLiveValidation = () => {
                  setValidationMode(null);
                  setSpeedMult(1);
                  setSliderMode('DAILY');
                  setRealtimeSun(true);
                  setSimulatedTimeMs(Date.now());
                  setClockMode('LIVE');
                  setIsAutoPilot(false);
                  setIsPlaying(true);
                };

                return (
                  <>
                  {/* 📍 ฟันธง: ปุ่ม AUTO-EARTH เปลี่ยนเป็นสี Sci-Fi (อิงตามตัวแปร --cyan) และเปลี่ยนสีตาม Theme อัตโนมัติ */}
                  <button 
                     onClick={() => {
                      const nextState = !isAutoPilot;
                      setIsAutoPilot(nextState);
                      // AUTO-EARTH is camera-only. Do not touch simulation time,
                      // playback state, pass selection, or any popup/tool window.
                      if (nextState) {
                        setCameraMode('FREE LOOK');
                        isTrackingRef.current = false;
                      }
                     }}
                     disabled={isRealtimePassLock}
                     style={{ 
                       width: '100%', marginBottom: '12px', padding: '12px', 
                       fontSize: 'clamp(15px, 1.5vw, 19px)', fontFamily: 'Orbitron', fontWeight: '900', letterSpacing: '2px', 
                       borderRadius: '6px', cursor: isRealtimePassLock ? 'not-allowed' : 'pointer', transition: 'all 0.3s', 
                       background: isAutoPilot ? 'linear-gradient(90deg, var(--cyan), var(--green))' : 'rgba(0, 234, 255, 0.08)', 
                       color: isAutoPilot ? '#000' : 'var(--cyan)', 
                       border: '2px solid var(--cyan)', 
                       boxShadow: isAutoPilot ? '0 0 25px var(--cyan)' : 'inset 0 0 10px rgba(0, 234, 255, 0.2)', 
                       opacity: isRealtimePassLock ? 0.3 : 1 
                     }}
                   >
                      {isAutoPilot ? 'AUTO-EARTH: ACTIVE' : 'AUTO-EARTH: OFF'}
                    </button>

                    <div className="speed-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', marginTop: '16px' }}>
                      {[1, 10, 60, 120, 600, 1200].map(s => (
                        <button key={s} disabled={isRealtimePassLock} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0, opacity: isRealtimePassLock ? 0.3 : 1, cursor: isRealtimePassLock ? 'not-allowed' : 'pointer'}} onClick={() => { setClockMode('SIM'); setIsAutoPilot(false); setSpeedMult(s); setIsPlaying(true); }}>{s}X</button>
                      ))}
                    </div>

                   {/* 📍 ฟันธง: ยุบรวม LIVE, RESET และ MODE เป็น Grid 3 คอลัมน์ ลดความอ้วนของปุ่มและประหยัดพื้นที่แนวตั้ง! */}
                   <div className="sat-hud-transport" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: 'clamp(10px, 1.5vh, 15px)', height: 'clamp(35px, 4.5vh, 45px)' }}>
                      {(() => {
                        const isLive = clockMode === 'LIVE' && speedMult === 1 && isPlaying;
                        return (
                          <div className={`status-badge ${isLive ? 'live' : 'sim'}`} style={{ margin: 0, padding: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '4px', fontSize: 'clamp(11px, 1.1vw, 14px)', letterSpacing: '1px', background: isRealtimePassLock ? 'rgba(0, 255, 102, 0.2)' : '', borderColor: isRealtimePassLock ? 'var(--green)' : '', color: isRealtimePassLock ? 'var(--green)' : '', boxShadow: isRealtimePassLock ? 'inset 0 0 10px rgba(0, 255, 102, 0.3)' : '' }}>
                            {isRealtimePassLock ? '🟢 REAL-TIME' : (isLive ? '🟢 LIVE' : clockMode === 'DEMO' ? '🟠 DEMO' : '🟠 SIM')}
                          </div>
                        );
                      })()}
                      
                      <button className="btn" style={{ margin: 0, padding: '0', fontSize: 'clamp(11px, 1.1vw, 14px)', letterSpacing: '1.5px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => {
                        setValidationMode(null); setSimulatedTimeMs(Date.now()); setClockMode('LIVE'); setSpeedMult(1); setIsPlaying(true); isTrackingRef.current = false; setCameraMode('FREE LOOK');
                        setSelectedPlanId(null); setMapZoom(1); setImgMapOrigin('center center'); setTacticalZoom(1); setZoomOrigin('center center');
                        setIsAutoPilot(false);
                        
                        // 📍 ฟันธง: ล็อกเป้าบังคับกลับมาที่พระเอก THEOS-2 (58016) เสมอ!
                        setSelectedCatnr('58016');
                        setSelectedCatnrs(['58016']);
                        
                        // 📍 ฟันธง: บังคับสถานีภาคพื้นดินกลับมาที่ SRC (ลำดับที่ 0 ใน GS_NETWORK)
                        setActiveStation(GS_NETWORK[0]);

                        if (globeRef.current) {
                          globeRef.current.controls().autoRotate = false;
                          // 📍 ฟันธง: บังคับกล้องโลก 3D บินกลับมาที่พิกัดไทย (SRC) ทันที
                          globeRef.current.pointOfView({ lat: GS_NETWORK[0].lat, lng: GS_NETWORK[0].lng, altitude: 2.2 }, 1000);
                        }
                      }}>RESET</button>

                      <button onClick={() => setSliderMode(sliderMode === 'DAILY' ? 'PASS' : 'DAILY')} disabled={isRealtimePassLock} style={{ margin: 0, padding: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', background: sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.1)' : 'rgba(255, 204, 0, 0.15)', border: `1px solid ${sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'}`, color: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', borderRadius: '4px', fontSize: 'clamp(10px, 1vw, 13px)', cursor: isRealtimePassLock ? 'not-allowed' : 'pointer', fontFamily: 'Orbitron', fontWeight: '900', letterSpacing: '1px', transition: 'all 0.3s', boxShadow: `0 0 10px ${sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.2)' : 'rgba(255, 204, 0, 0.3)'}`, opacity: isRealtimePassLock ? 0.3 : 1 }}>
                        MODE: {sliderMode === 'DAILY' ? '24H' : 'PASS'}
                      </button>
                    </div>

                    {/* 📍 ฟันธง: เส้นประคั่นและตัวเลขบอกเวลาหัวท้ายแนบชิด Slider สวยงามสะอาดตา */}
                    <div className="time-scrubber-container" style={{ marginTop: 'clamp(10px, 1.5vh, 15px)', paddingTop: 'clamp(10px, 1.5vh, 15px)' }}>
                      <div className="scrubber-labels" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'clamp(4px, 0.8vh, 8px)' }}>
                        <span style={{ textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(10px, 1vw, 13px)', fontFamily: 'Orbitron', fontWeight: 'bold', letterSpacing: '1px' }}>{sliderMode === 'DAILY' ? '00:00 UTC' : 'AOS -5m'}</span>
                        <span style={{ textAlign: 'right', color: 'rgba(255,255,255,0.6)', fontSize: 'clamp(10px, 1vw, 13px)', fontFamily: 'Orbitron', fontWeight: 'bold', letterSpacing: '1px' }}>{sliderMode === 'DAILY' ? '23:59 UTC' : 'LOS +5m'}</span>
                      </div>
                      
                      {(() => {
                        const currentSimDate = new Date(simulatedTimeMs);
                        let minTime = Date.UTC(currentSimDate.getUTCFullYear(), currentSimDate.getUTCMonth(), currentSimDate.getUTCDate(), 0, 0, 0);
                        let maxTime = minTime + 86400000 - 1; 

                        if (sliderMode === 'PASS' && passSchedule.length > 0) {
                          let targetPass = passSchedule.find(p => simulatedTimeMs >= p.aosTime - 300000 && simulatedTimeMs <= p.losTime + 300000);
                          if (!targetPass) targetPass = passSchedule.reduce((prev, curr) => Math.abs(curr.peakTime - simulatedTimeMs) < Math.abs(prev.peakTime - simulatedTimeMs) ? curr : prev);
                          if (targetPass) { minTime = targetPass.aosTime - 300000; maxTime = targetPass.losTime + 300000; }
                        }
                        const progressPct = ((simulatedTimeMs - minTime) / (maxTime - minTime)) * 100;

                        return (
                          <div className="sat-hud-time-track" style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '10px', left: 0, height: '8px', width: `${Math.max(0, Math.min(100, progressPct))}%`, background: isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'), borderRadius: '4px', pointerEvents: 'none', boxShadow: `0 0 10px ${isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)')}` }}></div>
                            <input type="range" min={minTime} max={maxTime} value={simulatedTimeMs} disabled={isRealtimePassLock} className="sci-fi-slider"
                              style={{ '--thumb-color': isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'), '--thumb-glow': isRealtimePassLock ? 'rgba(0, 255, 102, 0.8)' : (sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.8)' : 'rgba(255, 204, 0, 0.8)'), opacity: isRealtimePassLock ? 0.5 : 1, cursor: isRealtimePassLock ? 'not-allowed' : 'grab' }}
                              onMouseDown={() => { if(!isRealtimePassLock) setIsPlaying(false); }} onChange={(e) => { if(!isRealtimePassLock) setSimulatedTimeMs(Number(e.target.value)); }} />
                          </div>
                        );
                      })()}
                      
                     {/* 📍 ฟันธง: แก้ไข Current SIM - ขยายความกว้างตัวเลขให้ห่างขึ้นเป็น 0.9em, ล็อกความกว้างแก้กระตุก และปิด text-shadow 100% */}
                     <div className="sat-hud-current-time" style={{ textAlign: 'center', fontSize: 'clamp(12px, 1.2vw, 16px)', color: 'rgba(255,255,255,0.7)', marginTop: '12px', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold', letterSpacing: '1px' }}>
                        CURRENT SIM: 
                        <strong style={{ display: 'inline-flex', color: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', fontSize: 'clamp(16px, 1.8vw, 24px)', textShadow: 'none', marginLeft: '12px', fontFamily: 'Orbitron', alignItems: 'center', justifyContent: 'center' }}>
                          {formatTime(new Date(simulatedTimeMs)).split('').map((char, i) => (
                            <span key={i} style={{ display: 'inline-block', width: char === ':' ? '0.4em' : '0.9em', textAlign: 'center' }}>{char}</span>
                          ))}
                          <span style={{ marginLeft: '8px' }}>UTC</span>
                        </strong>
                      </div>

                      {/* 2D DAY/NIGHT SEASON VALIDATION - test dates only; no orbit logic is modified */}
                      <div className="sat-hud-season" style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed rgba(0,234,255,0.35)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', fontFamily: 'Orbitron' }}>
                          <span style={{ color: 'var(--cyan)', fontSize: 'clamp(10px, 1vw, 12px)', fontWeight: 900, letterSpacing: '1px' }}>SEASON VALIDATION</span>
                          <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 'clamp(9px, 0.9vw, 11px)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {new Date(simulatedTimeMs).toISOString().substring(0, 10)} / 12:00 UTC
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
                          {[
                            { key: 'MAR_EQX', date: '20 MAR', label: 'EQX', month: 2, day: 20 },
                            { key: 'JUN_SOL', date: '21 JUN', label: 'SOL', month: 5, day: 21 },
                            { key: 'SEP_EQX', date: '23 SEP', label: 'EQX', month: 8, day: 23 },
                            { key: 'DEC_SOL', date: '21 DEC', label: 'SOL', month: 11, day: 21 }
                          ].map(v => {
                            const active = validationMode === v.key;
                            return (
                              <button
                                key={v.key}
                                disabled={isRealtimePassLock}
                                onClick={() => jumpToValidationDate(v.key, v.month, v.day)}
                                style={{
                                  margin: 0, padding: '6px 4px', borderRadius: '4px', cursor: isRealtimePassLock ? 'not-allowed' : 'pointer',
                                  border: `1px solid ${active ? 'var(--cyan)' : 'rgba(0,234,255,0.35)'}`,
                                  background: active ? 'rgba(0,234,255,0.18)' : 'rgba(0,234,255,0.05)',
                                  color: active ? '#fff' : 'var(--cyan)', fontFamily: 'Orbitron', fontWeight: 900,
                                  fontSize: 'clamp(8px, 0.82vw, 10px)', lineHeight: 1.05, letterSpacing: '0.35px',
                                  boxShadow: active ? '0 0 12px rgba(0,234,255,0.45)' : 'none', opacity: isRealtimePassLock ? 0.3 : 1,
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                }}
                              >
                                {`${v.date} ${v.label}`}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          disabled={isRealtimePassLock}
                          onClick={returnToLiveValidation}
                          style={{
                            width: '100%', marginTop: '6px', padding: '6px 5px', borderRadius: '4px', cursor: isRealtimePassLock ? 'not-allowed' : 'pointer',
                            border: '1px solid var(--green)', background: validationMode ? 'rgba(0,255,102,0.08)' : 'rgba(0,255,102,0.16)',
                            color: 'var(--green)', fontFamily: 'Orbitron', fontWeight: 900, fontSize: 'clamp(9px, 0.9vw, 11px)', letterSpacing: '1px',
                            boxShadow: validationMode ? 'none' : '0 0 10px rgba(0,255,102,0.35)', opacity: isRealtimePassLock ? 0.3 : 1
                          }}
                        >
                          LIVE NOW
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

           {/* กลุ่มที่ 2: การแสดงผลมุมมอง */}
           <div className="control-group sat-hud-display">
              {/* 📍 ฟันธง: ลบ <p>DISPLAY CONTROLS</p> ทิ้ง และปรับ marginTop ของกล่องด้านในเป็น 0px เพื่อให้ชิดขอบสวยงาม */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '0px' }}>
                
             {/* STATION MASK -> Cyan */}
             <style>{`
                 .station-mask-override {
                   font-size: 18px !important;
                   padding: 4px 2px !important;
                   line-height: 1.1 !important;
                 }
               `}</style>
               <button 
                  className="btn btn-cyan active station-mask-override"
                  style={{ marginBottom: 0, letterSpacing: '0.2px' }} 
                  onClick={() => setStationMask(prev => prev === 5 ? 0 : (prev === 0 ? 3 : 5))}
                >
                STATION MASK: {stationMask}° 
                </button>
                
                {/* DAY/NIGHT -> Gold */}
                <button 
                  className={`btn btn-gold ${realtimeSun ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: 'clamp(14px, 1.5vw, 18px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px' }} 
                  onClick={() => setRealtimeSun(!realtimeSun)}
                >
                  {realtimeSun ? 'DAY/NIGHT' : 'SUN OFF'}
                </button>
                
                {/* 3D GLOBE / 2D TACTICAL -> Gold */}
                <button 
                  className={`btn btn-gold ${isFlatMap ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: 'clamp(14px, 1.5vw, 18px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px' }} 
                  onClick={() => setIsFlatMap(!isFlatMap)}
                >
                  {isFlatMap ? '2D TACTICAL' : '3D GLOBE'}
                </button>
                
                {/* STATION MODE -> Green */}
                <button 
                  className={`btn btn-green ${stationDisplayMode !== 'none' ? 'active' : ''}`}
                  style={{ marginBottom: 0, fontSize: 'clamp(14px, 1.5vw, 18px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px' }}
                  onClick={() => {
                    const modes = ['both', 'icon', 'name', 'none'];
                    const nextIndex = (modes.indexOf(stationDisplayMode) + 1) % modes.length;
                    setStationDisplayMode(modes[nextIndex]);
                  }}
                >
                  {`STATION: ${stationDisplayMode.toUpperCase()}`}
                </button>
                
                {/* GROUND TRACK -> Green */}
                <button 
                  className={`btn btn-green ${showGroundTrack ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: 'clamp(14px, 1.5vw, 18px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px' }} 
                  onClick={() => setShowGroundTrack(!showGroundTrack)}
                >
                  GROUND TRACK
                </button>

              {/* TARGET LOCK -> Red */}
              <button 
                  className={`btn btn-red ${cameraMode === 'TRACKING' ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: 'clamp(14px, 1.5vw, 18px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px' }}
                  onClick={() => {
                    startTransition(() => {
                      const newMode = cameraMode === 'TRACKING' ? 'FREE LOOK' : 'TRACKING';
                      setCameraMode(newMode);
                      isTrackingRef.current = (newMode === 'TRACKING');
                      
                      if (newMode === 'TRACKING') {
                        setIsAutoPilot(false);
                        if (globeRef.current) globeRef.current.controls().autoRotate = false;
                      }
                      
                      if (newMode === 'TRACKING' && selectedCatnr && globeRef.current) {
                        try {
                          const rec = satrecs[selectedCatnr];
                          if (rec) {
                              const pos = calculateSatData(new Date(simulatedTimeMs), rec, activeStation);
                              if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
                                const camAlt = Math.max(0.4, (pos.altKm / EARTH_RADIUS_KM) + 0.5);
                                globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: camAlt }, 1000);
                              }
                          }
                        } catch (err) {}
                      } else if (newMode === 'FREE LOOK' && globeRef.current) {
                        globeRef.current.pointOfView({ lat: activeStation.lat, lng: activeStation.lng, altitude: 2.2 }, 1000);
                      }
                    });
                  }}
                >
                  TARGET LOCK
                </button>

              {/* UI COLOR THEME (ย่อชื่อให้สั้นกระชับ ไม่ล้นกรอบ) */}
             {/* UI THEME */}
              <button 
                  className="btn btn-gold" 
                  style={{ marginBottom: 0, fontSize: 'clamp(13px, 1.4vw, 17px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px', textShadow: '0 0 10px currentColor', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                  /* 📍 ฟันธง: ลบ startTransition ออก เพื่อให้เปลี่ยน Theme ทันทีแบบ High Priority ไม่มีดีเลย์แน่นอน */
                  onClick={() => setUiThemeIdx((prev) => (prev + 1) % uiThemes.length)}
                  title={`UI THEME: ${uiThemes[uiThemeIdx].name}`}
                >
                  UI THEME
                </button>

                {/* MAP THEME */}
                <button 
                  className="btn btn-cyan" 
                  style={{ marginBottom: 0, fontSize: 'clamp(13px, 1.4vw, 17px)', padding: 'clamp(14px, 1.5vh, 20px) 5px', letterSpacing: '1px', borderColor: 'var(--cyan)', color: 'var(--cyan)', textShadow: '0 0 8px var(--cyan)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} 
                  onClick={() => setMapThemeIdx((prev) => (prev + 1) % mapThemes.length)}
                  title={`MAP THEME: ${mapThemes[mapThemeIdx].name}`}
                >
                MAP THEME
                </button>
              </div>
            </div>

        {/* 🛠️ กลุ่มที่ 3: DATA & TOOLS (Redesigned & Regrouped) */}
            <div className="control-group sat-hud-tools" style={{ paddingBottom: '15px' }}>
              {/* 📍 ฟันธง: จับ 6 ปุ่มมัดรวมใน Grid เดียวกันทั้งหมด (3 แถว x 2 คอลัมน์) เพื่อความสมมาตร 100% */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                
                {/* 1. SATELLITE DATABASE */}
                <button 
                  className={`btn btn-cyan ${isModalOpen ? 'active' : ''}`} 
                  onClick={() => toggleToolVisibility('db', isModalOpen)}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >
                 SATELLITE DATABASE
                </button>

                {/* 2. SIGNAL ANALYZER (IQ) */}
                <button 
                  className={`btn ${linkActive ? 'btn-green' : 'btn-red'} ${isAnalyzerOpen ? 'active' : ''}`}
                  onClick={() => { toggleToolVisibility('analyzer', isAnalyzerOpen); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', boxShadow: linkActive ? '0 0 20px rgba(0,255,102,0.4)' : '0 0 20px rgba(255,51,51,0.2)', transition: 'all 0.3s' }}
                >
                  SIGNAL ANALYZER
                </button>
                
                {/* 3. GROUND STATION */}
                <button 
                  className={`btn btn-cyan ${isGsModalOpen ? 'active' : ''}`}
                  onClick={() => toggleToolVisibility('gs', isGsModalOpen)}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >GROUND STATION</button>

                {/* 4. RADAR SKYPLOT */}
                <button 
                  className={`btn btn-green ${isRadarOpen ? 'active' : ''}`} 
                  onClick={() => { toggleToolVisibility('radar', isRadarOpen); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >RADAR SKYPLOT</button>

                {/* 5. POINTING ANGLES */}
                <button 
                  className={`btn btn-gold ${isAnglesOpen ? 'active' : ''}`} 
                  onClick={() => toggleToolVisibility('angles', isAnglesOpen)}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >POINTING ANGLES</button>

                {/* 6. SIGNAL FLOW */}
                <button 
                  className={`btn ${isDiagramOpen ? 'active' : ''}`} 
                  onClick={() => { toggleToolVisibility('diagram', isDiagramOpen); }}
                  style={{ 
                    margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900',
                    background: isDiagramOpen ? '#ff00ff' : 'rgba(255, 0, 255, 0.05)', color: isDiagramOpen ? '#fff' : '#ff00ff', border: '1px solid #ff00ff', boxShadow: isDiagramOpen ? '0 0 25px #ff00ff' : 'inset 0 0 10px rgba(255, 0, 255, 0.15)', transition: 'all 0.3s'
                  }}
                >SIGNAL FLOW</button>

              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <button 
                  className={`btn btn-red ${isImgOpen ? 'active' : ''}`}
                  onClick={() => toggleToolVisibility('img', isImgOpen)}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', transition: 'all 0.3s' }}
                >MISSION PLAN</button>

                <button 
                  className={`btn btn-gold ${isPassModalOpen ? 'active' : ''}`} 
                  onClick={() => { toggleToolVisibility('pass', isPassModalOpen); if (!isPassModalOpen && selectedCatnr) calculateFuturePasses(selectedCatnr); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', transition: 'all 0.3s' }}
                >PASS SCHEDULE</button>
              </div>
          </div>

          {/* 📍 SIMULATION STATUS - Summary panel for current SAT-ORBIT operating state */}
          <div className="panel-box sat-hud-status" style={{
            marginTop: '10px',
            padding: '10px 14px',
            background: 'linear-gradient(145deg, rgba(0, 18, 30, 0.88), rgba(0, 7, 15, 0.96))',
            border: '1px solid var(--cyan)'
          }}>
            <div style={{
              fontFamily: 'Orbitron',
              fontSize: 'clamp(11px, 1vw, 13px)',
              color: 'var(--cyan)',
              fontWeight: '900',
              letterSpacing: '1.4px',
              marginBottom: '8px',
              paddingBottom: '6px',
              borderBottom: '1px dashed rgba(0,234,255,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'
            }}>
              <span>SIMULATION STATUS</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '14px', rowGap: '6px' }}>
              {[
                ['TARGET', targetConfig.displayName, 'var(--cyan)'],
                ['STATION', activeStation.id, 'var(--green)'],
                ['MODE', (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive) ? 'REAL-TIME' : (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying ? 'LIVE' : 'SIM'), (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive) ? 'var(--green)' : (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying ? 'var(--green)' : 'var(--gold)')],
                ['SPEED', `${speedMult}X`, 'var(--gold)'],
                ['TLE', isUpdatingTle ? 'SYNCING' : (!tles[selectedCatnr] ? 'NO TLE' : (selectedTleIsStale ? 'STALE' : 'SYNCED')), isUpdatingTle ? 'var(--gold)' : (!tles[selectedCatnr] || selectedTleIsStale ? 'var(--red)' : 'var(--green)')],
                ['ANTENNA', linkActive ? 'TRACKING' : 'STANDBY', linkActive ? 'var(--green)' : 'var(--gold)'],
                ...(isMainFullscreenLayout ? [
                  ['PROPAGATOR', 'SGP4', 'var(--cyan)'],
                  ['ORBIT DATA', selectedTleIsStale ? 'STALE TLE' : (selectedTlePair ? 'TLE ACTIVE' : 'NO TLE'), selectedTleIsStale || !selectedTlePair ? 'var(--gold)' : 'var(--green)'],
                  ['TIME SOURCE', clockMode, clockMode === 'LIVE' ? 'var(--green)' : 'var(--gold)'],
                  ['RF STATE', rfState.label.replace(' (SIM)', ''), rfState.color],
                  ['PASS PHASE', passPhaseLabel, rfState.visible ? 'var(--cyan)' : 'var(--gold)'],
                  ['VISIBILITY', visibilityLabel, visibilityColor],
                  ['TRACK MODE', trackModeLabel, cameraMode === 'TRACKING' ? 'var(--green)' : 'var(--cyan)'],
                  ['RANGE TREND', rangeTrendLabel, rangeTrendLabel === 'APPROACHING' ? 'var(--cyan)' : rangeTrendLabel === 'RECEDING' ? 'var(--gold)' : 'rgba(255,255,255,0.75)']
                ] : [])
              ].map(([label, value, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0, gap: '8px' }}>
                  <span style={{
                    fontFamily: 'Rajdhani',
                    fontSize: 'clamp(10px, 0.9vw, 12px)',
                    fontWeight: '800',
                    color: 'rgba(255,255,255,0.55)',
                    letterSpacing: '0.8px',
                    whiteSpace: 'nowrap'
                  }}>{label}</span>
                  <strong style={{
                    fontFamily: 'Orbitron',
                    fontSize: 'clamp(10px, 0.9vw, 12px)',
                    fontWeight: '900',
                    color,
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>{value}</strong>
                </div>
              ))}
            </div>
          </div>

         {/* 📍 เครดิตลิขสิทธิ์และผู้พัฒนา (อัปเดตปีอัตโนมัติ และบีบพื้นที่แนวตั้งขั้นสุด) */}
         <div className="sat-hud-credits" style={{ textAlign: 'center', marginTop: '4px', fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)', fontFamily: 'Rajdhani', letterSpacing: '1px', lineHeight: '1.2', paddingBottom: '2px' }}>
             © {new Date().getFullYear()} GISTDA — Ground System Engineering Division <br />
             SAT-ORBIT · Developed by Nawattakorn Kaikaew
         </div>
         </SatHudPages></div>
          )}
        </div>
      </div>
      
     {/* --- GISTDA GROUND STATION --- */}
     {isGsModalOpen && (<SatToolSurface id="gs" viewer={toolWindows.gs}>
       <SatDataWindow id="gs" hostRevision={toolHostRevision} scale={presentationScale} position={gsPos} maximized={maximizedWins.gs} width={520} height={530} zIndex={windowZ.gs} accent="#ff6600" onFocus={() => bringToFront('gs')} dragging={isDraggingGs}>
         <SatDataHeader title="📡 GISTDA GROUND STATION" windowControl={toolWindowButton('gs')} maximized={maximizedWins.gs}
           onMaximize={() => toggleWorkspacePanel('gs')} onClose={() => closeTool('gs')}
           onDrag={event => { if (!toolWindows.gs && !maximizedWins.gs) handleGsMouseDown(event); }} />
         <SatGroundStationData station={activeStation} onStation={setActiveStation} mask={stationMask} antennaMode={antennaState.mode} linkActive={linkActive} />
       </SatDataWindow>
     </SatToolSurface>)}

    <SatToolSurface id="antenna3d" viewer={toolWindows.antenna3d}>
    <Antenna3DSimulatorModal
      open={isAntenna3DOpen}
      onClose={() => closeTool('antenna3d')}
      hostWindow={toolWindows.antenna3d?.win || window} hosted={!!toolWindows.antenna3d}
      hostRevision={toolHostRevision} windowControl={toolWindowButton('antenna3d')} presentationScale={presentationScale}
      targetData={targetData}
      targetConfig={targetConfig}
      linkActive={linkActive}
      speedMult={speedMult}
      isPlaying={isPlaying}
      stationMask={stationMask}
      stationId={activeStation.id}
      satelliteTextureUrl={runtimeAsset('/textures/THEOS-2.webp')}
      windowZIndex={windowZ.antenna3d}
      onFocus={() => bringToFront('antenna3d')}
      simulatedTimeMs={simulatedTimeMs}
      nextPassTimeMs={nextPassTimestamp?.time || null}
      antennaState={antennaState}
    /></SatToolSurface>


    <SatToolSurface id="weather" viewer={toolWindows.weather}>
    <WeatherCenterModal
      open={isWeatherOpen}
      onClose={() => closeTool('weather')}
      hostWindow={toolWindows.weather?.win || window} hosted={!!toolWindows.weather}
      hostRevision={toolHostRevision} windowControl={toolWindowButton('weather')} presentationScale={presentationScale}
      station={activeStation}
      zIndex={windowZ.weather}
      onFocus={() => bringToFront('weather')}
      summaryCloudCover={cloudCover}
      summaryMode={cloudDataMode}
    /></SatToolSurface>


    {/* --- SATELLITE DATABASE --- */}
    {isModalOpen && (<SatToolSurface id="db" viewer={toolWindows.db}>
      <SatDataWindow id="db" hostRevision={toolHostRevision} scale={presentationScale} position={dbPos} maximized={maximizedWins.db} width={750} height={480} zIndex={windowZ.db} onFocus={() => bringToFront('db')} dragging={isDraggingDb}>
        <SatDataHeader title="🛰️ SATELLITES DATABASE" windowControl={toolWindowButton('db')} maximized={maximizedWins.db}
          onMaximize={() => toggleWorkspacePanel('db')} onClose={() => closeTool('db')}
          onDrag={event => { if (!toolWindows.db && !maximizedWins.db) handleDbMouseDown(event); }} />
        <SatDatabaseData options={SATELLITE_OPTIONS} satrecs={satrecs} selectedCatnr={selectedCatnr} selectedCatnrs={selectedCatnrs} hostRevision={toolHostRevision} scale={presentationScale}
          onClear={() => setSelectedCatnrs([selectedCatnr])}
          onGroupToggle={(groupCatnrs, isAllSelected) => {
            if (!groupCatnrs.length) return;
            let newSelected = [...selectedCatnrs];
            if (isAllSelected) newSelected = newSelected.filter(cat => !groupCatnrs.includes(cat) || cat === selectedCatnr);
            else groupCatnrs.forEach(cat => { if (!newSelected.includes(cat)) newSelected.push(cat); });
            setSelectedCatnrs(newSelected);
          }}
          onToggle={sat => {
            if (!satrecs[sat.catnr]) return;
            let newSelected = [...selectedCatnrs];
            if (newSelected.includes(sat.catnr)) {
              if (newSelected.length === 1) return;
              newSelected = newSelected.filter(cat => cat !== sat.catnr);
            } else newSelected.push(sat.catnr);
            setSelectedCatnrs(newSelected);
            const nextTarget = newSelected[newSelected.length - 1];
            setSelectedCatnr(nextTarget);
            isTrackingRef.current = true;
            setCameraMode('TRACKING');
            if (globeRef.current && nextTarget) {
              try {
                const rec = satrecs[nextTarget];
                if (rec) {
                  const pos = calculateSatData(currentDate, rec, activeStation);
                  if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
                }
              } catch (_) {}
            }
          }} />
      </SatDataWindow>
    </SatToolSurface>)}

   {/* --- PASS SCHEDULE --- */}
   {isPassModalOpen && (<SatToolSurface id="pass" viewer={toolWindows.pass}>
     <SatDataWindow id="pass" hostRevision={toolHostRevision} scale={presentationScale} position={passPos} maximized={maximizedWins.pass} width={800} height={520} zIndex={windowZ.pass} accent="var(--gold)" onFocus={() => bringToFront('pass')} dragging={isDraggingPass}>
       <SatDataHeader title="⏱ PASS SCHEDULE" windowControl={toolWindowButton('pass')} maximized={maximizedWins.pass}
         onMaximize={() => toggleWorkspacePanel('pass')} onClose={() => closeTool('pass')}
         onDrag={event => { if (!toolWindows.pass && !maximizedWins.pass) handlePassMouseDown(event); }} />
       <SatPassData passes={passSchedule} simTime={simulatedTimeMs} days={passPredictionDays} onDays={setPassPredictionDays}
         calculating={isCalculatingPass} note={passScheduleNote} hostRevision={toolHostRevision} scale={presentationScale}
         onReplay={pass => {
           const isRealtimePassLock = clockMode === 'LIVE' && speedMult === 1 && isPlaying && linkActive;
           if (isRealtimePassLock) {
             setCustomAlert({ show: true, message: "🔒 REAL-TIME LOCK: Command rejected while a LIVE pass is active.", type: 'error' });
             return;
           }
           setSimulatedTimeMs(pass.aosTime - 10000); setSpeedMult(1); setIsPlaying(true); bringToFront('radar');
         }} />
     </SatDataWindow>
   </SatToolSurface>)}

 {/* --- RADAR SKYPLOT --- */}
 {isRadarOpen && (<SatToolSurface id="radar" viewer={toolWindows.radar} quad={workspaceMode === 'quad'} rect={focusedWorkspacePanel === 'radar' ? workspaceFullRect : workspaceRects.radar} hidden={!!focusedWorkspacePanel && focusedWorkspacePanel !== 'radar'}>
        <div className="radar-perfect-scale" onMouseDownCapture={() => bringToFront('radar')} style={{
          position: 'fixed', 
          top: maximizedWins.radar ? '0px' : `${radarPos.y}px`, 
          left: maximizedWins.radar ? '0px' : `${radarPos.x}px`, 
          
          /* 📍 ฟันธง: ลดขนาดเริ่มต้น width และ height เป็น 550px เพื่อให้กรอบกะทัดรัดและยังเป็นสี่เหลี่ยมจัตุรัส */
          width: maximizedWins.radar ? '100vw' : 'min(550px, 95vw)',
          height: maximizedWins.radar ? '100vh' : 'min(550px, 85vh)', 
          minWidth: 'min(320px, 90vw)', minHeight: 'min(240px, 80vh)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', containerType: 'size', boxSizing: 'border-box',

          resize: maximizedWins.radar ? 'none' : 'both',
          
          /* 📍 ฟันธง 1: เปลี่ยนพื้นหลังเป็นอวกาศตามรูปที่แนบมา */
          background: '#000 url("//unpkg.com/three-globe/example/img/night-sky.png")', 
          backgroundSize: 'cover', backgroundPosition: 'center',
          
          border: maximizedWins.radar ? 'none' : '2px solid var(--green)', 
          borderRadius: maximizedWins.radar ? '0px' : '12px', 
          boxShadow: '0 0 40px rgba(0, 255, 102, 0.4), inset 0 0 20px rgba(0, 255, 102, 0.2)',
          zIndex: windowZ.radar,
          transition: isDraggingRadar ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>
          
          {/* 📍 ฟันธง 2: CSS สร้างดวงดาวระยิบระยับ (Twinkling Stars) */}
          <style>{`
            @keyframes twinkle-radar { 
              0% { opacity: 0.1; } 
              50% { opacity: 0.8; filter: brightness(1.5); } 
              100% { opacity: 0.1; } 
            }
            .radar-stars {
              position: absolute; inset: 0; pointer-events: none; z-index: 1;
              background-image: 
                radial-gradient(1.5px 1.5px at 10% 20%, #fff, transparent),
                radial-gradient(2px 2px at 30% 60%, #fff, transparent),
                radial-gradient(1px 1px at 80% 40%, #00eaff, transparent),
                radial-gradient(2.5px 2.5px at 60% 80%, #ffcc00, transparent),
                radial-gradient(1.5px 1.5px at 90% 90%, #fff, transparent);
              background-size: 150px 150px;
              animation: twinkle-radar 3s infinite ease-in-out alternate;
            }
          `}</style>
          <div className="radar-stars"></div>

          <style>{SAT_VISUAL_CSS}</style>
          <div className="modal-header sat-visual-header sat-radar-header" onMouseDown={(e) => { if(!maximizedWins.radar) handleRadarMouseDown(e); }}>
            <div className="sat-radar-title-stack">
              <div className="sat-radar-title-badge">
                {targetConfig.flag ? <img src={`https://flagcdn.com/w80/${targetConfig.flag.toLowerCase()}.png`} alt={`${targetConfig.displayName} flag`} /> : <span aria-hidden="true">🛰️</span>}
                <strong>{targetConfig.displayName}</strong>
              </div>
            </div>
            <div className="sat-visual-actions">
              <button className="sat-radar-audio" onClick={toggleAudioMute} aria-pressed={isMuted} aria-label={isMuted?'Enable radar audio':'Mute radar audio'} style={{color:isMuted?'var(--red)':'var(--green)'}}>{workspaceMode === 'quad' ? (isMuted ? '🔇' : '🔊') : (isMuted ? '🔇 MUTE' : '🔊 AUDIO')}</button>
              {toolDetachButton('radar')}
              <button className="modal-close-btn" aria-label="Maximize Radar" onMouseDown={e=>e.stopPropagation()} onClick={()=>toggleMaximize('radar')}><SatWindowIcon kind={maximizedWins.radar || focusedWorkspacePanel === 'radar' ? 'restore' : 'maximize'} /></button>
              <button className="modal-close-btn" aria-label="Close Radar" onMouseDown={e=>e.stopPropagation()} onClick={()=>closeTool('radar')}>✕</button>
            </div>
          </div>
          <div className="sat-radar-metrics">
            <span className="sat-radar-metric-card" style={{color:rfState.locked?'var(--green)':'var(--gold)'}}><span className="sat-radar-metric-label">EL.</span><strong style={{color:rfState.locked?'var(--green)':'var(--gold)'}}>{Number.isFinite(targetData?.elevationDeg)?`${targetData.elevationDeg.toFixed(1)}°`:'N/A'}</strong></span>
            <span className="sat-radar-metric-card" style={{color:'var(--cyan)'}}><span className="sat-radar-metric-label">AZ.</span><strong style={{color:'var(--cyan)'}}>{Number.isFinite(targetData?.azimuthDeg)?`${(((targetData.azimuthDeg % 360) + 360) % 360).toFixed(1)}°`:'N/A'}</strong></span>
          </div>
          <div className="sat-radar-plot" ref={radarContainerRef}>
          <svg width="100%" height="100%" style={{ display: 'block', position: 'absolute', inset: 0, zIndex: 10, overflow: 'visible' }}>
            {/* วงแหวนเรดาร์และเส้น Grid */}
            <g style={{ pointerEvents: 'none' }}>
              {(() => {
                const { R, cx, cy, fontScale } = radarLayout;

                const elStep = R > 250 ? 10 : (R > 150 ? 15 : 30);
                const rings = []; for (let e = elStep; e < 90; e += elStep) rings.push(e);
                const azStep = R > 200 ? 15 : 45;
                const azLines = []; for (let a = 0; a < 360; a += azStep) azLines.push(a);

                return (
                  <>
                    {azLines.map(az => {
                       const x2 = cx + R * Math.sin((az * Math.PI) / 180);
                       const y2 = cy - R * Math.cos((az * Math.PI) / 180);
                       const isMain = az % 90 === 0;
                       return <line key={`az-${az}`} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(0, 255, 102, 0.5)" strokeWidth={isMain ? "1.8" : "1.0"} strokeDasharray={isMain ? "none" : "3 3"} />
                    })}

                    {rings.map(el => {
                      const r = R * ((90 - el) / 90);
                      return (
                        <React.Fragment key={`el-${el}`}>
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0, 255, 102, 0.4)" strokeWidth="1.5" strokeDasharray="4 4" />
                          {R > 120 && el % 30 === 0 && ( <text x={cx + (6 * fontScale)} y={cy - r + (14 * fontScale)} fill="#ffcc00" fontSize={12 * fontScale} fontWeight="900" style={{ textShadow: '0 0 5px #000' }}>{el}°</text> )}
                        </React.Fragment>
                      )
                    })}
                    
                    {/* ขอบเรดาร์วงนอกสุด */}
                    <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(0, 255, 102, 0.8)" strokeWidth="2.5" />
                    
                    {[0, 45, 90, 135, 180, 225, 270, 315].map(az => {
                      const isMain = az % 90 === 0;
                      const padding = isMain ? 28 * fontScale : 20 * fontScale; 
                      let lx = cx + (R + padding) * Math.sin((az * Math.PI) / 180);
                      let ly = cy - (R + padding) * Math.cos((az * Math.PI) / 180);
                      
                      let label = az + '°';
                      if (az === 0) label = "N (0°)"; if (az === 90) label = "E (90°)"; if (az === 180) label = "S (180°)"; if (az === 270) label = "W (270°)";
                      let anchor = "middle"; if (az > 0 && az < 180) anchor = "start"; if (az > 180 && az < 360) anchor = "end";
                      let dy = "0.3em";
                      let dominantBaseline = undefined;
                      let labelFontSize = isMain ? 15 * fontScale : 12 * fontScale;

                      // N/S use their own mirrored safe slots outside the radar circle.
                      // Do not apply the generic dy shift here: it pushes both labels back
                      // into the ring and makes them overlap the outer circle.
                      if (az === 0) {
                        lx = cx;
                        ly = cy - R - 22 * fontScale;
                        dy = undefined;
                        dominantBaseline = "middle";
                        labelFontSize = 14 * fontScale;
                        anchor = "middle";
                      }
                      if (az === 180) {
                        lx = cx;
                        ly = cy + R + 22 * fontScale;
                        dy = undefined;
                        dominantBaseline = "middle";
                        labelFontSize = 14 * fontScale;
                        anchor = "middle";
                      }

                      return (
                        <text key={`az-label-${az}`} x={lx} y={ly} dy={dy} dominantBaseline={dominantBaseline} fill={isMain ? "#00eaff" : "#ffcc00"} fontSize={labelFontSize} fontWeight="900" textAnchor={anchor} style={{ textShadow: '0 0 8px #000' }} >
                          {label}
                        </text>
                      );
                    })}
                  </>
                );
              })()}

             {/* ชิ้นพิซซ่า & AOS/LOS Labels */}
             {radarData.sectorEdgePoints && radarData.sectorEdgePoints.length > 0 && radarData.aosAz !== null && (
                <g>
                  <polygon points={`${radarLayout.cx},${radarLayout.cy} ${radarData.sectorEdgePoints.join(' ')}`} fill="rgba(0, 255, 102, 0.15)" />
                  {(() => {
                    const s = radarLayout.fontScale; 
                    const aosX = radarLayout.cx + radarLayout.R * Math.sin((radarData.aosAz * Math.PI) / 180); 
                    const aosY = radarLayout.cy - radarLayout.R * Math.cos((radarData.aosAz * Math.PI) / 180);
                    const losX = radarLayout.cx + radarLayout.R * Math.sin((radarData.losAz * Math.PI) / 180); 
                    const losY = radarLayout.cy - radarLayout.R * Math.cos((radarData.losAz * Math.PI) / 180);
                    
                    const getLabelConfig = (az) => {
                      const isRight = az >= 0 && az <= 180;
                      let dx = isRight ? 16 * s : -16 * s; 
                      let dy = 0;
                      if (az < 25 || az > 335) dy = 16 * s;
                      else if (az > 155 && az < 205) dy = -16 * s;
                      else if ((az >= 65 && az <= 115) || (az >= 245 && az <= 295)) dy = -16 * s;
                      return { dx, dy, anchor: isRight ? "start" : "end" };
                    };

                    const aosCfg = getLabelConfig(radarData.aosAz);
                    const losCfg = getLabelConfig(radarData.losAz);

                   return (
                       <>
                         <line x1={radarLayout.cx} y1={radarLayout.cy} x2={aosX} y2={aosY} stroke="var(--gold)" strokeWidth={2 * s} strokeDasharray="4 4" />
                         <line x1={radarLayout.cx} y1={radarLayout.cy} x2={losX} y2={losY} stroke="var(--red)" strokeWidth={2 * s} strokeDasharray="4 4" />
                         
                         <circle cx={aosX} cy={aosY} r={4 * s} fill="var(--gold)" style={{ filter: 'drop-shadow(0 0 8px var(--gold))' }} />
                         <circle cx={losX} cy={losY} r={4 * s} fill="var(--red)" style={{ filter: 'drop-shadow(0 0 8px var(--red))' }} />


                       </>
                     );
                  })()}
                </g>
              )}

              {/* วาดเส้นพาสดาวเทียม */}
              {radarData.segments.map((seg, i) => ( <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={seg.color} strokeWidth={seg.width} strokeDasharray={seg.dash} /> ))}
              
              {/* ตำแหน่งดาวเทียมปัจจุบัน */}
              {radarCurrentPos && ( <circle cx={radarCurrentPos.x} cy={radarCurrentPos.y} r={7 * radarLayout.fontScale} fill="#ff9900" stroke="#ffffff" strokeWidth={2} style={{ filter: `drop-shadow(0 0 10px #ff9900)` }} /> )}
              {/* จุดกึ่งกลาง (สถานีรับสัญญาณ) */}
              <circle cx={radarLayout.cx} cy={radarLayout.cy} r={4 * radarLayout.fontScale} fill="var(--red)" style={{ filter: `drop-shadow(0 0 8px var(--red))` }} />
            </g>
          </svg>

          {/* เอฟเฟกต์คลื่นสแกนเรดาร์สีเขียว */}
          <style>{` @keyframes radar-sweep { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } `}</style>
            <div style={{
              position: 'absolute', left: `${radarLayout.cx - radarLayout.R}px`, top: `${radarLayout.cy - radarLayout.R}px`, width: `${radarLayout.R * 2}px`, height: `${radarLayout.R * 2}px`, 
              borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', WebkitClipPath: 'circle(50% at 50% 50%)', 
              pointerEvents: 'none', zIndex: 5, opacity: linkActive ? 0.5 : 1,
              transition: 'opacity 0.3s'
            }}>
              <div style={{ position:'absolute', inset:0,
                background:'conic-gradient(from 0deg, rgba(0, 255, 102, 0) 30%, rgba(0, 255, 102, 0.15) 70%, rgba(0, 255, 102, 0.6) 98%, rgba(0, 255, 102, 1) 100%)',
                animation:linkActive ? 'none' : 'radar-sweep 3s infinite linear',
                transform:linkActive && targetData && !isNaN(targetData.azimuthDeg) ? `rotate(${targetData.azimuthDeg}deg)` : 'none',
                transition:'transform 0.1s linear'
              }}/>
            </div>
          </div>
          <div className="sat-radar-legend">
            <span style={{color:'#7bb1bd'}}>- - DEPARTED</span><span style={{color:'var(--gold)'}}>- - APPROACH</span><span style={{color:'var(--cyan)'}}>━━ VISIBLE</span>
          </div>
          <span className="sat-radar-metric-card sat-radar-max-el"><span className="sat-radar-metric-label">MAX EL.</span><strong>{radarData.maxEl!=='N/A'?`${radarData.maxEl}°`:'N/A'}</strong></span>
        </div>
     </SatToolSurface>)}

   {/* --- IMAGING PLAN VIEWER --- */}
{isImgOpen && (<SatToolSurface id="img" viewer={toolWindows.img}>
  <SatDataWindow id="img" hostRevision={toolHostRevision} scale={presentationScale} position={imgPos} maximized={maximizedWins.img} width={780} height={500} zIndex={windowZ.img} onFocus={() => bringToFront('img')} dragging={isDraggingImg}>
    <SatDataHeader title="📸 IMAGING PLAN VIEWER" subtitle={`ORBIT ${missionOrbitLabel}`} windowControl={toolWindowButton('img')} maximized={maximizedWins.img}
      onMaximize={() => toggleWorkspacePanel('img')} onClose={() => closeTool('img')}
      onDrag={event => { if (!toolWindows.img && !maximizedWins.img) handleImgMouseDown(event); }} />
    <SatMissionWorkspace showList={isImgListOpen} hostRevision={toolHostRevision} scale={presentationScale}
      upload={<>
        <button type="button" className="sat-data-action" aria-pressed={isImgListOpen} onClick={() => setIsImgListOpen(value => !value)}>{isImgListOpen ? '◀ HIDE LIST' : '▶ SHOW LIST'}</button>
        <label className="sat-mission-upload">📂 UPLOAD MISSION PLAN (PDF / JSON)<input type="file" accept=".pdf,.json,.geojson" multiple style={{ display: 'none' }} onChange={handleMissionPlanUpload} /></label>
      </>}
      list={<SatMissionListData plans={imagingPlansData} selectedId={selectedPlanId} onSelect={setSelectedPlanId} hostRevision={toolHostRevision} scale={presentationScale}
        onReplay={plan => {
          const isRealtimePassLock = clockMode === 'LIVE' && speedMult === 1 && isPlaying && linkActive;
          if (isRealtimePassLock) {
            setCustomAlert({ show: true, message: "🔒 REAL-TIME LOCK: Command rejected while a LIVE pass is active.", type: 'error' });
            return;
          }
          setSelectedPlanId(plan.id);
          setSimulatedTimeMs(new Date(plan.start).getTime() - 5000);
          setSpeedMult(1); setIsPlaying(true);
        }} />}
      mapTools={<div className="sat-mission-map-tools">
        <span>{selectedPlanId !== null ? `🎯 TARGET LOCKED · ${mapZoom}×` : `🌍 GLOBAL VIEW · ${mapZoom}×`}</span>
        <button type="button" className="sat-data-action" aria-label="Zoom out mission map" disabled={mapZoom <= 1} onClick={() => setMapZoom(previous => { const next = Math.max(1, previous - 1); if (next === 1) setImgMapOrigin('center center'); return next; })}>−</button>
        <button type="button" className="sat-data-action" aria-label="Zoom in mission map" disabled={mapZoom >= 30} onClick={() => setMapZoom(previous => Math.min(30, previous + 1))}>+</button>
        <button type="button" className="sat-data-action" aria-label="Reset mission map zoom" onClick={() => { setMapZoom(1); setImgMapOrigin('center center'); }}>1×</button>
        <button type="button" className="sat-data-action" aria-pressed={showGroundTrack} onClick={() => setShowGroundTrack(value => !value)}>{showGroundTrack ? 'HIDE ORBIT TRACK' : 'SHOW ORBIT TRACK'}</button>
      </div>}
    >
            <div className="sat-mission-map-canvas"
               style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', border: '1px solid var(--cyan)', borderRadius: '6px', background: '#000', overflow: 'hidden', boxShadow: 'inset 0 0 20px rgba(0, 234, 255, 0.2)', cursor: 'crosshair', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
               onWheel={(e) => { 
                 const rect = e.currentTarget.getBoundingClientRect();
                 const x = ((e.clientX - rect.left) / rect.width) * 100;
                 const y = ((e.clientY - rect.top) / rect.height) * 100;
                 setMapZoom(prev => {
                    const newZoom = Math.max(1, Math.min(30, prev + (e.deltaY < 0 ? 1 : -1)));
                    if (newZoom === 1) setImgMapOrigin('center center');
                    else if (selectedPlanId === null && prev === 1) setImgMapOrigin(`${x}% ${y}%`);
                    return newZoom;
                 });
               }}
            >
                {(() => {
                   let tOrigin = imgMapOrigin; 
                   if (selectedPlanId !== null) {
                      const p = imagingPlansData.find(x => x.id === selectedPlanId);
                      if (p && !isNaN(p.startLng) && !isNaN(p.endLng)) {
                         const deltaLng = ((p.endLng - p.startLng + 540) % 360) - 180;
                         const cx_deg = ((p.startLng + deltaLng / 2 + 540) % 360) - 180; const cy_deg = (p.startLat + p.endLat) / 2;
                         const cx_pct = (cx_deg + 180) / 360 * 100; const cy_pct = (90 - cy_deg) / 180 * 100;
                         tOrigin = `${cx_pct}% ${cy_pct}%`; 
                      }
                   }
                  return (
                     <div className="sat-mission-map-image" style={{
                        width: '100%',
                        height: 'auto',
                        maxWidth: '100%',
                        maxHeight: '100%',
                        aspectRatio: '2 / 1',
                        margin: 'auto',
                        position: 'relative',
                        transformOrigin: tOrigin,
                        transform: `scale(${mapZoom})`,
                        transition: 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
                        /* 📍 ฟันธง: ย้ายภาพมาใส่เป็น CSS Background แทน ป้องกันบั๊กจอดำจาก SVG <image> โหลดไม่ขึ้น */
                        backgroundImage: `url('${runtimeAsset(mapThemes[mapThemeIdx] ? mapThemes[mapThemeIdx].url : '/textures/8k_earth_daymap.webp')}')`,
                        backgroundSize: '100% 100%',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                        filter: mapThemes[mapThemeIdx] ? mapThemes[mapThemeIdx].filter : 'none'
                     }}>

                        {/* 📍 STABILITY FIX: persistent DOM image layer. CSS background remains
                            unchanged as a visual fallback; this layer gives us deterministic
                            load/error handling after long-running browser sessions. */}
                        <img
                          key={`mission-map-${mapThemeIdx}`}
                          src={runtimeAsset(mapThemes[mapThemeIdx] ? mapThemes[mapThemeIdx].url : '/textures/8k_earth_daymap.webp')}
                          alt="Mission Plan Map"
                          onError={(e) => handleRuntimeImageError(e, runtimeAsset('/textures/Blue_marble_depth.webp'))}
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'fill',
                            pointerEvents: 'none',
                            zIndex: 0
                          }}
                        />

<svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', backgroundColor: 'transparent', position: 'relative', zIndex: 1 }}>
                            
                           {/* ======================================================== */}
                            {/* 📍 LAYER 1 (ล่างสุด): วาด Ground Track 24 ชม. (อัปเกรดความเข้ม) */}
                            {/* ======================================================== */}
                            {showGroundTrack && groundTrackPath && groundTrackPath.map((pathObj, i) => {
                              const segments = [];
                              let currentPoints = [];
                              pathObj.points.forEach((p, idx) => {
                                if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 90) {
                                  segments.push(currentPoints);
                                  currentPoints = [];
                                }
                                currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                              });
                              if (currentPoints.length > 0) segments.push(currentPoints);
                              
                              return segments.map((seg, j) => (
                                <polyline 
                                  key={`mp-gt-${i}-${j}`} 
                                  points={seg.join(' ')} 
                                  fill="none" 
                                  // 📍 ฟันธง: ปรับสีเทาให้สว่างขึ้นและทึบแสง (Opacity 0.9)
                                  stroke="rgba(255, 204, 0, 0.55)" 
                                  // 📍 ฟันธง: เพิ่มความหนาของเส้นจาก 0.1 เป็น 0.25 ให้เห็นชัดทะลุจอ
                                  strokeWidth={0.15 / mapZoom}       
                                />
                              ));
                            })}

                            {/* ======================================================== */}
                            {/* 📍 LAYER 2 (บนสุด): วาดเป้าหมายแนวถ่าย (Mesh) ทับด้านบนเสมอ! */}
                            {/* ======================================================== */}
                            {imagingPlansData.map(plan => {
                              const display = missionPathById.get(plan.id);
                              if (!display || simulatedTimeMs > display.end) return null;
                              const selected = selectedPlanId === plan.id;
                              const paths = display.paths.flatMap(points => splitMapPath(points));
                              return <g key={plan.id}>
                                {paths.map((segment, index) => <g key={index}>
                                  <polyline points={mapSegmentPoints(segment)} fill="none" stroke={selected ? 'rgba(255,51,51,1)' : 'rgba(204,0,0,0.9)'}
                                    strokeWidth={(display.importedGeometry ? (selected ? 0.7 : 0.35) : (selected ? 2.5 : 1.2)) / mapZoom} strokeLinejoin="round" strokeLinecap="round" />
                                  {selected && <polyline points={mapSegmentPoints(segment)} fill="none" stroke="#fff" strokeWidth={0.15 / mapZoom} strokeDasharray={`${0.5 / mapZoom} ${0.5 / mapZoom}`} />}
                                </g>)}
                                {selected && validMissionPoint(plan.startLat, plan.startLng) && <circle cx={(plan.startLng + 180) / 360 * 100} cy={(90 - plan.startLat) / 180 * 100} r={1 / mapZoom} fill="#fff" stroke="#ff3333" strokeWidth={0.15 / mapZoom} />}
                              </g>;
                            })}
                        </svg>
                     </div>
                   )
                })()}

            </div>
    </SatMissionWorkspace>
  </SatDataWindow>
</SatToolSurface>)}

{/* --- SIGNAL ANALYZER: SPECTRUM-ONLY INSTRUMENT VIEW --- */}
{isAnalyzerOpen && (<SatToolSurface id="analyzer" viewer={toolWindows.analyzer} quad={workspaceMode === 'quad'} rect={focusedWorkspacePanel === 'analyzer' ? workspaceFullRect : workspaceRects.analyzer} hidden={!!focusedWorkspacePanel && focusedWorkspacePanel !== 'analyzer'}>
        <div className="modal-box analyzer-modal" onMouseDownCapture={() => bringToFront('analyzer')} style={{
          position: 'fixed', top: maximizedWins.analyzer ? '0px' : `${analyzerPos.y}px`, left: maximizedWins.analyzer ? '0px' : `${analyzerPos.x}px`,
          width: maximizedWins.analyzer ? '100vw' : 'min(980px, 95vw)', height: maximizedWins.analyzer ? '100vh' : 'min(620px, 88vh)',
          minWidth: 'min(340px, 92vw)', minHeight: 'min(320px, 82vh)',
          resize: maximizedWins.analyzer ? 'none' : 'both', overflow: 'hidden',
          background: 'linear-gradient(145deg, #050a15 0%, #02040a 100%)',
          border: maximizedWins.analyzer ? 'none' : `2px solid ${rfState.locked ? 'var(--green)' : rfState.eligible ? 'var(--gold)' : 'var(--red)'}`,
          borderRadius: maximizedWins.analyzer ? '0px' : '10px',
          boxShadow: `0 0 30px rgba(0,0,0,0.8), inset 0 0 10px rgba(255,255,255,0.05)`,
          display: 'flex', flexDirection: 'column', zIndex: windowZ.analyzer || 10001,
          transition: isDraggingAnalyzer ? 'none' : 'all 0.2s ease-out'
        }}>
          <style>{SAT_VISUAL_CSS}</style>
          <div className="modal-header sat-visual-header" onMouseDown={(e)=>{if(!maximizedWins.analyzer) handleAnalyzerMouseDown(e);}}>
            <div className="sat-visual-heading"><strong>RF SPECTRUM ANALYZER</strong><div className="sat-visual-meta"><span style={{color:rfState.color}}>{rfState.label}</span><span>{new Date(simulatedTimeMs).toISOString().slice(11,19)} UTC · SIM</span></div></div>
            <div className="sat-visual-actions">
              {toolWindowButton('analyzer')}
              <button className="modal-close-btn" aria-label="Maximize Signal Analyzer" onMouseDown={e=>e.stopPropagation()} onClick={()=>toggleMaximize('analyzer')}><SatWindowIcon kind={maximizedWins.analyzer || focusedWorkspacePanel === 'analyzer' ? 'restore' : 'maximize'} /></button>
              <button className="modal-close-btn" aria-label="Close Signal Analyzer" onMouseDown={e=>e.stopPropagation()} onClick={()=>closeTool('analyzer')}>✕</button>
            </div>
          </div>
          <div className="rf-analyzer-toolbar">
            <button type="button" aria-pressed={showXBand} onClick={()=>{if(showXBand&&!showSBand)return;setShowXBand(!showXBand);}} style={{color:'#ffcc00',background:showXBand?'#302a0a':'transparent'}}>CH1: X-BAND{showXBand?'':' OFF'}</button>
            <button type="button" aria-pressed={showSBand} onClick={()=>{if(showSBand&&!showXBand)return;setShowSBand(!showSBand);}} style={{color:'#00eaff',background:showSBand?'#032d37':'transparent'}}>CH2: S-BAND{showSBand?'':' OFF'}</button>
            <span className="rf-sim-badge">LOCK EL ≥ {rfState.acquisitionEl.toFixed(1)}° · SIM MODEL</span>
            <button type="button" className="rf-iq-open-btn" onClick={()=>{setIsIqOpen(true);bringToFront('iq');}}>IQ CONSTELLATION ↗</button>
          </div>
          <div className="rf-analyzer-body rf-spectrum-only">
            <div className="rf-channel-stack" data-dual-x={showXBand && analyzerXPaths.length > 1 ? 'true' : undefined}>
              {[...analyzerXPaths.map(channel => ({show:showXBand,isX:true,channel,span:xBandSpan,setSpan:setXBandSpan,canvasRef:node => { if (node) xBandCanvasRefs.current.set(channel.id,node); else xBandCanvasRefs.current.delete(channel.id); }})),{show:showSBand,isX:false,channel:rfProfile.sBand,span:sBandSpan,setSpan:setSBandSpan,canvasRef:sBandCanvasRef}].filter(item=>item.show).map(({isX,channel,span,setSpan,canvasRef})=>{
                const instrument = getRfInstrumentSettings(channel, span, isX);
                const rfCenter = Number(channel.rf);
                const symbolRate = Number(channel.symbolRateMsps);
                return <div key={isX?`${selectedCatnr}-${channel.id}`:'s'} data-band={isX?'x':'s'} className="rf-spectrum-channel" style={{background:'#0b1121',border:'1px solid #223445',borderRadius:6}}>
                  <div className="rf-channel-header"><strong style={{color:isX?'#ffcc00':'#00eaff'}}>{isX?`CH1: X-BAND · ${channel.polarization === 'UNKNOWN' ? 'POL: UNKNOWN' : channel.polarization}`:'CH2: S-BAND TELEMETRY'} · {channel.mod}</strong><span>{Number.isFinite(rfCenter)?`RF ${rfCenter.toFixed(rfCenter < 3000 ? 3 : 0)} MHz · `:''}IF {channel.freq.toFixed(1)} MHz</span></div>
                  <div className="rf-span-controls" style={{color:isX?'#ffcc00':'#00eaff'}}>
                    <button type="button" title="Fit the modeled bandwidth to this spectrum" onClick={()=>setSpan(isX?Math.min(1000,Math.max(10,Math.ceil((channel.bw*3.2)/10)*10)):Math.min(50,Math.max(.1,Math.ceil(channel.bw*80)/10)))}>AUTO SPAN</button>
                    <input type="range" aria-label={isX?`X-band ${channel.polarization} span (linked)`:'S-band span'} min={isX?1:.1} max={isX?1000:50} step={isX?1:.1} value={span} onChange={e=>setSpan(Number(e.target.value))} className="sci-fi-slider" style={{'--thumb-color':isX?'#ffcc00':'#00eaff','--thumb-glow':isX?'#ffcc0077':'#00eaff77'}}/>
                    <output>{span>=1000?`${(span/1000).toFixed(3)} GHz`:`${span.toFixed(1)} MHz`}</output>
                  </div>
                  <div className="rf-instrument-grid">
                    <span>REF <b>{instrument.refDbm.toFixed(0)} dBm</b></span>
                    <span>ATT <b>{instrument.attenuationDb} dB</b></span>
                    <span>RBW <b>{formatRfMHz(instrument.rbwMHz)}</b></span>
                    <span>VBW <b>{formatRfMHz(instrument.vbwMHz)}</b></span>
                    <span>DET <b>{instrument.detector}</b></span>
                    <span>{Number.isFinite(symbolRate)?<>Rs <b>{symbolRate>=1?`${symbolRate.toFixed(3)} MSym/s`:`${(symbolRate*1000).toFixed(3)} kSym/s`}</b></>:<>BW <b>{channel.bw} MHz</b></>}</span>
                    <span>TRACE <b>CLR/WRITE</b></span>
                    <span>SWP <b>AUTO · SIM</b></span>
                  </div>
                  <div className="rf-spectrum-plot"><canvas ref={canvasRef}/></div>
                  <div className="rf-spectrum-readout">
                    <span>CENTER <b>{channel.freq.toFixed(3)} MHz IF</b></span>
                    <span>SPAN <b>{span>=1000?`${(span/1000).toFixed(3)} GHz`:`${span.toFixed(1)} MHz`}</b></span>
                    <span>MKR <b>{rfState.eligible?`${rfSpectrumPowerDb(channel,0,rfState,simulatedTimeMs,isX).toFixed(2)} dBm`:'—'}</b> (SIM)</span>
                  </div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </SatToolSurface>)}

{/* --- IQ CONSTELLATION: SEPARATE FROM SPECTRUM ANALYZER --- */}
{isIqOpen && (<SatToolSurface id="iq" viewer={toolWindows.iq}>
<div className="modal-box iq-modal" onMouseDownCapture={()=>bringToFront('iq')} style={{
  position:'fixed', top:maximizedWins.iq?'0px':`${iqPos.y}px`, left:maximizedWins.iq?'0px':`${iqPos.x}px`,
  width:maximizedWins.iq?'100vw':'min(620px,92vw)', height:maximizedWins.iq?'100vh':'min(620px,82vh)',
  minWidth:'min(320px,90vw)', minHeight:'min(320px,80vh)', resize:maximizedWins.iq?'none':'both', overflow:'hidden',
  background:'linear-gradient(145deg,#050a15 0%,#02040a 100%)', border:`2px solid ${rfState.color}`, borderRadius:maximizedWins.iq?0:10,
  boxShadow:'0 0 30px rgba(0,0,0,.82), inset 0 0 10px rgba(255,255,255,.05)', display:'flex', flexDirection:'column', zIndex:windowZ.iq||10002,
  transition:isDraggingIq?'none':'all .18s ease-out'
}}>
  <style>{SAT_VISUAL_CSS}</style>
  <div className="modal-header sat-visual-header" onMouseDown={(e)=>{if(!maximizedWins.iq)handleIqMouseDown(e);}}>
    <div className="sat-visual-heading"><strong>IQ CONSTELLATION ANALYZER</strong><div className="sat-visual-meta"><span style={{color:rfState.color}}>{rfState.label}</span><span>{rfProfile.name} · BASEBAND SIM</span></div></div>
    <div className="sat-visual-actions">
      {toolWindowButton('iq')}
      <button className="modal-close-btn" aria-label="Maximize IQ Analyzer" onMouseDown={e=>e.stopPropagation()} onClick={()=>toggleMaximize('iq')}><SatWindowIcon kind={maximizedWins.iq?'restore':'maximize'} /></button>
      <button className="modal-close-btn" aria-label="Close IQ Analyzer" onMouseDown={e=>e.stopPropagation()} onClick={()=>closeTool('iq')}>✕</button>
    </div>
  </div>
  <div className="rf-iq-popup-body">
    <div className="rf-iq-popup-toolbar">
      <button type="button" data-active={iqDisplayChannel==='x'} style={{color:'#ffcc00'}} onClick={()=>setIqDisplayChannel('x')}>CH1 X-BAND · {rfProfile.xBand.mod}</button>
      <button type="button" data-active={iqDisplayChannel==='s'} style={{color:'#00eaff'}} onClick={()=>setIqDisplayChannel('s')}>CH2 S-BAND · {rfProfile.sBand.mod}</button>
      <button type="button" data-active={iqDisplayChannel==='both'} onClick={()=>setIqDisplayChannel('both')}>BOTH</button>
    </div>
    {analyzerXPaths.length > 1 && iqDisplayChannel !== 's' ? (
      <div className="rf-iq-pol-grid">
        {[...analyzerXPaths.map(channel => ({channel,isX:true})), ...(iqDisplayChannel === 'both' ? [{channel:{...rfProfile.sBand,id:'s'},isX:false}] : [])].map(({channel,isX}) => (
          <div className="rf-iq-pol-cell" data-band={isX?'x':'s'} key={`${selectedCatnr}-${channel.id}`}>
            <div className="rf-iq-pol-label" style={{color:isX?'#ffcc00':'#00eaff'}}>{isX?`X-BAND · ${channel.polarization}`:'S-BAND'} · {channel.mod} · SIM</div>
            <div className="rf-iq-popup-plot"><canvas ref={node => { if (node) iqPathCanvasRefs.current.set(channel.id,node); else iqPathCanvasRefs.current.delete(channel.id); }}/></div>
          </div>
        ))}
      </div>
    ) : <>
      {iqDisplayChannel !== 's' && <div className="rf-iq-pol-label">X-BAND · POL: {analyzerXPaths[0].polarization} · SIM</div>}
      <div className="rf-iq-popup-plot"><canvas ref={iqCanvasRef}/></div>
    </>}
    <div className="rf-iq-popup-footer">
      <span>{rfState.locked?'LOCKED SYMBOL CLUSTERS':rfState.eligible?'ACQUISITION / PHASE RECOVERY':'NO CARRIER / NOISE CLOUD'}</span>
      <span>SIM MODEL · NOT A RECORDED RF CAPTURE</span>
    </div>
  </div>
</div>
</SatToolSurface>)}

{/* --- TRACKING ANGLES (MODERN TACTICAL DATRON) --- */}
{isAnglesOpen && (<SatToolSurface id="angles" viewer={toolWindows.angles}>
  <SatDataWindow id="angles" hostRevision={toolHostRevision} scale={presentationScale} position={anglesPos} maximized={maximizedWins.angles} width={780} height={520} zIndex={windowZ.angles} onFocus={() => bringToFront('angles')} dragging={isDraggingAngles}>
    <SatDataHeader title="📐 POINTING ANGLES" subtitle={targetConfig.displayName} windowControl={toolWindowButton('angles')} maximized={maximizedWins.angles}
      onMaximize={() => toggleWorkspacePanel('angles')} onClose={() => closeTool('angles')}
      onDrag={event => { if (!toolWindows.angles && !maximizedWins.angles) handleAnglesMouseDown(event); }} />
    <SatPointingData targetSatrec={targetSatrec} passes={passSchedule} simTime={simulatedTimeMs} station={activeStation}
      interval={angleInterval} onInterval={setAngleInterval} orbit={tles[selectedCatnr]?.line2.substring(63,68).trim() || 'N/A'}
      hostRevision={toolHostRevision} scale={presentationScale} />
  </SatDataWindow>
</SatToolSurface>)}

{/* ===================================================================== */}
{/* 📍 WOW Feature 1: SIGNAL FLOW DIAGRAM (MASTER BLUEPRINT & COMMENTS) */}
{/* ===================================================================== */}
{isDiagramOpen && (<SatToolSurface id="diagram" viewer={toolWindows.diagram} quad={workspaceMode === 'quad'} rect={focusedWorkspacePanel === 'diagram' ? workspaceFullRect : workspaceRects.diagram} hidden={!!focusedWorkspacePanel && focusedWorkspacePanel !== 'diagram'}>
  <div className={`modal-box diagram-modal${workspaceMode === 'quad' && !toolWindows.diagram && focusedWorkspacePanel !== 'diagram' ? ' diagram-quad-compact' : ''}`} onMouseDownCapture={() => bringToFront('diagram')} style={{
    position: 'fixed', 
    top: maximizedWins?.diagram ? '0px' : `${diagramPos.y}px`, 
    left: maximizedWins?.diagram ? '0px' : `${diagramPos.x}px`,
    width: maximizedWins?.diagram ? '100vw' : 'min(1050px, 95vw)', 
    height: maximizedWins?.diagram ? '100vh' : 'min(600px, 85vh)', 
    minWidth: 'min(320px, 90vw)', minHeight: 'min(300px, 80vh)',
    resize: maximizedWins?.diagram ? 'none' : 'both', 
    overflow: 'hidden',
    background: '#000 url("//unpkg.com/three-globe/example/img/night-sky.png")',
    backgroundSize: 'cover', backgroundPosition: 'center',
    border: maximizedWins?.diagram ? 'none' : `2px solid ${rfState.color}`, 
    borderRadius: maximizedWins?.diagram ? '0px' : '12px',
    boxShadow: `0 0 40px ${rfState.locked ? 'rgba(0,255,102,0.30)' : rfState.status === 'ACQUIRING' ? 'rgba(255,204,0,0.28)' : 'rgba(0,234,255,0.22)'}`,
    display: 'flex', flexDirection: 'column', 
    zIndex: windowZ?.diagram || 10003, 
    transition: isDraggingDiagram ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
    containerType: 'size'
  }}>
    
    {/* 🌟 1. HEADER (ส่วนหัวหน้าต่าง) */}
    {/* 📍 แก้ข้อ 5: เปลี่ยน background เป็น 'transparent' และเอา blur ออก เพื่อลบขอบดำบังดาวเทียม */}
    <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 25px', borderBottom: 'none', background: 'transparent', backdropFilter: 'none', cursor: maximizedWins?.diagram ? 'default' : (isDraggingDiagram ? 'grabbing' : 'grab') }} onMouseDown={(e) => { if(!maximizedWins?.diagram) startTransition(() => handleDiagramMouseDown(e)); }}>
      <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ color: '#fff', fontFamily: 'Orbitron', fontWeight: '900', fontSize: '18px', letterSpacing: '2px', textShadow: '0 0 10px var(--cyan)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '22px' }}>⚙️</span> SIGNAL FLOW
        </div>
        <div className={`status-badge-top ${rfState.locked ? 'active' : 'standby'}`} style={{ display: 'flex', alignItems: 'center', borderRadius: '20px', border: '2px solid', padding: '6px 20px', whiteSpace: 'nowrap', background: rfState.locked ? 'rgba(0,255,102,0.15)' : rfState.status === 'ACQUIRING' ? 'rgba(255,204,0,0.15)' : 'rgba(255,51,51,0.15)', borderColor: rfState.color, boxShadow: `0 0 25px ${rfState.locked ? 'rgba(0,255,102,.5)' : rfState.status === 'ACQUIRING' ? 'rgba(255,204,0,.42)' : 'rgba(255,51,51,.42)'}` }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: rfState.color, marginRight: '10px', animation: rfState.eligible ? 'pulse 1.5s infinite' : 'none', boxShadow: `0 0 12px ${rfState.color}` }}></div>
            <span style={{ fontFamily: 'Orbitron', fontWeight: '900', fontSize: '14px', color: rfState.color, letterSpacing: '2px', textShadow: `0 0 10px ${rfState.color}` }}>
              {rfState.locked ? 'ACTIVE: DOWNLINK' : rfState.status === 'ACQUIRING' ? 'ACQUIRING' : rfState.status === 'MASKED' ? 'BELOW MASK' : 'NO CARRIER'}
            </span>
        </div>
      </div>
      <div style={{ flex: '1 1 0%' }}></div>
      <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '20px' }}>
        {/* 📍 ฟันธง 1: โซนชื่อดาวเทียมและธงชาติ (เพิ่ม whiteSpace: 'nowrap' และ flexShrink: 0 กันตกบรรทัด 100%) */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: '20px', borderRight: '1px solid rgba(255,255,255,0.2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {targetConfig.flag && <img src={`https://flagcdn.com/w40/${targetConfig.flag.toLowerCase()}.png`} style={{ width: '32px', borderRadius: '3px', marginRight: '12px', boxShadow: '0 0 10px rgba(255,255,255,0.3)' }} alt="flag" />}
          <span style={{ fontFamily: 'Orbitron', fontSize: '24px', fontWeight: '900', color: '#ffffff', letterSpacing: '2px', textShadow: '0 0 15px var(--cyan)', whiteSpace: 'nowrap' }}>{targetConfig.displayName}</span>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {toolWindowButton('diagram')}
          <button className="modal-close-btn" style={{ width: '38px', height: '38px', background: 'transparent', border: '1px solid var(--cyan)', color: 'var(--cyan)', cursor: 'pointer', borderRadius: '4px', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => toggleMaximize('diagram')}>{maximizedWins?.diagram ? '🗗' : '🗖'}</button>
          <button className="modal-close-btn" style={{ width: '38px', height: '38px', background: 'rgba(255,51,51,0.1)', border: '1px solid var(--red)', color: 'var(--red)', cursor: 'pointer', borderRadius: '4px', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => closeTool('diagram')}>✕</button>
        </div>
      </div>
    </div>

    {/* 📍 ฟันธง: แก้ hidden เป็น visible ดาวเทียมจะทะลุขอบ 3D Pop-out ทันที! */}
    <div className={workspaceMode === 'quad' && !toolWindows.diagram && focusedWorkspacePanel !== 'diagram' ? 'flow-content' : undefined} style={{ flex: 1, position: 'relative', overflow: workspaceMode === 'quad' && !toolWindows.diagram && focusedWorkspacePanel !== 'diagram' ? 'hidden' : 'visible' }}>
      
      {/* 🌟 2. CSS STYLES (คุมขนาดกล่องและคลื่น) */}
      <style>{`
        @keyframes dash-fwd { to { stroke-dashoffset: -30; } }
        @keyframes dash-rev { to { stroke-dashoffset: 30; } }
        @keyframes sat-wobble { 
          0% { transform: translateY(0) rotate(0deg); } 
          25% { transform: translateY(-4px) rotate(-2deg) translateX(-3px); } 
          50% { transform: translateY(0) rotate(0deg); } 
          75% { transform: translateY(4px) rotate(2deg) translateX(3px); } 
          100% { transform: translateY(0) rotate(0deg); } 
        }
        @keyframes krasue-glow { 0% { opacity: 0.6; } 50% { opacity: 1.0; } 100% { opacity: 0.6; } }
        
        .pkt-tm { fill: var(--cyan); color: var(--cyan); animation: krasue-glow 1.2s ease-in-out infinite; }
        .pkt-tm-sat { fill: var(--cyan); color: var(--cyan); opacity: 1; filter: drop-shadow(0 0 5px var(--cyan)); }
        .pkt-binary { fill: #ff4df8 !important; color: #ff4df8 !important; filter: drop-shadow(0 0 5px rgba(255,77,248,0.75)); }
        .pkt-tc { fill: var(--gold); color: var(--gold); animation: krasue-glow 1.2s ease-in-out infinite 0.4s; }
        .pkt-pl { fill: var(--green); color: var(--green); animation: krasue-glow 1.2s ease-in-out infinite 0.8s; }
        .p-line { stroke-width: 3; stroke-dasharray: 8 8; stroke-linecap: round; transition: all 0.3s; }
        
        .l-tm { stroke: var(--cyan); animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px var(--cyan)); }
        .l-tc { stroke: var(--gold); animation: dash-fwd 0.6s linear infinite; filter: drop-shadow(0 0 5px var(--gold)); }
        .l-pl { stroke: var(--green); animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px var(--green)); }
        .l-dual { stroke: var(--cyan); stroke-width: 3; animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px var(--cyan)); }

        /* SIGNAL FLOW FINAL LOCK: engineering labels + processing stages */
        .flow-tech-tag {
          display: inline-flex; align-items: center; justify-content: center;
          min-height: 18px; padding: 2px 7px; border-radius: 4px;
          font-family: 'Rajdhani', sans-serif; font-size: clamp(7px, 0.62cqw, 10px);
          font-weight: 900; letter-spacing: .35px; white-space: nowrap;
          color: #dffaff; background: rgba(1, 8, 16, 0.92);
          box-shadow: inset 0 0 10px rgba(0,0,0,.75);
        }
        .flow-tech-tag.cyan { border: 1px solid rgba(0,234,255,.75); color: #7ff8ff; box-shadow: 0 0 9px rgba(0,234,255,.18), inset 0 0 10px rgba(0,234,255,.06); }
        .flow-tech-tag.gold { border: 1px solid rgba(255,204,0,.75); color: #ffe86a; box-shadow: 0 0 9px rgba(255,204,0,.18), inset 0 0 10px rgba(255,204,0,.06); }
        .flow-freq-tag {
          position: absolute; z-index: 16; transform: translate(-50%, -50%);
          min-width: max-content; padding: 4px 8px; border-radius: 4px;
          background: rgba(1, 8, 16, .88); border: 1px solid currentColor;
          font-family: 'Orbitron', sans-serif; font-weight: 900;
          font-size: clamp(7px, .62cqw, 10px); letter-spacing: .45px; line-height: 1.05;
          text-align: center; box-shadow: 0 0 12px currentColor; pointer-events: none;
        }
        .flow-freq-tag small {
          display: block; margin-top: 2px; color: rgba(255,255,255,.8);
          font-family: 'Rajdhani', sans-serif; font-size: .82em; letter-spacing: .65px;
        }
        .flow-stage-strip {
          width: 100%; display: flex; align-items: center; justify-content: center; gap: 3px;
          min-height: 22px; overflow: hidden;
        }
        .flow-stage {
          flex: 1 1 0; min-width: 0; padding: 3px 4px; border-radius: 3px;
          border: 1px solid rgba(0,255,102,.35); background: rgba(0,255,102,.055);
          color: #cffff0; font-family: 'Rajdhani', sans-serif;
          font-size: clamp(6px, .52cqw, 8px); font-weight: 900; line-height: 1.02;
          letter-spacing: .3px; text-align: center; white-space: normal;
        }
        .flow-stage-arrow { color: #ff4df8; font-size: clamp(8px, .7cqw, 11px); font-weight: 900; text-shadow: 0 0 6px rgba(255,77,248,.7); }
        
        /* 📍 จุดแก้ขนาดกล่องหลัก (UP/DOWN, SRC, X-BAND) */
        /* 📍 เปลี่ยน px เป็น cqw ให้ยืดหดตามจอ 100% */
        /* 📍 ฟันธง: ลดขนาดกล่องหลักลง เพื่อเพิ่มระยะความยาวของเส้นสายไฟ */
        .flow-node { 
          background: linear-gradient(145deg, rgba(0, 15, 25, 0.95), rgba(0, 5, 10, 0.98)); 
          border: 2px solid rgba(0, 234, 255, 0.5); 
          border-radius: 8px; 
          position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center; 
          transform: translate(-50%, -50%); transition: all 0.3s ease; 
          box-shadow: 0 0 15px rgba(0,234,255,0.2), inset 0 0 10px rgba(0, 234, 255, 0.15); 
          z-index: 10; 
          padding: 0.8cqw; /* ลด padding ลงนิดนึงให้สมส่วนกับกล่อง */
          width: 8cqw;   /* 📍 แก้ตรงนี้: ลดจาก 11cqw เหลือ 9cqw */
          aspect-ratio: 4/3; 
        }
        .flow-node.active { border-width: 3px; border-color: var(--green); box-shadow: 0 0 25px rgba(0, 255, 102, 0.4), inset 0 0 15px rgba(0, 255, 102, 0.3); }
        
        .n-icon { width: 2.8cqw; height: 2.8cqw; margin-bottom: 0.5cqw; filter: drop-shadow(0 0 5px rgba(255,255,255,0.2)); transition: all 0.3s; }
        .flow-node.active .n-icon { filter: drop-shadow(0 0 12px var(--green)); transform: scale(1.1); }
        .n-title { font-size: 1.0cqw; color: #fff; font-family: 'Orbitron', sans-serif; font-weight: 900; letter-spacing: 1px; text-shadow: none; text-align: center; white-space: nowrap; line-height: 1.1; }
        .n-sub { font-size: 0.7cqw; color: rgba(255,255,255,0.95); font-family: 'Rajdhani', sans-serif; font-weight: 900; letter-spacing: 1px; text-align: center; margin-top: 4px; white-space: nowrap; text-shadow: none; }
        
        .conn-dot { position: absolute; width: 0.6cqw; height: 0.6cqw; background: var(--green); border-radius: 50%; box-shadow: 0 0 8px var(--green); z-index: 15; transform: translate(-50%, -50%); }
      `}</style>

{(() => {
        // 📍 ฟันธง 1: ฐานข้อมูลความถี่ RF อัจฉริยะ (อิงตาม Group คลุมดาวเทียมครบทุกดวง 100%)
        let spec = { tcFreq: '2050.00 MHz', tmFreq: '2225.00 MHz', xBandFreq: '8150.00 MHz' }; // Default

        // 🧠 จัดกลุ่มความถี่ระดับโลกอัตโนมัติ (ไม่ต้องมานั่งพิมพ์ทีละดวง)
        const grp = targetConfig.group;
        if (grp === 'SYNTHETIC APERTURE RADAR (SAR)') {
          spec = { tcFreq: '2090.00 MHz', tmFreq: '2270.00 MHz', xBandFreq: '8025.00 MHz' };
        } else if (grp === 'WEATHER & EARTH RESOURCES' || grp === 'GLOBAL EESS & SCIENCE') {
          spec = { tcFreq: '2106.40 MHz', tmFreq: '2287.50 MHz', xBandFreq: '8212.50 MHz' };
        } else if (grp === 'MEGA CONSTELLATIONS') {
          spec = { tcFreq: '11.32 GHz', tmFreq: '11.32 GHz', xBandFreq: '12.25 GHz' }; // Ku-Band
        } else if (grp === 'GLOBAL NAVIGATION (GNSS)') {
          spec = { tcFreq: '2227.50 MHz', tmFreq: '2227.50 MHz', xBandFreq: '1575.42 MHz' }; // L-Band
        } else if (grp === 'THAI CUBESAT & MICROSAT') {
          spec = { tcFreq: '435.00 MHz', tmFreq: '437.00 MHz', xBandFreq: '2200.00 MHz' }; // UHF/S-Band
        } else if (grp === 'SPACE STATIONS & TELESCOPES') {
          spec = { tcFreq: '2041.25 MHz', tmFreq: '2216.00 MHz', xBandFreq: '15.00 GHz' }; // Ku-Band
        }

        // 🎯 Overrides เฉพาะดวงที่สเปกต้องเป๊ะระดับจุดทศนิยม
        const overrides = {
          '33396': { tcFreq: '2036.00 MHz', tmFreq: '2211.00 MHz', xBandFreq: '8140.00 MHz' }, // THEOS
          '58016': { tcFreq: '2066.56 MHz', tmFreq: '2244.228 MHz', xBandFreq: '8150.00 MHz' }, // THEOS-2
          '27424': { tcFreq: '2106.40 MHz', tmFreq: '2287.50 MHz', xBandFreq: '8160.00 MHz' }, // AQUA
          '25994': { tcFreq: '2106.40 MHz', tmFreq: '2287.50 MHz', xBandFreq: '8212.50 MHz' }, // TERRA
          '49260': { tcFreq: '2085.68 MHz', tmFreq: '2265.50 MHz', xBandFreq: '8212.50 MHz' }, // LANDSAT-9
          '39084': { tcFreq: '2085.68 MHz', tmFreq: '2265.50 MHz', xBandFreq: '8212.50 MHz' }, // LANDSAT-8
          '54234': { tcFreq: '2067.27 MHz', tmFreq: '2247.50 MHz', xBandFreq: '7812.00 MHz' }, // NOAA-21
          '43013': { tcFreq: '2067.27 MHz', tmFreq: '2247.50 MHz', xBandFreq: '7812.00 MHz' }, // NOAA-20
          '37849': { tcFreq: '2067.27 MHz', tmFreq: '2247.50 MHz', xBandFreq: '7812.00 MHz' }, // SUOMI NPP
        };

        let satSpecs = overrides[selectedCatnr] || spec;
        const isTheos2Flow = selectedCatnr === '58016';
        const sIfDetail = isTheos2Flow ? '2244.228 MHz → IF 70 MHz' : `RF ${satSpecs.tmFreq} → IF 70 MHz`;
        const xIfDetail = isTheos2Flow ? '8150 MHz → IF 720 MHz' : `RF ${satSpecs.xBandFreq} → IF 720 MHz`;
        const useQuadCompactSignalFlow = workspaceMode === 'quad' && !toolWindows.diagram && focusedWorkspacePanel !== 'diagram';
        if (useQuadCompactSignalFlow) {
          const satelliteImage = selectedCatnr === '58016'
            ? runtimeAsset('/textures/THEOS-2.webp')
            : selectedCatnr === '33396'
              ? runtimeAsset('/textures/THEOS.webp')
              : GENERIC_LEO_SATELLITE_SVG;
          return <SatSignalFlow
            rfState={rfState}
            rfProfile={rfProfile}
            satSpecs={satSpecs}
            stationId={activeStation.id}
            satelliteImage={satelliteImage}
            onSatelliteError={(e) => handleRuntimeImageError(e, GENERIC_LEO_SATELLITE_SVG)}
            openReceiver={openSignalFlowReceiver}
          />;
        }
        
        return (
          <>


           {/* ========================================= */}
            {/* 🌟 เส้นสายไฟ และ คลื่นสัญญาณ (อัปเดตแกนสมมาตรใหม่ 8 - 38 - 46 - 54 - 62 - 92) */}
            {/* ========================================= */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
              <defs>
                <marker id="flowArrowCyan" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#00eaff" /></marker>
                <marker id="flowArrowGold" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ffcc00" /></marker>
                <marker id="flowArrowGreen" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#00ff66" /></marker>
              </defs>
              
              {/* Space link: TM/Payload downlink plus TC uplink. Arrowheads make direction explicit. */}
              <line x1="50%" y1="8%" x2="46%" y2="55%" className={`p-line ${rfState.locked ? 'l-dual' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(255,255,255,0.1)'} markerEnd={rfState.locked ? 'url(#flowArrowCyan)' : undefined} />
              <line x1="46%" y1="55%" x2="50%" y2="8%" className={`p-line ${rfState.locked ? 'l-tc' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(255,204,0,0.12)'} markerEnd={rfState.locked ? 'url(#flowArrowGold)' : undefined} />
              <line x1="50%" y1="8%" x2="54%" y2="55%" className={`p-line ${rfState.locked ? 'l-pl' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,255,102,0.2)'} markerEnd={rfState.locked ? 'url(#flowArrowGreen)' : undefined} />

              {/* S-Band TM downlink: antenna -> converter; TC uplink: converter -> antenna. */}
              <line x1="46%" y1="55%" x2="8%" y2="55%" className={`p-line ${rfState.locked ? 'l-tm' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,234,255,0.2)'} style={{ transform: 'translateY(-30px)' }} markerEnd={rfState.locked ? 'url(#flowArrowCyan)' : undefined} />
              <line x1="8%" y1="55%" x2="46%" y2="55%" className={`p-line ${rfState.locked ? 'l-tc' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(255,204,0,0.2)'} style={{ transform: 'translateY(30px)' }} markerEnd={rfState.locked ? 'url(#flowArrowGold)' : undefined} />

              {/* S-Band IF/baseband: converter -> TT&C for TM, reverse for TC. */}
              <line x1="8%" y1="55%" x2="8%" y2="85%" className={`p-line ${rfState.locked ? 'l-tm' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,234,255,0.2)'} style={{ transform: 'translateX(-30px)' }} markerEnd={rfState.locked ? 'url(#flowArrowCyan)' : undefined} />
              <line x1="8%" y1="85%" x2="8%" y2="55%" className={`p-line ${rfState.locked ? 'l-tc' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(255,204,0,0.2)'} style={{ transform: 'translateX(30px)' }} markerEnd={rfState.locked ? 'url(#flowArrowGold)' : undefined} />
              
              {/* TT&C decoded stream -> monitor. */}
              <line x1="8%" y1="85%" x2="38%" y2="85%" className={`p-line ${rfState.locked ? 'l-tm' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,234,255,0.2)'} markerEnd={rfState.locked ? 'url(#flowArrowCyan)' : undefined} />
              
              {/* X-Band payload: antenna -> downconverter -> demodulator -> processing. */}
              <line x1="54%" y1="55%" x2="92%" y2="55%" className={`p-line ${rfState.locked ? 'l-pl' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,255,102,0.2)'} markerEnd={rfState.locked ? 'url(#flowArrowGreen)' : undefined} />
              <line x1="92%" y1="55%" x2="92%" y2="85%" className={`p-line ${rfState.locked ? 'l-pl' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,255,102,0.2)'} markerEnd={rfState.locked ? 'url(#flowArrowGreen)' : undefined} />
              <line x1="92%" y1="85%" x2="62%" y2="85%" className={`p-line ${rfState.locked ? 'l-pl' : ''}`} stroke={rfState.locked ? 'none' : 'rgba(0,255,102,0.2)'} markerEnd={rfState.locked ? 'url(#flowArrowGreen)' : undefined} />

              {/* 🌟 HPA ขยับมาที่ 22% ให้สมมาตรพอดีกับเส้นที่ยาวขึ้น */}
              <g style={{ transform: 'translateY(30px)' }}>
                <svg x="22%" y="55%" style={{ overflow: 'visible' }}>
                  <g style={{ transform: 'scale(1.15)' }}>
                    <polygon points="-35,-20 -35,20 35,0" fill="#020617" stroke="var(--gold)" strokeWidth="3" />
                    <text className="flow-hpa-label" x="-2" y="48" fill="var(--gold)" fontSize="0.8cqw" fontFamily="Orbitron" fontWeight="900" textAnchor="middle" style={{ letterSpacing: '1px', transform: 'translateY(-18px)' }}>HPA</text>
                  </g>
                </svg>
              </g>

              {rfState.locked && (
                <g>
                  {/* คลื่นดาวเทียม V-Shape */}
                  <g>
                    <svg overflow="visible" className="pkt-tm-sat">
                      <g transform="rotate(98) scale(1)">
                        <path d="M -50,0 Q -37.5,-12 -25,0 Q -12.5,12 0,0 Q 12.5,-12 25,0 Q 37.5,12 50,0" fill="none" stroke="currentColor" strokeLinecap="round" style={{ strokeWidth: 'clamp(1.8px, 0.18cqw, 2.5px)' }}>
                          <animateTransform attributeName="transform" type="scale" values="0.58; 0.95; 0.58" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="50%" to="46%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="8%" to="55%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g>
                    <svg overflow="visible" className="pkt-tc">
                      <g transform="rotate(-82) scale(1)">
                        <path d="M -50,0 Q -37.5,-12 -25,0 Q -12.5,12 0,0 Q 12.5,-12 25,0 Q 37.5,12 50,0" fill="none" stroke="currentColor" strokeLinecap="round" style={{ strokeWidth: 'clamp(1.8px, 0.18cqw, 2.5px)' }}>
                          <animateTransform attributeName="transform" type="scale" values="0.58; 0.95; 0.58" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="46%" to="50%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="8%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g>
                    <svg overflow="visible" className="pkt-pl">
                      <g transform="rotate(82) scale(1)">
                        <path d="M -60,0 Q -45,-18 -30,0 Q -15,18 0,0 Q 15,-18 30,0 Q 45,18 60,0" fill="none" stroke="currentColor" strokeLinecap="round" style={{ strokeWidth: 'clamp(1.8px, 0.18cqw, 2.5px)' }}>
                          <animateTransform attributeName="transform" type="scale" values="0.58; 0.95; 0.58" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="50%" to="54%" dur="2.5s" repeatCount="indefinite" />
                      <animate attributeName="y" from="8%" to="55%" dur="2.5s" repeatCount="indefinite" />
                    </svg>
                  </g>

                  {/* คลื่น TM ซ้าย (8 <-> 46) */}
                  <g style={{ transform: 'translateY(-30px)' }}>
                    <svg overflow="visible" className="pkt-tm">
                      <g transform="rotate(180) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="46%" to="8%" dur="4s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="55%" dur="4s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g style={{ transform: 'translateX(-30px)' }}>
                    <svg overflow="visible" className="pkt-tm">
                      <g transform="rotate(90) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="8%" to="8%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="85%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>

                  {/* คลื่น TC ซ้าย (8 <-> 46) */}
                  <g style={{ transform: 'translateY(30px)' }}>
                    <svg overflow="visible" className="pkt-tc">
                      <g transform="rotate(0) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="8%" to="46%" dur="4s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="55%" dur="4s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g style={{ transform: 'translateX(30px)' }}>
                    <svg overflow="visible" className="pkt-tc">
                      <g transform="rotate(-90) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="8%" to="8%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="85%" to="55%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>

                  {/* คลื่น PL ขวา (54 <-> 92) */}
                  <g>
                    <svg overflow="visible" className="pkt-pl">
                      <g transform="rotate(0) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="54%" to="92%" dur="4s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="55%" dur="4s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g>
                    <svg overflow="visible" className="pkt-pl">
                      <g transform="rotate(90) scale(1)">
                        <path d="M -75,0 Q -62.5,-12 -50,0 Q -37.5,24 -25,0 Q -12.5,-38 0,0 Q 12.5,38 25,0 Q 37.5,-24 50,0 Q 62.5,12 75,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="92%" to="92%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="85%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>

                  {/* รหัสดิจิตอล (ปรับระยะให้ยาวขึ้น และวิ่งตรงๆ) */}
                  <g>
                    <text className="pkt-binary" dominantBaseline="middle" textAnchor="middle" style={{ fontSize: '1.2cqw', fontWeight: 900, fill: '#ff4df8', color: '#ff4df8', filter: 'drop-shadow(0 0 5px rgba(255,77,248,0.75))', letterSpacing: '4px' }}>
                      0 1 0 1 0 1
                      <animate attributeName="x" from="12%" to="34%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="85%" to="85%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0; 1; 1; 0" keyTimes="0; 0.2; 0.8; 1" dur="3s" repeatCount="indefinite" />
                    </text>
                  </g>
                  <g>
                    <text className="pkt-binary" dominantBaseline="middle" textAnchor="middle" style={{ fontSize: '1.2cqw', fontWeight: 900, fill: '#ff4df8', color: '#ff4df8', filter: 'drop-shadow(0 0 5px rgba(255,77,248,0.75))', letterSpacing: '4px' }}>
                      1 0 1 0 1 0
                      <animate attributeName="x" from="88%" to="66%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="85%" to="85%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0; 1; 1; 0" keyTimes="0; 0.2; 0.8; 1" dur="3s" repeatCount="indefinite" />
                    </text>
                  </g>
                </g>
              )}
            </svg>

            {/* ========================================= */}
            {/* 🌟 5. FREQUENCY LABELS (ป้ายกำกับความถี่) */}
            {/* ========================================= */}
            {rfState.locked && (
              <>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--cyan)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '33%', top: 'calc(55% - 60px)', color: 'var(--cyan)', boxShadow: '0 0 10px rgba(0,234,255,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.tmFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>S-BAND TM DOWN</span>
                </div>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--gold)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(20, 10, 0, 0.85)', backdropFilter: 'blur(4px)', left: '33%', top: 'calc(55% + 60px)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.tcFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>S-BAND TC UP</span>
                </div>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--green)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '73%', top: 'calc(55% - 33px)', color: 'var(--green)', boxShadow: '0 0 10px rgba(0,255,102,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.xBandFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>X-BAND PAYLOAD DOWN</span>
                </div>

               {/* 📍 ป้าย IF 70 MHz (พลิกให้ผลักเข้ามาด้านขวาของเส้น 8% ไม่มีทางตกขอบซ้าย) */}
               <div className="flow-active-s-if" style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid #FF6600', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(4px)', left: '11.5%', top: '72%', color: '#ffffff', boxShadow: '0 0 15px rgba(255,102,0,0.4)', transform: 'translate(0, -50%)' }}>{sIfDetail}</div>

              {/* 📍 ป้าย IF 720 MHz (พลิกให้ผลักเข้ามาด้านซ้ายของเส้น 92% ไม่มีทางตกขอบขวา) */}
              <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid #00aaff', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '92%', top: '70%', color: '#ffffff', boxShadow: '0 0 10px rgba(0,170,255,0.4)', transform: 'translate(calc(-100% - 15px), -50%)' }}>{xIfDetail}</div>
              </>
            )}

           {/* ========================================= */}
            {/* 🌟 6. SATELLITE IMAGE (ภาพดาวเทียม) */}
            {/* ========================================= */}
            <div style={{ position: 'absolute', left: '0', top: '-4%', width: '100%', zIndex: 20, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              {selectedCatnr === '58016' ? (
                // THEOS-2: keep the verified mission image. If it is unavailable, fail safe to the neutral generic spacecraft.
                <img key="signal-theos2" src={runtimeAsset('/textures/THEOS-2.webp')} onError={(e) => handleRuntimeImageError(e, GENERIC_LEO_SATELLITE_SVG)} className={rfState.locked ? 'anim-wobble' : ''} alt="THEOS-2" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : selectedCatnr === '33396' ? (
                // THEOS: keep the verified mission image. If it is unavailable, use the neutral generic spacecraft rather than another mission's image.
                <img key="signal-theos1" src={runtimeAsset('/textures/THEOS.webp')} onError={(e) => handleRuntimeImageError(e, GENERIC_LEO_SATELLITE_SVG)} className={rfState.locked ? 'anim-wobble' : ''} alt="THEOS" style={{ width: '12.5cqw', minWidth: '88px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : (
                // Any other database target: intentionally use a premium neutral LEO spacecraft.
                // The header still shows targetConfig.displayName, so the selected target name remains truthful while the image stays non-mission-specific.
                <img key={`signal-generic-${selectedCatnr}`} src={GENERIC_LEO_SATELLITE_SVG} className={rfState.locked ? 'anim-wobble' : ''} alt={`${targetConfig.displayName} - generic satellite visualization`} style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              )}
            </div>
            {/* FINAL LOCK: Idle RF/IF labels remain visible only before carrier lock.
                When locked, the dedicated active labels above are the single source of truth. */}
            {!rfState.locked && (<>
              <div className="flow-freq-tag" style={{ left: '30%', top: '45%', color: 'var(--cyan)' }}>
                {isTheos2Flow ? '2244.228 MHz' : satSpecs.tmFreq}<small>{isTheos2Flow ? 'S-BAND TM DOWN' : 'S-BAND TM · SIM PROFILE'}</small>
              </div>
              <div className="flow-freq-tag" style={{ left: '30%', top: '64%', color: 'var(--gold)' }}>
                {isTheos2Flow ? '2066.56 MHz' : satSpecs.tcFreq}<small>{isTheos2Flow ? 'S-BAND TC UP' : 'S-BAND TC · SIM PROFILE'}</small>
              </div>
              <div className="flow-freq-tag" style={{ left: '72%', top: '49%', color: 'var(--green)' }}>
                {isTheos2Flow ? '8150.00 MHz' : satSpecs.xBandFreq}<small>{isTheos2Flow ? 'X-BAND PAYLOAD' : 'PAYLOAD · SIM PROFILE'}</small>
              </div>
              <div className="flow-freq-tag" style={{ left: '14.4%', top: '71%', color: 'var(--cyan)' }}>IF 70 MHz</div>
              <div className="flow-freq-tag" style={{ left: '87.6%', top: '71%', color: '#00aaff' }}>IF 720 MHz</div>
            </>)}

            {/* ========================================= */}
            {/* 🌟 7. HARDWARE BOXES (กล่องอุปกรณ์ภาคพื้นดิน) */}
            {/* ========================================= */}

            {/* 📍 7.1 โหนดซ้าย (UP/DOWN) ขยับซ้ายสุดที่ 8% */}
            <div className={`flow-node ${rfState.locked ? 'active' : ''}`} style={{ left: '8%', top: '55%', zIndex: 20 }}>
              <FlowHardwareIcon kind="converter" color="#00eaff" label="Converter" />
              <div className="n-title">UP/DOWN</div>
              <div className="n-sub">S-BAND CONVERTER</div>
              {rfState.locked && (<>
                <div className="conn-dot" style={{ top: 'calc(50% - 30px)', left: '100%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ top: 'calc(50% + 30px)', left: '100%', background: 'var(--gold)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% - 30px)', top: '100%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% + 30px)', top: '100%', background: 'var(--gold)' }}></div>
              </>)}
            </div>

            {/* 📍 7.2 โหนดเสาอากาศ (SRC ซ้าย) ขยับที่ 46% */}
            <div className={`flow-node ${rfState.locked ? 'active' : ''}`} style={{ left: '46%', top: '55%', zIndex: 20 }}>
              <FlowHardwareIcon kind="antenna" color="#00eaff" label="S-band antenna" />
              <div className="n-title">{activeStation.id}</div>
              <div className="n-sub">S-BAND ANTENNA</div>
              {rfState.locked && (<>
                <div className="conn-dot" style={{ top: 'calc(50% - 30px)', left: '0%' }}></div>
                <div className="conn-dot" style={{ top: 'calc(50% + 30px)', left: '0%', background: 'var(--gold)' }}></div>
              </>)}
            </div>

            {/* 📍 7.3 โหนดเสาอากาศ (SRC ขวา) ขยับที่ 54% */}
            <div className={`flow-node ${rfState.locked ? 'active' : ''}`} style={{ left: '54%', top: '55%', zIndex: 20, borderColor: rfState.locked ? 'var(--green)' : '' }}>
              <FlowHardwareIcon kind="antenna" color="#00ff66" label="X-band antenna" />
              <div className="n-title">{activeStation.id}</div>
              <div className="n-sub">X-BAND ANTENNA</div>
              {rfState.locked && (<div className="conn-dot" style={{ top: '50%', left: '100%' }}></div>)}
            </div>

            {/* 📍 7.4 โหนดขวา (DOWNCONVERTER) ขยับขวาสุดที่ 92% */}
            <div className="flow-node" style={{ left: '92%', top: '55%', zIndex: 20, borderColor: rfState.locked ? '#00aaff' : '' }}>
              <FlowHardwareIcon kind="tuner" color="#00aaff" label="X-band downconverter" />
              <div className="n-title" style={{ color: rfState.locked ? '#00aaff' : '#fff' }}>X-BAND</div>
              <div className="n-sub">DOWNCONVERTER</div>
              {rfState.locked && (<>
                <div className="conn-dot" style={{ top: '50%', left: '0%' }}></div>
                <div className="conn-dot" style={{ top: '100%', left: '50%' }}></div>
              </>)}
            </div>

            {/* 📍 7.5 โหนด TT&C (กล่องเล็กมุมซ้ายล่าง 8%) */}
            <div className="flow-node" style={{ left: '8%', top: '85%', zIndex: 20, borderColor: rfState.locked ? 'var(--gold)' : '' }}>
              <FlowHardwareIcon kind="router" color="#ffcc00" label="TT&C baseband" />
              <div className="n-title" style={{ color: rfState.locked ? 'var(--gold)' : '#fff' }}>TT&C</div>
              {rfState.locked && (<>
                <div className="conn-dot" style={{ left: 'calc(50% - 30px)', top: '0%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% + 30px)', top: '0%', background: 'var(--gold)' }}></div>
                <div className="conn-dot" style={{ left: '100%', top: '50%', background: 'var(--cyan)' }}></div>
              </>)}
            </div>

            {/* 📍 7.6 โหนด BASEBAND (กล่องเล็กมุมขวาล่าง 92%) */}
            <div className="flow-node" style={{ left: '92%', top: '85%', zIndex: 20, borderColor: rfState.locked ? 'var(--red)' : '' }}>
              <FlowHardwareIcon kind="baseband" color="#ff3333" label="Payload baseband demodulator" />
              <div className="n-title" style={{ color: rfState.locked ? 'var(--red)' : '#fff' }}>BASEBAND</div>
              {rfState.locked && (<>
                <div className="conn-dot" style={{ top: '0%', left: '50%' }}></div>
                <div className="conn-dot" style={{ top: '50%', left: '0%' }}></div>
              </>)}
            </div>

            {/* ========================================= */}
            {/* 🌟 8. HUD BOXES (กล่องกราฟิกจอวิเคราะห์สัญญาณ) */}
            {/* ========================================= */}
            
            {/* 📍 8.1 กล่องจอวิเคราะห์ TT&C (ขยับเข้า 38%) */}
            <div className={`flow-node ${rfState.locked ? 'active' : ''}`} 
                 style={{ left: '38%', top: '85%', zIndex: 20, width: '18cqw', height: '8.5cqw', padding: '8px', borderColor: rfState.locked ? 'var(--gold)' : 'rgba(255,204,0,0.3)', background: '#020617', flexDirection: 'column', gap: '6px', cursor: 'pointer', boxShadow: rfState.locked ? '0 0 30px rgba(255,204,0,0.4), inset 0 0 15px rgba(255,204,0,0.2)' : '' }} 
                 onClick={() => openSignalFlowReceiver('s', 'spectrum')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                <span style={{ color: '#fff', fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '1px' }}>
                  <span style={{ color: rfState.locked ? 'var(--gold)' : 'var(--red)', textShadow: rfState.locked ? '0 0 8px var(--gold)' : 'none', animation: rfState.locked ? 'pulse 1s infinite' : 'none' }}>●</span> TT&C
                </span>
              </div>
              <div style={{ display: 'flex', width: '100%', flex: 1, gap: '6px', minHeight: 0 }}>
                <div role="button" tabIndex={0} aria-label="Open SIM S-band iq" onClick={e => { e.stopPropagation(); openSignalFlowReceiver('s', 'iq'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSignalFlowReceiver('s', 'iq'); } }} style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', width: '65%', height: '65%', transform: 'translate(-50%, -50%)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '50%' }}></div>
                  {rfState.locked && (rfProfile.sBand.mod.includes('BPSK') ? [['20%','50%'],['80%','50%']] : [['20%','20%'],['80%','20%'],['20%','80%'],['80%','80%']]).map(([cx,cy], i) => (
                    <div key={`s-iq-${i}`} style={{ position: 'absolute', top: cy, left: cx, transform: 'translate(-50%, -50%)' }}>
                      <div style={{ width: '3px', height: '3px', background: 'var(--cyan)', borderRadius: '50%', boxShadow: '0 0 5px var(--cyan)', position: 'absolute', top: '-1.5px', left: '-1.5px', zIndex: 2 }}></div>
                      <div style={{ width: '10px', height: '10px', background: 'rgba(0,234,255,0.6)', position: 'absolute', top: '-5px', left: '-5px', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', animation: `pulse ${0.15 + (i * 0.03)}s infinite alternate` }}></div>
                    </div>
                  ))}
                </div>
                <div role="button" tabIndex={0} aria-label="Open SIM S-band spectrum" onClick={e => { e.stopPropagation(); openSignalFlowReceiver('s', 'spectrum'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSignalFlowReceiver('s', 'spectrum'); } }} style={{ flex: 1, background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '10% 20%' }}></div>
                  <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '90%', overflow: 'visible' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                    {rfState.locked ? (
                      <>
                        <path d="M0,95 L5,93 L10,96 L15,94 L20,95 L25,93 L30,95 L35,92 L40,95 L45,94 L50,96 L55,93 L60,95 L65,94 L70,95 L75,92 L80,96 L85,93 L90,95 L95,92 L100,95" fill="none" stroke="rgba(0,234,255,0.4)" strokeWidth="1">
                          <animateTransform attributeName="transform" type="translate" values="0 0; 0 -1.5; 0 1; 0 0" dur="0.1s" repeatCount="indefinite" />
                        </path>
                        <path d="M0,95 L46,95 L49,15 C50,10 50,10 51,15 L54,95 L100,95" fill="none" stroke="var(--cyan)" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 3px var(--cyan))', transformOrigin: 'bottom' }}>
                          <animateTransform attributeName="transform" type="scale" values="1 0.95; 1 1.05; 1 0.97; 1 1" dur="0.12s" repeatCount="indefinite" />
                        </path>
                      </>
                    ) : (
                      <path d="M0,95 L10,94 L20,96 L30,94 L40,95 L50,93 L60,96 L70,94 L80,95 L90,93 L100,95" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1">
                        <animateTransform attributeName="transform" type="translate" values="0 0; 0 -1; 0 0.5; 0 0" dur="0.2s" repeatCount="indefinite" />
                      </path>
                    )}
                  </svg>
                </div>
              </div>
            </div>

            {/* 📍 8.2 กล่องจอวิเคราะห์ BASEBAND (ขยับเข้า 62%) */}
            <div className={`flow-node ${rfState.locked ? 'active' : ''}`} 
                 style={{ left: '62%', top: '85%', zIndex: 20, width: '18cqw', height: '8.5cqw', padding: '8px', borderColor: rfState.locked ? 'var(--green)' : 'rgba(0,234,255,0.3)', background: '#020617', flexDirection: 'column', gap: '6px', cursor: 'pointer', boxShadow: rfState.locked ? '0 0 30px rgba(0,255,102,0.4), inset 0 0 15px rgba(0,255,102,0.2)' : '' }} 
                 onClick={() => openSignalFlowReceiver('x', 'spectrum')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                <span style={{ color: '#fff', fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '1px' }}>
                  <span style={{ color: rfState.locked ? 'var(--green)' : 'var(--red)', textShadow: rfState.locked ? '0 0 8px var(--green)' : 'none', animation: rfState.locked ? 'pulse 1s infinite' : 'none' }}>●</span> BASEBAND
                </span>
              </div>
              <div style={{ display: 'flex', width: '100%', flex: 1, gap: '6px', minHeight: 0 }}>
                <div role="button" tabIndex={0} aria-label="Open SIM X-band iq" onClick={e => { e.stopPropagation(); openSignalFlowReceiver('x', 'iq'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSignalFlowReceiver('x', 'iq'); } }} style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', width: '65%', height: '65%', transform: 'translate(-50%, -50%)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '50%' }}></div>
                  {rfState.locked && (rfProfile.xBand.mod.includes('BPSK') ? [['20%','50%'],['80%','50%']] : [['20%','20%'],['80%','20%'],['20%','80%'],['80%','80%']]).map(([cx,cy], i) => (
                    <div key={`x-iq-${i}`} style={{ position: 'absolute', top: cy, left: cx, transform: 'translate(-50%, -50%)' }}>
                      <div style={{ width: '3px', height: '3px', background: 'var(--red)', borderRadius: '50%', boxShadow: '0 0 5px var(--red)', position: 'absolute', top: '-1.5px', left: '-1.5px', zIndex: 2 }}></div>
                      <div style={{ width: '10px', height: '10px', background: 'rgba(255,255,255,0.8)', position: 'absolute', top: '-5px', left: '-5px', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', animation: `pulse ${0.15 + (i * 0.03)}s infinite alternate` }}></div>
                    </div>
                  ))}
                </div>
                <div role="button" tabIndex={0} aria-label="Open SIM X-band spectrum" onClick={e => { e.stopPropagation(); openSignalFlowReceiver('x', 'spectrum'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openSignalFlowReceiver('x', 'spectrum'); } }} style={{ flex: 1, background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '10% 20%' }}></div>
                  <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '90%', overflow: 'visible' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                    {rfState.locked ? (
                      <>
                        <path d="M0,95 L30,95 C38,95 42,15 50,15 C58,15 62,95 70,95 L100,95" fill="none" stroke="var(--gold)" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 3px var(--gold))', transformOrigin: 'bottom' }}>
                          <animateTransform attributeName="transform" type="scale" values="1 0.95; 1 1.05; 1 0.97; 1 1" dur="0.12s" repeatCount="indefinite" />
                        </path>
                      </>
                    ) : (
                      <path d="M0,95 L100,95" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                    )}
                  </svg>
                </div>
              </div>
            </div>

          </>
        );
      })()}

    </div>
  </div>
</SatToolSurface>)}
    </>
  );
}

function SatDetachedBootstrap({ toolId }) {
  const title = SAT_WORKSPACE_TOOLS[toolId] || 'Detached Tool';
  useEffect(() => {
    document.title = `SAT-Orbit — ${title}`;
  }, [title]);
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#010408', color: '#b7f6ff', fontFamily: 'Rajdhani, Arial, sans-serif', textAlign: 'center', padding: 24 }}>
      <div style={{ border: '1px solid #337689', borderRadius: 8, padding: '18px 24px', background: '#071720', boxShadow: '0 0 24px rgba(0,234,255,.12)' }}>
        <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 900, letterSpacing: 1.5, color: '#00eaff' }}>{title}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>CONNECTING TO MAIN SAT-ORBIT SESSION…</div>
      </div>
    </div>
  );
}

export default function App() {
  const detachedToolId = typeof window !== 'undefined' ? getSatDetachedToolFromLocation(window) : null;
  if (detachedToolId) return <SatDetachedBootstrap toolId={detachedToolId} />;
  return (
    <SatOrbitErrorBoundary>
      <SatOrbitCore />
    </SatOrbitErrorBoundary>
  );
}