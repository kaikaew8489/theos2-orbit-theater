// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// ==========================================
// 1. DATA & CONFIGURATION
// ==========================================
const GROUND_STATION = { lat: 13.16, lng: 100.93, name: 'Sriracha', color: '#00eaff' };
const PASS_MIN_ELEVATION_DEG = 5;
const EARTH_RADIUS_KM = 6371;

const SATELLITE_OPTIONS = [
  { catnr: '58016', name: 'THEOS-2', displayName: 'THEOS-2', flag: 'th', group: 'GISTDA EARTH OBSERVATION' },
  { catnr: '33396', name: 'THEOS', displayName: 'THEOS', flag: 'th', group: 'GISTDA EARTH OBSERVATION' },
  
  { catnr: '43761', name: 'KNACKSAT-1', displayName: 'KNACKSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },
  { catnr: '46320', name: 'NAPA-1', displayName: 'NAPA-1 / RTAF-SAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },
  { catnr: '48041', name: 'BCCSAT-1', displayName: 'BCCSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },
  { catnr: '48963', name: 'NAPA-2', displayName: 'NAPA-2 / RTAF-SAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },
  { catnr: '62689', name: 'LOGSATS-2', displayName: 'LOGSATS-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },
  { catnr: '67683', name: 'KNACKSAT-2', displayName: 'KNACKSAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT' },

  { catnr: '32382', name: 'RADARSAT-2', displayName: 'RADARSAT-2', flag: 'ca', group: 'INTERNATIONAL RADAR (SAR)' },
  { catnr: '31598', name: 'COSMO-SKYMED-1', displayName: 'COSMO-1', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)' },
  { catnr: '32376', name: 'COSMO-SKYMED-2', displayName: 'COSMO-2', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)' },
  { catnr: '33412', name: 'COSMO-SKYMED-3', displayName: 'COSMO-3', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)' },
  { catnr: '37216', name: 'COSMO-SKYMED-4', displayName: 'COSMO-4', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)' },
  { catnr: '39634', name: 'SENTINEL-1A', displayName: 'SENTINEL-1A', flag: 'eu', group: 'INTERNATIONAL RADAR (SAR)' },

  { catnr: '49260', name: 'LANDSAT-9', displayName: 'LANDSAT-9', flag: 'us', group: 'EARTH RESOURCES & WEATHER' },
  { catnr: '39084', name: 'LANDSAT-8', displayName: 'LANDSAT-8', flag: 'us', group: 'EARTH RESOURCES & WEATHER' },
  { catnr: '25994', name: 'TERRA', displayName: 'TERRA', flag: 'us', group: 'EARTH RESOURCES & WEATHER' },
  { catnr: '27424', name: 'AQUA', displayName: 'AQUA', flag: 'us', group: 'EARTH RESOURCES & WEATHER' }
];

const FALLBACK_TLES = {
  // THEOS & THEOS-2 (วงโคจรต่างกันชัดเจน)
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' },
  '33396': { line1: '1 33396U 08049A   26166.85000000  .00000100  00000-0  50000-4 0  9991', line2: '2 33396  98.5400 210.1200 0001500  85.0000 275.0000 14.20000000900001' },

  // SAR Constellation (จัดระยะห่างให้สมดุล)
  '32382': { line1: '1 32382U 07061A   26166.85000000  .00000050  00000-0  30000-4 0  9992', line2: '2 32382  98.5800 180.2300 0001200  90.0000 270.0000 14.29000000900002' },
  '31598': { line1: '1 31598U 07026A   26166.85000000  .00000120  00000-0  60000-4 0  9993', line2: '2 31598  97.9000 150.4500 0001000  70.0000 290.0000 14.85000000900003' },
  '32376': { line1: '1 32376U 07059A   26166.85000000  .00000120  00000-0  60000-4 0  9994', line2: '2 32376  97.9000 152.4500 0001000  72.0000 180.0000 14.85000000900004' },
  '33412': { line1: '1 33412U 08054A   26166.85000000  .00000120  00000-0  60000-4 0  9995', line2: '2 33412  97.9000 154.4500 0001000  74.0000 090.0000 14.85000000900005' },
  '37216': { line1: '1 37216U 10060A   26166.85000000  .00000120  00000-0  60000-4 0  9996', line2: '2 37216  97.9000 156.4500 0001000  76.0000 010.0000 14.85000000900006' },
  '39634': { line1: '1 39634U 14016A   26166.85000000  .00000090  00000-0  45000-4 0  9994', line2: '2 39634  98.1818 259.9868 0001391  81.0858 279.0558 14.59196924522858' },

  // Earth Resources & Weather 
  // (แก้ Mean Anomaly ให้ LS-8 และ LS-9 อยู่ห่างกัน 180 องศา)
  '39084': { line1: '1 39084U 13008A   26166.85000000  .00000080  00000-0  40000-4 0  9998', line2: '2 39084  98.2000 197.3000 0001100  82.0000 278.0000 14.57000000900008' },
  '49260': { line1: '1 49260U 21088A   26166.85000000  .00000080  00000-0  40000-4 0  9997', line2: '2 49260  98.2000 195.3000 0001100  80.0000 098.0000 14.57000000900007' },
  '25994': { line1: '1 25994U 99068A   26166.85000000  .00000090  00000-0  45000-4 0  9997', line2: '2 25994  98.2045 233.1557 0001099 101.4468 258.6946 14.57116521288226' },
  '27424': { line1: '1 27424U 02022A   26166.85000000  .00000090  00000-0  45000-4 0  9998', line2: '2 27424  98.2039  20.4497 0001859  69.2132 290.9329 14.57113110162590' },

  // Thai Cubesats
  // (แก้ Mean Anomaly กระจายระยะห่างทีละ 60 องศา จะได้ไม่บินทับซ้อนกัน)
  '43761': { line1: '1 43761U 18099D   26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 43761  98.1800 220.1000 0001300  88.0000 000.0000 14.59000000900009' },
  '46320': { line1: '1 46320U 20061BA  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 46320  98.1800 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '48041': { line1: '1 48041U 21022AK  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 48041  98.1800 220.1000 0001300  88.0000 120.0000 14.59000000900009' },
  '48963': { line1: '1 48963U 21059CN  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 48963  98.1800 220.1000 0001300  88.0000 180.0000 14.59000000900009' },
  '62689': { line1: '1 62689U 25009CJ  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 62689  98.1800 220.1000 0001300  88.0000 240.0000 14.59000000900009' },
  '67683': { line1: '1 67683U 98067XZ  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 67683  98.1800 220.1000 0001300  88.0000 300.0000 14.59000000900009' }
};

// ==========================================
// 2. SCI-FI CSS (INJECTED) - ULTIMATE EXPO EDITION
// ==========================================
const injectStyles = () => {
  if (document.getElementById('scifi-theater-styles')) return;
  const style = document.createElement('style');
  style.id = 'scifi-theater-styles';
  style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@500;600;700&display=swap');
    :root { --cyan: #00eaff; --gold: #ffb347; --bg: #030712; --red: #ff3333; --dark-cyan: #005f73; }
    body { margin: 0; overflow: hidden; background: var(--bg); color: #fff; font-family: 'Rajdhani', sans-serif; }
    
    /* Hologram Scanline Effect */
    .scanlines { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1)); background-size: 100% 4px; z-index: 100; opacity: 0.6; }
    
    .ui-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; display: flex; justify-content: space-between; padding: 25px; box-sizing: border-box; z-index: 10; }
    
    /* Left Panel & HUD Boxes */
    .left-panel { width: 380px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; }
    .panel-box { border: 1px solid var(--dark-cyan); border-radius: 4px; background: rgba(3, 11, 24, 0.75); padding: 15px 20px; box-shadow: 0 0 15px rgba(0, 234, 255, 0.05) inset; backdrop-filter: blur(8px); position: relative; }
    .panel-box::before { content: ''; position: absolute; top: -1px; left: -1px; width: 20px; height: 20px; border-top: 2px solid var(--cyan); border-left: 2px solid var(--cyan); }
    .panel-box::after { content: ''; position: absolute; bottom: -1px; right: -1px; width: 20px; height: 20px; border-bottom: 2px solid var(--cyan); border-right: 2px solid var(--cyan); }
    
    .main-title p { margin: 0; color: var(--cyan); font-size: 12px; letter-spacing: 3px; text-transform: uppercase; }
    .main-title h1 { margin: 5px 0; font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 900; color: #fff; text-shadow: 0 0 10px rgba(0,234,255,0.6); letter-spacing: 1px; }
    .main-title span { font-size: 11px; color: #8892b0; letter-spacing: 1px; }
    
    .clock-panel { display: flex; gap: 15px; justify-content: space-between; background: rgba(0, 0, 0, 0.6); border: 1px solid var(--dark-cyan); border-radius: 4px; padding: 12px 15px; box-shadow: 0 0 10px rgba(0, 234, 255, 0.1) inset; }
    .clock-item { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 33%; }
    .clock-item span { font-size: 10px; color: var(--cyan); font-weight: 700; letter-spacing: 2px; margin-bottom: 2px; }
    .clock-item strong { font-family: 'Orbitron', sans-serif; font-size: 16px; color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }

    /* Telemetry Grid (The WOW Factor) */
    /* Target Header (ชื่อดาวเทียม + ธงชาติ) */
    .target-header { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed var(--dark-cyan); }
    .target-header img { width: 40px; border-radius: 4px; box-shadow: 0 0 10px rgba(0, 234, 255, 0.3); border: 1px solid var(--cyan); }
    .target-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 24px; font-weight: 900; color: #fff; letter-spacing: 2px; text-shadow: 0 0 10px rgba(0,234,255,0.5); }
    .status-banner { text-align: center; font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 2px; padding: 10px; margin-bottom: 15px; border-radius: 2px; transition: all 0.3s; }
    .status-banner.standby { background: rgba(255, 51, 51, 0.1); border: 1px solid var(--red); color: var(--red); }
    .status-banner.active { background: rgba(0, 234, 255, 0.15); border: 1px solid var(--cyan); color: var(--cyan); box-shadow: 0 0 15px rgba(0, 234, 255, 0.4); animation: pulse 2s infinite; }
    
    @keyframes pulse { 0% { box-shadow: 0 0 10px rgba(0,234,255,0.2); } 50% { box-shadow: 0 0 25px rgba(0,234,255,0.6); } 100% { box-shadow: 0 0 10px rgba(0,234,255,0.2); } }

    .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
    .t-box { background: rgba(0, 0, 0, 0.4); border-left: 3px solid var(--dark-cyan); padding: 8px 12px; display: flex; flex-direction: column; }
    .t-box.highlight { border-left-color: var(--cyan); background: rgba(0, 234, 255, 0.05); }
    .t-box span { font-size: 10px; color: #8892b0; text-transform: uppercase; letter-spacing: 1px; }
    .t-box strong { font-family: 'Orbitron', sans-serif; font-size: 15px; color: #fff; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .t-box strong.text-cyan { color: var(--cyan); text-shadow: 0 0 5px rgba(0,234,255,0.5); }
    .t-box strong.text-gold { color: var(--gold); }

    .info-list { list-style: none; padding: 10px 0 0 0; margin: 15px 0 0 0; border-top: 1px dashed var(--dark-cyan); font-size: 13px; line-height: 2.2; color: #ddd; }
    .info-list li { display: flex; justify-content: space-between; }
    .info-list span { color: #8892b0; }
    .info-list strong { color: var(--gold); font-weight: 600; }

    /* Right Panel & Controls */
    .right-panel { width: 220px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; }
    .control-group p { margin: 0 0 10px 0; color: var(--cyan); font-size: 12px; font-weight: 700; letter-spacing: 2px; border-bottom: 1px solid var(--dark-cyan); padding-bottom: 5px; }
    .btn { display: block; width: 100%; background: rgba(0, 234, 255, 0.05); border: 1px solid var(--dark-cyan); color: var(--cyan); padding: 10px; margin-bottom: 8px; font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; text-align: center; border-radius: 2px; text-transform: uppercase; transition: all 0.2s; letter-spacing: 1px; }
    .btn:hover, .btn.active { background: var(--cyan); color: #000; box-shadow: 0 0 15px rgba(0,234,255,0.4); border-color: var(--cyan); }
    .btn:disabled { opacity: 0.5; pointer-events: none; border-color: #555; color: #555; }
    
    .speed-row { display: flex; gap: 5px; margin-bottom: 8px; }
    
    .sat-selector { max-height: calc(100vh - 350px); overflow-y: auto; padding-right: 5px; }
    .sat-selector::-webkit-scrollbar { width: 4px; }
    .sat-selector::-webkit-scrollbar-thumb { background: var(--gold); }
    
    /* Satellite Group Accordion Styles */
    .group-header { background: rgba(0, 15, 30, 0.6); border: 1px solid var(--dark-cyan); color: #8892b0; padding: 10px 12px; font-family: 'Rajdhani', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-radius: 2px; transition: all 0.2s; }
    .group-header:hover { color: var(--cyan); border-color: var(--cyan); background: rgba(0, 234, 255, 0.05); }
    .group-header.active { color: var(--gold); border-color: var(--gold); background: rgba(255, 179, 71, 0.1); }
    .group-content { display: none; flex-direction: column; padding-left: 12px; margin-bottom: 12px; border-left: 2px solid var(--dark-cyan); margin-left: 6px; gap: 6px; }
    .group-content.open { display: flex; }
    
    .sat-btn { border-color: rgba(255, 179, 71, 0.3); color: var(--gold); background: rgba(255, 179, 71, 0.05); margin-bottom: 0; }
    .sat-btn:hover, .sat-btn.active { background: var(--gold); color: #000; box-shadow: 0 0 15px rgba(255, 179, 71, 0.4); border-color: var(--gold); }
    .sat-btn { border-color: rgba(255, 179, 71, 0.3); color: var(--gold); background: rgba(255, 179, 71, 0.05); }
    .sat-btn:hover, .sat-btn.active { background: var(--gold); color: #000; box-shadow: 0 0 15px rgba(255, 179, 71, 0.4); border-color: var(--gold); }
    /* ==========================================
    RESPONSIVE DESIGN (MOBILE & TABLET SUPPORT)
    ========================================== */
 @media (max-width: 900px) {
   /* ปรับโครงสร้างหลักให้เรียงจากบนลงล่าง และไถหน้าจอได้ */
   .ui-layer { flex-direction: column; padding: 10px; height: 100vh; overflow-y: auto; justify-content: flex-start; gap: 15px; pointer-events: none; }
   /* คืนค่าการกดปุ่มให้แผงควบคุม และล้าง scrollbar ที่ซ่อนอยู่ */
   .ui-layer::-webkit-scrollbar { display: none; }
   
   /* ขยายกล่องซ้ายขวาให้เต็ม 100% ของจอมือถือ */
   .left-panel, .right-panel { width: 100%; pointer-events: auto; }
   
   /* ย่อขนาดตัวอักษรไม่ให้ล้นจอ */
   .main-title h1 { font-size: 20px; }
   .target-header h2 { font-size: 18px; }
   .target-header img { width: 30px; }
   
   /* ปรับตาราง Telemetry ให้แน่นขึ้น */
   .telemetry-grid { gap: 5px; }
   .t-box { padding: 5px 8px; }
   .t-box strong { font-size: 13px; }
   
   /* จำกัดความสูงเมนูเลือกดาวเทียม เพื่อให้ไถจอไปต่อได้ */
   .sat-selector { max-height: 250px; }
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

function getUtcDayOfYear(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000) + 1;
}

function calculateSatData(date, satrec) {
  if (!satrec) return null;
  try {
    const positionAndVelocity = satelliteJs.propagate(satrec, date);
    if (!positionAndVelocity.position || typeof positionAndVelocity.position === 'boolean') return null;

    const gmst = satelliteJs.gstime(date);
    const geodetic = satelliteJs.eciToGeodetic(positionAndVelocity.position, gmst);
    const positionEcf = satelliteJs.eciToEcf(positionAndVelocity.position, gmst);
    const observerGd = { latitude: toRadians(GROUND_STATION.lat), longitude: toRadians(GROUND_STATION.lng), height: 0.05 };
    const lookAngles = satelliteJs.ecfToLookAngles(observerGd, positionEcf);
    const speed = Math.sqrt(positionAndVelocity.velocity.x ** 2 + positionAndVelocity.velocity.y ** 2 + positionAndVelocity.velocity.z ** 2);

    return {
      lat: satelliteJs.degreesLat(geodetic.latitude),
      lng: satelliteJs.degreesLong(geodetic.longitude),
      altKm: geodetic.height,
      elevationDeg: toDegrees(lookAngles.elevation),
      azimuthDeg: toDegrees(lookAngles.azimuth),
      rangeKm: lookAngles.rangeSat,
      speedKmS: speed
    };
  } catch (e) { return null; }
}

function getInclinationDeg(line2) { return Number(line2.trim().split(/\s+/)[2] || 0); }

function createSatelliteModel(isTarget = false) {
  const group = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: '#d8a536' });
  const blue = new THREE.MeshBasicMaterial({ color: '#173d92' });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.45), gold));
  const lp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), blue); lp.position.x = -1.85; group.add(lp);
  const rp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), blue); rp.position.x = 1.85; group.add(rp);
  const scale = isTarget ? 2.5 : 1.2;
  group.scale.set(scale, scale, scale);
  return group;
}

// ==========================================
// 4. MAIN APP
// ==========================================
export default function App() {
  const globeRef = useRef(null);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [tles, setTles] = useState(FALLBACK_TLES);
  const [tleSource, setTleSource] = useState('Fallback / Built-in');
  const [isUpdatingTle, setIsUpdatingTle] = useState(false);
  const [selectedCatnr, setSelectedCatnr] = useState(SATELLITE_OPTIONS[0].catnr);
  
  const [simulatedTimeMs, setSimulatedTimeMs] = useState(Date.now());
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);
  // --- แทรกบรรทัดนี้ต่อท้ายกลุ่ม useState เดิม ---
  const [realtimeSun, setRealtimeSun] = useState(false);
  // --- เพิ่ม State สำหรับเปิด-ปิด กลุ่มดาวเทียม ---
  const [openGroup, setOpenGroup] = useState('GISTDA EARTH OBSERVATION');

  useEffect(() => {
    injectStyles();
    const handleResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    
    if (globeRef.current) {
      globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
      globeRef.current.controls().autoRotate = false;
    }
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => setSimulatedTimeMs(prev => prev + (50 * speedMult)), 50);
    return () => clearInterval(timer);
  }, [isPlaying, speedMult]);

// ==========================================
  // REAL-TIME DAY/NIGHT ENGINE (SUNLIGHT)
  // ==========================================
  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    const scene = globe.scene();
    const camera = globe.camera();

    // 1. หาแสงที่ติดอยู่กับกล้อง (ปกติจะสาดสว่างเต็มใบ) และปิดมันเมื่อใช้โหมดดวงอาทิตย์
    const camLight = camera.children.find(c => c.type === 'DirectionalLight');
    if (camLight) camLight.intensity = realtimeSun ? 0 : 1;

    // 2. ปรับแสงเงา (Ambient) ให้ฝั่งกลางคืนมืดสนิทสมจริง
    const ambient = scene.children.find(c => c.type === 'AmbientLight');
    if (ambient) ambient.intensity = realtimeSun ? 0.02 : 0.6; 

    // 3. สร้างดวงอาทิตย์จำลอง
    let sunLight = scene.children.find(c => c.name === 'SunLight');
    if (!sunLight) {
      sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
      sunLight.name = 'SunLight';
      scene.add(sunLight);
    }

    if (realtimeSun) {
      // คำนวณแกนโลกและตำแหน่งดวงอาทิตย์ตามเวลา Real-time
      const date = new Date(simulatedTimeMs);
      const dayOfYear = getUtcDayOfYear(date);
      // แกนโลกเอียง 23.44 องศา
      const declination = -23.44 * Math.cos((2 * Math.PI / 365.24) * (dayOfYear + 10)); 
      // ดวงอาทิตย์เคลื่อนที่ 15 องศาต่อ 1 ชั่วโมง
      const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
      const longitude = 180 - (hours * 15); 

      // แปลงพิกัด Lat/Lng ของดวงอาทิตย์ เป็นพิกัด 3D บนลูกโลก
      const sunPos = globe.getCoords(declination, longitude, 100); 
      sunLight.position.set(sunPos.x, sunPos.y, sunPos.z);
      sunLight.visible = true;
    } else {
      sunLight.visible = false;
    }
  }, [realtimeSun, Math.floor(simulatedTimeMs / 60000)]); // อัปเดตเงาทุกๆ 1 นาทีจำลอง


  const satrecs = useMemo(() => {
    const recs = {};
    Object.keys(tles).forEach(cat => {
      recs[cat] = satelliteJs.twoline2satrec(tles[cat].line1, tles[cat].line2);
    });
    return recs;
  }, [tles]);

  const currentDate = new Date(simulatedTimeMs);
  const targetSatrec = satrecs[selectedCatnr];
  const targetData = calculateSatData(currentDate, targetSatrec);
  const targetConfig = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr) || SATELLITE_OPTIONS[0];
  const linkActive = targetData && targetData.elevationDeg >= PASS_MIN_ELEVATION_DEG;

  const allSatObjects = useMemo(() => {
    return SATELLITE_OPTIONS.map(sat => {
      const data = calculateSatData(currentDate, satrecs[sat.catnr]);
      if (!data) return null;
      return {
        ...data, 
        type: 'satellite', 
        name: sat.displayName,
        catnr: sat.catnr, // <-- เพิ่มบรรทัดนี้เข้ามา เพื่อส่งรหัส NORAD ไปให้ลูกโลก
        isTarget: sat.catnr === selectedCatnr,
        altitude: Math.max(0.05, data.altKm / EARTH_RADIUS_KM)
      };
    }).filter(Boolean);
  }, [currentDate, satrecs, selectedCatnr]);

  // Generate Orbit Path (Past 60m to Future 60m) - อัปเกรดความละเอียดเส้น
  const orbitVisualPath = useMemo(() => {
    if (!targetSatrec) return [];

    const points = [];
    // ฟันธง: เปลี่ยน step จาก 2 เป็น 0.5 เพื่อเพิ่มความหนาแน่นของจุด เส้นจะกลมเนียน 100%
    for (let m = -60; m <= 60; m += 0.5) {
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pos = calculateSatData(d, targetSatrec);
      if (pos) points.push({ lat: pos.lat, lng: pos.lng, alt: Math.max(0.01, pos.altKm / EARTH_RADIUS_KM) });
    }
    // ปรับเส้นให้บางลงและสว่างขึ้นให้ดู Sci-Fi
    return [{ points, color: 'rgba(255, 179, 71, 0.8)', stroke: 1.0 }]; 
  }, [selectedCatnr, targetSatrec, Math.floor(simulatedTimeMs / 60000)]);

  // --- สร้างเส้นเลเซอร์สัญญาณ (Line of Sight Beam) พุ่งตรงจากสถานีไปยังดาวเทียม ---
  const signalVisualPath = useMemo(() => {
    if (!linkActive || !targetData) return [];
    
    // กำหนดจุดเริ่มต้น (สถานีศรีราชาที่พื้นดิน) และจุดสิ้นสุด (ดาวเทียมบนอวกาศ)
    const gsPoint = { lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, alt: 0 };
    const satPoint = { lat: targetData.lat, lng: targetData.lng, alt: targetData.altKm / EARTH_RADIUS_KM };
    
    return [
      // 1. แกนแสงด้านใน (Core) - เส้นบาง สีขาวสว่างจ้า
      { points: [gsPoint, satPoint], color: 'rgba(255, 255, 255, 0.9)', stroke: 0.4 },
      // 2. แสงออร่าด้านนอก (Glow) - เส้นหนา สีฟ้าเรืองแสงโปร่งใส
      { points: [gsPoint, satPoint], color: 'rgba(0, 234, 255, 0.3)', stroke: 1.8 }
    ];
  }, [linkActive, targetData]);

  const updateTlesFromAPI = async () => {
    setIsUpdatingTle(true);
    setTleSource('Updating...');
    try {
      const newTles = { ...tles };
      await Promise.all(SATELLITE_OPTIONS.map(async (sat) => {
        try {
          const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.catnr}&FORMAT=tle`)}`;
          const res = await fetch(url, { cache: 'no-store' });
          const text = await res.text();
          const lines = text.trim().split('\n');
          if (lines.length >= 3) {
            newTles[sat.catnr] = { line1: lines[1].trim(), line2: lines[2].trim() };
          }
        } catch (e) { /* Ignore individual fail */ }
      }));
      setTles(newTles);
      const now = new Date();
      setTleSource(`Live (${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())})`);
    } catch (e) {
      setTleSource('Update Failed (Using Fallback)');
    } finally {
      setIsUpdatingTle(false);
    }
  };

  const thaiTime = new Date(currentDate.getTime() + 7 * 3600000);
  const formatTime = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

  return (
    <>
      <Globe
        ref={globeRef} width={size.width} height={size.height}
        backgroundColor="#000000"
        
        // 1. อัปเกรดพื้นผิวโลก (Blue Marble + Topology) และฉากหลังอวกาศ
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        
        // 2. ฟันธง: เปิดแสงชั้นบรรยากาศ (Atmosphere) ให้ขอบโลกเรืองแสงเหมือนจริง!
        showAtmosphere={true}
        atmosphereColor="#3a7eff"
        atmosphereAltitude={0.15}

        objectsData={[{ type: 'station', lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 0 }, ...allSatObjects]}
        objectLat="lat" objectLng="lng" objectAltitude="altitude"
        objectThreeObject={(d) => d.type === 'station' ? new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2), new THREE.MeshBasicMaterial({color: '#00eaff'})) : createSatelliteModel(d.isTarget)}
        
        objectLabel={(d) => {
          if (d.type !== 'satellite') return '';
          const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === d.catnr);
          const flagHtml = satInfo?.flag ? `<img src="https://flagcdn.com/w20/${satInfo.flag}.png" width="20" style="vertical-align: middle; border-radius: 2px; margin-right: 6px;" />` : '🛰️ ';
          return `
            <div style="background: rgba(0, 15, 30, 0.85); border: 1px solid #00eaff; border-radius: 4px; padding: 6px 12px; font-family: 'Rajdhani', sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.5);">
              <strong style="color: #fff; font-size: 14px; display: flex; align-items: center;">${flagHtml}${satInfo?.displayName || d.name}</strong>
              <div style="margin-top: 4px;">
                <span style="color: #00eaff; font-size: 12px;">NORAD: ${d.catnr}</span><br/>
                <span style="color: #ffb347; font-size: 12px;">Alt: ${Math.round(d.altKm)} km</span>
              </div>
            </div>
          `;
        }}
        onObjectClick={(d) => {
          if (d.type === 'satellite') {
            setSelectedCatnr(d.catnr);
            if (globeRef.current) globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: 2.2 }, 1000);
          }
        }}

        labelsData={[GROUND_STATION, ...allSatObjects]}
        labelLat="lat" labelLng="lng" labelText="name"
        labelColor={d => d.isTarget ? '#ffb347' : '#00eaff'}
        labelSize={d => d.isTarget ? 1.5 : 0.8}
        labelDotRadius={0}
        labelAltitude={d => d.altitude ? d.altitude + 0.05 : 0.02}

        // --- รวมเส้นวงโคจรเดิม เข้ากับเส้นเลเซอร์ใหม่ ---
        pathsData={[...orbitVisualPath, ...signalVisualPath]}
        pathPoints="points"
        pathPointLat="lat" pathPointLng="lng" pathPointAlt="alt"
        pathColor="color" pathStroke="stroke"
        pathResolution={4}
        pathTransitionDuration={0}

        
        ringsData={[{ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng }]}
        ringColor={() => linkActive ? t => `rgba(0, 234, 255, ${1-t})` : t => `rgba(255, 51, 51, ${1-t})`}
        ringMaxRadius={linkActive ? 8 : 4}
        ringPropagationSpeed={1.5}
        ringRepeatPeriod={800}
      />

      <div className="ui-layer">
        
      <div className="left-panel">
          <div className="panel-box main-title">
            <p>THAILAND SPACE EXPO</p>
            <h1>SATELLITE ORBIT</h1>
            <span>{targetConfig.displayName} • Thailand Satellite Ground Station</span>
          </div>

          <section className="clock-panel">
            <div className="clock-item">
              <span>THA LOCAL</span>
              <strong>{formatTime(thaiTime)}</strong>
            </div>
            <div className="clock-item">
              <span>DOY</span>
              <strong>{pad3(getUtcDayOfYear(currentDate))}</strong>
            </div>
            <div className="clock-item">
              <span>UTC</span>
              <strong>{formatTime(currentDate)}</strong>
            </div>
          </section>

          <div className="panel-box mission-status">
            
            {/* 1. ส่วนหัว: แสดงธงชาติและชื่อดาวเทียม */}
            <div className="target-header">
              {targetConfig.flag ? <img src={`https://flagcdn.com/w40/${targetConfig.flag}.png`} alt="flag" /> : <span style={{fontSize: '30px'}}>🛰️</span>}
              <h2>{targetConfig.displayName}</h2>
            </div>

            {/* 2. ป้ายสถานะ AOS */}
            <div className={`status-banner ${linkActive ? 'active' : 'standby'}`}>
              {linkActive ? 'SIGNAL ACQUIRED' : 'WAITING FOR AOS'}
            </div>

            {/* 3. ตารางข้อมูล (เพิ่ม Lat / Lng เข้าไปให้สมบูรณ์) */}
            <div className="telemetry-grid">
              <div className="t-box">
                <span>LATITUDE</span>
                <strong>{targetData ? targetData.lat.toFixed(4) : '---'}°</strong>
              </div>
              <div className="t-box">
                <span>LONGITUDE</span>
                <strong>{targetData ? targetData.lng.toFixed(4) : '---'}°</strong>
              </div>
              <div className={`t-box ${linkActive ? 'highlight' : ''}`}>
                <span>ELEVATION</span>
                <strong className={linkActive ? 'text-cyan' : ''}>{targetData?.elevationDeg.toFixed(2)}°</strong>
              </div>
              <div className="t-box">
                <span>AZIMUTH</span>
                <strong>{targetData?.azimuthDeg.toFixed(2)}°</strong>
              </div>
              <div className="t-box">
                <span>SLANT RANGE</span>
                <strong className="text-gold">{targetData ? Math.round(targetData.rangeKm).toLocaleString() : '---'} km</strong>
              </div>
              <div className="t-box">
                <span>ALTITUDE</span>
                <strong>{targetData ? targetData.altKm.toFixed(0) : '---'} km</strong>
              </div>
              <div className="t-box">
                <span>ORBITAL SPEED</span>
                <strong>{targetData ? targetData.speedKmS.toFixed(2) : '---'} km/s</strong>
              </div>
              <div className="t-box">
                <span>INCLINATION</span>
                <strong>{tles[selectedCatnr] ? getInclinationDeg(tles[selectedCatnr].line2).toFixed(2) : '---'}°</strong>
              </div>
            </div>

            <ul className="info-list">
              <li><span>Station Mask:</span> <strong>{PASS_MIN_ELEVATION_DEG.toFixed(1)}°</strong></li>
              <li><span>Telemetry (S-Band):</span> <strong>2.0 - 2.3 GHz</strong></li>
              <li><span>Payload (X-Band):</span> <strong>8.0 - 8.4 GHz</strong></li>
              <li><span>TLE Epoch:</span> <strong>{tles[selectedCatnr] ? tles[selectedCatnr].line1.substring(18, 32) : '---'}</strong></li>
              <li><span>TLE Source:</span> <strong>{tleSource}</strong></li>
            </ul>
          </div>
        </div>

        <div className="right-panel">
          <div className="control-group">
            <p>SYSTEM CONTROL</p>
            <button className={`btn ${!isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(false)}>PAUSE</button>
            <button className={`btn ${isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(true)}>PLAY</button>
            <button className="btn" onClick={() => { 
              setSimulatedTimeMs(Date.now()); 
              setSpeedMult(1); 
              setIsPlaying(true); 
              if (globeRef.current) globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
            }}>RESET NOW</button>
            <button className="btn" onClick={updateTlesFromAPI} disabled={isUpdatingTle}>
              {isUpdatingTle ? 'UPDATING...' : 'UPDATE TLE LIVE'}
            </button>
            
            {/* --- ปุ่มเปิด/ปิด กลางวัน-กลางคืน --- */}
            <button 
              className={`btn ${realtimeSun ? 'active' : ''}`} 
              onClick={() => setRealtimeSun(!realtimeSun)}
              style={{ borderColor: realtimeSun ? '#ffb347' : '', color: realtimeSun ? '#000' : '#ffb347', backgroundColor: realtimeSun ? '#ffb347' : 'rgba(255, 179, 71, 0.05)' }}
            >
              {realtimeSun ? 'SUNLIGHT: REAL-TIME' : 'SUNLIGHT: FULLY LIT'}
            </button>
          </div>

          <div className="control-group">
            <p>SPEED</p>
            <div className="speed-row">
              {/* ข้อ 3: เพิ่มปุ่ม 100X เข้าไปใน Array */}
              {[1, 10, 50, 100].map(s => (
                <button key={s} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0}} onClick={() => setSpeedMult(s)}>{s}x</button>
              ))}
            </div>
          </div>
<div className="control-group">
            <p>SATELLITE SELECTOR</p>
            <div className="sat-selector">
              {/* ใช้ Set ในการดึงชื่อหมวดหมู่ออกมาแบบไม่ซ้ำ */}
              {Array.from(new Set(SATELLITE_OPTIONS.map(s => s.group))).map(groupName => (
                <div key={groupName}>
                  
                  {/* แถบหัวข้อหมวดหมู่ กดเพื่อเปิด-ปิด */}
                  <div 
                    className={`group-header ${openGroup === groupName ? 'active' : ''}`}
                    onClick={() => setOpenGroup(openGroup === groupName ? null : groupName)}
                  >
                    <span>{groupName}</span>
                    <span>{openGroup === groupName ? '▼' : '▶'}</span>
                  </div>

                  {/* ลิสต์ปุ่มดาวเทียมย่อย ที่จะซ่อน/โชว์ */}
                  <div className={`group-content ${openGroup === groupName ? 'open' : ''}`}>
                    {SATELLITE_OPTIONS.filter(sat => sat.group === groupName).map(sat => (
                      <button 
                        key={sat.catnr} 
                        className={`btn sat-btn ${selectedCatnr === sat.catnr ? 'active' : ''}`} 
                        onClick={() => {
                          setSelectedCatnr(sat.catnr);
                          if (globeRef.current) {
                            const rec = satrecs[sat.catnr];
                            const pos = calculateSatData(currentDate, rec);
                            if (pos) globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: 2.2 }, 1000);
                          }
                        }}
                      >
                        {sat.displayName}
                      </button>
                    ))}
                  </div>

                </div>
              ))}
            </div>
          </div>
        </div> {/* <--- แท็กปิดของ right-panel ที่ถูกต้องอยู่ตรงนี้ครับ */}
      </div> {/* <--- แท็กปิดของ ui-layer */}
      
      <div className="scanlines"></div>
    </>
  );
}