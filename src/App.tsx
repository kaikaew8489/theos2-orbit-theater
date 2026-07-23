// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// ==========================================
// 1. DATA & CONFIGURATION
// ==========================================
const GROUND_STATION = { lat: 13.16, lng: 100.93, name: 'GISTDA', color: '#00eaff' };
const PASS_MIN_ELEVATION_DEG = 5;
const EARTH_RADIUS_KM = 6371;

const SATELLITE_OPTIONS = [
  // GISTDA EARTH OBSERVATION
  { catnr: '58016', name: 'THEOS-2', displayName: 'THEOS-2', flag: 'th', group: 'GISTDA EARTH OBSERVATION', operator: 'GISTDA', mission: 'High-Res Optical', telemetry: '2.0 - 2.3 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '33396', name: 'THEOS', displayName: 'THEOS', flag: 'th', group: 'GISTDA EARTH OBSERVATION', operator: 'GISTDA', mission: 'Earth Observation', telemetry: '2.0 - 2.3 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  
  // SPACE STATIONS & HUMAN SPACEFLIGHT
  { catnr: '25544', name: 'ISS (ZARYA)', displayName: 'ISS (Space Station)', flag: 'us', group: 'SPACE STATIONS', operator: 'International', mission: 'Space Station', telemetry: '2.216 GHz (S-Band)', payload: '15.003 GHz (Ku-Band)' },
  { catnr: '48274', name: 'CSS (TIANGONG)', displayName: 'TIANGONG (CSS)', flag: 'cn', group: 'SPACE STATIONS', operator: 'CMSA', mission: 'Space Station', telemetry: 'S-Band', payload: 'Ka-Band' },

  // THAI CUBESAT & MICROSAT
  { catnr: '43761', name: 'KNACKSAT-1', displayName: 'KNACKSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'KMUTNB', mission: 'Tech Demo CubeSat', telemetry: '435.590 MHz (UHF)', payload: '435.590 MHz (UHF)' },
  { catnr: '46320', name: 'NAPA-1', displayName: 'NAPA-1 / RTAF-SAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: '436.000 MHz (UHF)', payload: '436.000 MHz (UHF)' },
  { catnr: '48041', name: 'BCCSAT-1', displayName: 'BCCSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'BCC', mission: 'Educational', telemetry: '435.200 MHz (UHF)', payload: '435.200 MHz (UHF)' },
  { catnr: '48963', name: 'NAPA-2', displayName: 'NAPA-2 / RTAF-SAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: '436.000 MHz (UHF)', payload: '436.000 MHz (UHF)' },
  { catnr: '62689', name: 'LOGSATS-2', displayName: 'LOGSATS-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'EOS Orbit', mission: 'IoT Tech Demo', telemetry: '401.500 MHz (UHF)', payload: '401.500 MHz (UHF)' },
  { catnr: '67683', name: 'KNACKSAT-2', displayName: 'KNACKSAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'KMUTNB', mission: 'Tech Demo', telemetry: '435.590 MHz (UHF)', payload: '435.590 MHz (UHF)' },

  // INTERNATIONAL RADAR (SAR)
  { catnr: '32382', name: 'RADARSAT-2', displayName: 'RADARSAT-2', flag: 'ca', group: 'INTERNATIONAL RADAR (SAR)', operator: 'MDA', mission: 'SAR Imaging', telemetry: '2.215 GHz (S-Band)', payload: '8.250 GHz (X-Band)' },
  { catnr: '31598', name: 'COSMO-SKYMED-1', displayName: 'COSMO-1', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '32376', name: 'COSMO-SKYMED-2', displayName: 'COSMO-2', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '33412', name: 'COSMO-SKYMED-3', displayName: 'COSMO-3', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '37216', name: 'COSMO-SKYMED-4', displayName: 'COSMO-4', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '39634', name: 'SENTINEL-1A', displayName: 'SENTINEL-1A', flag: 'eu', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ESA', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.025 - 8.400 GHz (X-Band)' },
  { catnr: '31698', name: 'TERRASAR-X', displayName: 'TERRASAR-X', flag: 'de', group: 'INTERNATIONAL RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '36605', name: 'TANDEM-X', displayName: 'TANDEM-X', flag: 'de', group: 'INTERNATIONAL RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },

  // EARTH RESOURCES & WEATHER
  { catnr: '49260', name: 'LANDSAT-9', displayName: 'LANDSAT-9', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: '2.206 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '39084', name: 'LANDSAT-8', displayName: 'LANDSAT-8', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: '2.206 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '25994', name: 'TERRA', displayName: 'TERRA', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA', mission: 'Earth Resources', telemetry: '2.106 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '27424', name: 'AQUA', displayName: 'AQUA', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA', mission: 'Earth Resources', telemetry: '2.106 GHz (S-Band)', payload: '8.160 GHz (X-Band)' },
  { catnr: '54234', name: 'NOAA-21', displayName: 'NOAA-21 (JPSS-2)', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '43013', name: 'NOAA-20', displayName: 'NOAA-20 (JPSS-1)', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '37849', name: 'SUOMI NPP', displayName: 'SUOMI NPP', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '40697', name: 'SENTINEL-2A', displayName: 'SENTINEL-2A', flag: 'eu', group: 'EARTH RESOURCES & WEATHER', operator: 'ESA', mission: 'Earth Resources', telemetry: '2.025 GHz (S-Band)', payload: '8.025 - 8.400 GHz (X-Band)' },
  { catnr: '42063', name: 'SENTINEL-2B', displayName: 'SENTINEL-2B', flag: 'eu', group: 'EARTH RESOURCES & WEATHER', operator: 'ESA', mission: 'Earth Resources', telemetry: '2.025 GHz (S-Band)', payload: '8.025 - 8.400 GHz (X-Band)' },
  { catnr: '40115', name: 'WORLDVIEW-3', displayName: 'WORLDVIEW-3 (High-Res)', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'Maxar', mission: 'High-Res Optical', telemetry: '2.080 GHz (S-Band)', payload: '8.040 GHz (X-Band)' },
  { catnr: '38012', name: 'PLEIADES-1A', displayName: 'PLEIADES-1A (High-Res)', flag: 'fr', group: 'EARTH RESOURCES & WEATHER', operator: 'Airbus DS', mission: 'High-Res Optical', telemetry: '2.200 - 2.290 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '39019', name: 'PLEIADES 1B', displayName: 'PLEIADES-1B (High-Res)', flag: 'fr', group: 'EARTH RESOURCES & WEATHER', operator: 'Airbus DS', mission: 'High-Res Optical', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '38755', name: 'SPOT 6', displayName: 'SPOT 6', flag: 'fr', group: 'EARTH RESOURCES & WEATHER', operator: 'Airbus DS', mission: 'High-Res Optical', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '40053', name: 'SPOT 7', displayName: 'SPOT 7', flag: 'fr', group: 'EARTH RESOURCES & WEATHER', operator: 'Airbus DS', mission: 'High-Res Optical', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '28649', name: 'CARTOSAT-1', displayName: 'CARTOSAT-1', flag: 'in', group: 'EARTH RESOURCES & WEATHER', operator: 'ISRO', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '32783', name: 'CARTOSAT-2A', displayName: 'CARTOSAT-2A', flag: 'in', group: 'EARTH RESOURCES & WEATHER', operator: 'ISRO', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' }
];

const FALLBACK_TLES = {
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' },
  '33396': { line1: '1 33396U 08049A   26166.85000000  .00000100  00000-0  50000-4 0  9991', line2: '2 33396  98.5400 210.1200 0001500  85.0000 275.0000 14.20000000900001' },
  '43761': { line1: '1 43761U 18099D   26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 43761  98.1800 220.1000 0001300  88.0000 000.0000 14.59000000900009' },
  '46320': { line1: '1 46320U 20061BA  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 46320  98.1800 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '25544': { line1: '1 25544U 98067A   26201.79846070  .00005574  00000-0  10900-3 0  9995', line2: '2 25544  51.6312 133.7599 0006835 319.3995  40.6483 15.49066413576965' }
};

// ==========================================
// 2. SCI-FI CSS (INJECTED)
// ==========================================
const injectStyles = () => {
  if (document.getElementById('scifi-theater-styles')) return;
  const style = document.createElement('style');
  style.id = 'scifi-theater-styles';
  style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@500;600;700&display=swap');
    :root { --cyan: #00eaff; --gold: #ffb347; --bg: #010408; --red: #ff3333; --dark-cyan: #005f73; --green: #00ff66; }
    body { margin: 0; overflow: hidden; background: var(--bg); color: #fff; font-family: 'Rajdhani', sans-serif; }
    
    .scanlines { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1)); background-size: 100% 4px; z-index: 100; opacity: 0.6; }
    
    .ui-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; display: flex; justify-content: space-between; padding: 25px; box-sizing: border-box; z-index: 10; }
    
    .left-container { display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; height: 100%; z-index: 20; }
    .menu-toggle-btn-left { width: 42px; height: 42px; background: rgba(3, 11, 24, 0.85); border: 2px solid var(--cyan); color: var(--cyan); font-size: 22px; cursor: pointer; border-radius: 8px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); margin-bottom: 15px; flex-shrink: 0; box-shadow: 0 0 15px rgba(0,234,255,0.6), inset 0 0 10px rgba(0,234,255,0.3); text-shadow: 0 0 8px var(--cyan); }
    .menu-toggle-btn-left:hover { background: var(--cyan); color: #000; box-shadow: 0 0 30px rgba(0,234,255,1), 0 0 60px rgba(0,234,255,0.5); transform: scale(1.05); text-shadow: none; }
    
    .left-panel { width: 380px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInLeft 0.3s ease-out; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
    .left-panel::-webkit-scrollbar { display: none; }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }

    .panel-box { border: 1px solid var(--cyan); border-radius: 8px; background: rgba(3, 11, 24, 0.85); padding: 15px 20px; box-shadow: 0 0 20px rgba(0, 234, 255, 0.2), inset 0 0 10px rgba(0, 234, 255, 0.1); backdrop-filter: blur(8px); position: relative; }
    
    .main-title p { margin: 0; color: var(--cyan); font-size: 12px; letter-spacing: 3px; text-transform: uppercase; }
    .main-title h1 { margin: 5px 0; font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 900; color: #fff; text-shadow: 0 0 15px rgba(0,234,255,0.8); letter-spacing: 1px; }
    .main-title span { font-size: 11px; color: #8892b0; letter-spacing: 1px; }
    
    .clock-panel { display: flex; gap: 15px; justify-content: space-between; background: rgba(0, 0, 0, 0.6); border: 1px solid var(--cyan); border-radius: 8px; padding: 12px 15px; box-shadow: 0 0 15px rgba(0, 234, 255, 0.2) inset; }
    .clock-item { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 33%; }
    .clock-item span { font-size: 10px; color: var(--cyan); font-weight: 700; letter-spacing: 2px; margin-bottom: 2px; text-shadow: 0 0 5px var(--cyan); }
    .clock-item strong { font-family: 'Orbitron', sans-serif; font-size: 16px; color: var(--gold); font-weight: 700; font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgba(255, 179, 71, 0.8); }

    .target-header { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed var(--cyan); }
    .target-header img { width: 40px; border-radius: 4px; border: 1px solid var(--cyan); box-shadow: 0 0 10px var(--cyan); }
    .target-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 24px; font-weight: 900; color: #fff; letter-spacing: 2px; text-shadow: 0 0 10px rgba(0,234,255,0.5); }
    
    .status-banner { text-align: center; font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 2px; padding: 10px; margin-bottom: 15px; border-radius: 4px; transition: all 0.3s; }
    .status-banner.standby { background: rgba(255, 51, 51, 0.1); border: 1px solid var(--red); color: var(--red); box-shadow: 0 0 15px rgba(255, 51, 51, 0.4), inset 0 0 10px rgba(255, 51, 51, 0.2); text-shadow: 0 0 8px var(--red); }
    .status-banner.active { background: rgba(0, 234, 255, 0.15); border: 1px solid var(--cyan); color: var(--cyan); box-shadow: 0 0 20px rgba(0, 234, 255, 0.6), inset 0 0 10px rgba(0, 234, 255, 0.3); text-shadow: 0 0 8px var(--cyan); }

    .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px; }
    .t-box { background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(0, 234, 255, 0.3); border-radius: 4px; padding: 8px 12px; display: flex; flex-direction: column; }
    .t-box.highlight { border-color: var(--cyan); background: rgba(0, 234, 255, 0.1); box-shadow: inset 0 0 10px rgba(0, 234, 255, 0.2); }
    .t-box span { font-size: 10px; color: #8892b0; text-transform: uppercase; letter-spacing: 1px; }
    /* ฟันธง 1: ข้อมูล Telemetry และ Info สีขาวล้วนเรืองแสง อ่านง่าย สบายตา */
    .t-box strong { font-family: 'Orbitron', sans-serif; font-size: 15px; color: #ffffff; margin-top: 2px; text-shadow: 0 0 8px rgba(255,255,255,0.6); }

    .info-list { list-style: none; padding: 10px 0 0 0; margin: 15px 0 0 0; border-top: 1px dashed var(--cyan); font-size: 13px; line-height: 2.2; color: #ddd; }
    .info-list li { display: flex; justify-content: space-between; }
    .info-list span { color: #8892b0; }
    .info-list strong { color: #ffffff; font-weight: 600; text-shadow: 0 0 5px rgba(255,255,255,0.5); }

    /* ขวามือ */
    .right-container { display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; height: 100%; z-index: 20; }
    .menu-toggle-btn { width: 42px; height: 42px; background: rgba(3, 11, 24, 0.85); border: 2px solid var(--gold); color: var(--gold); font-size: 22px; cursor: pointer; border-radius: 8px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); margin-bottom: 15px; flex-shrink: 0; box-shadow: 0 0 15px rgba(255,179,71,0.6), inset 0 0 10px rgba(255,179,71,0.3); text-shadow: 0 0 8px var(--gold); }
    .menu-toggle-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 30px rgba(255,179,71,1), 0 0 60px rgba(255,179,71,0.5); transform: scale(1.05); text-shadow: none; }
    
    .right-panel { width: 280px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideIn 0.3s ease-out; }
    @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }

    .control-group { background: rgba(3, 11, 24, 0.85); border: 1px solid var(--cyan); border-radius: 8px; padding: 15px; margin-bottom: 15px; position: relative; transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); box-shadow: 0 0 20px rgba(0, 234, 255, 0.15), inset 0 0 10px rgba(0, 234, 255, 0.05); backdrop-filter: blur(8px); }
    .control-group p { margin: 0 0 12px 0; font-size: 13px; font-weight: 900; letter-spacing: 3px; border-bottom: 1px dashed var(--cyan); padding-bottom: 5px; color: var(--cyan); text-shadow: 0 0 8px var(--cyan); }
    
    .btn { display: block; width: 100%; background: rgba(0, 0, 0, 0.5); border: 1px solid var(--cyan); color: var(--cyan); padding: 10px; margin-bottom: 8px; font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: 700; cursor: pointer; text-align: center; border-radius: 4px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); letter-spacing: 1px; text-transform: uppercase; text-shadow: 0 0 8px var(--cyan); box-shadow: 0 0 10px rgba(0, 234, 255, 0.2), inset 0 0 8px rgba(0, 234, 255, 0.1); position: relative; overflow: hidden; }
    .btn:hover { background: rgba(0, 234, 255, 0.15) !important; color: #fff !important; border-color: #fff !important; text-shadow: 0 0 10px #fff !important; box-shadow: 0 0 25px rgba(0, 234, 255, 0.8), inset 0 0 15px rgba(0, 234, 255, 0.4) !important; transform: translateY(-1px); }
    .btn.active { background: var(--cyan) !important; color: #000 !important; border-color: var(--cyan) !important; text-shadow: none !important; box-shadow: 0 0 25px rgba(0, 234, 255, 0.9), 0 0 40px rgba(0, 234, 255, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; transform: translateY(-1px); }
    .btn:disabled { opacity: 0.3; pointer-events: none; border-color: #333; color: #555; text-shadow: none; box-shadow: none; }
    .speed-row { display: flex; gap: 5px; margin-bottom: 8px; }

    /* ฟันธง 2: กรอบ SYSTEM CONTROL สีแดงเรืองแสง / เมาส์ชี้ปุ่มเป็นสีส้มทอง */
    .control-group:nth-child(1) { border-color: rgba(255, 51, 51, 0.3); box-shadow: 0 0 20px rgba(255, 51, 51, 0.1), inset 0 0 10px rgba(255, 51, 51, 0.05); }
    .control-group:nth-child(1) p { color: var(--red); border-bottom-color: rgba(255, 51, 51, 0.4); text-shadow: 0 0 8px var(--red); }
    
    .control-group:nth-child(1) .btn { border-color: var(--red); color: var(--red); text-shadow: 0 0 8px var(--red); box-shadow: 0 0 10px rgba(255, 51, 51, 0.2), inset 0 0 8px rgba(255, 51, 51, 0.1); }
    .control-group:nth-child(1) .btn:hover { background: rgba(255, 179, 71, 0.2) !important; color: var(--gold) !important; border-color: var(--gold) !important; text-shadow: 0 0 10px var(--gold) !important; box-shadow: 0 0 25px rgba(255, 179, 71, 0.8), inset 0 0 15px rgba(255, 179, 71, 0.4) !important; }
    .control-group:nth-child(1) .btn.active { background: var(--gold) !important; color: #000 !important; border-color: var(--gold) !important; text-shadow: none !important; box-shadow: 0 0 25px rgba(255, 179, 71, 0.9), 0 0 40px rgba(255, 179, 71, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; }

    /* ฟันธง: สีเขียวและสีทองของปุ่ม กลับมาเหมือนเดิม 100% */
    .control-group:nth-child(2) { border-color: rgba(0, 255, 102, 0.2); }
    .control-group:nth-child(2) p { color: var(--green); border-bottom-color: rgba(0, 255, 102, 0.3); text-shadow: 0 0 8px var(--green); }
    .control-group:nth-child(2) .speed-row .btn { border-color: rgba(0, 255, 102, 0.4); color: var(--green); background: rgba(0, 255, 102, 0.05); text-shadow: 0 0 6px rgba(0, 255, 102, 0.6); box-shadow: inset 0 0 8px rgba(0, 255, 102, 0.15); }
    .control-group:nth-child(2) .speed-row .btn:hover { background: rgba(255, 255, 255, 0.15) !important; color: #fff !important; border-color: #fff !important; text-shadow: 0 0 10px #fff !important; box-shadow: 0 0 20px rgba(255, 255, 255, 0.6), inset 0 0 10px rgba(255, 255, 255, 0.3) !important; transform: translateY(-1px); }
    .control-group:nth-child(2) .speed-row .btn.active { background: var(--green) !important; color: #000 !important; border-color: var(--green) !important; text-shadow: none !important; box-shadow: 0 0 20px rgba(0, 255, 102, 0.8), 0 0 40px rgba(0, 255, 102, 0.4), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; transform: translateY(-1px); }

    .control-group:nth-child(3) { border-color: rgba(255, 179, 71, 0.2); text-align: center; padding: 20px; }
    .control-group:nth-child(3) p { color: var(--gold); border-bottom-color: rgba(255, 179, 71, 0.3); text-shadow: 0 0 8px var(--gold); }
    .database-btn { border-color: var(--gold) !important; color: var(--gold) !important; font-size: 15px !important; padding: 15px !important; text-shadow: 0 0 8px var(--gold); }
    .database-btn:hover { background: rgba(255, 179, 71, 0.15) !important; box-shadow: 0 0 20px rgba(255, 179, 71, 0.5), inset 0 0 10px rgba(255, 179, 71, 0.2) !important; color: #fff !important; border-color: #fff !important; }

    /* ==================================================
       ฟันธง: POPUP MODAL ให้เหมือนรูปเป๊ะ 100%
       ================================================== */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(10px); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s ease; }
    
    .modal-box { background: #030a14; border: 2px solid var(--cyan); border-radius: 12px; width: 95%; max-width: 900px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 0 40px rgba(0, 234, 255, 0.5), inset 0 0 20px rgba(0, 234, 255, 0.2); position: relative; overflow: hidden; }
    
    .modal-header { padding: 20px 25px; border-bottom: 1px solid rgba(0, 234, 255, 0.4); display: flex; justify-content: space-between; align-items: center; background: linear-gradient(180deg, rgba(0, 234, 255, 0.1) 0%, transparent 100%); }
    .modal-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 20px; color: #fff; letter-spacing: 2px; display: flex; align-items: center; gap: 10px; text-shadow: 0 0 10px var(--cyan); }
    
    .modal-close-btn { background: rgba(255, 51, 51, 0.05); border: 2px solid var(--red); color: var(--red); width: 40px; height: 40px; border-radius: 50%; font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s; box-shadow: 0 0 15px rgba(255, 51, 51, 0.6), inset 0 0 10px rgba(255, 51, 51, 0.3); text-shadow: 0 0 5px var(--red); }
    .modal-close-btn:hover { background: var(--red); color: #fff; box-shadow: 0 0 30px rgba(255, 51, 51, 1), 0 0 50px rgba(255, 51, 51, 0.6); transform: scale(1.1); text-shadow: none; }

    .modal-content { padding: 25px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; display: flex; flex-direction: column; gap: 20px; }
    .modal-content::-webkit-scrollbar { display: none; }
    
    .modal-group-title { color: var(--cyan); font-size: 13px; font-weight: 800; letter-spacing: 2px; border-bottom: 1px dashed rgba(0, 234, 255, 0.4); padding-bottom: 8px; margin-bottom: 12px; text-transform: uppercase; font-family: 'Orbitron', sans-serif; text-shadow: 0 0 8px rgba(0, 234, 255, 0.5); }
    .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }
    
    .modal-sat-btn { background: rgba(0, 255, 102, 0.05); border: 1px solid var(--green); color: #fff; padding: 14px 18px; border-radius: 6px; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s; text-align: left; display: flex; align-items: center; justify-content: space-between; letter-spacing: 1px; }
    .modal-sat-btn:hover { background: rgba(0, 255, 102, 0.15); box-shadow: 0 0 15px rgba(0, 255, 102, 0.3); }
    
    .modal-sat-btn.secondary { background: var(--green) !important; color: #000 !important; border-color: var(--green) !important; box-shadow: 0 0 20px rgba(0, 255, 102, 0.6) !important; font-weight: 800; }
    .modal-sat-btn.primary { background: rgba(255, 51, 51, 0.2) !important; color: #fff !important; border: 2px solid var(--red) !important; box-shadow: 0 0 25px rgba(255, 51, 51, 0.8), inset 0 0 10px rgba(255, 51, 51, 0.4) !important; text-shadow: 0 0 8px #fff !important; font-weight: 900; z-index: 10; }

    /* ==================================================
       ฟันธง: 2D MAP - เปลียนไปใช้ภาพแบบสะอาดตา 
       ================================================== */
    .flat-map-wrap { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 5; padding: 25px 280px 25px 420px; box-sizing: border-box; transition: padding 0.3s ease-in-out; }
    .flat-map-wrap.panel-closed { padding-right: 25px; }
    .flat-map-wrap.left-panel-closed { padding-left: 25px; }
    .flat-map-container { position: relative; width: 100%; aspect-ratio: 2 / 1; max-height: 100vh; max-width: 200vh; background-color: #000; box-shadow: 0 0 50px rgba(0, 234, 255, 0.2); border: 2px solid var(--cyan); border-radius: 8px; overflow: hidden; }
    .map-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
    
    .map-marker { position: absolute; transform: translate(-50%, -50%); cursor: pointer; pointer-events: auto; display: flex; flex-direction: column; align-items: center; transition: transform 0.2s; z-index: 3; }
    .map-marker:hover { transform: translate(-50%, -50%) scale(1.5); z-index: 20 !important; }
    .map-marker span.dot { width: 5px; height: 5px; background: currentColor; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
    .map-marker span.target-dot { width: 10px; height: 10px; background: currentColor; border-radius: 2px; box-shadow: 0 0 15px currentColor; animation: pulse 2s infinite; }
    .map-marker span.label { margin-top: 4px; font-size: 10px; font-weight: 700; white-space: nowrap; font-family: 'Rajdhani', sans-serif; text-shadow: 0 0 4px #000, 0 0 6px #000; }

    .map-marker .map-tooltip { display: none; position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%); background: rgba(0, 15, 30, 0.95); border: 1px solid var(--cyan); border-radius: 4px; padding: 8px 12px; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 13px; white-space: nowrap; pointer-events: none; box-shadow: 0 4px 15px rgba(0,234,255,0.4); z-index: 30; }
    .map-marker:hover .map-tooltip { display: block; }
    .map-tooltip img { vertical-align: middle; border-radius: 2px; margin-right: 6px; width: 18px; }
    .map-tooltip span.norad { display: block; color: var(--cyan); font-size: 11px; margin-top: 3px; }
    .map-tooltip span.alt { display: block; color: var(--gold); font-size: 11px; }

    @media (max-width: 900px) {
      .ui-layer { flex-direction: column; padding: 10px; height: 100vh; overflow-y: auto; justify-content: flex-start; gap: 15px; pointer-events: none; }
      .ui-layer::-webkit-scrollbar { display: none; }
      .left-container, .right-panel { width: 100%; pointer-events: auto; }
      .flat-map-wrap { padding: 10px; }
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
    let lat = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(tc));
    let lon = lon1 + Math.atan2(Math.sin(tc) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat));
    
    lon = (lon + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
    coords.push([toDegrees(lon), toDegrees(lat)]);
  }
  return coords;
}

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
  const fileInputRef = useRef(null); 
  const isTrackingRef = useRef(false);

  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  const [tles, setTles] = useState(() => {
    try {
      const saved = localStorage.getItem('gistda_tles');
      return saved ? JSON.parse(saved) : FALLBACK_TLES;
    } catch(e) { return FALLBACK_TLES; }
  });
  const [tleSource, setTleSource] = useState(() => {
    return localStorage.getItem('gistda_tles') ? 'Restored from Memory' : 'Fallback / Built-in';
  });

  const [isUpdatingTle, setIsUpdatingTle] = useState(false);
  const [selectedCatnr, setSelectedCatnr] = useState(SATELLITE_OPTIONS[0].catnr);
  const [selectedCatnrs, setSelectedCatnrs] = useState([SATELLITE_OPTIONS[0].catnr]); 
  
  const [simulatedTimeMs, setSimulatedTimeMs] = useState(Date.now());
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);
  const [realtimeSun, setRealtimeSun] = useState(false);
  
  const [showGroundTrack, setShowGroundTrack] = useState(false);
  
  const [isFlatMap, setIsFlatMap] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true); 
  const [cameraMode, setCameraMode] = useState('FREE LOOK');

  const [isModalOpen, setIsModalOpen] = useState(false);

  // คำนวณตำแหน่งดวงอาทิตย์
  const currentSunPos = useMemo(() => {
    const d = new Date(simulatedTimeMs);
    const doy = getUtcDayOfYear(d);
    const dec = -23.44 * Math.cos((2 * Math.PI / 365.24) * (doy + 10));
    const hrs = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    let lon = 180 - (hrs * 15);
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return { lat: dec, lng: lon };
  }, [Math.floor(simulatedTimeMs / 60000)]);

  const satrecs = useMemo(() => {
    const recs = {};
    Object.keys(tles).forEach(cat => {
      if (tles[cat].line1 && tles[cat].line2) {
        recs[cat] = satelliteJs.twoline2satrec(tles[cat].line1, tles[cat].line2);
      }
    });
    return recs;
  }, [tles]);

  useEffect(() => {
    injectStyles();
    const handleResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    
    setTimeout(() => {
      if (globeRef.current) {
        globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
        const controls = globeRef.current.controls();
        controls.autoRotate = false;
        
        controls.addEventListener('start', () => {
          if (typeof isTrackingRef !== 'undefined' && isTrackingRef.current) {
            isTrackingRef.current = false;
            setCameraMode('FREE LOOK');
          }
        });
      }
    }, 500);

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => setSimulatedTimeMs(prev => prev + (50 * speedMult)), 50);
    return () => clearInterval(timer);
  }, [isPlaying, speedMult]);

  useEffect(() => {
    if (isPlaying && globeRef.current && selectedCatnr && !isFlatMap && isTrackingRef.current) {
      try {
        const rec = satrecs[selectedCatnr];
        if (rec) {
          const pos = calculateSatData(new Date(simulatedTimeMs), rec);
          if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
            const currentPov = globeRef.current.pointOfView();
            const safeAltitude = (currentPov && !isNaN(currentPov.altitude)) ? currentPov.altitude : 2.2;
            globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: safeAltitude }, 0);
          }
        }
      } catch (err) { }
    }
  }, [simulatedTimeMs, selectedCatnr, isFlatMap, isPlaying, satrecs]);

  // REAL-TIME DAY/NIGHT ENGINE
  useEffect(() => {
    if (!globeRef.current) return;
    const globe = globeRef.current;
    
    if (!globe.scene || !globe.camera) return;
    const scene = globe.scene();
    const camera = globe.camera();
    if (!scene || !camera || !scene.children || !camera.children) return;

    const camLight = camera.children.find(c => c.type === 'DirectionalLight');
    if (camLight) camLight.intensity = realtimeSun ? 0 : 1;

    const ambient = scene.children.find(c => c.type === 'AmbientLight');
    if (ambient) ambient.intensity = realtimeSun ? 0.02 : 0.6; 

    let sunLight = scene.children.find(c => c.name === 'SunLight');
    
    if (!sunLight) {
      sunLight = new THREE.DirectionalLight(0xffffff, 5.0); 
      sunLight.name = 'SunLight';
      scene.add(sunLight);
    }

    if (realtimeSun) {
      const sunPos = globe.getCoords(currentSunPos.lat, currentSunPos.lng, 100); 
      sunLight.position.set(sunPos.x, sunPos.y, sunPos.z);
      sunLight.visible = true;
    } else {
      sunLight.visible = false;
    }
  }, [realtimeSun, currentSunPos]);

  const currentDate = new Date(simulatedTimeMs);
  const targetSatrec = selectedCatnr ? satrecs[selectedCatnr] : null;
  const targetData = targetSatrec ? calculateSatData(currentDate, targetSatrec) : null;
  const targetConfig = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr) || SATELLITE_OPTIONS[0];
  const linkActive = targetData && targetData.elevationDeg >= PASS_MIN_ELEVATION_DEG;

  const allSatObjects = useMemo(() => {
    return SATELLITE_OPTIONS.map(sat => {
      if (!satrecs[sat.catnr]) return null;
      const data = calculateSatData(currentDate, satrecs[sat.catnr]);
      if (!data) return null;
      return {
        ...data, 
        type: 'satellite', 
        name: sat.displayName,
        catnr: sat.catnr,
        isTarget: sat.catnr === selectedCatnr,
        altitude: Math.max(0.05, data.altKm / EARTH_RADIUS_KM)
      };
    }).filter(Boolean);
  }, [currentDate, satrecs, selectedCatnr]);

  const orbitVisualPath = useMemo(() => {
    if (!targetSatrec) return [];
    const points = [];
    for (let m = -60; m <= 60; m += 0.5) {
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pos = calculateSatData(d, targetSatrec);
      if (pos && !isNaN(pos.lat) && !isNaN(pos.lng) && !isNaN(pos.altKm)) {
        points.push({ lat: pos.lat, lng: pos.lng, alt: Math.max(0.01, pos.altKm / EARTH_RADIUS_KM) });
      }
    }
    if (points.length < 2) return [];
    return [{ points, color: 'rgba(255, 179, 71, 0.8)', stroke: 1.0 }]; 
  }, [selectedCatnr, targetSatrec, Math.floor(simulatedTimeMs / 60000)]);

  const groundTrackPath = useMemo(() => {
    if (!targetSatrec || !showGroundTrack) return [];
    const points = [];
    for (let m = 0; m <= 1440; m += 1) {
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pos = calculateSatData(d, targetSatrec);
      if (pos && !isNaN(pos.lat) && !isNaN(pos.lng) && !isNaN(pos.altKm)) {
        points.push({ lat: pos.lat, lng: pos.lng, alt: Math.max(0.01, pos.altKm / EARTH_RADIUS_KM) });
      }
    }
    if (points.length < 2) return [];
   // ฟันธง 1: เส้น 3D Ground Track สีเหลืองทอง ความหนา 0.2 (สำหรับลูกโลก)
   return [{ points, color: 'rgba(255, 215, 0, 0.8)', stroke: 0.3 }];
  }, [selectedCatnr, targetSatrec, Math.floor(simulatedTimeMs / 60000), showGroundTrack]);
  
  const footprintBoundaryPath = useMemo(() => {
    if (!targetData || targetData.altKm <= 0) return [];
    const radiusDeg = getFootprintRadiusDeg(targetData.altKm, PASS_MIN_ELEVATION_DEG);
    if (isNaN(radiusDeg)) return [];
    const pts = getCirclePolygon(targetData.lat, targetData.lng, radiusDeg, 64).map(c => ({ lng: c[0], lat: c[1], alt: 0.001 }));
    if (pts.length < 3) return [];
    // ฟันธง 2: เส้นขอบ Foot Print สีแดงสด 100% และเพิ่มความหนาให้คมกริบ (stroke: 1.5)
    return [{ points: pts, color: 'rgba(255, 51, 51, 1)', stroke: 1.5 }];
  }, [targetData]);

  const signalVisualPath = useMemo(() => {
    if (!linkActive || !targetData || isNaN(targetData.lat) || isNaN(targetData.lng)) return [];
    const gsPoint = { lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, alt: 0 };
    const satPoint = { lat: targetData.lat, lng: targetData.lng, alt: Math.max(0, targetData.altKm) / EARTH_RADIUS_KM };
    return [
      { points: [gsPoint, satPoint], color: 'rgba(255, 255, 255, 0.9)', stroke: 0.4 },
      { points: [gsPoint, satPoint], color: 'rgba(0, 234, 255, 0.3)', stroke: 1.8 }
    ];
  }, [linkActive, targetData]);

  const footprintPolygonData = useMemo(() => {
    if (!targetData || targetData.altKm <= 0) return [];
    const radiusDeg = getFootprintRadiusDeg(targetData.altKm, PASS_MIN_ELEVATION_DEG);
    if (isNaN(radiusDeg)) return [];
    const circleCoords = getCirclePolygon(targetData.lat, targetData.lng, radiusDeg, 64);
    return [{
      coords: circleCoords,
      fillColor: 'rgba(255, 51, 51, 0.15)'
    }];
  }, [targetData]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsUpdatingTle(true);
    setTleSource('Reading File...');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.trim().split(/\r?\n/);
        const newTles = { ...tles };
        let successCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('1 ')) {
            const line1 = line;
            const line2 = lines[i + 1] ? lines[i + 1].trim() : '';
            if (line2.startsWith('2 ')) {
              const catnr = line1.substring(2, 7).trim();
              if (SATELLITE_OPTIONS.find(s => s.catnr === catnr)) {
                newTles[catnr] = { line1, line2 };
                successCount++;
              }
            }
          }
        }

        if (successCount > 0) {
          setTles(newTles);
          try {
            localStorage.setItem('gistda_tles', JSON.stringify(newTles)); 
          } catch(e) {}
          const now = new Date();
          setTleSource(`Manual Upload (${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())})`);
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
    reader.readAsText(file);
  };

  const thaiTime = new Date(currentDate.getTime() + 7 * 3600000);
  const formatTime = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

  const pathsToDraw3D = [...orbitVisualPath, ...signalVisualPath, ...footprintBoundaryPath];
  if (showGroundTrack) pathsToDraw3D.push(...groundTrackPath);

  return (
    <>
      <Globe
        ref={globeRef} width={size.width} height={size.height}
        backgroundColor="#000000"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        showAtmosphere={true}
        atmosphereColor="#3a7eff"
        atmosphereAltitude={0.15}

        objectsData={[...allSatObjects]}
        objectLat="lat" objectLng="lng" objectAltitude="altitude"
        objectThreeObject={(d) => createSatelliteModel(d.isTarget)}
        
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
            if (!selectedCatnrs.includes(d.catnr)) setSelectedCatnrs([...selectedCatnrs, d.catnr]);
            isTrackingRef.current = true;
            setCameraMode('TRACKING');
            if (globeRef.current) globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: 2.2 }, 1000);
          }
        }}

        labelsData={[GROUND_STATION]} 
        labelLat="lat" labelLng="lng" labelText="name"
        labelColor={() => '#00eaff'}
        labelSize={0.4}
        labelDotRadius={0}
        labelAltitude={0.02}

        htmlElementsData={allSatObjects.filter(sat => sat.isTarget)}
        htmlLat="lat" htmlLng="lng" htmlAltitude="altitude"
        htmlElement={d => {
          const el = document.createElement('div');
          const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === d.catnr);
          const flagUrl = satInfo?.flag ? `https://flagcdn.com/w20/${satInfo.flag}.png` : '';
          el.innerHTML = `
            <div style="display: flex; align-items: center; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 14px; font-weight: bold; letter-spacing: 1px; text-shadow: 0 0 5px #000, 0 0 10px #000; transform: translate(15px, -15px); pointer-events: none; white-space: nowrap;">
              ${flagUrl ? `<img src="${flagUrl}" style="width:18px; margin-right:6px; border-radius:2px; box-shadow: 0 0 4px rgba(0,0,0,0.8);" />` : ''}
              ${d.name}
            </div>`;
          return el;
        }}

        pathsData={pathsToDraw3D}
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

        polygonsData={footprintPolygonData}
        polygonGeoJsonGeometry={d => ({ type: 'Polygon', coordinates: [d.coords] })}
        polygonCapColor={d => d.fillColor}
        polygonSideColor={() => 'transparent'}
        polygonStrokeColor={() => 'transparent'} 
        polygonAltitude={0.015}
        polygonTransitionDuration={0}
      />

      {isFlatMap && (
        <div className={`flat-map-wrap ${!isRightPanelOpen ? 'panel-closed' : ''} ${!isLeftPanelOpen ? 'left-panel-closed' : ''}`}>
          <div 
            className="flat-map-container"
            style={{
              /* ฟันธง: 2D MAP สลับกลางวันกลางคืนด้วยภาพคมชัดจาก NASA 100% ตรงสเปค ไม่เละแน่นอน */
              backgroundImage: realtimeSun 
                ? "url('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')" 
                : "url('//unpkg.com/three-globe/example/img/earth-night.jpg')",
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-svg">
              {orbitVisualPath.map((pathObj, i) => {
                const segments = [];
                let currentPoints = [];
                pathObj.points.forEach((p, idx) => {
                  if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 180) {
                    segments.push(currentPoints);
                    currentPoints = [];
                  }
                  currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                });
                if (currentPoints.length > 0) segments.push(currentPoints);
                return segments.map((seg, j) => (
                  // ฟันธง 2: แยกสเกล 2D ออกมา บังคับเส้นให้บางเฉียบที่ 0.05 เพื่อให้สัมพันธ์กับแผนที่ SVG
                  <polyline key={`gt-${i}-${j}`} points={seg.join(' ')} fill="none" stroke={pathObj.color} strokeWidth="0.02" />
                ));
              })}

              {showGroundTrack && groundTrackPath.map((pathObj, i) => {
                const segments = [];
                let currentPoints = [];
                pathObj.points.forEach((p, idx) => {
                  if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 180) {
                    segments.push(currentPoints);
                    currentPoints = [];
                  }
                  currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                });
                if (currentPoints.length > 0) segments.push(currentPoints);
                return segments.map((seg, j) => (
                  <polyline key={`gt-${i}-${j}`} points={seg.join(' ')} fill="none" stroke={pathObj.color} strokeWidth={pathObj.stroke} />
                ));
              })}
              
              {linkActive && targetData && !isNaN(targetData.lat) && !isNaN(targetData.lng) && (
                <line
                  x1={`${(GROUND_STATION.lng + 180) / 360 * 100}`} y1={`${(90 - GROUND_STATION.lat) / 180 * 100}`}
                  x2={`${(targetData.lng + 180) / 360 * 100}`} y2={`${(90 - targetData.lat) / 180 * 100}`}
                  stroke="rgba(0, 234, 255, 0.8)" strokeWidth="0.3"
                />
              )}

              {allSatObjects.filter(sat => selectedCatnrs.includes(sat.catnr)).map(sat => {
                const isPrimary = sat.catnr === selectedCatnr;
                const radiusDeg = getFootprintRadiusDeg(sat.altKm, PASS_MIN_ELEVATION_DEG);
                if (isNaN(radiusDeg)) return null;
                
                return (
                  <ellipse 
                    key={`fp-${sat.catnr}`}
                    cx={`${(sat.lng + 180) / 360 * 100}`} 
                    cy={`${(90 - sat.lat) / 180 * 100}`} 
                    rx={`${radiusDeg / 360 * 100}`}
                    ry={`${radiusDeg / 180 * 100}`}
                    fill={isPrimary ? "rgba(255, 51, 51, 0.15)" : "rgba(0, 234, 255, 0.1)"}
                    stroke={isPrimary ? "rgba(255, 51, 51, 0.8)" : "rgba(0, 234, 255, 0.5)"}
                    strokeWidth="0.2"
                  />
                );
              })}
            </svg>

            <div className="map-marker" style={{ left: `${(GROUND_STATION.lng + 180) / 360 * 100}%`, top: `${(90 - GROUND_STATION.lat) / 180 * 100}%`, color: '#00eaff', zIndex: 5 }}>
              {/* ฟันธง: เปลี่ยนเป็นไอคอนจานดาวเทียม GS พร้อมปรับขนาดและแสงเฟลอร์ให้เด่นขึ้น */}
              <span style={{ fontSize: '20px', textShadow: '0 0 15px #00eaff', marginBottom: '2px' }}>📡</span>
              <span className="label" style={{ fontSize: '13px', fontWeight: '900', textShadow: '0 0 8px #00eaff', color: '#00eaff' }}>GISTDA</span>
            </div>

            {allSatObjects.map(sat => {
              const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === sat.catnr);
              
              // ฟันธง: เช็คสถานะดวงรอง (ดวงที่ถูกเลือก แต่ไม่ใช่ดวงหลัก)
              const isSecondary = selectedCatnrs.includes(sat.catnr) && !sat.isTarget;

              return (
              <div
                key={sat.catnr}
                className="map-marker"
                style={{
                  left: `${(sat.lng + 180) / 360 * 100}%`,
                  top: `${(90 - sat.lat) / 180 * 100}%`,
                  // ฟันธง: แยกสี 3 ระดับ แดง(หลัก) / ส้มทอง(รอง) / เขียว(ทั่วไป)
                  color: sat.isTarget ? '#ff3333' : isSecondary ? '#ffb347' : '#00ff66',
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
                <span 
                  className={sat.isTarget ? 'target-dot' : 'dot'} 
                  style={{ 
                    boxShadow: sat.isTarget ? '0 0 15px #ff3333' : isSecondary ? '0 0 10px #ffb347' : '0 0 8px #00ff66' 
                  }}>
                </span>
                <span className="label" style={{ 
                  color: sat.isTarget ? '#ffffff' : isSecondary ? '#ffb347' : '#00ff66', 
                  fontSize: sat.isTarget ? '12px' : isSecondary ? '11px' : '9.5px', // ปรับขนาดดวงรองให้ใหญ่กว่าดวงปกตินิดนึง
                  opacity: 1, 
                  fontWeight: '800',
                  textShadow: sat.isTarget ? '0 0 8px #ff3333, 0 0 15px #ff3333' : isSecondary ? '0 0 6px #ffb347, 0 0 12px #000' : '0 0 6px #00ff66, 0 0 12px #000' 
                }}>
                  {sat.name}
                </span>
                
                <div className="map-tooltip">
                  <strong style={{ display: 'flex', alignItems: 'center' }}>
                    {satInfo?.flag ? <img src={`https://flagcdn.com/w20/${satInfo.flag}.png`} alt="flag" /> : '🛰️ '}
                    {satInfo?.displayName || sat.name}
                  </strong>
                  <span className="norad">NORAD: {sat.catnr}</span>
                  <span className="alt">Alt: {Math.round(sat.altKm)} km</span>
                </div>
              </div>
            )})}
          </div>
        </div>
      )}

      <div className="ui-layer">
        
        <div className="left-container">
          <button 
            className="menu-toggle-btn-left"
            onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
          >
            {isLeftPanelOpen ? '✕' : '☰'}
          </button>
          
          {isLeftPanelOpen && (
            <div className="left-panel">
              <div className="panel-box main-title">
                <p>THAILAND SPACE EXPO</p>
                <h1>SATELLITE ORBIT</h1>
                <span>{targetConfig.displayName} • Thailand Satellite Ground Station</span>
              </div>

              <section className="clock-panel">
                <div className="clock-item">
                  <span>THA LOCAL</span>
                  {/* ฟันธง 3: เวลาเป็นสีแดง */}
                  <strong style={{ color: 'var(--red)', textShadow: '0 0 10px rgba(255, 51, 51, 0.8)' }}>{formatTime(thaiTime)}</strong>
                </div>
                <div className="clock-item">
                  <span>DOY</span>
                  {/* ฟันธง 3: DOY เป็นสีส้มคงไว้ */}
                  <strong>{pad3(getUtcDayOfYear(currentDate))}</strong>
                </div>
                <div className="clock-item">
                  <span>UTC</span>
                  {/* ฟันธง 3: เวลาเป็นสีแดง */}
                  <strong style={{ color: 'var(--red)', textShadow: '0 0 10px rgba(255, 51, 51, 0.8)' }}>{formatTime(currentDate)}</strong>
                </div>
              </section>

              <div className="panel-box mission-status">
                <div className="target-header">
                  {targetConfig.flag ? <img src={`https://flagcdn.com/w40/${targetConfig.flag}.png`} alt="flag" /> : <span style={{fontSize: '30px'}}>🛰️</span>}
                  <h2>{targetConfig.displayName}</h2>
                </div>

                <div className={`status-banner ${linkActive ? 'active' : 'standby'}`}>
                  {linkActive ? 'SIGNAL ACQUIRED' : 'WAITING FOR AOS'}
                </div>

                {/* ฟันธง 1: ลบคลาสสีที่ปนกันออกให้หมด CSS จะจัดการให้เป็นสีขาวล้วนเรืองแสงเอง */}
                <div className="telemetry-grid">
                  <div className="t-box">
                    <span>LATITUDE</span>
                    <strong>{targetData && !isNaN(targetData.lat) ? targetData.lat.toFixed(4) : '---'}°</strong>
                  </div>
                  <div className="t-box">
                    <span>LONGITUDE</span>
                    <strong>{targetData && !isNaN(targetData.lng) ? targetData.lng.toFixed(4) : '---'}°</strong>
                  </div>
                  <div className={`t-box ${linkActive ? 'highlight' : ''}`}>
                    <span>ELEVATION</span>
                    <strong>{targetData && !isNaN(targetData.elevationDeg) ? targetData.elevationDeg.toFixed(2) : '---'}°</strong>
                  </div>
                  <div className="t-box">
                    <span>AZIMUTH</span>
                    <strong>{targetData && !isNaN(targetData.azimuthDeg) ? targetData.azimuthDeg.toFixed(2) : '---'}°</strong>
                  </div>
                  <div className="t-box">
                    <span>SLANT RANGE</span>
                    <strong>{targetData && !isNaN(targetData.rangeKm) ? Math.round(targetData.rangeKm).toLocaleString() : '---'} km</strong>
                  </div>
                  <div className="t-box">
                    <span>ALTITUDE</span>
                    <strong>{targetData && !isNaN(targetData.altKm) ? targetData.altKm.toFixed(0) : '---'} km</strong>
                  </div>
                  <div className="t-box">
                    <span>ORBITAL SPEED</span>
                    <strong>{targetData && !isNaN(targetData.speedKmS) ? targetData.speedKmS.toFixed(2) : '---'} km/s</strong>
                  </div>
                  <div className="t-box">
                    <span>INCLINATION</span>
                    <strong>{tles[selectedCatnr] ? getInclinationDeg(tles[selectedCatnr].line2).toFixed(2) : '---'}°</strong>
                  </div>
                </div>

                {/* ฟันธง 1: ลบสไตล์สีมั่วๆ ออกให้หมด */}
                <ul className="info-list">
                  <li><span>Operator / Agency:</span> <strong>{targetConfig.operator || 'Unknown'}</strong></li>
                  <li><span>Mission Type:</span> <strong>{targetConfig.mission || 'Various'}</strong></li>
                  <li><span>Orbit Class:</span> <strong>LEO (Sun-Synchronous)</strong></li>
                  
                  <li><span>Station Mask:</span> <strong>{PASS_MIN_ELEVATION_DEG.toFixed(1)}°</strong></li>
                  <li><span>Telemetry (TT&C):</span> <strong>{targetConfig.telemetry || 'N/A'}</strong></li>
                  <li><span>Payload Downlink:</span> <strong>{targetConfig.payload || 'N/A'}</strong></li>
                  
                  <li><span>TLE Epoch:</span> <strong>{tles[selectedCatnr] ? tles[selectedCatnr].line1.substring(18, 32) : '---'}</strong></li>
                  <li><span>TLE Source:</span> <strong>{tleSource}</strong></li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="right-container">
          <button 
            className="menu-toggle-btn"
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
          >
            {isRightPanelOpen ? '✕' : '☰'}
          </button>
          
          {isRightPanelOpen && (
            <div className="right-panel">
              <div className="control-group">
                <p>SYSTEM CONTROL</p>
                <button className={`btn ${!isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(false)}>PAUSE</button>
                <button className={`btn ${isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(true)}>PLAY</button>
                <button className="btn" onClick={() => { 
                  setSimulatedTimeMs(Date.now()); 
                  setSpeedMult(1); 
                  setIsPlaying(true); 
                  isTrackingRef.current = false;
                  setCameraMode('FREE LOOK');
                  setSelectedCatnr(null);
                  setSelectedCatnrs([]); 
                  setShowGroundTrack(false);
                  if (globeRef.current) globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
                }}>RESET NOW</button>
                
                <input 
                  type="file" 
                  accept=".txt,.tle" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleFileUpload} 
                />
                <button 
                  className="btn" 
                  onClick={() => fileInputRef.current && fileInputRef.current.click()} 
                  disabled={isUpdatingTle}
                >
                  {isUpdatingTle ? 'READING FILE...' : 'UPDATE TLE MANUAL'}
                </button>
                
                <button 
                  className={`btn ${realtimeSun ? 'active' : ''}`} 
                  onClick={() => setRealtimeSun(!realtimeSun)}
                >
                  {/* ฟันธง: เปลี่ยนข้อความสลับไปมาให้รู้สถานะเหมือนปุ่ม 2D/3D */}
                  {realtimeSun ? 'SUNLIGHT: REAL-TIME' : 'SUNLIGHT: FULLY LIT'}
                </button>
                
                <button 
                  className={`btn ${isFlatMap ? 'active' : ''}`} 
                  onClick={() => setIsFlatMap(!isFlatMap)}
                  style={{ marginTop: '8px' }}
                >
                  {/* ฟันธง 3: ถ้าเป็นโหมด 2D อยู่ ให้ปุ่มขึ้นคำว่า VIEW: 3D GLOBE เพื่อให้รู้ว่ากดเพื่อกลับไปลูกโลก */}
                  {isFlatMap ? 'VIEW: 3D GLOBE' : 'VIEW: 2D TACTICAL MAP'}
                </button>

                <button 
                  className={`btn ${showGroundTrack ? 'active' : ''}`} 
                  onClick={() => setShowGroundTrack(!showGroundTrack)}
                  style={{ marginTop: '8px' }}
                >
                  24H GROUNDTRACK
                </button>

                <button 
                  className={`btn ${cameraMode === 'TRACKING' ? 'active' : ''}`} 
                  onClick={() => {
                    const newMode = cameraMode === 'TRACKING' ? 'FREE LOOK' : 'TRACKING';
                    setCameraMode(newMode);
                    isTrackingRef.current = (newMode === 'TRACKING');
                    
                    if (newMode === 'TRACKING' && selectedCatnr && globeRef.current) {
                      try {
                        const rec = satrecs[selectedCatnr];
                        if (rec) {
                            const pos = calculateSatData(new Date(simulatedTimeMs), rec);
                            if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
                              const currentPov = globeRef.current.pointOfView();
                              const safeAltitude = (currentPov && !isNaN(currentPov.altitude)) ? currentPov.altitude : 2.2;
                              globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: safeAltitude }, 1000);
                            }
                        }
                      } catch (err) {}
                    }
                  }}
                  style={{ marginTop: '8px' }}
                >
                  CAMERA TRACKING
                </button>
              </div>

              <div className="control-group">
                <p>SPEED</p>
                <div className="speed-row">
                  {[1, 100, 300, 500].map(s => (
                    <button key={s} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0}} onClick={() => setSpeedMult(s)}>{s}X</button>
                  ))}
                </div>
              </div>

              <div className="control-group" style={{ padding: '20px', textAlign: 'center' }}>
                <p>SATELLITE DATABASE</p>
                <button 
                  className="btn database-btn" 
                  onClick={() => setIsModalOpen(true)}
                >
                  🛰️ OPEN DATABASE
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-header">
              <h2><span style={{fontSize:'24px', marginRight:'5px'}}>🛰️</span> SATELLITE DATABASE</h2>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>✕</button>
            </div>
            
            <div className="modal-content">
              {Array.from(new Set(SATELLITE_OPTIONS.map(s => s.group))).map(groupName => (
                <div key={groupName}>
                  <div className="modal-group-title">{groupName}</div>
                  <div className="modal-grid">
                    {SATELLITE_OPTIONS.filter(sat => sat.group === groupName).map(sat => (
                      <button 
                        key={sat.catnr} 
                        className={`modal-sat-btn ${sat.catnr === selectedCatnr ? 'primary' : selectedCatnrs.includes(sat.catnr) ? 'secondary' : ''}`} 
                        onClick={() => {
                          let newSelected = [...selectedCatnrs];
                          
                          // ฟันธง: แก้ไขการกดยกเลิกดาวเทียมให้ตรงจุด!
                          // ถ้าคลิกดาวเทียมที่เลือกไว้แล้ว (ซ้ำดวงเดิม) ระบบจะลบมันออกทันที ปิด Footprint ฟ้าทิ้งไปเลย
                          if (newSelected.includes(sat.catnr)) {
                            newSelected = newSelected.filter(c => c !== sat.catnr);
                          } else {
                            // ถ้ายังไม่เลือก ก็เลือกเข้ามาใหม่
                            newSelected.push(sat.catnr);
                          }
                          setSelectedCatnrs(newSelected);
                          
                          // ดึงดวงล่าสุดที่เหลืออยู่ในรายการให้ขึ้นแท่นเป็นพระเอก (MAIN)
                          const nextTarget = newSelected.length > 0 ? newSelected[newSelected.length - 1] : null;
                          setSelectedCatnr(nextTarget);

                          isTrackingRef.current = true; 
                          setCameraMode('TRACKING');

                          if (globeRef.current && nextTarget) {
                            try {
                              const rec = satrecs[nextTarget];
                              if (rec) {
                                  const pos = calculateSatData(currentDate, rec);
                                  if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
                                    const currentPov = globeRef.current.pointOfView();
                                    const safeAltitude = (currentPov && !isNaN(currentPov.altitude)) ? currentPov.altitude : 2.2;
                                    globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: safeAltitude }, 1000);
                                  }
                              }
                            } catch (err) {}
                          }
                        }}
                      >
                        {sat.displayName}
                        {sat.catnr === selectedCatnr ? (
                          <span style={{ color: '#fff', textShadow: '0 0 8px #fff', fontSize: '14px', letterSpacing: '1px' }}>🎯 MAIN</span>
                        ) : selectedCatnrs.includes(sat.catnr) ? (
                          <span style={{ color: '#000', fontSize: '12px' }}>●</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="scanlines"></div>
    </>
  );
}