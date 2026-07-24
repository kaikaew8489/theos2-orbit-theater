// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// ==========================================
// 1. DATA & CONFIGURATION (ชุดสมบูรณ์ ของเก่าอยู่ครบ + ของใหม่จัดเต็ม)
// ==========================================
const GROUND_STATION = { lat: 13.16, lng: 100.93, name: 'GISTDA', color: '#00eaff' };
const PASS_MIN_ELEVATION_DEG = 5;
const EARTH_RADIUS_KM = 6371;

const SATELLITE_OPTIONS = [
  // GISTDA EARTH OBSERVATION (ของเดิม)
  { catnr: '58016', name: 'THEOS-2', displayName: 'THEOS-2', flag: 'th', group: 'GISTDA EARTH OBSERVATION', operator: 'GISTDA', mission: 'High-Res Optical', telemetry: '2066.56 UP / 2244.228 DN MHz (S-Band)', payload: '8150 MHz (X-Band)' },
  { catnr: '33396', name: 'THEOS', displayName: 'THEOS', flag: 'th', group: 'GISTDA EARTH OBSERVATION', operator: 'GISTDA', mission: 'Earth Observation', telemetry: '2036 UP / 2211 DN MHz (S-Band)', payload: '8140 MHz (X-Band)' },
  
  // SPACE STATIONS (ของเดิม)
  { catnr: '25544', name: 'ISS (ZARYA)', displayName: 'ISS (Space Station)', flag: 'us', group: 'SPACE STATIONS', operator: 'International', mission: 'Space Station', telemetry: '2.216 GHz (S-Band)', payload: '15.003 GHz (Ku-Band)' },
  { catnr: '48274', name: 'CSS (TIANGONG)', displayName: 'TIANGONG (CSS)', flag: 'cn', group: 'SPACE STATIONS', operator: 'CMSA', mission: 'Space Station', telemetry: 'S-Band', payload: 'Ka-Band' },

  // THAI CUBESAT & MICROSAT (เอากลับมาให้ครบ)
  { catnr: '43720', name: 'KNACKSAT-1', displayName: 'KNACKSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'KMUTNB', mission: 'Tech Demo', telemetry: 'UHF/VHF', payload: 'N/A' },
  { catnr: '46292', name: 'NAPA-1', displayName: 'NAPA-1 / RTAF-SAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: 'UHF/VHF', payload: 'S-Band' },
  { catnr: '48008', name: 'BCCSAT-1', displayName: 'BCCSAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'BCC', mission: 'Educational', telemetry: 'UHF/VHF', payload: 'N/A' },
  { catnr: '48900', name: 'NAPA-2', displayName: 'NAPA-2 / RTAF-SAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: 'UHF/VHF', payload: 'S-Band' },
  { catnr: '62689', name: 'LOGSATS-2', displayName: 'LOGSATS-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'EOS Orbit', mission: 'IoT Tech Demo', telemetry: 'UHF/VHF', payload: 'N/A' },
  { catnr: '67683', name: 'KNACKSAT-2', displayName: 'KNACKSAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'KMUTNB', mission: 'Tech Demo', telemetry: '435.590 MHz (UHF)', payload: '435.590 MHz (UHF)' },

  // INTERNATIONAL RADAR (SAR) (เอากลับมาให้ครบ)
  { catnr: '32382', name: 'RADARSAT-2', displayName: 'RADARSAT-2', flag: 'ca', group: 'INTERNATIONAL RADAR (SAR)', operator: 'MDA', mission: 'SAR Imaging', telemetry: '2.215 GHz (S-Band)', payload: '8.250 GHz (X-Band)' },
  { catnr: '31598', name: 'COSMO-SKYMED-1', displayName: 'COSMO-1', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '32376', name: 'COSMO-SKYMED-2', displayName: 'COSMO-2', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '33412', name: 'COSMO-SKYMED-3', displayName: 'COSMO-3', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '37216', name: 'COSMO-SKYMED-4', displayName: 'COSMO-4', flag: 'it', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ASI / e-GEOS', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.0 - 8.4 GHz (X-Band)' },
  { catnr: '39634', name: 'SENTINEL-1A', displayName: 'SENTINEL-1A', flag: 'eu', group: 'INTERNATIONAL RADAR (SAR)', operator: 'ESA', mission: 'SAR Imaging', telemetry: '2.025 - 2.110 GHz (S-Band)', payload: '8.025 - 8.400 GHz (X-Band)' },
  { catnr: '31698', name: 'TERRASAR-X', displayName: 'TERRASAR-X', flag: 'de', group: 'INTERNATIONAL RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '36605', name: 'TANDEM-X', displayName: 'TANDEM-X', flag: 'de', group: 'INTERNATIONAL RADAR (SAR)', operator: 'DLR', mission: 'SAR Imaging', telemetry: 'S-Band', payload: 'X-Band' },

  // EARTH RESOURCES & WEATHER (ของเดิมที่โดนลบไป เอากลับมาแล้ว!)
  { catnr: '49260', name: 'LANDSAT-9', displayName: 'LANDSAT-9', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: '2.206 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '39084', name: 'LANDSAT-8', displayName: 'LANDSAT-8', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA / USGS', mission: 'Earth Resources', telemetry: '2.206 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '25994', name: 'TERRA', displayName: 'TERRA', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA', mission: 'Earth Resources', telemetry: '2.106 GHz (S-Band)', payload: '8.212 GHz (X-Band)' },
  { catnr: '27424', name: 'AQUA', displayName: 'AQUA', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NASA', mission: 'Earth Resources', telemetry: '2.106 GHz (S-Band)', payload: '8.160 GHz (X-Band)' },
  { catnr: '54234', name: 'NOAA-21', displayName: 'NOAA-21 (JPSS-2)', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '43013', name: 'NOAA-20', displayName: 'NOAA-20 (JPSS-1)', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '37849', name: 'SUOMI NPP', displayName: 'SUOMI NPP', flag: 'us', group: 'EARTH RESOURCES & WEATHER', operator: 'NOAA', mission: 'Weather & Climate', telemetry: '2.220 GHz (S-Band)', payload: '7.812 GHz (X-Band)' },
  { catnr: '40697', name: 'SENTINEL-2A', displayName: 'SENTINEL-2A', flag: 'eu', group: 'EARTH RESOURCES & WEATHER', operator: 'ESA', mission: 'Earth Resources', telemetry: '2.025 GHz (S-Band)', payload: '8.025 - 8.400 GHz (X-Band)' },
  { catnr: '32783', name: 'CARTOSAT-2A', displayName: 'CARTOSAT-2A', flag: 'in', group: 'EARTH RESOURCES & WEATHER', operator: 'ISRO', mission: 'Earth Resources', telemetry: 'S-Band', payload: 'X-Band' },

  // GLOBAL EESS & SCIENCE (ของเดิม)
  { catnr: '39150', name: 'GAOFEN-1', displayName: 'GAOFEN-1', flag: 'cn', group: 'GLOBAL EESS & SCIENCE', operator: 'CNSA', mission: 'Earth Observation', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '40376', name: 'SMAP', displayName: 'SMAP', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA', mission: 'Soil Moisture', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '54754', name: 'SWOT', displayName: 'SWOT', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA/CNES', mission: 'Water Topography', telemetry: 'S-Band', payload: 'X-Band' },
  { catnr: '43613', name: 'ICESAT-2', displayName: 'ICESAT-2', flag: 'us', group: 'GLOBAL EESS & SCIENCE', operator: 'NASA', mission: 'Ice Elevation', telemetry: 'S-Band', payload: 'X-Band' },

  // ==========================================
  // ของใหม่ที่เพิ่มเข้าไป (MEGA CONSTELLATIONS & GNSS & GLOBALSTAR)
  // ==========================================
  
  // MEGA CONSTELLATIONS (STARLINK)
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

  // MEGA CONSTELLATIONS (ONEWEB)
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

  // COMMUNICATIONS (GLOBALSTAR)
  { catnr: '31573', name: 'GLOBALSTAR M069', displayName: 'GLOBALSTAR M069', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '31574', name: 'GLOBALSTAR M072', displayName: 'GLOBALSTAR M072', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '32265', name: 'GLOBALSTAR M066', displayName: 'GLOBALSTAR M066', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '37188', name: 'GLOBALSTAR M079', displayName: 'GLOBALSTAR M079', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },
  { catnr: '37189', name: 'GLOBALSTAR M074', displayName: 'GLOBALSTAR M074', flag: 'us', group: 'MEGA CONSTELLATIONS', operator: 'Globalstar', mission: 'Mobile Comms', telemetry: 'S/L-Band', payload: 'S/L-Band' },

  // GLOBAL NAVIGATION (GNSS) - BEIDOU
  { catnr: '36828', name: 'BEIDOU-2 C06', displayName: 'BEIDOU-2 (C06)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37210', name: 'BEIDOU-2 C04', displayName: 'BEIDOU-2 (C04)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (GEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37256', name: 'BEIDOU-2 C07', displayName: 'BEIDOU-2 (C07)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '37384', name: 'BEIDOU-2 C08', displayName: 'BEIDOU-2 (C08)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '38091', name: 'BEIDOU-2 C05', displayName: 'BEIDOU-2 (C05)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (GEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '40549', name: 'BEIDOU-3 C31', displayName: 'BEIDOU-3 (C31)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (IGSO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '43001', name: 'BEIDOU-3 C19', displayName: 'BEIDOU-3 (C19)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },
  { catnr: '43002', name: 'BEIDOU-3 C20', displayName: 'BEIDOU-3 (C20)', flag: 'cn', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'CNSA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'B1, B2, B3' },

  // GLOBAL NAVIGATION (GNSS) - GALILEO
  { catnr: '37846', name: 'GSAT0101', displayName: 'GALILEO (GSAT0101)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '37847', name: 'GSAT0102', displayName: 'GALILEO (GSAT0102)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' },
  { catnr: '38857', name: 'GSAT0103', displayName: 'GALILEO (GSAT0103)', flag: 'eu', group: 'GLOBAL NAVIGATION (GNSS)', operator: 'ESA', mission: 'Navigation (MEO)', telemetry: 'L-Band', payload: 'E1, E5, E6' }
];

const FALLBACK_TLES = {
  // GISTDA & ISS
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' },
  '33396': { line1: '1 33396U 08049A   26166.85000000  .00000100  00000-0  50000-4 0  9991', line2: '2 33396  98.5400 210.1200 0001500  85.0000 275.0000 14.20000000900001' },
  '25544': { line1: '1 25544U 98067A   26201.79846070  .00005574  00000-0  10900-3 0  9995', line2: '2 25544  51.6312 133.7599 0006835 319.3995  40.6483 15.49066413576965' },
  '48274': { line1: '1 48274U 21035A   26204.00000000  .00000000  00000-0  00000-0 0  9999', line2: '2 48274  41.4700 120.0000 0001500 180.0000 180.0000 15.60000000000000' }, 
  
  // ของเดิม (Thai Cubesat)
  '43720': { line1: '1 43720U 18099D   26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 43720  98.1800 220.1000 0001300  88.0000 000.0000 14.59000000900009' },
  '46292': { line1: '1 46292U 20061BA  26166.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 46292  98.1800 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '48008': { line1: '1 48008U 21022H   26202.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 48008  97.5000 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '48900': { line1: '1 48900U 21059G   26202.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 48900  97.5000 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '62689': { line1: '1 62689U 23155G   26202.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 62689  97.5000 220.1000 0001300  88.0000 060.0000 14.59000000900009' },
  '67683': { line1: '1 67683U 24155G   26202.85000000  .00000090  00000-0  45000-4 0  9999', line2: '2 67683  97.5000 220.1000 0001300  88.0000 060.0000 14.59000000900009' },

  // ของเดิม (SAR & Earth Observation)
  '32382': { line1: '1 32382U 07061A   26202.60341558  .00000099  00000+0  55382-4 0  9990', line2: '2 32382  98.5791 209.0450 0001341  85.6887 274.4449 14.29984452970873' },
  '31598': { line1: '1 31598U 07023A   26202.62118812  .00002298  00000+0  20364-3 0  9997', line2: '2 31598  97.8855  34.7692 0001812  95.0649 265.0780 14.97244419 34949' },
  '32376': { line1: '1 32376U 07059A   26202.59142825  .00000260  00000+0  39213-4 0  9999', line2: '2 32376  97.8898  25.6922 0001474  94.2407 265.8975 14.82153951  7109' },
  '33412': { line1: '1 33412U 08054A   26202.60280087  .00002865  00000+0  19446-3 0  9990', line2: '2 33412  97.8254  61.7418 0016592 144.5833 215.6499 15.07143192962127' },
  '37216': { line1: '1 37216U 10060A   26202.87414014  .00000374  00000+0  53551-4 0  9993', line2: '2 37216  97.8900  25.9727 0001468  90.5169 269.6212 14.82156050849703' },
  '39634': { line1: '1 39634U 14016A   26202.58469653  .00000103  00000+0  31533-4 0  9997', line2: '2 39634  98.1714 209.6122 0001435  85.1809 274.9554 14.59173297655036' },
  '31698': { line1: '1 31698U 07026A   26202.44324132  .00000200  00000+0  12714-4 0  9997', line2: '2 31698  97.4457 209.6623 0001808  80.3305 279.8134 15.19148901 58421' },
  '36605': { line1: '1 36605U 10030A   26202.44323971  .00000080  00000+0  69995-5 0  9999', line2: '2 36605  97.4466 209.6630 0001785 100.1073 260.0363 15.19148789891840' },
  '49260': { line1: '1 49260U 21088A   26202.18816322  .00000217  00000+0  58165-4 0  9991', line2: '2 49260  98.2264 271.9512 0001073  92.7639 267.3683 14.57098343255953' },
  '39084': { line1: '1 39084U 13008A   26202.56572164  .00000215  00000+0  57916-4 0  9993', line2: '2 39084  98.2285 272.2897 0001337  91.8641 268.2711 14.57097234702907' },
  '25994': { line1: '1 25994U 99068A   26202.61954139  .00000241  00000+0  58077-4 0  9998', line2: '2 25994  97.9436 250.7972 0003622 110.2563  49.2698 14.61127057414632' },
  '27424': { line1: '1 27424U 02022A   26202.61098541  .00000537  00000+0  11669-3 0  9991', line2: '2 27424  98.4301 172.5868 0001325 102.0917 312.0397 14.62134884288301' },
  '54234': { line1: '1 54234U 22150A   26202.57178498  .00000039  00000+0  39192-4 0  9998', line2: '2 54234  98.7059 140.7835 0002913  92.9119 267.2391 14.19541826191420' },
  '43013': { line1: '1 43013U 17073A   26202.61007573  .00000028  00000+0  34127-4 0  9990', line2: '2 43013  98.7772 141.7679 0001601 117.5455 242.5884 14.19517347449354' },
  '37849': { line1: '1 37849U 11061A   26202.59669540  .00000061  00000+0  50149-4 0  9995', line2: '2 37849  98.7956 143.2390 0001073 185.7964 174.3200 14.19523619763329' },
  '40697': { line1: '1 40697U 15028A   26202.62030285  .00000257  00000+0  11465-3 0  9993', line2: '2 40697  98.5668 276.9811 0001324  96.2802 263.8532 14.30816331578651' },
  '32783': { line1: '1 32783U 08021A   26202.61184102  .00000240  00000+0  38932-4 0  9993', line2: '2 32783  97.7612 250.1425 0011923   7.4059 352.7327 14.79280264983896' },
  '41866': { line1: '1 41866U 16071A   26202.59556191 -.00000089  00000+0  00000+0 0  9999', line2: '2 41866   0.4199  85.4484 0000685  72.3972 251.2077  1.00271776 35443' },
  '41882': { line1: '1 41882U 16077A   26202.64086039 -.00000357  00000+0  00000+0 0  9996', line2: '2 41882   2.4080  79.8916 0008146 159.3196  54.5323  1.00265376 35271' },
  '40267': { line1: '1 40267U 14060A   26202.64415374 -.00000274  00000+0  00000+0 0  9998', line2: '2 40267   0.0419 263.4457 0001309 253.7501 154.7516  1.00271154 43100' },
  '38771': { line1: '1 38771U 12049A   26202.61072963  .00000042  00000+0  38851-4 0  9992', line2: '2 38771  98.6485 253.4198 0001346 221.8467 138.2608 14.21447602718155' },
  '40069': { line1: '1 40069U 14037A   26202.56620946 -.00000010  00000+0  14927-4 0  9992', line2: '2 40069  98.5143 177.0912 0004764 305.4497  54.6236 14.21469887624201' },
  '39150': { line1: '1 39150U 13018A   26202.62458456  .00000510  00000+0  80300-4 0  9993', line2: '2 39150  97.9076 273.9898 0017656 150.9869 209.2327 14.76523192713328' },
  '40376': { line1: '1 40376U 15003A   26202.60961285  .00000285  00000+0  64260-4 0  9994', line2: '2 40376  98.1287 209.2183 0001633  92.4865 267.6524 14.63392770612653' },
  '54754': { line1: '1 54754U 22173A   26202.64354096  .00000057  00000+0  40400-4 0  9992', line2: '2 54754  77.6118 348.7929 0000214  70.3491 289.7684 14.00172654183972' },
  '43613': { line1: '1 43613U 18070A   26202.53193309  .00008021  00000+0  29144-3 0  9991', line2: '2 43613  92.0084 300.2608 0004849  44.3614 315.8023 15.28247442437700' },

  // ของใหม่ที่เพิ่มเข้าไปรอบนี้ (STARLINK)
  '44714': { line1: '1 44714U 19074B   26203.85026071  .00043430  00000+0  65493-3 0  9996', line2: '2 44714  53.1486 257.4051 0005733 347.6199  12.4671 15.54349637369758' },
  '44718': { line1: '1 44718U 19074F   26203.90241220  .00033521  00000+0  50186-3 0  9994', line2: '2 44718  53.1532 257.3464 0006055 350.4988   9.5908 15.54669722369757' },
  '44723': { line1: '1 44723U 19074L   26203.59465954  .00030080  00000+0  89176-3 0  9995', line2: '2 44723  53.0453 263.7268 0000886  74.0426 286.0673 15.34612174369612' },
  '44725': { line1: '1 44725U 19074N   26203.63352324  .00066630  00000+0  78560-3 0  9993', line2: '2 44725  53.1540 280.8739 0005311 322.6141  37.4503 15.60756549369387' },
  '44741': { line1: '1 44741U 19074AE  26203.29108934  .00079445  00000+0  45231-3 0  9996', line2: '2 44741  53.0397 245.6485 0004236  27.2706 332.8536 15.78280675369830' },
  '44744': { line1: '1 44744U 19074AH  26203.71106589  .00029233  00000+0  95349-3 0  9995', line2: '2 44744  53.0558 309.5752 0001136 251.4157 108.6720 15.31583154368982' },
  '44747': { line1: '1 44747U 19074AL  26203.27373482  .00027377  00000+0  39067-3 0  9999', line2: '2 44747  53.0415 165.8551 0001451  58.9768 301.1385 15.56101247370981' },
  '44748': { line1: '1 44748U 19074AM  26203.52631903  .00046385  00000+0  41630-3 0  9992', line2: '2 44748  53.0459 257.8185 0003233  22.1036 338.0119 15.67831807369690' },
  '44751': { line1: '1 44751U 19074AQ  26203.63380023  .00042380  00000+0  49888-3 0  9996', line2: '2 44751  53.0451 281.1779 0003829 289.6198  70.4401 15.60996941369375' },
  '44752': { line1: '1 44752U 19074AR  26203.81294063  .00034667  00000+0  98615-3 0  9996', line2: '2 44752  53.0682 233.3488 0001790 314.2366  45.8489 15.35839511370088' },
  
  // ONEWEB
  '44057': { line1: '1 44057U 19010A   26203.74374192  .00000059  00000+0  11998-3 0  9995', line2: '2 44057  87.9078 221.7217 0001652  96.8358 263.2961 13.16594592356240' },
  '44058': { line1: '1 44058U 19010B   26203.76909415 -.00000042  00000+0 -14218-3 0  9992', line2: '2 44058  87.9079 221.7131 0002371  97.0243 263.1157 13.16594262356297' },
  '44059': { line1: '1 44059U 19010C   26203.79442328 -.0000013  00000+0 -68432-4 0  9997', line2: '2 44059  87.9074 221.7024 0002074  86.3755 273.7613 13.16593468356418' },
  '44060': { line1: '1 44060U 19010D   26203.55359207 -.00000116  00000+0 -34111-3 0  9996', line2: '2 44060  87.8975 252.1735 0002052 105.1379 254.9978 13.15548157356020' },
  '44061': { line1: '1 44061U 19010E   26203.55752999 -.00000056  00000+0 -18184-3 0  9997', line2: '2 44061  87.8984 252.1405 0002201  94.9634 265.1747 13.15546720356077' },
  '44062': { line1: '1 44062U 19010F   26203.14556028  .00000014  00000+0  35375-5 0  9993', line2: '2 44062  87.8992 252.2334 0002166  94.0959 266.0419 13.15546725356015' },
  '45131': { line1: '1 45131U 20008A   26203.54825201  .00000728  00000+0  20773-2 0  9991', line2: '2 45131  87.8495  45.6845 0000783  84.4533 275.6683 13.09460725310697' },
  '45132': { line1: '1 45132U 20008B   26203.81143215  .00000673  00000+0  18927-2 0  9997', line2: '2 45132  87.8810  29.1676 0002078  91.4979 268.6387 13.10376287312617' },
  '45133': { line1: '1 45133U 20008C   26203.47543953 -.00000485  00000+0 -14255-2 0  9996', line2: '2 45133  87.8826  29.2349 0001799  88.1371 271.9963 13.10374490312960' },
  '45134': { line1: '1 45134U 20008D   26203.49071875  .00000224  00000+0  60437-3 0  9991', line2: '2 45134  87.8819  29.2458 0001771  92.1672 267.9658 13.10375332313270' },
  
  // GLOBALSTAR
  '31573': { line1: '1 31573U 07020C   26203.34397047 -.00000053  00000+0  36290-3 0  9999', line2: '2 31573  52.0018 152.6174 0001486 226.2046 297.9391 12.23472540883104' },
  '31574': { line1: '1 31574U 07020D   26203.43989804 -.00000088  00000+0 -55494-4 0  9995', line2: '2 31574  51.9955   6.3933 0001633  48.1342 337.6937 11.91658759879188' },
  '32265': { line1: '1 32265U 07048C   26203.32694402 -.00000025  00000+0  59145-3 0  9994', line2: '2 32265  51.9610 317.0380 0005480 116.3209 278.9500 12.30390412864557' },
  '37188': { line1: '1 37188U 10054A   26203.76436852 -.00000099  00000+0  26196-4 0  9997', line2: '2 37188  52.0059   0.3677 0001113  89.9803 309.6942 12.62266424727044' },
  '37189': { line1: '1 37189U 10054B   26203.70807359 -.00000103  00000+0  61618-5 0  9991', line2: '2 37189  52.0038 359.7991 0000833 104.9572 278.6412 12.62262042727646' },

  // BEIDOU
  '36828': { line1: '1 36828U 10036A   26203.83497221 -.00000090  00000+0  00000+0 0  9994', line2: '2 36828  54.3079 162.6381 0059059 225.2794 320.0279  1.00261993 58459' },
  '37210': { line1: '1 37210U 10057A   26203.85983729 -.00000112  00000+0  00000+0 0  9993', line2: '2 37210   3.7336  68.7236 0005248 183.3998 157.9688  1.00273222 57644' },
  '37256': { line1: '1 37256U 10068A   26202.87819282 -.00000198  00000+0  00000+0 0  9992', line2: '2 37256  47.4828 271.3972 0057045 214.5351 238.1175  1.00271863 57143' },
  '37384': { line1: '1 37384U 11013A   26202.49436278 -.00000172  00000+0  00000+0 0  9995', line2: '2 37384  62.4558  39.8259 0035881 183.5212 359.9880  1.00259347 56004' },
  '37763': { line1: '1 37763U 11038A   26203.99265681 -.00000035  00000+0  00000+0 0  9995', line2: '2 37763  54.6048 165.3543 0160072 231.4898 355.6942  1.00278691 55001' },
  '37948': { line1: '1 37948U 11073A   26183.72937883 -.00000128  00000+0  00000+0 0  9990', line2: '2 37948  47.6496 271.3544 0114527 222.0502 141.5350  1.00270596 53296' },
  '38091': { line1: '1 38091U 12008A   26204.00350590  .00000058  00000+0  00000+0 0  9999', line2: '2 38091   3.6610  69.4702 0007035 271.4937  19.7057  1.00273416 52724' },
  '40549': { line1: '1 40549U 15019A   26203.86188105 -.00000173  00000+0  00000+0 0  9998', line2: '2 40549  49.1249 295.0310 0038696 195.6676 212.2841  1.00291059 41434' },
  '43001': { line1: '1 43001U 17069A   26201.96127414 -.00000079  00000+0  00000+0 0  9991', line2: '2 43001  56.7221  61.9715 0008832 327.7311  32.2769  1.86231306 59235' },
  '43002': { line1: '1 43002U 17069B   26203.51098727 -.00000077  00000+0  00000+0 0  9997', line2: '2 43002  56.7230  61.9567 0007814   0.0665 359.9968  1.86231039 59258' },

  // GALILEO
  '37846': { line1: '1 37846U 11060A   26203.04348625 -.00000107  00000+0  00000+0 0  9998', line2: '2 37846  56.9816 340.8168 0002031  64.0635 295.9520  1.70475789 91713' },
  '37847': { line1: '1 37847U 11060B   26202.38421657 -.00000107  00000+0  00000+0 0  9992', line2: '2 37847  56.9829 340.8353 0001995   5.2866 355.7737  1.70476023 91712' },
  '38857': { line1: '1 38857U 12055A   26200.15144010 -.00000035  00000+0  00000+0 0  9997', line2: '2 38857  55.8248 100.6680 0003622 312.6356  47.3724  1.70473478 85556' },
  '40128': { line1: '1 40128U 14050A   26202.91197597 -.00000055  00000+0  00000+0 0  9994', line2: '2 40128  48.8375 272.0101 1679296 180.7600 179.0021  1.85519659 78966' },
  '40129': { line1: '1 40129U 14050B   26203.16739232 -.00000050  00000+0  00000+0 0  9996', line2: '2 40129  48.8548 271.0857 1680673 181.4787 178.0078  1.85520629 81134' }
};

// ==========================================
// 2. SCI-FI CSS (INJECTED) - ORBITAL RADAR EDITION
// ==========================================
const injectStyles = () => {
  if (document.getElementById('scifi-theater-styles')) return;
  const style = document.createElement('style');
  style.id = 'scifi-theater-styles';
  style.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@500;600;700&display=swap');
    :root { --cyan: #00eaff; --gold: #ffcc00; --bg: #010408; --red: #ff3333; --dark-cyan: #005f73; --green: #00ff66; }
    body { margin: 0; overflow: hidden; background: var(--bg); color: #fff; font-family: 'Rajdhani', sans-serif; }
    
    .scanlines { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.1)); background-size: 100% 4px; z-index: 100; opacity: 0.6; }
    
    .ui-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; display: flex; justify-content: space-between; padding: 25px; box-sizing: border-box; z-index: 10; }
    
    .left-container { display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; height: 100%; z-index: 20; }
    .menu-toggle-btn-left { width: 42px; height: 42px; background: rgba(3, 11, 24, 0.45); backdrop-filter: blur(12px); border: 2px solid var(--cyan); color: var(--cyan); font-size: 22px; cursor: pointer; border-radius: 4px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease-in-out; margin-bottom: 15px; flex-shrink: 0; box-shadow: 0 0 15px rgba(0,234,255,0.6), inset 0 0 10px rgba(0,234,255,0.3); text-shadow: 0 0 8px var(--cyan); }
    
    .left-panel { width: 380px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInLeft 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
    .left-panel::-webkit-scrollbar { display: none; }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }

    /* ฟันธง: กรอบเหลี่ยมมนเล็กน้อย (4px) กว้างไม่อึดอัด และเรืองแสงจัดๆ */
    /* ฟันธง: กรอบโปร่งแสงแบบกระจกโฮโลแกรม มองทะลุเห็นลูกโลก */
    .panel-box { background: rgba(0, 10, 20, 0.45) !important; -webkit-backdrop-filter: blur(12px) !important; backdrop-filter: blur(12px) !important; border: 1px solid var(--cyan); border-radius: 4px; padding: 20px; box-shadow: 0 0 20px rgba(0, 234, 255, 0.3), inset 0 0 15px rgba(0, 234, 255, 0.15); position: relative; }
    
    .main-title p { margin: 0; color: var(--cyan); font-size: 13px; letter-spacing: 3px; text-transform: uppercase; font-weight: 700; text-shadow: 0 0 8px var(--cyan); }
    .main-title h1 { margin: 5px 0; font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 900; color: #fff; text-shadow: 0 0 15px rgba(0,234,255,0.8); letter-spacing: 1px; }
    .main-title span { font-size: 12px; color: #8892b0; letter-spacing: 1px; }
    
    .clock-panel { display: flex; gap: 15px; justify-content: space-between; background: rgba(0, 0, 0, 0.6); border: 1px solid var(--gold); border-radius: 4px; padding: 15px; box-shadow: 0 0 15px rgba(255, 204, 0, 0.2) inset, 0 0 10px rgba(255, 204, 0, 0.3); }
    .clock-item { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 33%; }
    .clock-item span { font-size: 11px; color: var(--gold); font-weight: 700; letter-spacing: 2px; margin-bottom: 2px; text-shadow: 0 0 5px var(--gold); }
    .clock-item strong { font-family: 'Orbitron', sans-serif; font-size: 18px; color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; text-shadow: 0 0 10px rgba(255, 255, 255, 0.8); }

    .target-header { display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px dashed var(--cyan); }
    .target-header img { width: 40px; border-radius: 2px; border: 1px solid var(--cyan); box-shadow: 0 0 10px var(--cyan); }
    .target-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 24px; font-weight: 900; color: #fff; letter-spacing: 2px; text-shadow: 0 0 10px rgba(0,234,255,0.5); }
    
    .status-banner { text-align: center; font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 2px; padding: 12px; margin-bottom: 20px; border-radius: 2px; transition: all 0.3s; }
    .status-banner.standby { background: rgba(255, 51, 51, 0.15); border: 1px solid var(--red); color: var(--red); box-shadow: 0 0 20px rgba(255, 51, 51, 0.5), inset 0 0 15px rgba(255, 51, 51, 0.3); text-shadow: 0 0 8px var(--red); }
    .status-banner.active { background: rgba(0, 234, 255, 0.15); border: 1px solid var(--cyan); color: var(--cyan); box-shadow: 0 0 20px rgba(0, 234, 255, 0.6), inset 0 0 15px rgba(0, 234, 255, 0.3); text-shadow: 0 0 8px var(--cyan); }

    .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .t-box { background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(0, 234, 255, 0.3); border-radius: 2px; padding: 10px 15px; display: flex; flex-direction: column; transition: all 0.2s; }
    .t-box:hover { border-color: var(--cyan); box-shadow: inset 0 0 15px rgba(0, 234, 255, 0.5); }
    .t-box.highlight { border-color: var(--cyan); background: rgba(0, 234, 255, 0.1); box-shadow: inset 0 0 15px rgba(0, 234, 255, 0.8); }
    .t-box span { font-size: 11px; color: #8892b0; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
    .t-box strong { font-family: 'Orbitron', sans-serif; font-size: 16px; color: #ffffff; margin-top: 4px; text-shadow: 0 0 8px rgba(255,255,255,0.6); }

    .info-list { list-style: none; padding: 15px 0 0 0; margin: 15px 0 0 0; border-top: 1px dashed var(--cyan); font-size: 14px; line-height: 2.4; color: #ddd; }
    .info-list li { display: flex; justify-content: space-between; }
    .info-list span { color: #8892b0; font-weight: 600; }
    .info-list strong { color: #ffffff; font-weight: 700; text-shadow: 0 0 5px rgba(255,255,255,0.5); text-align: right; }

    /* ขวามือ */
    .right-container { display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; height: 100%; z-index: 20; }
    .menu-toggle-btn { width: 42px; height: 42px; background: rgba(3, 11, 24, 0.45); backdrop-filter: blur(12px); border: 2px solid var(--gold); color: var(--gold); font-size: 22px; cursor: pointer; border-radius: 4px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease-in-out; margin-bottom: 15px; flex-shrink: 0; box-shadow: 0 0 15px rgba(255,204,0,0.6), inset 0 0 10px rgba(255,204,0,0.3); text-shadow: 0 0 8px var(--gold); }
    
    .right-panel { width: 300px; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInRight 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); }
    @keyframes slideInRight { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }

    .control-group { background: rgba(0, 10, 20, 0.45) !important; -webkit-backdrop-filter: blur(12px) !important; backdrop-filter: blur(12px) !important; border: 1px solid var(--cyan); border-radius: 4px; padding: 20px; margin-bottom: 15px; position: relative; transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); box-shadow: 0 0 20px rgba(0, 234, 255, 0.2), inset 0 0 15px rgba(0, 234, 255, 0.1); }
    .control-group p { margin: 0 0 15px 0; font-size: 14px; font-weight: 900; letter-spacing: 3px; border-bottom: 1px dashed var(--cyan); padding-bottom: 8px; color: var(--cyan); text-shadow: 0 0 8px var(--cyan); }
    
    /* ฟันธง: ปุ่ม Hover สว่างวาบแบบอลังการ */
    .btn { display: block; width: 100%; background: rgba(0, 0, 0, 0.6); border: 1px solid var(--cyan); color: var(--cyan); padding: 12px; margin-bottom: 10px; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 800; cursor: pointer; text-align: center; border-radius: 2px; transition: all 0.2s ease-in-out; letter-spacing: 1.5px; text-transform: uppercase; text-shadow: 0 0 8px var(--cyan); box-shadow: 0 0 10px rgba(0, 234, 255, 0.3), inset 0 0 8px rgba(0, 234, 255, 0.1); position: relative; overflow: hidden; }
    .btn:hover { background: rgba(0, 234, 255, 0.15) !important; color: #fff !important; border-color: #fff !important; text-shadow: 0 0 15px #fff !important; box-shadow: 0 0 30px rgba(0, 234, 255, 0.8), inset 0 0 20px rgba(0, 234, 255, 0.4) !important; transform: scale(1.02); }
    .btn.active { background: var(--cyan) !important; color: #000 !important; border-color: var(--cyan) !important; text-shadow: none !important; box-shadow: 0 0 25px rgba(0, 234, 255, 0.9), 0 0 40px rgba(0, 234, 255, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; transform: scale(1.02); }
    .btn:disabled { opacity: 0.3; pointer-events: none; border-color: #333; color: #555; text-shadow: none; box-shadow: none; }
    .speed-row { display: flex; gap: 8px; margin-bottom: 8px; }

    /* ฟันธง: กรอบ SYSTEM CONTROL เส้นสีฟ้า ตัวหนังสือสีแดงเรืองแสง / เมาส์ชี้ปุ่มเป็นสีส้มทอง */
    .control-group:nth-child(1) { border-color: var(--cyan); box-shadow: 0 0 20px rgba(0, 234, 255, 0.2), inset 0 0 15px rgba(0, 234, 255, 0.1); }
    .control-group:nth-child(1) p { color: var(--red); border-bottom-color: rgba(0, 234, 255, 0.5); text-shadow: 0 0 10px var(--red); }
    .control-group:nth-child(1) .btn { border-color: rgba(0, 234, 255, 0.5); color: var(--red); text-shadow: 0 0 8px var(--red); box-shadow: 0 0 10px rgba(0, 234, 255, 0.2), inset 0 0 8px rgba(0, 234, 255, 0.1); }
    .control-group:nth-child(1) .btn:hover { background: rgba(255, 204, 0, 0.2) !important; color: var(--gold) !important; border-color: var(--gold) !important; text-shadow: 0 0 15px var(--gold) !important; box-shadow: 0 0 30px rgba(255, 204, 0, 0.8), inset 0 0 20px rgba(255, 204, 0, 0.4) !important; }
    .control-group:nth-child(1) .btn.active { background: var(--gold) !important; color: #000 !important; border-color: var(--gold) !important; text-shadow: none !important; box-shadow: 0 0 25px rgba(255, 204, 0, 0.9), 0 0 40px rgba(255, 204, 0, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; }

    /* ฟันธง: SPEED สีเขียวนีออน */
    .control-group:nth-child(2) { border-color: rgba(0, 255, 102, 0.8); }
    .control-group:nth-child(2) p { color: var(--green); border-bottom-color: rgba(0, 255, 102, 0.4); text-shadow: 0 0 10px var(--green); }
    .control-group:nth-child(2) .speed-row .btn { border-color: rgba(0, 255, 102, 0.5); color: var(--green); background: rgba(0, 255, 102, 0.05); text-shadow: 0 0 8px rgba(0, 255, 102, 0.8); box-shadow: inset 0 0 10px rgba(0, 255, 102, 0.2); }
    .control-group:nth-child(2) .speed-row .btn:hover { background: rgba(255, 255, 255, 0.15) !important; color: #fff !important; border-color: #fff !important; text-shadow: 0 0 15px #fff !important; box-shadow: 0 0 25px rgba(255, 255, 255, 0.8), inset 0 0 15px rgba(255, 255, 255, 0.4) !important; }
    .control-group:nth-child(2) .speed-row .btn.active { background: var(--green) !important; color: #000 !important; border-color: var(--green) !important; text-shadow: none !important; box-shadow: 0 0 25px rgba(0, 255, 102, 0.9), 0 0 40px rgba(0, 255, 102, 0.5), inset 0 0 15px rgba(255, 255, 255, 0.6) !important; }

    .control-group:nth-child(3) { border-color: rgba(255, 204, 0, 0.8); text-align: center; padding: 25px 20px; }
    .control-group:nth-child(3) p { color: var(--gold); border-bottom-color: rgba(255, 204, 0, 0.4); text-shadow: 0 0 10px var(--gold); }
    .database-btn { border-color: var(--gold) !important; color: var(--gold) !important; font-size: 16px !important; padding: 15px !important; text-shadow: 0 0 10px var(--gold); box-shadow: 0 0 15px rgba(255,204,0,0.3), inset 0 0 10px rgba(255,204,0,0.2) !important; }
    .database-btn:hover { background: rgba(255, 204, 0, 0.2) !important; box-shadow: 0 0 30px rgba(255, 204, 0, 0.8), inset 0 0 20px rgba(255, 204, 0, 0.4) !important; color: #fff !important; border-color: #fff !important; }

    /* ฟันธง: CSS สำหรับปุ่ม CLEAR OTHERS และ Group Toggle */
    .modal-clear-btn { background: rgba(255, 179, 71, 0.1); border: 1px solid var(--gold); color: var(--gold); padding: 5px 15px; border-radius: 2px; font-family: 'Orbitron', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 0 10px rgba(255, 204, 0, 0.2); margin-right: 15px; letter-spacing: 1px; display: flex; align-items: center; text-transform: uppercase; }
    .modal-clear-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 20px rgba(255, 204, 0, 0.8); transform: scale(1.05); }

    .group-header-row { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px dashed rgba(0, 234, 255, 0.5); padding-bottom: 8px; margin-bottom: 15px; }
    .group-header-row .modal-group-title { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .group-toggle-btn { background: transparent; border: 1px solid rgba(0, 234, 255, 0.5); color: var(--cyan); font-family: 'Rajdhani', sans-serif; font-size: 13px; font-weight: 800; padding: 4px 12px; border-radius: 2px; cursor: pointer; transition: all 0.2s; letter-spacing: 1px; }
    .group-toggle-btn:hover { background: rgba(0, 234, 255, 0.2); border-color: var(--cyan); box-shadow: 0 0 15px rgba(0,234,255,0.6); color: #fff; }

    /* ==================================================
       POPUP MODAL
       ================================================== */
    .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 5, 10, 0.9); backdrop-filter: blur(15px); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s ease; }
    
    .modal-box { background: #01060d; border: 2px solid var(--cyan); border-radius: 4px; width: 95%; max-width: 1000px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 0 50px rgba(0, 234, 255, 0.4), inset 0 0 30px rgba(0, 234, 255, 0.15); position: relative; overflow: hidden; }
    
    .modal-header { padding: 25px 30px; border-bottom: 1px solid rgba(0, 234, 255, 0.5); display: flex; justify-content: space-between; align-items: center; background: linear-gradient(180deg, rgba(0, 234, 255, 0.15) 0%, transparent 100%); }
    .modal-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 22px; color: #fff; letter-spacing: 2px; display: flex; align-items: center; gap: 12px; text-shadow: 0 0 15px var(--cyan); }
    
    .modal-close-btn { background: rgba(255, 51, 51, 0.1); border: 2px solid var(--red); color: var(--red); width: 45px; height: 45px; border-radius: 2px; font-size: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.3s; box-shadow: 0 0 15px rgba(255, 51, 51, 0.5), inset 0 0 10px rgba(255, 51, 51, 0.3); text-shadow: 0 0 8px var(--red); }
    .modal-close-btn:hover { background: var(--red); color: #fff; box-shadow: 0 0 35px rgba(255, 51, 51, 1), 0 0 60px rgba(255, 51, 51, 0.6); transform: scale(1.1); text-shadow: none; border-radius: 4px; }

    .modal-content { padding: 30px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; display: flex; flex-direction: column; gap: 25px; }
    .modal-content::-webkit-scrollbar { display: none; }
    
    .modal-group-title { color: var(--cyan); font-size: 15px; font-weight: 900; letter-spacing: 3px; border-bottom: 1px dashed rgba(0, 234, 255, 0.5); padding-bottom: 10px; margin-bottom: 15px; text-transform: uppercase; font-family: 'Orbitron', sans-serif; text-shadow: 0 0 12px rgba(0, 234, 255, 0.6); }
    .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; }
    
    .modal-sat-btn { background: rgba(0, 255, 102, 0.05); border: 1px solid var(--green); color: #fff; padding: 15px 20px; border-radius: 2px; font-family: 'Rajdhani', sans-serif; font-size: 16px; font-weight: 700; cursor: pointer; transition: all 0.2s ease-in-out; text-align: left; display: flex; align-items: center; justify-content: space-between; letter-spacing: 1px; }
    .modal-sat-btn:hover { background: rgba(0, 255, 102, 0.2); box-shadow: 0 0 20px rgba(0, 255, 102, 0.4); transform: scale(1.02); }
    
    .modal-sat-btn.secondary { background: var(--green) !important; color: #000 !important; border-color: var(--green) !important; box-shadow: 0 0 25px rgba(0, 255, 102, 0.8) !important; font-weight: 900; }
    .modal-sat-btn.primary { background: rgba(255, 51, 51, 0.2) !important; color: #fff !important; border: 2px solid var(--red) !important; box-shadow: 0 0 30px rgba(255, 51, 51, 0.9), inset 0 0 15px rgba(255, 51, 51, 0.5) !important; text-shadow: 0 0 10px #fff !important; font-weight: 900; z-index: 10; }

    /* ==================================================
       2D MAP
       ================================================== */
    .flat-map-wrap { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 5; padding: 25px 320px 25px 420px; box-sizing: border-box; transition: padding 0.3s ease-in-out; }
    .flat-map-wrap.panel-closed { padding-right: 25px; }
    .flat-map-wrap.left-panel-closed { padding-left: 25px; }
    .flat-map-container { position: relative; width: 100%; aspect-ratio: 2 / 1; max-height: 100vh; max-width: 200vh; background-color: #000; box-shadow: 0 0 50px rgba(0, 234, 255, 0.3); border: 2px solid var(--cyan); border-radius: 4px; overflow: hidden; }
    .map-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2; }
    
    .map-marker { position: absolute; transform: translate(-50%, -50%); cursor: pointer; pointer-events: auto; display: flex; flex-direction: column; align-items: center; transition: transform 0.2s; z-index: 3; }
    .map-marker:hover { transform: translate(-50%, -50%) scale(1.8); z-index: 20 !important; }
    .map-marker span.dot { width: 5px; height: 5px; background: currentColor; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
    .map-marker span.target-dot { width: 10px; height: 10px; background: currentColor; border-radius: 2px; box-shadow: 0 0 15px currentColor; animation: pulse 2s infinite; }
    .map-marker span.label { margin-top: 5px; font-size: 11px; font-weight: 800; white-space: nowrap; font-family: 'Rajdhani', sans-serif; text-shadow: 0 0 6px #000, 0 0 10px #000; letter-spacing: 0.5px; }

    .map-marker .map-tooltip { display: none; position: absolute; bottom: 130%; left: 50%; transform: translateX(-50%); background: rgba(0, 15, 30, 0.95); border: 1px solid var(--cyan); border-radius: 2px; padding: 10px 15px; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 14px; white-space: nowrap; pointer-events: none; box-shadow: 0 5px 20px rgba(0,234,255,0.5); z-index: 30; }
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
  const gold = new THREE.MeshBasicMaterial({ color: '#ffcc00' });
  const blue = new THREE.MeshBasicMaterial({ color: '#00eaff' });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.45), gold));
  const lp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), blue); lp.position.x = -1.85; group.add(lp);
  const rp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.95), blue); rp.position.x = 1.85; group.add(rp);
  const scale = isTarget ? 3.0 : 1.2;
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
  // ฟันธง 1: เปิดระบบเงากลางวัน-กลางคืน เป็นค่าเริ่มต้นตั้งแต่เปิดแอป
  const [realtimeSun, setRealtimeSun] = useState(true);
  
  const [showGroundTrack, setShowGroundTrack] = useState(false);
  
  const [isFlatMap, setIsFlatMap] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true); 
  const [cameraMode, setCameraMode] = useState('FREE LOOK');

  const [isModalOpen, setIsModalOpen] = useState(false);

 // ฟันธง: ตัวแปรควบคุมการเปิดปิดหน้าจอ Radar Skyplot
 const [isRadarOpen, setIsRadarOpen] = useState(false);

 // ฟันธง: ระบบลากและขยายหน้าจอ Radar อย่างอิสระ (Draggable)
 const [radarPos, setRadarPos] = useState({ x: 380, y: 400 }); // ตำแหน่งเริ่มต้นตอนเปิด
 const [isDraggingRadar, setIsDraggingRadar] = useState(false);
 const dragRadarRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

 const handleRadarMouseDown = (e) => {
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

  // ฟันธง: ปลดล็อกให้เมนูซ้าย-ขวา เปิดอิสระพร้อมกันได้เลย!
  const toggleLeftPanel = () => {
    setIsLeftPanelOpen(!isLeftPanelOpen);
  };

  const toggleRightPanel = () => {
    setIsRightPanelOpen(!isRightPanelOpen);
  };

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
          // ฟันธง 1: เอาคำสั่งปิด Tracking อัตโนมัติออก 
          // เพื่อให้ผู้ใช้ซูมเข้า-ออกดูโลกมุมกว้างได้อิสระ โดยปุ่มยัง Active อยู่!
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
            // ฟันธง: ซูมเข้าไปใกล้ๆ ให้รู้สึกเหมือน "นั่งไปบนดาวเทียม"
            // ฟันธง 2: อัปเดตพิกัดตามดาวเทียม แต่ "ถอดการบังคับ altitude ออก"
                  // ทำให้กล้องลอยตามดาวเทียมแบบเนียนๆ ส่วนผู้ใช้จะซูมเข้า/ซูมออกดูโลกกว้างๆ เองได้เลย
                  globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
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
    if (camLight) camLight.intensity = realtimeSun ? 0 : 2.5;

    const ambient = scene.children.find(c => c.type === 'AmbientLight');
    if (ambient) ambient.intensity = realtimeSun ? 0.02 : 0.05; 

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
    // ฟันธง: กรองเอาเฉพาะดาวเทียมที่ถูก "เลือก" เท่านั้นมาคำนวณและแสดงผลบนจอ เพื่อแก้ปัญหากระตุกและลดความรก
    return SATELLITE_OPTIONS.filter(sat => selectedCatnrs.includes(sat.catnr)).map(sat => {
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
  }, [currentDate, satrecs, selectedCatnr, selectedCatnrs]); // เพิ่ม selectedCatnrs ใน dependency ด้วย

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
    return [{ points, color: 'rgba(255, 204, 0, 0.8)', stroke: 1.0 }]; 
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
    return [{ points, color: 'rgba(255, 215, 0, 0.8)', stroke: 0.5 }];
  }, [selectedCatnr, targetSatrec, Math.floor(simulatedTimeMs / 60000), showGroundTrack]);
  
  const footprintBoundaryPath = useMemo(() => {
    const paths = [];
    allSatObjects.forEach(sat => {
      if (selectedCatnrs.includes(sat.catnr)) {
        const isPrimary = sat.catnr === selectedCatnr;
        const radiusDeg = getFootprintRadiusDeg(sat.altKm, PASS_MIN_ELEVATION_DEG);
        if (!isNaN(radiusDeg)) {
          const pts = getCirclePolygon(sat.lat, sat.lng, radiusDeg, 64).map(c => ({ lng: c[0], lat: c[1], alt: 0.001 }));
          if (pts.length >= 3) {
            paths.push({
              points: pts,
              color: isPrimary ? 'rgba(255, 51, 51, 1)' : 'rgba(0, 234, 255, 0.8)',
              stroke: isPrimary ? 1.5 : 0.8
            });
          }
        }
      }
    });
    return paths;
  }, [allSatObjects, selectedCatnrs, selectedCatnr]);

  const signalVisualPath = useMemo(() => {
    if (!linkActive || !targetData || isNaN(targetData.lat) || isNaN(targetData.lng)) return [];
    const gsPoint = { lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, alt: 0 };
    const satPoint = { lat: targetData.lat, lng: targetData.lng, alt: Math.max(0, targetData.altKm) / EARTH_RADIUS_KM };
    return [
      { points: [gsPoint, satPoint], color: 'rgba(255, 255, 255, 0.9)', stroke: 0.4 },
      { points: [gsPoint, satPoint], color: 'rgba(0, 234, 255, 0.5)', stroke: 2.0 }
    ];
  }, [linkActive, targetData]);

  const footprintPolygonData = useMemo(() => {
    const polygons = [];
    allSatObjects.forEach(sat => {
      if (selectedCatnrs.includes(sat.catnr)) {
        const isPrimary = sat.catnr === selectedCatnr;
        const radiusDeg = getFootprintRadiusDeg(sat.altKm, PASS_MIN_ELEVATION_DEG);
        if (!isNaN(radiusDeg)) {
          const circleCoords = getCirclePolygon(sat.lat, sat.lng, radiusDeg, 64);
          polygons.push({
            coords: circleCoords,
            fillColor: isPrimary ? 'rgba(255, 51, 51, 0.15)' : 'rgba(0, 234, 255, 0.1)'
          });
        }
      }
    });
    return polygons;
  }, [allSatObjects, selectedCatnrs, selectedCatnr]);

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

 // ฟันธง 1: ฝังเซนเซอร์ ResizeObserver จับขนาดหน้าต่างแบบ Real-time
 const radarContainerRef = useRef(null);
 const [radarDim, setRadarDim] = useState({ w: 360, h: 420 }); // ขนาดเริ่มต้น

 useEffect(() => {
   if (!radarContainerRef.current) return;
   const observer = new ResizeObserver(entries => {
     if (entries[0]) setRadarDim({ w: entries[0].contentRect.width, h: entries[0].contentRect.height });
   });
   observer.observe(radarContainerRef.current);
   return () => observer.disconnect();
 }, [isRadarOpen]);

 // ฟันธง 1: คำนวณรัศมีและเพิ่มตัวแปร uiScale เพื่อให้ตัวหนังสือ/UI ขยายตามสัดส่วนจออย่างสมมาตร
 const radarLayout = useMemo(() => {
  // สมองกลคำนวณขนาดตัวหนังสือ (ยิ่งจอกว้าง ตัวหนังสือยิ่งใหญ่ แต่ตันสูงสุดที่ 1.8 เท่า)
  const uiScale = Math.max(1, Math.min(1.8, radarDim.w / 360)); 
  
  // เผื่อขอบด้านข้างและบนล่างให้กว้างขึ้น เพื่อไม่ให้ตัวหนังสือ AZ ที่ขยาย ถูกตัดขาด
  const topMargin = 70 * uiScale; 
  const bottomMargin = 45 * uiScale;
  const sideMargin = 45 * uiScale;
  
  const R = Math.max(50, Math.min(radarDim.w - sideMargin * 2, radarDim.h - topMargin - bottomMargin) / 2);
  const cx = radarDim.w / 2;
  const cy = (radarDim.h - topMargin - bottomMargin) / 2 + topMargin - 10; 
  
  return { R, cx, cy, uiScale };
}, [radarDim]);

 const radarData = useMemo(() => {
   if (!targetSatrec) return { segments: [], maxEl: 0 };
   const segments = [];
   let prevPoint = null;
   let maxEl = -90;
   const { R, cx, cy } = radarLayout;

   for (let m = -30; m <= 30; m += 0.5) { 
     const d = new Date(currentDate.getTime() + m * 60000);
     const pos = calculateSatData(d, targetSatrec);
     
     if (pos && !isNaN(pos.elevationDeg) && !isNaN(pos.azimuthDeg)) {
       if (pos.elevationDeg > maxEl) maxEl = pos.elevationDeg; 
       if (pos.elevationDeg < -15) { prevPoint = null; continue; }
       
       const r = R * ((90 - pos.elevationDeg) / 90);
       const x = cx + r * Math.sin((pos.azimuthDeg * Math.PI) / 180);
       const y = cy - r * Math.cos((pos.azimuthDeg * Math.PI) / 180);
       
       const isVis = pos.elevationDeg >= PASS_MIN_ELEVATION_DEG;
       const isPast = m <= 0; 

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
   return { segments, maxEl: maxEl > -15 ? maxEl.toFixed(1) : 'N/A' };
 }, [targetSatrec, Math.floor(simulatedTimeMs / 60000), radarLayout]);

 const radarCurrentPos = useMemo(() => {
   if (!targetData || isNaN(targetData.elevationDeg) || isNaN(targetData.azimuthDeg)) return null;
   if (targetData.elevationDeg < -15) return null;
   
   const { R, cx, cy } = radarLayout;
   const r = R * ((90 - targetData.elevationDeg) / 90);
   const x = cx + r * Math.sin((targetData.azimuthDeg * Math.PI) / 180);
   const y = cy - r * Math.cos((targetData.azimuthDeg * Math.PI) / 180);
   
   return { x, y, isVis: targetData.elevationDeg >= PASS_MIN_ELEVATION_DEG, el: targetData.elevationDeg };
 }, [targetData, radarLayout]);

  return (
    <>
      <Globe
        ref={globeRef} width={size.width} height={size.height}
        backgroundColor="#000000"
        /* ฟันธง: เปลี่ยนเป็นภาพกลางคืนความละเอียดสูง (แสงไฟเมือง) และสลับกลางวันอัตโนมัติเมื่อกดปุ่ม Sunlight */
       /* ฟันธง: ใช้ภาพเดียวไปเลยให้แสงเงาทำงานสมจริง และลดชั้นบรรยากาศให้ขอบโลกคมกริบแบบ Sci-Fi */
       globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
       bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
       backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
       showAtmosphere={true}
       atmosphereColor="#00eaff"
       atmosphereAltitude={0.05}

        objectsData={[...allSatObjects]}
        objectLat="lat" objectLng="lng" objectAltitude="altitude"
        objectThreeObject={(d) => createSatelliteModel(d.isTarget)}
        
        objectLabel={(d) => {
          if (d.type !== 'satellite') return '';
          const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === d.catnr);
          const flagHtml = satInfo?.flag ? `<img src="https://flagcdn.com/w20/${satInfo.flag}.png" width="20" style="vertical-align: middle; border-radius: 2px; margin-right: 6px;" />` : '🛰️ ';
          return `
            <div style="background: rgba(0, 10, 20, 0.9); border: 1px solid #00eaff; border-radius: 4px; padding: 10px 15px; font-family: 'Rajdhani', sans-serif; box-shadow: 0 5px 20px rgba(0,234,255,0.6);">
              <strong style="color: #fff; font-size: 15px; display: flex; align-items: center; text-shadow: 0 0 10px #00eaff;">${flagHtml}${satInfo?.displayName || d.name}</strong>
              <div style="margin-top: 6px; font-weight: bold;">
                <span style="color: #00eaff; font-size: 13px;">NORAD: ${d.catnr}</span><br/>
                <span style="color: #ffcc00; font-size: 13px;">Alt: ${Math.round(d.altKm)} km</span>
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
            if (globeRef.current) globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.4 }, 1000);
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
            <div style="display: flex; align-items: center; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 5px #000, 0 0 15px #00eaff; transform: translate(15px, -15px); pointer-events: none; white-space: nowrap;">
              ${flagUrl ? `<img src="${flagUrl}" style="width:20px; margin-right:8px; border-radius:2px; box-shadow: 0 0 8px rgba(0,234,255,0.8);" />` : ''}
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
        ringColor={() => linkActive ? t => `rgba(0, 255, 102, ${1-t})` : t => `rgba(255, 51, 51, ${1-t})`}
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
              backgroundImage: "url('//unpkg.com/three-globe/example/img/earth-blue-marble.jpg')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: '#000'
            }}
          >
            {/* ฟันธง: ระบบสร้างเงากลางคืน (Night Shadow) แบบ Gradient ที่ทำงานได้สมบูรณ์ทุกเบราว์เซอร์ */}
            {realtimeSun && (() => {
              const nightLng = currentSunPos.lng > 0 ? currentSunPos.lng - 180 : currentSunPos.lng + 180;
              const nightLat = -currentSunPos.lat; // เงาตกตรงข้ามกับจุดที่ดวงอาทิตย์ตั้งฉาก
              const nightX = (nightLng + 180) / 360 * 100;
              const nightY = (90 - nightLat) / 180 * 100;
              return (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
                  {[-100, 0, 100].map(offset => (
                    <div 
                      key={offset}
                      style={{
                        position: 'absolute', top: 0, left: `${offset}%`, width: '100%', height: '100%',
                        background: `radial-gradient(circle at ${nightX}% ${nightY}%, rgba(0, 5, 15, 0.85) 0%, rgba(0, 5, 15, 0.6) 40%, transparent 65%)`
                      }}
                    />
                  ))}
                </div>
              );
            })()}

            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-svg">
              {orbitVisualPath.map((pathObj, i) => {
                const segments = [];
                let currentPoints = [];
                pathObj.points.forEach((p, idx) => {
                  // ฟันธง 3: เปลี่ยนระยะเช็คการกระโดดข้ามขั้วโลกเป็น 90 องศา จะแก้บั๊กเส้นตีกลับได้ 100%
                if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 90) {
                    segments.push(currentPoints);
                    currentPoints = [];
                  }
                  currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                });
                if (currentPoints.length > 0) segments.push(currentPoints);
                return segments.map((seg, j) => (
                  <polyline key={`orb-${i}-${j}`} points={seg.join(' ')} fill="none" stroke="rgba(255, 204, 0, 0.5)" strokeWidth="0.2" strokeDasharray="0.5 0.5" />
                ));
              })}

              {showGroundTrack && groundTrackPath.map((pathObj, i) => {
                const segments = [];
                let currentPoints = [];
                pathObj.points.forEach((p, idx) => {
                  // ฟันธง 3: เปลี่ยนระยะเช็คการกระโดดข้ามขั้วโลกเป็น 90 องศา จะแก้บั๊กเส้นตีกลับได้ 100%
                if (idx > 0 && Math.abs(p.lng - pathObj.points[idx-1].lng) > 90) {
                    segments.push(currentPoints);
                    currentPoints = [];
                  }
                  currentPoints.push(`${(p.lng + 180) / 360 * 100},${(90 - p.lat) / 180 * 100}`);
                });
                if (currentPoints.length > 0) segments.push(currentPoints);
                return segments.map((seg, j) => (
                  <polyline key={`gt-${i}-${j}`} points={seg.join(' ')} fill="none" stroke={pathObj.color} strokeWidth="0.15" />
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
                
                // ฟันธง 1: แก้ไข Polar Distortion (ปรับสัดส่วนความกว้างของวงรีตามละติจูด)
                const latRad = (sat.lat * Math.PI) / 180;
                const cosLat = Math.max(Math.abs(Math.cos(latRad)), 0.05); // กันค่าเข้าใกล้ 0 ที่ขั้วโลก
                const rxDeg = Math.min(radiusDeg / cosLat, 180); // ขยายแกน X แต่ไม่ให้เกินครึ่งโลก
                
                const cx = (sat.lng + 180) / 360 * 100;
                const cy = (90 - sat.lat) / 180 * 100;
                const rx = rxDeg / 360 * 100;
                const ry = radiusDeg / 180 * 100;
                
                // ฟันธง 2: แก้ไข Edge Wrap-around (วาดวงรีโคลนนิ่งซ้ายขวา ให้ขอบเชื่อมกันเนียนกริบ)
                return [-100, 0, 100].map(offset => (
                  <ellipse 
                    key={`fp-${sat.catnr}-${offset}`}
                    cx={`${cx + offset}`} 
                    cy={`${cy}`} 
                    rx={`${rx}`}
                    ry={`${ry}`}
                    fill={isPrimary ? "rgba(255, 51, 51, 0.15)" : "rgba(0, 234, 255, 0.1)"}
                    stroke={isPrimary ? "rgba(255, 51, 51, 1)" : "rgba(0, 234, 255, 0.8)"}
                    strokeWidth="0.2"
                  />
                ));
              })}
            </svg>

            <div className="map-marker" style={{ left: `${(GROUND_STATION.lng + 180) / 360 * 100}%`, top: `${(90 - GROUND_STATION.lat) / 180 * 100}%`, color: '#00eaff', zIndex: 5 }}>
              <span style={{ fontSize: '24px', textShadow: '0 0 20px #00eaff', marginBottom: '4px' }}>📡</span>
              <span className="label" style={{ fontSize: '12px', fontWeight: '900', textShadow: '0 0 10px #00eaff', color: '#00eaff' }}>GISTDA</span>
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
                <span 
                  className={sat.isTarget ? 'target-dot' : 'dot'} 
                  style={{ 
                    boxShadow: sat.isTarget ? '0 0 20px #ff3333' : isSecondary ? '0 0 15px #ffcc00' : '0 0 10px #00ff66' 
                  }}>
                </span>
                <span className="label" style={{ 
                  color: sat.isTarget ? '#ffffff' : isSecondary ? '#ffcc00' : '#00ff66', 
                  fontSize: sat.isTarget ? '13px' : isSecondary ? '12px' : '10px', 
                  opacity: 1, 
                  fontWeight: '900',
                  textShadow: sat.isTarget ? '0 0 10px #ff3333, 0 0 20px #ff3333' : isSecondary ? '0 0 8px #ffcc00, 0 0 15px #000' : '0 0 8px #00ff66, 0 0 15px #000' 
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
            onClick={toggleLeftPanel}
          >
            {isLeftPanelOpen ? '✕' : '☰'}
          </button>
          
          {isLeftPanelOpen && (
            <div className="left-panel">
              <div className="panel-box main-title">
                <h1>SATELLITE ORBIT</h1>
                <span>{targetConfig.displayName} • Thailand Satellite Ground Station</span>
              </div>

              <section className="clock-panel">
                <div className="clock-item">
                  <span>THA LOCAL</span>
                  <strong style={{ color: 'var(--red)', textShadow: '0 0 15px rgba(255, 51, 51, 0.9)' }}>{formatTime(thaiTime)}</strong>
                </div>
                <div className="clock-item">
                  <span>DOY</span>
                  <strong>{pad3(getUtcDayOfYear(currentDate))}</strong>
                </div>
                <div className="clock-item">
                  <span>UTC</span>
                  <strong style={{ color: 'var(--red)', textShadow: '0 0 15px rgba(255, 51, 51, 0.9)' }}>{formatTime(currentDate)}</strong>
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

                <ul className="info-list">
                  <li><span>Operator / Agency:</span> <strong>{targetConfig.operator || 'Unknown'}</strong></li>
                  <li><span>Mission Type:</span> <strong>{targetConfig.mission || 'Various'}</strong></li>
                  <li><span>Orbit Class:</span> <strong>{targetData?.altKm > 2000 ? (targetData?.altKm > 30000 ? 'GEO' : 'MEO') : 'LEO'}</strong></li>
                  
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
            onClick={toggleRightPanel}
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
                 {realtimeSun ? 'DAY/NIGHT: REAL-TIME' : 'DAY/NIGHT: DISABLED'}
                </button>
                
                <button 
                  className={`btn ${isFlatMap ? 'active' : ''}`} 
                  onClick={() => setIsFlatMap(!isFlatMap)}
                  style={{ marginTop: '10px' }}
                >
                  {isFlatMap ? 'VIEW: 3D GLOBE' : 'VIEW: 2D TACTICAL MAP'}
                </button>

                <button 
                  className={`btn ${showGroundTrack ? 'active' : ''}`} 
                  onClick={() => setShowGroundTrack(!showGroundTrack)}
                  style={{ marginTop: '10px' }}
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
                              globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: 0.4 }, 1000);
                            }
                        }
                      } catch (err) {}
                    }
                  }}
                  style={{ marginTop: '10px' }}
                >
                  CAMERA TRACKING
                </button>
              </div>

                {/* ฟันธง: ปุ่มเรียกดูหน้าจอจานเรดาร์ ขยายกรอบให้กว้างและจัดกึ่งกลางเป๊ะๆ */}
                <button 
                  className={`btn ${isRadarOpen ? 'active' : ''}`} 
                  onClick={() => setIsRadarOpen(!isRadarOpen)}
                  style={{ 
                    marginTop: '10px', 
                    padding: '12px 10px', /* เพิ่มพื้นที่บน-ล่างให้หายใจ */
                    minHeight: '48px',    /* บังคับความสูงขั้นต่ำ ไม่ให้กรอบบีบตัวหนังสือ */
                    display: 'flex',      /* ใช้ Flex จัดระเบียบไอคอนและข้อความ */
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    gap: '8px',           /* เว้นช่องไฟระหว่างเสาอากาศกับตัวหนังสือ */
                    borderColor: 'var(--green)', 
                    color: 'var(--green)', 
                    textShadow: '0 0 8px var(--green)' 
                  }}
                >
                  📡 GISTDA RADAR SKYPLOT
                </button>

              <div className="control-group">
                <p>SPEED</p>
                <div className="speed-row">
                  {[1, 100, 300, 500].map(s => (
                    <button key={s} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0}} onClick={() => setSpeedMult(s)}>{s}X</button>
                  ))}
                </div>
              </div>

              <div className="control-group" style={{ padding: '25px 20px', textAlign: 'center' }}>
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
        <div className="modal-overlay" style={{ zIndex: 99999 }}>
          <div className="modal-box">
            <div className="modal-header">
              <h2><span style={{fontSize:'26px', marginRight:'8px'}}>🛰️</span> SATELLITE DATABASE</h2>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {/* ฟันธง: ปุ่มเคลียร์ดาวเทียมดวงรองทั้งหมด ทิ้งไว้แค่ดวง MAIN */}
                <button 
                  className="modal-clear-btn" 
                  onClick={() => setSelectedCatnrs([selectedCatnr])}
                  title="Remove all secondary satellites"
                >
                  🧹 CLEAR OTHERS
                </button>
                <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>✕</button>
              </div>
            </div>
            
            <div className="modal-content">
              {Array.from(new Set(SATELLITE_OPTIONS.map(s => s.group))).map(groupName => {
                // ฟันธง: Logic เช็คสถานะการเลือกดาวเทียมทั้งกลุ่ม
                const satsInGroup = SATELLITE_OPTIONS.filter(sat => sat.group === groupName);
                const groupCatnrs = satsInGroup.map(s => s.catnr);
                const isAllSelected = groupCatnrs.every(cat => selectedCatnrs.includes(cat));

                return (
                <div key={groupName}>
                  <div className="group-header-row">
                    <div className="modal-group-title">{groupName}</div>
                    
                    {/* ฟันธง: ปุ่ม Select All / Deselect All ประจำกลุ่ม */}
                    <button 
                      className="group-toggle-btn"
                      onClick={() => {
                        let newSelected = [...selectedCatnrs];
                        
                        if (isAllSelected) {
                          // ถ้าเลือกครบแล้ว ให้ลบทั้งกลุ่มออก (แต่ล็อกดวง MAIN เอาไว้ระบบจะได้ไม่พัง)
                          newSelected = newSelected.filter(c => !groupCatnrs.includes(c) || c === selectedCatnr);
                        } else {
                          // ถ้ายังไม่ครบ ให้เพิ่มทั้งกลุ่มเข้าไป
                          groupCatnrs.forEach(c => {
                            if (!newSelected.includes(c)) newSelected.push(c);
                          });
                        }
                        setSelectedCatnrs(newSelected);
                      }}
                    >
                      {isAllSelected ? '- DESELECT ALL' : '+ SELECT ALL'}
                    </button>
                  </div>

                  <div className="modal-grid">
                    {satsInGroup.map(sat => (
                      <button 
                        key={sat.catnr} 
                        className={`modal-sat-btn ${sat.catnr === selectedCatnr ? 'primary' : selectedCatnrs.includes(sat.catnr) ? 'secondary' : ''}`} 
                        onClick={() => {
                          let newSelected = [...selectedCatnrs];
                          
                          if (newSelected.includes(sat.catnr)) {
                            newSelected = newSelected.filter(c => c !== sat.catnr);
                          } else {
                            newSelected.push(sat.catnr);
                          }
                          setSelectedCatnrs(newSelected);
                          
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
                                    globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
                                  }
                              }
                            } catch (err) {}
                          }
                        }}
                      >
                        {sat.displayName}
                        {sat.catnr === selectedCatnr ? (
                          <span style={{ color: '#fff', textShadow: '0 0 10px #fff', fontSize: '15px', letterSpacing: '1px' }}>🎯 MAIN</span>
                        ) : selectedCatnrs.includes(sat.catnr) ? (
                          <span style={{ color: '#000', fontSize: '14px' }}>●</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              )})}
            </div>
          </div>
        </div>
      )}

{/* ฟันธง: หน้าจอ RADAR แบบ Dynamic Grid (ขยายจอแล้ววงกลม+เส้นจะงอกขึ้นมาเองอัตโนมัติ ตัวอักษรเท่าเดิม) */}
{isRadarOpen && (
        <div ref={radarContainerRef} className="radar-perfect-scale" style={{
          position: 'fixed',
          top: `${radarPos.y}px`,
          left: `${radarPos.x}px`,
          zIndex: 9999,
          background: 'rgba(0, 10, 20, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid var(--green)',
          borderRadius: '8px',
          boxShadow: '0 0 30px rgba(0, 255, 102, 0.3)',
          width: '360px', 
          height: '420px', 
          minWidth: '300px',
          minHeight: '350px',
          overflow: 'hidden',
          resize: 'both' // ให้ลากขยายได้อิสระ
        }}>
          
          {/* เอา viewBox ออกทิ้งไปเลยครับ! จบปัญหาอาการแว่นขยาย */}
          {/* เอา viewBox ออกทิ้งไปเลยครับ! จบปัญหาอาการแว่นขยาย */}
          <svg width="100%" height="100%" style={{ display: 'block' }}>
            
            {/* Header: ปรับความกว้างและสัดส่วนตัวหนังสือให้ยืดตาม uiScale */}
            <rect x="0" y="0" width={radarDim.w - 40} height={40 * radarLayout.uiScale} fill="transparent" cursor={isDraggingRadar ? 'grabbing' : 'grab'} onMouseDown={handleRadarMouseDown} />
            <line x1="10" y1={40 * radarLayout.uiScale} x2={radarDim.w - 10} y2={40 * radarLayout.uiScale} stroke="var(--green)" strokeDasharray="3 3" opacity="0.5" />
            <text x="15" y={28 * radarLayout.uiScale} fill="var(--green)" fontSize={14 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron">📡 AZ/EL</text>
            
            {(() => {
              const sat = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr);
              if (!sat) return null;
              const s = radarLayout.uiScale; // ดึงค่าตัวคูณมาใช้ให้โค้ดสั้นลง
              return (
                <g style={{ pointerEvents: 'none' }} transform={`translate(${radarDim.w / 2}, ${20 * s})`}>
                  <rect x={-70 * s} y={-14 * s} width={140 * s} height={28 * s} rx={4 * s} fill="rgba(0,255,102,0.2)" stroke="rgba(0,255,102,0.5)" />
                  {sat.flag && <image href={`https://flagcdn.com/w20/${sat.flag.toLowerCase()}.png`} x={-60 * s} y={-8 * s} width={16 * s} height={16 * s} />}
                  <text x={sat.flag ? -35 * s : 0} y={4 * s} fill="#fff" fontSize={12 * s} fontWeight="bold" fontFamily="Orbitron" textAnchor={sat.flag ? "start" : "middle"}>{sat.displayName}</text>
                </g>
              );
            })()}

            <g onClick={() => setIsRadarOpen(false)} cursor="pointer">
              <rect x={radarDim.w - (35 * radarLayout.uiScale)} y={10 * radarLayout.uiScale} width={24 * radarLayout.uiScale} height={24 * radarLayout.uiScale} rx={4 * radarLayout.uiScale} fill="transparent" stroke="var(--green)" />
              <text x={radarDim.w - (23 * radarLayout.uiScale)} y={27 * radarLayout.uiScale} fill="var(--green)" fontSize={14 * radarLayout.uiScale} textAnchor="middle" fontWeight="bold">✕</text>
            </g>

            <text x="15" y={65 * radarLayout.uiScale} fill="var(--cyan)" fontSize={11 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron" textAnchor="start">
              EL: {radarCurrentPos && radarCurrentPos.el ? Math.max(0, radarCurrentPos.el).toFixed(1) : '0.0'}°
            </text>
            <text x={radarDim.w - 15} y={65 * radarLayout.uiScale} fill="var(--cyan)" fontSize={11 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron" textAnchor="end">
              MAX EL: {radarData.maxEl !== 'N/A' ? `${radarData.maxEl}°` : 'N/A'}
            </text>

            <g style={{ pointerEvents: 'none' }}>
              {(() => {
                const { R, cx, cy, uiScale } = radarLayout;
                
                // ระบบวงกลมด้านในคงไว้เหมือนเดิม 100% ตามสั่ง
                const elStep = R > 250 ? 10 : (R > 150 ? 15 : 30);
                const rings = [];
                for (let e = elStep; e < 90; e += elStep) rings.push(e);

                const azStep = R > 200 ? 15 : 45;
                const azLines = [];
                for (let a = 0; a < 360; a += azStep) azLines.push(a);

                return (
                  <>
                    {azLines.map(az => {
                       const x2 = cx + R * Math.sin((az * Math.PI) / 180);
                       const y2 = cy - R * Math.cos((az * Math.PI) / 180);
                       const isMain = az % 90 === 0;
                       return <line key={`az-${az}`} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(0, 255, 102, 0.3)" strokeWidth={isMain ? "1" : "0.5"} strokeDasharray={isMain ? "none" : "3 3"} />
                    })}

                    {rings.map(el => {
                      const r = R * ((90 - el) / 90);
                      return (
                        <React.Fragment key={`el-${el}`}>
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0, 255, 102, 0.4)" strokeWidth="1" strokeDasharray="4 4" />
                          {R > 120 && el % 30 === 0 && (
                            <text x={cx + 2} y={cy - r + (9 * uiScale)} fill="rgba(0,255,102,0.6)" fontSize={9 * uiScale}>{el}°</text>
                          )}
                        </React.Fragment>
                      )
                    })}
                    
                    <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(0, 255, 102, 0.6)" strokeWidth="1.5" />
                    
                    {/* ฟันธง 2: เพิ่มข้อความมุมกวาด (Azimuth) มาตรฐาน 8 ทิศทาง และปรับขนาดตาม uiScale */}
                    {[0, 45, 90, 135, 180, 225, 270, 315].map(az => {
                      const isMain = az % 90 === 0;
                      // เผื่อระยะห่างข้อความจากขอบวงกลม ให้สมส่วนตามขนาดหน้าจอ
                      const padding = isMain ? 15 * uiScale : 12 * uiScale; 
                      const lx = cx + (R + padding) * Math.sin((az * Math.PI) / 180);
                      const ly = cy - (R + padding) * Math.cos((az * Math.PI) / 180);
                      
                      let label = az + '°';
                      if (az === 0) label = "N (0°)";
                      if (az === 90) label = "E (90°)";
                      if (az === 180) label = "S (180°)";
                      if (az === 270) label = "W (270°)";

                      // จัดตำแหน่งข้อความให้ไม่ทับวงกลม
                      let anchor = "middle";
                      if (az > 0 && az < 180) anchor = "start";
                      if (az > 180 && az < 360) anchor = "end";

                      let dy = "0.3em"; 
                      if (az === 0) dy = "0em"; 
                      if (az === 180) dy = "0.8em";

                      return (
                        <text 
                          key={`az-label-${az}`} 
                          x={lx} 
                          y={ly} 
                          dy={dy}
                          fill={isMain ? "var(--green)" : "rgba(0,255,102,0.6)"} 
                          fontSize={isMain ? 12 * uiScale : 10 * uiScale} 
                          fontWeight={isMain ? "bold" : "normal"} 
                          textAnchor={anchor}
                        >
                          {label}
                        </text>
                      );
                    })}
                  </>
                );
              })()}

              {radarData.segments.map((seg, i) => (
                <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={seg.color} strokeWidth={seg.width} strokeDasharray={seg.dash} />
              ))}
              
              {/* จุดดาวเทียม ขยายตามสัดส่วนหน้าจอ */}
              {radarCurrentPos && (
                <circle cx={radarCurrentPos.x} cy={radarCurrentPos.y} r={6 * radarLayout.uiScale} fill="#ff9900" stroke="#ffffff" strokeWidth={1.5 * radarLayout.uiScale} style={{ filter: `drop-shadow(0 0 ${10 * radarLayout.uiScale}px #ff9900)` }} />
              )}
              <circle cx={radarLayout.cx} cy={radarLayout.cy} r={3 * radarLayout.uiScale} fill="var(--red)" />
            </g>

            {/* Legend ด้านล่างขยายสมมาตร */}
            <text x={radarDim.w / 2} y={radarDim.h - (12 * radarLayout.uiScale)} fontSize={10 * radarLayout.uiScale} fontFamily="Orbitron" textAnchor="middle">
              <tspan fill="rgba(0, 234, 255, 0.4)">- - DEPARTED</tspan>
              <tspan dx={15 * radarLayout.uiScale} fill="var(--gold)">- - APPROACH</tspan>
              <tspan dx={15 * radarLayout.uiScale} fill="var(--cyan)">━━ VISIBLE</tspan>
            </text>
          </svg>
        </div>
      )}

      <div className="scanlines"></div>
    </>
  );
}