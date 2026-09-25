// @ts-nocheck
// Thailand Satellite Orbit — OK20.8 CLASSIC VECTOR ANTENNA FINAL

import React, { useEffect, useMemo, useRef, useState, startTransition } from 'react';
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
  { start: Date.UTC(2026, 7, 1, 2, 46, 18), end: Date.UTC(2026, 7, 1, 2, 46, 37) }, 
  // คิวที่ 2: ถ่ายภาพ 19 วินาที[cite: 1]
  { start: Date.UTC(2026, 7, 1, 2, 47, 10), end: Date.UTC(2026, 7, 1, 2, 47, 29) }, 
  // คิวที่ 3: ถ่ายภาพ 37 วินาที[cite: 1]
  { start: Date.UTC(2026, 7, 1, 2, 49, 23), end: Date.UTC(2026, 7, 1, 2, 50,  0) },
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
 
    .menu-toggle-btn-left { width: 32px; height: 32px; background: linear-gradient(135deg, rgba(0,234,255,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--cyan); color: var(--cyan); font-size: 16px; cursor: pointer; border-radius: 6px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-right: 10px; box-shadow: 0 0 15px rgba(0,234,255,0.6), inset 0 0 10px rgba(0,234,255,0.3); flex-shrink: 0; }
    .menu-toggle-btn-left:hover { background: var(--cyan); color: #000; box-shadow: 0 0 30px var(--cyan); transform: scale(1.1); }
    
    /* 📍 รีดไขมัน: เปลี่ยน gap และ padding-bottom เป็น vh */
    .left-panel { width: 100% !important; box-sizing: border-box !important; display: flex; flex-direction: column; gap: clamp(6px, 1.2vh, 12px); pointer-events: auto; flex: 1; min-height: 0; animation: slideInLeft 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; overflow-x: hidden; padding-bottom: clamp(10px, 2vh, 20px); }
    .left-panel::-webkit-scrollbar { display: none; }
    /* 📍 ฟันธง: แก้ไขบรรทัดนี้! ขยายความกว้างแผงขวาจาก 380-460px เป็น 400-550px ให้สมมาตรกับฝั่งซ้าย 100% */
    .right-container { width: clamp(400px, 32vw, 550px) !important; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; max-height: 100%; z-index: 20; }
    
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
  .control-group:nth-child(1) p { border-color: var(--gold); box-shadow: 0 0 10px rgba(255,204,0,0.4); }
  .control-group:nth-child(2) p { border-color: var(--green); box-shadow: 0 0 10px rgba(0,255,102,0.4); }
  .control-group:nth-child(3) p { border-color: var(--cyan); box-shadow: 0 0 10px rgba(0,234,255,0.4); }
  
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

    .control-group:nth-child(1) { border-color: var(--gold); border-top-color: var(--gold); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(255, 204, 0, 0.15), inset 0 0 20px rgba(255, 204, 0, 0.05); }
    .control-group:nth-child(1) p { color: var(--gold); border-bottom-color: rgba(255, 204, 0, 0.5); }
    
    /* 📍 บังคับให้ปุ่มทุกตัวในกลุ่มนี้เป็นสีทอง ไม่มีแสงแฟลร์ */
    .control-group:nth-child(1) .btn { border-color: rgba(255,204,0,0.4) !important; color: var(--gold) !important; text-shadow: none !important; background: rgba(255,204,0,0.05) !important; }
    
    .control-group:nth-child(1) .btn:hover { background: linear-gradient(135deg, #ffcc00, #ff6600) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: none !important; transform: translateY(-2px); }
    
    .control-group:nth-child(1) .btn.active { background: linear-gradient(135deg, #ffcc00, #ff8800) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: none !important; }

    /* 📍 แยกเป้าหมายเฉพาะปุ่ม PAUSE ไม่มีแสงแฟลร์ */
    .control-group:nth-child(1) .btn.btn-pause { border-color: rgba(255,51,51,0.6) !important; color: var(--red) !important; text-shadow: none !important; background: rgba(255,51,51,0.05) !important; }
    .control-group:nth-child(1) .btn.btn-pause:hover, .control-group:nth-child(1) .btn.btn-pause.active { background: linear-gradient(135deg, #ff3333, #aa0000) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--red) !important; text-shadow: none !important; }

    /* สไตล์ปุ่มเครื่องเล่นเทป (Media Controls) */
    .media-btn { display: flex !important; flex-direction: row; align-items: center; justify-content: center; padding: 14px !important; }
    .media-btn .icon { font-size: 44px; line-height: 1; filter: none !important; }

    /* 🖥️ กลุ่มที่ 2: DISPLAY CONTROLS (ขอบเขียว) */
    .control-group:nth-child(2) { border-color: var(--green); border-top-color: var(--green); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(0, 255, 102, 0.15), inset 0 0 20px rgba(0, 255, 102, 0.05); }
    .control-group:nth-child(2) p { color: var(--green); border-bottom-color: rgba(0, 255, 102, 0.4); }

    /* 🌟 เพิ่มคลาสปุ่มสีทอง (Gold) สำหรับ PASS SCHEDULE */
    .btn-gold { background: rgba(255, 204, 0, 0.05) !important; border: 1px solid rgba(255, 204, 0, 0.5) !important; color: var(--gold) !important; text-shadow: none !important; }
    .btn-gold:hover, .btn-gold.active { background: var(--gold) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--gold) !important; transform: scale(1.02) !important; }

    /* 🛠️ กลุ่มที่ 3: DATA & TOOLS (ล้าง Hover สีส้มทิ้ง สร้างคลาสสีมาตรฐาน Invert Color) */
    .control-group:nth-child(3) { border-color: var(--cyan); border-top-color: var(--cyan); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 30px rgba(0, 234, 255, 0.2), inset 0 0 20px rgba(0, 234, 255, 0.1); }
    .control-group:nth-child(3) p { color: var(--cyan); border-bottom-color: rgba(0, 234, 255, 0.4); }
    .control-group:nth-child(3) button { transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important; }
    
    /* 📍 ฟันธง: สังหารเอฟเฟกต์แสงขาววิ่งผ่าน (Sweep Flare) ทิ้ง เฉพาะในกรอบ DATA & TOOLS เด็ดขาด! */
    .control-group:nth-child(3) .btn::before { display: none !important; }
    
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
  nextPassTimeMs
}) {
  // STOW/PARK visual position: reflector-up, AZ 0 deg / EL 90 deg.
  // Keep the vector geometry and all tracking/orbit logic unchanged.
  const STOW_PARK_AZ_DEG = 0;
  const STOW_PARK_EL_DEG = 90;

  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(true);
  const [showOrbit, setShowOrbit] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [windowRect, setWindowRect] = useState({ x: 90, y: 72, width: 1180, height: 720 });
  const [visualPointing, setVisualPointing] = useState({ az: STOW_PARK_AZ_DEG, el: STOW_PARK_EL_DEG });
  const [visualSignalVisible, setVisualSignalVisible] = useState(false);
  const frameRef = useRef(null);
  const dragRef = useRef({ offsetX: 0, offsetY: 0 });
  const initializedWindowRef = useRef(false);
  const servoRef = useRef({
    az: STOW_PARK_AZ_DEG,
    el: STOW_PARK_EL_DEG,
    azVel: 0,
    elVel: 0,
    lastTs: null,
    lastLinkActive: false,
    signalReadyAt: 0,
    losAt: 0
  });
  const servoInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setIsMaximized(false);
      setIsMinimized(false);
      setIsDragging(false);
      return;
    }

    const fitRectToViewport = (rect) => {
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(240, window.innerHeight);
      const maxW = Math.max(520, vw - 16);
      const maxH = Math.max(360, vh - 16);
      const width = Math.min(Math.max(620, rect.width), maxW);
      const height = Math.min(Math.max(440, rect.height), maxH);
      const x = Math.min(Math.max(8, rect.x), Math.max(8, vw - width - 8));
      const y = Math.min(Math.max(8, rect.y), Math.max(8, vh - height - 8));
      return { x, y, width, height };
    };

    if (!initializedWindowRef.current) {
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(240, window.innerHeight);
      const width = Math.min(1360, Math.max(760, vw * 0.74), vw - 24);
      const height = Math.min(840, Math.max(540, vh * 0.78), vh - 24);
      setWindowRect({
        x: Math.max(12, (vw - width) / 2),
        y: Math.max(12, (vh - height) / 2),
        width,
        height
      });
      initializedWindowRef.current = true;
    } else {
      setWindowRect((rect) => fitRectToViewport(rect));
    }

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (isMaximized) setIsMaximized(false);
      else if (isMinimized) setIsMinimized(false);
      else onClose();
    };
    const onResize = () => {
      if (isMaximized) return;
      setWindowRect((rect) => fitRectToViewport(rect));
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, isMaximized, isMinimized, onClose]);

  useEffect(() => {
    if (!open || !isDragging) return;

    const onPointerMove = (event) => {
      const vw = Math.max(320, window.innerWidth);
      const vh = Math.max(240, window.innerHeight);
      setWindowRect((rect) => {
        const x = Math.min(Math.max(0, event.clientX - dragRef.current.offsetX), Math.max(0, vw - rect.width));
        const effectiveHeight = isMinimized ? 58 : rect.height;
        const y = Math.min(Math.max(0, event.clientY - dragRef.current.offsetY), Math.max(0, vh - effectiveHeight));
        return { ...rect, x, y };
      });
    };
    const onPointerUp = () => setIsDragging(false);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [open, isDragging, isMinimized]);

  useEffect(() => {
    if (!open || isMaximized || isMinimized || !frameRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.target?.getBoundingClientRect?.();
      if (!rect) return;
      setWindowRect((current) => {
        if (Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1) return current;
        return { ...current, width: rect.width, height: rect.height };
      });
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, isMaximized, isMinimized]);

  const startWindowDrag = (event) => {
    if (isMaximized || event.button !== 0) return;
    if (event.target?.closest?.('button, input, label')) return;
    const rect = frameRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setIsDragging(true);
    event.preventDefault();
  };

  const validAz = Number.isFinite(targetData?.azimuthDeg);
  const validEl = Number.isFinite(targetData?.elevationDeg);
  const wrappedAz = validAz ? (((targetData.azimuthDeg % 360) + 360) % 360) : 0;
  const rawEl = validEl ? targetData.elevationDeg : 0;

  // Visual servo model only. SAT-ORBIT remains the source of truth for orbit/AZ/EL.
  // At 1X, the model uses LEO-class visual rates (AZ 15 deg/s, EL 12 deg/s),
  // pre-slews shortly before AOS, waits 3 seconds for acquisition, then tracks.
  // After LOS the RF/satellite disappears, the dish holds briefly, then returns
  // to STOW/PARK more gently (AZ 12 deg/s, EL 9 deg/s).
  servoInputRef.current = {
    validAz,
    validEl,
    wrappedAz,
    rawEl,
    linkActive: Boolean(linkActive),
    speedMult: Math.max(1, Number(speedMult) || 1),
    isPlaying: Boolean(isPlaying),
    stationMask: Math.max(0, Number(stationMask) || 0),
    simulatedTimeMs: Number(simulatedTimeMs),
    nextPassTimeMs: Number(nextPassTimeMs)
  };

  useEffect(() => {
    if (!open) {
      const servo = servoRef.current;
      servo.az = STOW_PARK_AZ_DEG;
      servo.el = STOW_PARK_EL_DEG;
      servo.azVel = 0;
      servo.elVel = 0;
      servo.lastTs = null;
      servo.lastLinkActive = false;
      servo.signalReadyAt = 0;
      servo.losAt = 0;
      setVisualPointing({ az: STOW_PARK_AZ_DEG, el: STOW_PARK_EL_DEG });
      setVisualSignalVisible(false);
      return;
    }

    let rafId = 0;
    const PRE_SLEW_LEAD_SIM_MS = 9000;
    const ACQUIRE_WAIT_REAL_MS = 3000;
    const POST_LOS_HOLD_REAL_MS = 1200;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const shortestAzError = (target, current) => ((target - current + 540) % 360) - 180;
    const approachVelocity = (velocity, desired, maxDelta) => {
      if (velocity < desired) return Math.min(desired, velocity + maxDelta);
      if (velocity > desired) return Math.max(desired, velocity - maxDelta);
      return velocity;
    };

    const stepLinearAxis = (current, velocity, target, maxRate, accel, dt) => {
      const error = target - current;
      if (Math.abs(error) < 0.01 && Math.abs(velocity) < 0.05) return { value: target, velocity: 0 };
      const desiredVelocity = clamp(error * 2.1, -maxRate, maxRate);
      let nextVelocity = approachVelocity(velocity, desiredVelocity, accel * dt);
      let step = nextVelocity * dt;
      if (Math.abs(step) > Math.abs(error)) {
        step = error;
        nextVelocity = 0;
      }
      return { value: current + step, velocity: nextVelocity };
    };

    const stepAzAxis = (current, velocity, target, maxRate, accel, dt) => {
      const error = shortestAzError(target, current);
      if (Math.abs(error) < 0.01 && Math.abs(velocity) < 0.05) return { value: (target + 360) % 360, velocity: 0 };
      const desiredVelocity = clamp(error * 2.1, -maxRate, maxRate);
      let nextVelocity = approachVelocity(velocity, desiredVelocity, accel * dt);
      let step = nextVelocity * dt;
      if (Math.abs(step) > Math.abs(error)) {
        step = error;
        nextVelocity = 0;
      }
      return { value: ((current + step) % 360 + 360) % 360, velocity: nextVelocity };
    };

    const animate = (ts) => {
      const input = servoInputRef.current;
      const servo = servoRef.current;
      if (!input) {
        rafId = requestAnimationFrame(animate);
        return;
      }

      const dt = servo.lastTs === null ? 0 : clamp((ts - servo.lastTs) / 1000, 0, 0.05);
      servo.lastTs = ts;
      const speed = input.isPlaying ? input.speedMult : 0;
      const veryFastSim = speed > 60;
      const motionScale = speed > 0 ? speed : 0;

      if (input.linkActive && !servo.lastLinkActive) {
        servo.signalReadyAt = ts + (veryFastSim ? 0 : ACQUIRE_WAIT_REAL_MS / Math.max(1, motionScale));
        servo.losAt = 0;
        setVisualSignalVisible(false);
      } else if (!input.linkActive && servo.lastLinkActive) {
        servo.losAt = ts;
        servo.signalReadyAt = 0;
        setVisualSignalVisible(false);
      }
      servo.lastLinkActive = input.linkActive;

      const simNow = Number.isFinite(input.simulatedTimeMs) ? input.simulatedTimeMs : 0;
      const passAt = Number.isFinite(input.nextPassTimeMs) ? input.nextPassTimeMs : 0;
      const timeToAos = passAt > 0 ? passAt - simNow : Infinity;
      const preSlew = Boolean(
        input.isPlaying && !input.linkActive && input.validAz &&
        timeToAos > 0 && timeToAos <= PRE_SLEW_LEAD_SIM_MS
      );
      const holdingAfterLos = Boolean(
        !input.linkActive && servo.losAt > 0 &&
        ts - servo.losAt < (veryFastSim ? 0 : POST_LOS_HOLD_REAL_MS / Math.max(1, motionScale))
      );

      let targetAz = STOW_PARK_AZ_DEG;
      let targetEl = STOW_PARK_EL_DEG;
      let maxAzRate = 12;
      let maxElRate = 9;
      let azAccel = 20;
      let elAccel = 18;

      if (input.linkActive && input.validAz && input.validEl) {
        targetAz = input.wrappedAz;
        targetEl = clamp(input.rawEl, 0, 90);
        maxAzRate = 15;
        maxElRate = 12;
        azAccel = 30;
        elAccel = 24;
      } else if (preSlew) {
        targetAz = input.wrappedAz;
        targetEl = clamp(input.stationMask, 0, 90);
        maxAzRate = 15;
        maxElRate = 12;
        azAccel = 30;
        elAccel = 24;
      } else if (holdingAfterLos) {
        targetAz = servo.az;
        targetEl = servo.el;
        maxAzRate = 0;
        maxElRate = 0;
        azAccel = 0;
        elAccel = 0;
      }

      if (veryFastSim && input.linkActive && input.validAz && input.validEl) {
        servo.az = targetAz;
        servo.el = targetEl;
        servo.azVel = 0;
        servo.elVel = 0;
      } else if (dt > 0 && motionScale > 0) {
        const azStep = stepAzAxis(servo.az, servo.azVel, targetAz, maxAzRate * motionScale, azAccel * motionScale * motionScale, dt);
        const elStep = stepLinearAxis(servo.el, servo.elVel, targetEl, maxElRate * motionScale, elAccel * motionScale * motionScale, dt);
        servo.az = azStep.value;
        servo.azVel = azStep.velocity;
        servo.el = clamp(elStep.value, 0, 90);
        servo.elVel = elStep.velocity;
      }

      const pointingError = input.linkActive && input.validAz && input.validEl
        ? Math.max(Math.abs(shortestAzError(input.wrappedAz, servo.az)), Math.abs(clamp(input.rawEl, 0, 90) - servo.el))
        : Infinity;
      const signalShouldShow = Boolean(
        input.linkActive && input.validAz && input.validEl &&
        (veryFastSim || ts >= servo.signalReadyAt) &&
        pointingError <= (veryFastSim ? 999 : 2.5)
      );

      // Once acquisition is achieved, keep the satellite/RF visualization latched
      // for the remainder of the active pass. Near zenith the apparent azimuth can
      // change very quickly (especially at accelerated SIM rates), so a transient
      // servo pointing error must not make the satellite disappear from the scene.
      // The latch is cleared only when linkActive becomes false (LOS) or the view closes.
      setVisualSignalVisible((current) => {
        if (!input.linkActive) return false;
        if (current) return true;
        return signalShouldShow;
      });
      setVisualPointing((current) => {
        if (Math.abs(shortestAzError(servo.az, current.az)) < 0.015 && Math.abs(servo.el - current.el) < 0.015) return current;
        return { az: servo.az, el: servo.el };
      });

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [open]);

  const displayAz = visualPointing.az;
  const displayEl = visualPointing.el;

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
    const P = { x: 800, y: 438 };
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
    const visualRy = 400;
    const desiredRadius = 1 / Math.hypot(nx / visualRx, ny / visualRy);
    const safeLeft = 110;
    const safeRight = 1490;
    const safeTop = 72;
    const safeBottom = 760;
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

  const effectiveWidth = isMinimized ? Math.min(Math.max(430, windowRect.width), 720) : windowRect.width;
  const frameStyle = isMaximized
    ? {
        position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
        borderRadius: 0, borderWidth: 0, resize: 'none', pointerEvents: 'auto'
      }
    : {
        position: 'fixed', left: `${windowRect.x}px`, top: `${windowRect.y}px`,
        width: `${effectiveWidth}px`, height: isMinimized ? '58px' : `${windowRect.height}px`,
        borderRadius: '12px', borderWidth: '2px', resize: isMinimized ? 'none' : 'both',
        minWidth: isMinimized ? '430px' : 'min(660px, calc(100vw - 16px))',
        minHeight: isMinimized ? '58px' : 'min(460px, calc(100vh - 16px))',
        maxWidth: 'calc(100vw - 8px)', maxHeight: 'calc(100vh - 8px)',
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
        .sat-antenna3d-toolbar {
          position: absolute;
          z-index: 11;
          left: clamp(10px, 1.25cqw, 18px);
          right: auto;
          bottom: clamp(9px, 1.05cqw, 14px);
          width: auto;
          height: auto;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding: 0;
          background: transparent;
          border-top: 0;
          box-shadow: none;
          box-sizing: border-box;
        }
        .sat-antenna3d-toolbar-left {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: clamp(8px, 1.35cqw, 16px);
          min-width: 0;
          max-width: 100%;
        }
        .sat-antenna3d-toggle {
          display: inline-flex;
          align-items: center;
          gap: clamp(4px, 0.55cqw, 7px);
          color: rgba(255,255,255,0.72);
          font: 800 clamp(8px, 0.82cqw, 10px) Rajdhani, sans-serif;
          letter-spacing: 0.8px;
          white-space: nowrap;
          text-shadow: 0 1px 3px rgba(4,25,37,0.95);
        }
        .sat-antenna3d-toggle button {
          min-width: clamp(44px, 5.4cqw, 55px);
          height: clamp(22px, 2.5cqw, 25px);
          border-radius: 999px;
          padding: 0 clamp(6px, 0.8cqw, 9px);
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.56);
          font: 900 clamp(8px, 0.76cqw, 9px) Orbitron, sans-serif;
          cursor: pointer;
        }
        .sat-antenna3d-toggle button.active {
          border-color: var(--green);
          color: #041b12;
          background: var(--green);
          box-shadow: 0 0 12px rgba(0,255,102,0.28);
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
      `}</style>

      <div
        ref={frameRef}
        className="sat-antenna3d-frame"
        style={frameStyle}
        onPointerDownCapture={() => onFocus?.()}
      >
        <div
          className="sat-antenna3d-header"
          onPointerDown={startWindowDrag}
          style={{ cursor: isMaximized ? 'default' : (isDragging ? 'grabbing' : 'grab') }}
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
            <button
              className="sat-antenna3d-control-btn"
              onClick={() => {
                if (isMaximized) setIsMaximized(false);
                setIsMinimized((value) => !value);
              }}
              title={isMinimized ? 'Restore window' : 'Minimize'}
              style={{ border: '1px solid rgba(0,234,255,0.62)', color: 'var(--cyan)', background: 'rgba(0,234,255,0.06)' }}
            >
              {isMinimized ? '\u25a1' : '\u2212'}
            </button>
            <button
              className="sat-antenna3d-control-btn"
              onClick={() => {
                setIsMinimized(false);
                setIsMaximized((value) => !value);
              }}
              title={isMaximized ? 'Restore window' : 'Maximize'}
              style={{ border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,234,255,0.08)' }}
            >
              {isMaximized ? '\u2750' : '\u25a1'}
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

        {!isMinimized && (
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
                {showOrbit && (
                  <path
                    d="M45 590 Q800 -360 1555 590"
                    fill="none"
                    stroke={visualSignalVisible ? '#9f8737' : '#6f9fb2'}
                    strokeOpacity={visualSignalVisible ? '0.68' : '0.52'}
                    strokeWidth="1.8"
                    strokeDasharray={visualSignalVisible ? undefined : '9 10'}
                  />
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

                <g aria-label="Concrete antenna foundation" vectorEffect="non-scaling-stroke">
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
              <div className="sat-antenna3d-toolbar-left">
                <div className="sat-antenna3d-toggle">
                  <span>GRID</span>
                  <button className={showGrid ? 'active' : ''} onClick={() => setShowGrid((value) => !value)} title="Toggle engineering grid">
                    {showGrid ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="sat-antenna3d-toggle">
                  <span>GUIDES</span>
                  <button className={showGuides ? 'active' : ''} onClick={() => setShowGuides((value) => !value)} title="Toggle horizon / elevation guides">
                    {showGuides ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="sat-antenna3d-toggle">
                  <span>ORBIT</span>
                  <button className={showOrbit ? 'active' : ''} onClick={() => setShowOrbit((value) => !value)} title="Toggle orbit arc">
                    {showOrbit ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>

            {!isMaximized && <div className="sat-antenna3d-resize-grip">&#8991;</div>}
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
let weatherLeafletPromise = null;
function loadWeatherLeaflet() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Leaflet requires a browser'));
  if (window.L) return Promise.resolve(window.L);
  if (weatherLeafletPromise) return weatherLeafletPromise;

  weatherLeafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById('sat-orbit-leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'sat-orbit-leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const existing = document.getElementById('sat-orbit-leaflet-js');
    if (existing) {
      const started = Date.now();
      const waitForLeaflet = () => {
        if (window.L) return resolve(window.L);
        if (Date.now() - started > 10000) return reject(new Error('Leaflet load timeout'));
        setTimeout(waitForLeaflet, 50);
      };
      waitForLeaflet();
      return;
    }

    const script = document.createElement('script');
    script.id = 'sat-orbit-leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet unavailable after load'));
    script.onerror = () => reject(new Error('Leaflet script failed to load'));
    document.head.appendChild(script);
  }).catch((error) => {
    weatherLeafletPromise = null;
    throw error;
  });

  return weatherLeafletPromise;
}

function WeatherInteractiveMap({ station, fmt, cloudCover, precipitationNow }) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const weatherLayerRef = useRef(null);
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
    let resizeTimer = null;
    setMapReady(false);
    setMapError('');
    setLayerMode('CLOUD');

    loadWeatherLeaflet()
      .then((L) => {
        if (cancelled || !hostRef.current) return;
        if (mapRef.current) {
          try { mapRef.current.remove(); } catch (_) {}
          mapRef.current = null;
        }

        // Map interaction: wheel zooms the map while the pointer is over the map;
        // scrolling outside the map continues to scroll the Weather Center.
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
        }).setView([lat, lng], 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        L.circle([lat, lng], {
          radius: 17000,
          color: '#00ff66',
          weight: 1,
          opacity: 0.55,
          fillColor: '#00ff66',
          fillOpacity: 0.06,
          interactive: false
        }).addTo(map);

        const marker = L.circleMarker([lat, lng], {
          radius: 7,
          color: '#00ff66',
          weight: 2,
          fillColor: '#ffcc00',
          fillOpacity: 0.95
        }).addTo(map);
        marker.bindTooltip(`${stationId} GROUND STATION`, { permanent: false, direction: 'top', opacity: 0.9 });

        mapRef.current = map;
        setMapReady(true);
        resizeTimer = setTimeout(() => {
          try { map.invalidateSize(false); } catch (_) {}
        }, 80);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[WeatherCenter] interactive map unavailable:', error);
        setMapError('INTERACTIVE MAP OFFLINE');
      });

    return () => {
      cancelled = true;
      if (resizeTimer) clearTimeout(resizeTimer);
      if (weatherLayerRef.current) {
        try { weatherLayerRef.current.remove(); } catch (_) {}
        weatherLayerRef.current = null;
      }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_) {}
        mapRef.current = null;
      }
    };
  }, [stationId, lat, lng]);

  useEffect(() => {
    const map = mapRef.current;
    const L = typeof window !== 'undefined' ? window.L : null;
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

    layer.on('tileerror', () => {
      setMapError(layerConfig.error);
    });
    layer.on('load', () => setMapError(''));
    layer.addTo(map);
    weatherLayerRef.current = layer;
  }, [layerMode, mapReady]);

  const zoomBy = (delta) => {
    const map = mapRef.current;
    if (!map) return;
    if (delta > 0) map.zoomIn(); else map.zoomOut();
  };

  const cloudPct = Number.isFinite(Number(cloudCover)) ? Math.max(0, Math.min(100, Number(cloudCover))) : null;
  const rainNow = Number.isFinite(Number(precipitationNow)) ? Math.max(0, Number(precipitationNow)) : null;

  return (
    <div className="weather-map-shell">
      <div ref={hostRef} className="weather-leaflet-host" />
      <div className="weather-map-overlay" />
      <div className="weather-map-label">GLOBAL WEATHER MAP • {stationId}</div>
      <div className="weather-map-actions">
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
          title="Global satellite true color • NASA GIBS / MODIS Terra"
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
        <small>{layerMode === 'CLOUD' ? 'CLOUD: VIIRS NOAA-20 VISIBLE CLOUD • NASA GIBS' : layerMode === 'RAIN' ? 'RAIN: GPM IMERG V07 30-MIN GLOBAL • NASA GIBS' : layerMode === 'SATELLITE' ? 'SATELLITE: MODIS TERRA TRUE COLOR • NASA GIBS' : 'BASE: OPENSTREETMAP'}</small>
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
  summaryMode
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [windowRect, setWindowRect] = useState({ x: 210, y: 95, width: 1120, height: 720 });
  const [weatherData, setWeatherData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const frameRef = useRef(null);
  const dragRef = useRef({ offsetX: 0, offsetY: 0 });
  const initializedRef = useRef(false);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const finite = (v) => Number.isFinite(Number(v));
  const fmt = (v, digits = 0, fallback = '--') => finite(v) ? Number(v).toFixed(digits) : fallback;
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
  const weatherLabel = (code) => {
    const c = Number(code);
    if (!Number.isFinite(c)) return 'NO DATA';
    if (c === 0) return 'CLEAR SKY';
    if (c <= 2) return 'PARTLY CLOUDY';
    if (c === 3) return 'OVERCAST';
    if (c === 45 || c === 48) return 'FOG';
    if (c >= 51 && c <= 57) return 'DRIZZLE';
    if (c >= 61 && c <= 67) return 'RAIN';
    if (c >= 71 && c <= 77) return 'SNOW';
    if (c >= 80 && c <= 82) return 'RAIN SHOWERS';
    if (c >= 85 && c <= 86) return 'SNOW SHOWERS';
    if (c >= 95) return 'THUNDERSTORM';
    return 'VARIABLE';
  };
  const weatherIcon = (code) => {
    const c = Number(code);
    if (!Number.isFinite(c)) return '◌';
    if (c === 0) return '☀';
    if (c <= 2) return '🌤';
    if (c === 3) return '☁';
    if (c === 45 || c === 48) return '≋';
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return '🌧';
    if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return '❄';
    if (c >= 95) return '⛈';
    return '☁';
  };
  const windCardinal = (deg) => {
    if (!finite(deg)) return '--';
    const names = ['N','NE','E','SE','S','SW','W','NW'];
    return names[Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8];
  };

  useEffect(() => {
    if (!open) {
      setIsDragging(false);
      return;
    }
    if (!initializedRef.current) {
      const vw = Math.max(800, window.innerWidth);
      const vh = Math.max(600, window.innerHeight);
      const width = Math.min(1220, Math.max(900, vw * 0.72), vw - 32);
      const height = Math.min(790, Math.max(610, vh * 0.78), vh - 32);
      setWindowRect({ x: Math.max(16, (vw - width) / 2), y: Math.max(16, (vh - height) / 2), width, height });
      initializedRef.current = true;
    }
  }, [open]);

  useEffect(() => {
    if (!open || isMaximized || !frameRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.target?.getBoundingClientRect?.();
      if (!rect) return;
      setWindowRect((current) => {
        if (Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1) return current;
        return { ...current, width: rect.width, height: rect.height };
      });
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [open, isMaximized]);

  useEffect(() => {
    if (!open || !isDragging) return;
    const onMove = (event) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setWindowRect((rect) => ({
        ...rect,
        x: clamp(event.clientX - dragRef.current.offsetX, 0, Math.max(0, vw - rect.width)),
        y: clamp(event.clientY - dragRef.current.offsetY, 0, Math.max(0, vh - rect.height))
      }));
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [open, isDragging]);

  useEffect(() => {
    if (!open || !station || !finite(station.lat) || !finite(station.lng)) return;
    const controller = new AbortController();
    let active = true;
    setIsLoading(true);
    setWeatherError(null);

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
        setWeatherData(data || null);
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
  }, [open, station?.id, station?.lat, station?.lng, refreshKey]);

  if (!open) return null;

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
  const thunderstormNow = Number(current.weather_code) >= 95;
  const next24 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 24); i += 3) {
    next24.push({
      time: hourTimes[i],
      code: hourly.weather_code?.[i],
      temp: hourly.temperature_2m?.[i],
      cloud: hourly.cloud_cover?.[i],
      pop: hourly.precipitation_probability?.[i],
      rain: hourly.precipitation?.[i],
      wind: hourly.wind_speed_10m?.[i]
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

  const clampPct = (value) => finite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
  const cloudPct = clampPct(current.cloud_cover);
  const cloudState = cloudPct >= 90 ? 'OVERCAST' : cloudPct >= 70 ? 'CLOUDY' : cloudPct >= 40 ? 'BROKEN CLOUDS' : cloudPct >= 15 ? 'PARTLY CLOUDY' : 'CLEAR / FEW CLOUDS';
  const cloudLevelColor = (pct) => {
    const v = clampPct(pct);
    if (v <= 20) return '#24475f';
    if (v <= 40) return '#4f89a8';
    if (v <= 60) return '#83b8d0';
    if (v <= 80) return '#bfd8e6';
    return '#f4fbff';
  };
  // Conventional meteorological thermal ramp (there is no single universal palette):
  // colder values use blue/cyan; warm values move through green/yellow/orange to red.
  const temperatureColor = (value) => {
    const t = Number(value);
    if (!Number.isFinite(t)) return '#ffffff';
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
  const cloudOperationalLabel = cloudPct <= 20 ? 'CLEAR • OPTICAL FAVORABLE' : cloudPct <= 40 ? 'LOW CLOUD • GENERALLY FAVORABLE' : cloudPct <= 60 ? 'PARTLY CLOUDY • REVIEW TARGET' : cloudPct <= 80 ? 'CLOUDY • DEGRADED' : 'OVERCAST • OPTICAL DEGRADED';
  const precipNow = finite(current.rain ?? current.precipitation) ? Number(current.rain ?? current.precipitation) : 0;
  const windDirection = finite(current.wind_direction_10m) ? ((Number(current.wind_direction_10m) % 360) + 360) % 360 : 0;
  const windFlowDirection = (windDirection + 180) % 360;

  const rainHistory6 = [];
  for (let i = Math.max(0, nearestHour - 5); i <= nearestHour; i += 1) {
    rainHistory6.push({
      time: hourTimes[i],
      rain: finite(hourly.precipitation?.[i]) ? Number(hourly.precipitation[i]) : 0
    });
  }
  const rainHistoryMax = Math.max(0.1, ...rainHistory6.map((item) => item.rain || 0));
  const rainHistoryTotal = rainHistory6.reduce((sum, item) => sum + (item.rain || 0), 0);

  const precipNext6 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 6); i += 1) {
    precipNext6.push({
      time: hourTimes[i],
      rain: finite(hourly.precipitation?.[i]) ? Number(hourly.precipitation[i]) : 0,
      pop: finite(hourly.precipitation_probability?.[i]) ? Number(hourly.precipitation_probability[i]) : 0
    });
  }
  const precipNext6Max = Math.max(0.1, ...precipNext6.map((item) => item.rain || 0));
  const precipNext6Total = precipNext6.reduce((sum, item) => sum + (item.rain || 0), 0);
  const precipNext6Pop = precipNext6.length ? Math.max(...precipNext6.map((item) => item.pop || 0)) : 0;

  const cloudNext6 = [];
  for (let i = nearestHour; i < Math.min(hourTimes.length, nearestHour + 6); i += 1) {
    cloudNext6.push({
      time: hourTimes[i],
      cloud: clampPct(hourly.cloud_cover?.[i])
    });
  }

  const weatherAccent = (code) => {
    const c = Number(code);
    if (c >= 95) return '#ff3b5c';
    if ((c >= 61 && c <= 82) || (c >= 51 && c <= 57)) return '#ffb000';
    if (c === 3 || c === 45 || c === 48) return '#00d9ff';
    return '#00ff8a';
  };

  const lat = Number(station?.lat || 0);
  const lng = Number(station?.lng || 0);

  const frameStyle = isMaximized ? {
    position: 'fixed', inset: 0, width: '100vw', height: '100vh', borderRadius: 0, resize: 'none'
  } : {
    position: 'fixed', left: `${windowRect.x}px`, top: `${windowRect.y}px`, width: `${windowRect.width}px`, height: `${windowRect.height}px`,
    minWidth: 'min(820px, calc(100vw - 16px))', minHeight: 'min(560px, calc(100vh - 16px))',
    maxWidth: 'calc(100vw - 8px)', maxHeight: 'calc(100vh - 8px)', borderRadius: '12px', resize: 'both'
  };

  const startDrag = (event) => {
    if (isMaximized || event.button !== 0 || event.target?.closest?.('button')) return;
    const rect = frameRef.current?.getBoundingClientRect?.();
    if (!rect) return;
    dragRef.current = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    setIsDragging(true);
    event.preventDefault();
  };

  const metric = (label, value, unit = '', accent = '#fff', extraClass = '') => (
    <div className={`weather-center-metric ${extraClass}`.trim()}>
      <span>{label}</span>
      <strong style={{ color: accent }}>{value}{unit}</strong>
    </div>
  );

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
      `}</style>
      <div ref={frameRef} className="weather-center-frame" style={frameStyle} onPointerDownCapture={onFocus}>
        <div className="weather-center-header" onPointerDown={startDrag} style={{ cursor: isMaximized ? 'default' : (isDragging ? 'grabbing' : 'grab') }}>
          <div style={{ minWidth: 0, pointerEvents: 'none' }}>
            <div className="weather-center-title">WEATHER CENTER</div>
            <div className="weather-center-sub">{station?.id || 'SRC'} GROUND STATION • LIVE FORECAST • REGIONAL OPERATIONS VIEW</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="weather-center-btn" onClick={() => setRefreshKey((v) => v + 1)} title="Refresh weather" style={{ color: 'var(--green)', borderColor: 'var(--green)' }}>↻</button>
            <button className="weather-center-btn" onClick={() => setIsMaximized((v) => !v)} title={isMaximized ? 'Restore window' : 'Maximize'}>{isMaximized ? '❐' : '□'}</button>
            <button className="weather-center-btn" onClick={onClose} title="Close" style={{ color: 'var(--red)', borderColor: 'var(--red)', background: 'rgba(255,51,51,0.06)' }}>×</button>
          </div>
        </div>

        <div className="weather-center-body">
          <div className="weather-center-top">
            <div className="weather-center-panel">
              <WeatherInteractiveMap station={station} fmt={fmt} cloudCover={current.cloud_cover} precipitationNow={precipNow} />
            </div>

            <div className="weather-center-panel weather-center-current">
              {isLoading && !weatherData ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--cyan)', fontFamily: 'Orbitron', fontWeight: 900 }}>LOADING WEATHER DATA...</div>
              ) : weatherError && !weatherData ? (
                <div style={{ margin: 'auto', textAlign: 'center' }}>
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
                    </div>
                    <div className="weather-current-side">
                      <div className="weather-current-icon">{weatherIcon(current.weather_code)}</div>
                      <div className="weather-current-condition">{weatherLabel(current.weather_code)}</div>
                    </div>
                  </div>
                  <div className="weather-center-metrics">
                    {metric('TEMPERATURE', fmt(current.temperature_2m,1), '°C', temperatureColor(current.temperature_2m), 'temperature-highlight')}
                    {metric('FEELS LIKE', fmt(current.apparent_temperature,1), '°C', temperatureColor(current.apparent_temperature), 'temperature-highlight')}
                    {metric('HUMIDITY', fmt(current.relative_humidity_2m,0), '%', 'var(--cyan)')}
                    {metric('PRESSURE', fmt(current.surface_pressure,0), ' hPa', '#fff')}
                    {metric('VISIBILITY', fmt(visibilityKm,1), ' km', finite(visibilityKm) && Number(visibilityKm) < 5 ? 'var(--gold)' : '#fff')}
                    {metric('WIND', `${fmt(current.wind_speed_10m,0)} ${windCardinal(current.wind_direction_10m)}`, ' km/h', 'var(--cyan)')}
                    {metric('WIND GUST', fmt(current.wind_gusts_10m,0), ' km/h', finite(current.wind_gusts_10m) && Number(current.wind_gusts_10m) >= 40 ? '#ff8a00' : '#fff')}
                    {metric('RAIN NOW', fmt(precipNow,1), ' mm', precipNow > 0 ? '#ff9a00' : '#fff', 'rain-highlight')}
                    {metric('RAIN PROB.', fmt(popNow,0), '%', finite(popNow) && Number(popNow) >= 60 ? 'var(--gold)' : '#fff', 'rain-highlight')}
                    {metric('THUNDERSTORM', thunderstormNow ? 'DETECTED' : 'NO SIGNAL', '', thunderstormNow ? 'var(--red)' : 'var(--green)', thunderstormNow ? 'alert-highlight' : '')}
                  </div>

                  <div className="weather-ops-grid">
                    <div className="weather-ops-card cloud-card">
                      <div className="weather-ops-title">CLOUD TREND • NEXT 6 HOURS</div>
                      <div className="weather-cloud-card-body">
                        <div className="weather-cloud-trend-legend"><span>LOW</span><div className="weather-cloud-gradient" /><span>HIGH</span></div>
                        <div className="weather-cloud-trend">
                          {cloudNext6.map((item, index) => {
                            const color = cloudLevelColor(item.cloud);
                            return (
                              <div className="weather-cloud-trend-wrap" key={`${item.time}-${index}`}>
                                <div className="weather-cloud-trend-value">{fmt(item.cloud,0)}%</div>
                                <div className="weather-cloud-trend-bar" style={{ height: `${Math.max(5, item.cloud)}%`, background: `linear-gradient(180deg,${color},${color}88)`, color }} />
                                <div className="weather-cloud-trend-time">{formatUtcHour(item.time)}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="weather-ops-card rain-card">
                      <div className="weather-ops-title">PRECIPITATION • NEXT 6 HOURS</div>
                      <div className="weather-mini-bars">
                        {precipNext6.map((item, index) => (
                          <div className="weather-mini-bar-wrap" key={`${item.time}-${index}`}>
                            <div className="weather-mini-bar" style={{ height: `${Math.max(5, Math.round((item.rain / precipNext6Max) * 100))}%` }} />
                            <div className="weather-mini-bar-time">{formatUtcHour(item.time)}</div>
                          </div>
                        ))}
                      </div>
                      <div className="weather-rain-summary"><strong>{fmt(precipNext6Total,1)} mm</strong><span>MAX PROB {fmt(precipNext6Pop,0)}%</span></div>
                    </div>

                    <div className="weather-ops-card wind-card">
                      <div className="weather-ops-title">WIND DIRECTION & SPEED</div>
                      <div className="weather-wind-body">
                        <div className="weather-compass">
                          <span className="cardinal n">N</span><span className="cardinal s">S</span><span className="cardinal w">W</span><span className="cardinal e">E</span>
                          <div className="weather-compass-arrow" style={{ transform: `rotate(${windFlowDirection}deg)` }} />
                        </div>
                        <div className="weather-wind-copy"><strong>{fmt(current.wind_speed_10m,0)} km/h</strong><span>FROM {windCardinal(windDirection)}<br/>({fmt(windDirection,0)}°) • GUST {fmt(current.wind_gusts_10m,0)} km/h</span></div>
                      </div>
                    </div>

                    <div className="weather-ops-card history-card">
                      <div className="weather-ops-title">RAINFALL TREND • LAST 6 HOURS</div>
                      <div className="weather-history-bars">
                        {rainHistory6.map((item, index) => <div key={`${item.time}-${index}`} className="weather-history-bar" style={{ height: `${Math.max(4, Math.round((item.rain / rainHistoryMax) * 100))}%` }} />)}
                      </div>
                      <div className="weather-history-summary"><span>6H TOTAL</span><strong>{fmt(rainHistoryTotal,1)} mm</strong></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <div className="weather-section-label">NEXT 24 HOURS • 3-HOUR INTERVAL • UTC</div>
            <div className="weather-strip">
              {next24.length ? next24.map((item, index) => (
                <div className="weather-hour" key={`${item.time}-${index}`} style={{ borderTopColor: weatherAccent(item.code) }}>
                  <time>{formatUtcHour(item.time)}</time>
                  <div className="ico">{weatherIcon(item.code)}</div>
                  <strong style={{ color: temperatureColor(item.temp) }}>{fmt(item.temp,0)}°C</strong>
                  <small>CLOUD {fmt(item.cloud,0)}%<br/>RAIN {fmt(item.pop,0)}% • {fmt(item.wind,0)} km/h</small>
                </div>
              )) : <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Rajdhani' }}>Forecast unavailable.</div>}
            </div>
          </div>

          <div>
            <div className="weather-section-label">5-DAY FORECAST • STATION POINT FORECAST</div>
            <div className="weather-days">
              {dailyCards.length ? dailyCards.map((item, index) => (
                <div className="weather-day" key={`${item.time}-${index}`} style={{ borderLeftColor: weatherAccent(item.code) }}>
                  <div className="ico">{weatherIcon(item.code)}</div>
                  <strong>{formatUtcDate(item.time)}</strong>
                  <small>{fmt(item.tMin,0)}° / {fmt(item.tMax,0)}°C • RAIN {fmt(item.pop,0)}% ({fmt(item.rain,1)} mm)<br/>WIND {fmt(item.wind,0)} • GUST {fmt(item.gust,0)} km/h</small>
                </div>
              )) : <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Rajdhani' }}>Daily forecast unavailable.</div>}
            </div>
          </div>
        </div>

        <div className="weather-center-footer">
          <span>MODEL FORECAST: OPEN-METEO BEST MATCH • BASE: OPENSTREETMAP • CLOUD: NASA GIBS/VIIRS NOAA-20 • SATELLITE: NASA GIBS/VIIRS NOAA-20 • RAIN: NASA GIBS/GPM IMERG</span>
          <span>{summaryMode === 'SIM' ? 'CLOUD SUMMARY: SIM-TIME' : 'CLOUD SUMMARY: LIVE WEATHER'}</span>
        </div>
      </div>
    </div>
  );
}


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
  const fileInputRef = useRef(null); 
  const isTrackingRef = useRef(false);
  // 📍 ฟันธง: ประกาศ State ควบคุม Station Mask (มุมเงยรับสัญญาณ)
  const [stationMask, setStationMask] = useState(0);

  // 📍 ฟันธง: ตัวแปรควบคุมการแสดงผลสถานี (มี 4 โหมด: 'both', 'icon', 'name', 'none')
  const [stationDisplayMode, setStationDisplayMode] = useState('both');

  const [size, setSize] = useState(() => ({ width: typeof window !== 'undefined' ? window.innerWidth : 1920, height: typeof window !== 'undefined' ? window.innerHeight : 1080 }));
  
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

  const [isUpdatingTle, setIsUpdatingTle] = useState(false);
  const tleFetchControllerRef = useRef(null);
  const [selectedCatnr, setSelectedCatnr] = useState(SATELLITE_OPTIONS[0].catnr);
  const [selectedCatnrs, setSelectedCatnrs] = useState([SATELLITE_OPTIONS[0].catnr]); 
  
  const [simulatedTimeMs, setSimulatedTimeMs] = useState(Date.now());
  
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
const [cloudCover, setCloudCover] = useState(null);
const [isFetchingCloud, setIsFetchingCloud] = useState(false);
const [cloudDataCache, setCloudDataCache] = useState(null);
const [cloudDataOutOfRange, setCloudDataOutOfRange] = useState(false);
const [cloudDataMode, setCloudDataMode] = useState('SIM');

// 1. Request a 3-day forecast only when the selected station changes.
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
        setCloudDataCache({ hourly: data.hourly, current: data.current || null });
      }
      setIsFetchingCloud(false);
    })
    .catch(err => {
      if (!active) return;
      if (err?.name !== 'AbortError') console.warn('Cloud API Error:', err);
      setIsFetchingCloud(false);
    })
    .finally(() => clearTimeout(timeoutId));

  return () => {
    active = false;
    clearTimeout(timeoutId);
    controller.abort();
  };
}, [activeStation.id]);

// 2. Use forecast data only inside the actual forecast window. Seasonal validation dates must not display fake weather.
useEffect(() => {
  const hourly = cloudDataCache?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.cloud_cover)) return;

  const samples = hourly.time
    .map((tStr, idx) => { const stamp = /(?:Z|[+-]\d{2}:?\d{2})$/.test(tStr) ? tStr : `${tStr}Z`; return { t: new Date(stamp).getTime(), value: hourly.cloud_cover[idx] }; })
    .filter(s => Number.isFinite(s.t) && Number.isFinite(Number(s.value)));

  const liveFallback = Number(cloudDataCache?.current?.cloud_cover);
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
}, [Math.floor(simulatedTimeMs / 3600000), cloudDataCache]);

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

  const [windowZ, setWindowZ] = useState({ radar: 9997, pass: 9998, db: 9999, gs: 9996, img: 10000, analyzer: 10001, angles: 10002, diagram: 10003, antenna3d: 10004, weather: 10005 });
  const [maximizedWins, setMaximizedWins] = useState({ radar: false, pass: false, db: false, img: false, gs: false, analyzer: false, angles: false });

  const toggleMaximize = (winName) => {
    startTransition(() => {
      setMaximizedWins(prev => ({ ...prev, [winName]: !prev[winName] }));
      bringToFront(winName);
    });
  };
 
  const bringToFront = (winName) => {
    startTransition(() => {
      setWindowZ(prev => {
        const maxZ = Math.max(...Object.values(prev).map(Number));
        if (prev[winName] === maxZ) return prev; 
        return { ...prev, [winName]: maxZ + 1 }; 
      });
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

// 📍 ฟันธง: ฟังก์ชันอ่านไฟล์ Mission Plan (รองรับการอัปโหลด PDF และ JSON พร้อมกัน)
const handleMissionPlanUpload = async (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  if (files.length > 10) {
    setCustomAlert({ show: true, message: '⚠️ เลือกไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้ง', type: 'error' });
    return;
  }

  let newImagingPlans = [];
  let pdfFile = null;

  for (const file of files) {
    const lowerName = String(file.name || '').toLowerCase();
    if (lowerName.endsWith('.pdf')) {
      if (file.size > 25 * 1024 * 1024) {
        setCustomAlert({ show: true, message: `⚠️ PDF ${file.name} มีขนาดเกิน 25 MB`, type: 'error' });
        continue;
      }
      pdfFile = file; 
    } else if (lowerName.endsWith('.json') || lowerName.endsWith('.geojson')) {
      if (file.size > 10 * 1024 * 1024) {
        setCustomAlert({ show: true, message: `⚠️ JSON/GeoJSON ${file.name} มีขนาดเกิน 10 MB`, type: 'error' });
        continue;
      }
      const text = await file.text();
      try {
        const geoData = JSON.parse(text);
        if (Array.isArray(geoData.features)) {
          if (geoData.features.length > 5000) throw new Error('GeoJSON contains more than 5000 features');
          newImagingPlans = geoData.features.map((feat, index) => {
            const props = feat?.properties || {};
            const coords = feat?.geometry?.coordinates?.[0];
            if (!Array.isArray(coords) || coords.length < 3 || !Array.isArray(coords[0]) || !Array.isArray(coords[2])) {
              throw new Error(`Invalid geometry in feature ${index}`);
            }
            const startLng = Number(coords[0][0]);
            const startLat = Number(coords[0][1]);
            const endLng = Number(coords[2][0]); 
            const endLat = Number(coords[2][1]);
            if (![startLng, startLat, endLng, endLat].every(Number.isFinite) || Math.abs(startLat) > 90 || Math.abs(endLat) > 90 || Math.abs(startLng) > 180 || Math.abs(endLng) > 180) {
              throw new Error(`Invalid coordinates in feature ${index}`);
            }

            const startTime = new Date(props.acqStart).getTime();
            const endTime = new Date(props.acqEnd).getTime();
            if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
              throw new Error(`Invalid acquisition time in feature ${index}`);
            }

            return {
              id: props.id || `plan-${index}`,
              start: startTime,
              end: endTime,
              duration: (endTime - startTime) / 1000,
              startLat: startLat,
              startLng: startLng,
              endLat: endLat,
              endLng: endLng
            };
          });
          
          newImagingPlans.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        }
      } catch (error) {
        console.error("❌ Error parsing GeoJSON:", error);
        if (typeof setCustomAlert === 'function') {
          setCustomAlert({ show: true, message: "⚠️ ไฟล์ JSON ข้อมูลพิกัดผิดพลาด!", type: 'error' });
        }
      }
    }
  }

  if (newImagingPlans.length > 0) {
    setSourcePlans(newImagingPlans);
    imagingSwathCache.current = {};
  }

  if (pdfFile) {
    // โยนไฟล์ PDF ให้ระบบเดิมของคุณอ่านตารางเวลา (ถ้าฟังก์ชันเดิมชื่ออื่น ให้เปลี่ยนชื่อตามนั้นครับ)
    if (typeof handlePdfUpload === 'function') {
       handlePdfUpload({ target: { files: [pdfFile] } }); 
    }
  }
};


// 📍 ฟังก์ชันจัดการเมื่อกดอัปโหลดไฟล์ PDF
const handlePdfUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    setCustomAlert({ show: true, message: '⚠️ PDF มีขนาดเกิน 25 MB', type: 'error' });
    return;
  }
  
  // 📍 ฟันธง: ดักจับกรณีหน้างานเน็ตสะดุด โหลดไลบรารี PDF ไม่ขึ้น ป้องกันแอปพัง 100%
  if (typeof window.pdfjsLib === 'undefined') {
    setCustomAlert({ show: true, message: "⚠️ SYSTEM ERROR: ไม่พบไลบรารีถอดรหัส PDF โปรดตรวจสอบอินเทอร์เน็ต", type: 'error' });
    return;
  }

  try {
    const text = await extractPdfText(file);
    const parsedData = parsePlanText(text);
    
    // 📍 แปลงข้อมูลดิบจาก PDF ให้อยู่ในฟอร์แมตที่ตาราง React เข้าใจ
    const formattedPlans = parsedData.map(p => {
      const [dateStr, timeStr] = String(p.acq_start || '').split(' ');
      if (!dateStr || !timeStr) return null;
      const [y, m, d] = dateStr.split('/').map(Number);
      const [hr, min, sec] = timeStr.split(':').map(Number);
      const duration = Number(p.acq_duration_s || 0);
      const startMs = Date.UTC(y, m - 1, d, hr, min, sec);
      if (![y, m, d, hr, min, sec, duration, startMs].every(Number.isFinite) || duration < 0) return null;
      const startDate = new Date(startMs);
      return {
        id: p.file_nb,
        start: startDate,
        end: new Date(startMs + duration * 1000),
        duration
      };
    }).filter(Boolean);

    if (formattedPlans.length === 0) throw new Error('No valid imaging records found in PDF');
    setSourcePlans(formattedPlans);
    imagingSwathCache.current = {};
    
    // 📍 เรียก Popup Sci-Fi แทน alert() แบบเก่า
    setCustomAlert({ 
      show: true, 
      message: `สกัดข้อมูลสำเร็จ! พบแผนถ่ายภาพทั้งหมด ${formattedPlans.length} คิว`, 
      type: 'success' 
    });

  } catch (error) {
    setCustomAlert({ 
      show: true, 
      message: "เกิดข้อผิดพลาดในการอ่านไฟล์ PDF โปรดลองอีกครั้ง", 
      type: 'error' 
    });
  }
};

 const [imgPos, setImgPos] = useState({ x: 150, y: 100 });
 const [isDraggingImg, setIsDraggingImg] = useState(false);
 const dragImgRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });
 const [selectedPlanId, setSelectedPlanId] = useState(null);

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

  const toggleLeftPanel = () => {
    setIsLeftPanelOpen(!isLeftPanelOpen);
  };

  const toggleRightPanel = () => {
    setIsRightPanelOpen(!isRightPanelOpen);
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
    window.addEventListener('resize', handleResize);

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
    };
  }, []);

 // 📍 1. สมองกลควบคุมเวลา (ล็อก Tick Rate ที่ 40ms ให้ CPU หายใจ และส่งไม้ต่อให้ WebGL เกลี่ยเฟรม)
 useEffect(() => {
  if (!isPlaying) return;
  let lastTick = Date.now(); 
  const timer = setInterval(() => {
    const now = Date.now();
    const deltaMs = now - lastTick;
    lastTick = now;

    setSimulatedTimeMs(prev => {
      if (isNaN(prev)) return now;
      // ป้องกัน Time Drift ตอนโหมด LIVE
      if (speedMult === 1 && Math.abs(prev - now) < 300000) return now;
      return prev + (deltaMs * speedMult);
    });
  }, 40); // 📍 ฟันธง: ล็อกรอบการอัปเดตที่ 40ms (25fps)
  return () => clearInterval(timer);
}, [isPlaying, speedMult]);

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
const selectedTleEpochMs = selectedCatnr && tles[selectedCatnr] ? getTleEpochMs(tles[selectedCatnr].line1) : null;
const selectedTleAgeDays = selectedTleEpochMs === null ? null : Math.abs(Date.now() - selectedTleEpochMs) / 86400000;
const selectedTleIsStale = selectedTleAgeDays !== null && selectedTleAgeDays > 14;
const linkActive = targetData && targetData.elevationDeg >= stationMask;

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

// Production hardening: LINE alert delivery uses in-flight de-duplication, timeout and retry cooldown.
// The endpoint remains a client-visible integration URL; protect/rate-limit the Apps Script before public deployment.
const LINE_ALERT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec';
const lineAlertInFlightRef = useRef(new Set());
const lineAlertRetryAtRef = useRef(new Map());
const lineAlertControllersRef = useRef(new Set());

const sendLineAlert = async (alertId, payloadData) => {
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
  const isStrictLive = Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
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
}, [simulatedTimeMs, nextPassTimestamp, selectedCatnr, targetConfig, speedMult, isPlaying, passSchedule, activeStation.id]);

// 📍 เซนเซอร์จับจังหวะจบ Pass (แจ้ง LOS ลง LINE)
useEffect(() => {
  const isLiveStrict = Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
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
}, [simulatedTimeMs, passSchedule, selectedCatnr, targetConfig, speedMult, isPlaying, activeStation.id]);

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


// 📍 ฟันธง 2: ระบบวาดเส้นแดงบน 3D ใช้ useRef เป็นโกดัง Cache (ลดภาระ CPU ไม่ต้องคำนวณใหม่ทุก 16ms)
const imagingSwathCache = useRef({});
useEffect(() => {
  imagingSwathCache.current = {};
}, [sourcePlans, tles['58016']?.line1, tles['58016']?.line2]);
const imagingSwathPaths = useMemo(() => {
  if (!targetSatrec || selectedCatnr !== '58016') return []; 
  const paths = [];
  
  sourcePlans.forEach(plan => {
    const pStart = new Date(plan.start).getTime();
    const pEnd = new Date(plan.end).getTime();

    if (simulatedTimeMs > pEnd) return;

    const swathCacheKey = `${plan.id}|${pStart}|${pEnd}`;
    if (!imagingSwathCache.current[swathCacheKey]) {
      const points = [];
      for (let t = pStart; t <= pEnd; t += 1000) {
        const pos = calculateSatData(new Date(t), targetSatrec, activeStation);
        if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
          points.push({ lat: pos.lat, lng: pos.lng, alt: 0.002 });
        }
      }
      imagingSwathCache.current[swathCacheKey] = { id: plan.id, points };
    }
    
    const cachedPlan = imagingSwathCache.current[swathCacheKey];
    if (cachedPlan.points.length >= 2) {
      const isImagingNow = simulatedTimeMs >= pStart && simulatedTimeMs <= pEnd;
      cachedPlan.color = isImagingNow ? 'rgba(255, 51, 51, 1)' : 'rgba(255, 100, 51, 0.45)';
      cachedPlan.stroke = isImagingNow ? 6.0 : 4.0;
      paths.push(cachedPlan);
    }
  });
  return paths;
}, [selectedCatnr, targetSatrec, simulatedTimeMs, sourcePlans]);


// 📍 ฟันธง 3: สมองกลสกัดข้อมูลพิกัด (Lat/Lng) จาก THEOS2_IMAGING_PLAN เพื่อเอาไปวาดบนหน้าต่างแผนที่ 2D
const imagingPlansData = useMemo(() => {
  if (!satrecs['58016']) return [];
  const rec = satrecs['58016'];
  return sourcePlans.map((plan, idx) => {
    const startPos = calculateSatData(new Date(plan.start), rec);
    const endPos = calculateSatData(new Date(plan.end), rec);
    const duration = (new Date(plan.end).getTime() - new Date(plan.start).getTime()) / 1000;
    return {
      id: plan.id,
      ...plan,
      startLat: startPos?.lat, startLng: startPos?.lng,
      endLat: endPos?.lat, endLng: endPos?.lng,
      duration
    };
  });
}, [satrecs, sourcePlans]);
  
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

// 📍 ฟันธง 2: ระบบเสียง Sonar Ping วนลูปตลอดการ Tracking (หยุดเมื่อ LOS หรือกด Mute)
const audioCtxRef = useRef(null);
const pingIntervalRef = useRef(null);

useEffect(() => {
  // ถ้าจับสัญญาณได้ (AOS) และไม่ได้กด Mute
  if (linkActive && !isMuted) {
    if (!audioCtxRef.current) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      audioCtxRef.current = new AudioContextCtor();
    }
   // 📍 ฟันธง: ดักจับ Error จาก Browser Policy ป้องกันแอปพังหากผู้ใช้ยังไม่ได้คลิกหน้าจอ
   if (audioCtxRef.current.state === 'suspended') {
    audioCtxRef.current.resume().catch(err => console.warn("รอผู้บัญชาการคลิกหน้าจอก่อนเริ่มระบบเสียง (Browser Policy)"));
  }

    const playSonarPing = () => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      
      // 📍 ฟันธง: อัปเกรดเครื่องกำเนิดเสียงเป็น Dual-Layer จำลองเสียงเรือดำน้ำ (Submarine Sonar)
      const osc1 = ctx.createOscillator(); // คลื่นหลัก (ความถี่ต่ำ-กลาง) ให้ความรู้สึกทุ้มลึก
      const osc2 = ctx.createOscillator(); // คลื่นรอง (ความถี่สูง) สร้างความกังวาลใสแบบโลหะ
      const gain = ctx.createGain();
      
      // ตั้งค่าคลื่นหลัก: ความถี่ 850Hz (ค่ามาตรฐานของคลื่นโซนาร์)
      osc1.type = 'sine'; 
      osc1.frequency.setValueAtTime(850, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(830, ctx.currentTime + 1.8); // ดรอปเสียงลงนิดๆ ตอนท้าย (Doppler effect)
      
      // ตั้งค่าคลื่นรอง: ใช้คลื่นสามเหลี่ยม (Triangle) ที่ความถี่ 1700Hz เพิ่มความแหลมบาดลึก
      osc2.type = 'triangle'; 
      osc2.frequency.setValueAtTime(1700, ctx.currentTime); 
      osc2.frequency.exponentialRampToValueAtTime(1660, ctx.currentTime + 1.8);

      // สร้างกราฟหางเสียง (Reverb/Echo Envelope)
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.02); // เสียงตีกระทบแรก (Attack) เร็วและคมชัด
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.8); // ปล่อยหางเสียงให้ดังกังวาลยาว 1.8 วินาที
      
      // ประกอบร่างระบบเสียงเข้าด้วยกัน
      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      
      // สั่งยิงคลื่นเสียง!
      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 1.8);
      osc2.stop(ctx.currentTime + 1.8);
    };

    // เล่นทันทีตอนเพิ่ง AOS
    playSonarPing();
    // สั่งให้ดังเป็นจังหวะทุกๆ 2 วินาทีตลอดหน้าจอ
    pingIntervalRef.current = setInterval(playSonarPing, 2000);

  } else {
    // ถ้าดาวเทียมลับขอบฟ้า (LOS) หรือกดปุ่ม Mute ให้สั่งหยุดเสียงทันที
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
  }

  // Cleanup function เมื่อ Component รีเฟรช
  return () => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
  };
}, [linkActive, isMuted]); // ทำงานใหม่ทุกครั้งที่สถานะ Mute หรือ AOS เปลี่ยนแปลง

useEffect(() => {
  return () => {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
  };
}, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setTleSource('Update Failed (File Too Large)');
      setCustomAlert({ show: true, message: '⚠️ ไฟล์ TLE มีขนาดเกิน 5 MB', type: 'error' });
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
          setTleSource(`Manual Upload (${formatBangkokTime(Date.now())} THA)`);
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
        setTleSource(`TLE Update (${formatBangkokTime(Date.now())} THA)`);
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
  const [radarDim, setRadarDim] = useState({ w: 360, h: 460 });

  useEffect(() => {
    if (!radarContainerRef.current) return;
    const observer = new ResizeObserver(entries => {
      if (entries[0]) setRadarDim({ w: entries[0].contentRect.width, h: entries[0].contentRect.height });
    });
    observer.observe(radarContainerRef.current);
    return () => observer.disconnect();
  }, [isRadarOpen]);

  const radarLayout = useMemo(() => {
    // 📍 ฟันธง 1: ยกวงกลมเรดาร์ขึ้น! โดยลดขอบบน (top) และเพิ่มขอบล่าง (bottom) 
    // ทำให้ N(0°) ขยับขึ้นไปเติมพื้นที่ว่าง และ S(180°) ลอยพ้นขอบล่างได้อย่างสวยงาม
    const topMargin = 50;    
    const bottomMargin = 70;  
    const sideMargin = 90;    
    
    const R = Math.max(50, Math.min(radarDim.w - sideMargin * 2, radarDim.h - topMargin - bottomMargin) / 2);
    const cx = radarDim.w / 2;
    const cy = ((radarDim.h - topMargin - bottomMargin) / 2) + topMargin; 
    
    const fontScale = Math.max(1, Math.min(1.3, radarDim.w / 650));
    
    return { R, cx, cy, fontScale };
  }, [radarDim]);

  const radarData = useMemo(() => {
    if (!targetSatrec || !targetData) return { segments: [], maxEl: 0, aosAz: null, losAz: null, sectorEdgePoints: [] };

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

    for (let m = -15; m <= 15; m += 0.5) { 
      const d = new Date(currentDate.getTime() + m * 60000);
      const pos = calculateSatData(d, targetSatrec, activeStation);
      
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
    
    if (!hasFutureVisibility && segments.length === 0) {
      return { segments: [], maxEl: 'N/A', aosAz: null, losAz: null, sectorEdgePoints: [] };
    }
    return { segments, maxEl: maxEl > 0 ? maxEl.toFixed(1) : 'N/A', aosAz, losAz, sectorEdgePoints };
  }, [targetSatrec, targetData, Math.floor(simulatedTimeMs / 60000), radarLayout, stationMask, activeStation.id]); // observer-dependent

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
const [xBandSpan, setXBandSpan] = useState(1000); 
const [sBandSpan, setSBandSpan] = useState(20);
const [showXBand, setShowXBand] = useState(true);
const [showSBand, setShowSBand] = useState(true);

// 📍 ฟันธง: สมองกล SIGNAL ANALYZER (IQ & Dual Spectrum) 
// - แก้ 1: ลดขนาดตัวหนังสือลงอีกนิด
// - แก้ 2: ล็อกขนาดตัวหนังสือให้สมมาตร (ไม่บวมยักษ์เวลากดดูกราฟเดี่ยว)
// - แก้ 3: ปรับฐานกราฟ (baseY) ลงมาให้อยู่เหนือคำว่า CENTER นิดหน่อย เปิดพื้นที่ด้านบนให้กว้างขึ้น
// - ห้ามแก้ส่วนอื่น!
const iqCanvasRef = useRef(null);
const xBandCanvasRef = useRef(null);
const sBandCanvasRef = useRef(null);
const analyzerRuntimeRef = useRef({ simulatedTimeMs, targetData });
analyzerRuntimeRef.current = { simulatedTimeMs, targetData };

useEffect(() => {
  if (!isAnalyzerOpen) return;
  let animationFrameId;

  const SAT_SPECS = {
    '33396': { name: 'THEOS', xBand: { bw: 120, mod: 'QPSK' }, sBand: { bw: 2, mod: 'BPSK/QPSK' } },
    '58016': { name: 'THEOS-2', xBand: { bw: 310, mod: 'O-QPSK' }, sBand: { bw: 1, mod: 'QPSK' } }
  };

  const draw = () => {
    // ----------------------------------------------------
    // 1. วาดหน้าจอ IQ Constellation (อัปเกรด Viasat Style & Lock Phase)
    // ----------------------------------------------------
    const iqCanvas = iqCanvasRef.current;
    if (iqCanvas) {
      const iqParent = iqCanvas.parentElement;
      const iW = iqCanvas.width = iqParent.clientWidth;
      const iH = iqCanvas.height = iqParent.clientHeight;
      const iqCtx = iqCanvas.getContext('2d');
      const spec = SAT_SPECS[selectedCatnr] || { name: 'UNKNOWN', xBand: { bw: 120, mod: 'QPSK' }, sBand: { bw: 2, mod: 'PSK' } };

      iqCtx.fillStyle = '#0b1121'; 
      iqCtx.fillRect(0, 0, iW, iH);
      const centerX = iW / 2; const centerY = iH / 2; const radius = Math.min(iW, iH) * 0.35;

      iqCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; iqCtx.lineWidth = 1;
      iqCtx.beginPath(); iqCtx.moveTo(centerX, 0); iqCtx.lineTo(centerX, iH); iqCtx.stroke();
      iqCtx.beginPath(); iqCtx.moveTo(0, centerY); iqCtx.lineTo(iW, centerY); iqCtx.stroke();
      
      iqCtx.strokeStyle = 'rgba(255, 204, 0, 0.4)'; 
      iqCtx.setLineDash([4, 4]); 
      iqCtx.beginPath(); iqCtx.arc(centerX, centerY, radius, 0, 2*Math.PI); iqCtx.stroke();
      iqCtx.setLineDash([]); 

      const angles = [Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4];
      iqCtx.fillStyle = '#ff3333';
      angles.forEach(a => {
         iqCtx.beginPath(); iqCtx.arc(centerX + radius * Math.cos(a), centerY - radius * Math.sin(a), 4, 0, 2*Math.PI); iqCtx.fill();
      });

      // 📍 ฟันธง: คำนวณคุณภาพการ Lock ของ Demodulator อ้างอิงจากมุม Elevation
      const runtimeTargetData = analyzerRuntimeRef.current.targetData;
      const el = runtimeTargetData ? runtimeTargetData.elevationDeg : -10;
      const isAutoTrack = el >= 5.0;
      const isProgramTrack = el >= 0.0 && el < 5.0;
      
      // Lock Quality: 0.0 = ไม่ล็อคเลย, 1.0 = ล็อคสมบูรณ์
      // ในช่วง Program Track (0-5 องศา) เปอร์เซ็นต์การล็อคจะค่อยๆ เพิ่มขึ้น (อาการพยายาม Lock)
      const lockQuality = isAutoTrack ? 1.0 : (isProgramTrack ? (el / 5.0) : 0.0);

      iqCtx.fillStyle = '#ffffff';

      // 📍 ฟันธง: จำลองเม็ดเวกเตอร์ 256 จุด (Nb Vector 256 แบบเป๊ะๆ ตามหน้าจอ Viasat)
      for(let i=0; i<256; i++) {
         // สุ่มว่าเม็ดนี้จะอยู่ในตำแหน่ง Lock หรือ Unlocked ตามคุณภาพสัญญาณ
         const isPointLocked = Math.random() < lockQuality;

         if (isPointLocked) {
             // 🟢 อาการ Lock (QPSK): เม็ดสี่เหลี่ยมเกาะกลุ่มกันที่ 4 มุม
             const angle = angles[i % 4];
             const tx = centerX + radius * Math.cos(angle);
             const ty = centerY - radius * Math.sin(angle);
             const jitter = spec.xBand.mod === 'O-QPSK' ? 0.12 : 0.08;
             
             const u1 = Math.max(Math.random(), 0.0001); const u2 = Math.random();
             const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
             const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
             
             const nx = z0 * (radius * jitter * 0.4); 
             const ny = z1 * (radius * jitter * 0.4);
             
             iqCtx.globalAlpha = Math.random() * 0.4 + 0.6; // ให้ความสว่างวูบวาบนิดๆ
             // 📍 ฟันธง: วาดเป็นจุด "สี่เหลี่ยมทึบ" ขนาด 3x3 พิกเซล เหมือนเครื่อง Viasat
             iqCtx.fillRect(tx + nx - 1.5, ty + ny - 1.5, 3, 3);
         } else {
             // 🔴 อาการ Unlocked: เม็ดสี่เหลี่ยมกระจายแบบ Uniform ในกรอบสี่เหลี่ยมจัตุรัส
             const spread = radius * 1.35; // ความกว้างของการกระจาย (อยู่ในกรอบกราฟ)
             const px = centerX + (Math.random() - 0.5) * 2 * spread;
             const py = centerY + (Math.random() - 0.5) * 2 * spread;
             
             iqCtx.globalAlpha = 1.0; // เม็ดกระจายจะสว่างชัดเจน ไม่โปร่งแสง
             iqCtx.fillRect(px - 1.5, py - 1.5, 3, 3);
         }
      }
      iqCtx.globalAlpha = 1.0;
    }
// ----------------------------------------------------
    // 2. ฟังก์ชันวาดกราฟ Spectrum (อัปเกรด Dynamic Amplitude & Tracking LED)
    // ----------------------------------------------------
    const drawSpectrum = (canvas, w, h, isXBand) => {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0b1121'; 
      ctx.fillRect(0, 0, w, h);
      
      const spec = SAT_SPECS[selectedCatnr] || { name: 'UNKNOWN', xBand: { bw: 120, mod: 'QPSK' }, sBand: { bw: 2, mod: 'PSK' } };
      
      // 📍 ฟันธง: ล้าง textScale ทิ้ง บังคับให้ฟอนต์มีขนาดคงที่ (Fixed Size) ป้องกันตัวหนังสือบวม!
      const graphW = w - 15; 
      
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]); 
      ctx.beginPath();
      for(let i=1; i<=10; i++) { ctx.moveTo(i*(graphW/10), 0); ctx.lineTo(i*(graphW/10), h); }
      for(let i=1; i<10; i++) { ctx.moveTo(0, i*(h/10)); ctx.lineTo(graphW, i*(h/10)); }
      ctx.stroke();
      ctx.setLineDash([]); 

      const bw = isXBand ? spec.xBand.bw : spec.sBand.bw;
      const span = isXBand ? xBandSpan : sBandSpan; 
      const cf_base = isXBand ? 720.0 : 70.0; 

      let signalStrength = 0;
      let trackMode = 'STANDBY';
      let trackColor = 'var(--red)';

      const runtimeTargetData = analyzerRuntimeRef.current.targetData;
      if (linkActive && runtimeTargetData) {
          const el = runtimeTargetData.elevationDeg;
          let baseStrength = runtimeTargetData.altKm / runtimeTargetData.rangeKm; 
          
          if (el >= 5) {
              trackMode = 'AUTOTRACK';
              trackColor = '#00ff66'; 
              signalStrength = Math.min(1.0, Math.pow(baseStrength, 0.5) * 1.2); 
          } else if (el >= 0) {
              trackMode = 'PROGRAM TRACK';
              trackColor = '#ffcc00'; 
              signalStrength = (baseStrength * 0.8) * (Math.random() * 0.5 + 0.5); 
          }
      }

      const peakX = graphW / 2; 
      
      const visualCompression = 0.65; 
      const halfBwPixels = (bw / span) * (graphW / 2) * visualCompression;

      const dbPerDiv = 5; 
      const totalDb = 10 * dbPerDiv; 
      const refLevel = isXBand ? -35 : -20; 

      // 📍 ฟันธง: ล็อกฐานกราฟและเพดานกราฟด้วย px คงที่
      const baseY = h - 30; 
      const peakH = baseY - 25; 

      ctx.strokeStyle = isXBand ? '#ffcc00' : '#00eaff'; 
      ctx.lineWidth = 1;
      ctx.beginPath();

      for(let x=0; x<=graphW; x++) {
        const dist = Math.abs(x - peakX); 
        const x_norm = dist / halfBwPixels;
        let amp = 0;
        
        if (linkActive) {
            if (x_norm <= 1.0) {
                amp = Math.pow(Math.cos((x_norm * Math.PI) / 2), 0.6) * signalStrength;
            } else if (x_norm < 1.8) {
                amp = Math.abs(Math.sin((x_norm - 1.0) * Math.PI)) * 0.3 / x_norm * signalStrength;
            } else if (x_norm < 2.6) {
                amp = Math.abs(Math.sin((x_norm - 1.8) * Math.PI)) * 0.15 / x_norm * signalStrength;
            }
        }
        
        const noise = (Math.random() * 0.06) + 0.02; 
        const totalPwr = linkActive ? Math.max(noise, amp) : noise; 
        
        const y = baseY - (totalPwr * peakH) + (Math.random() - 0.5) * (h * 0.015); 
        
        if (x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ----------------------------------------------------
      // วาด Overlay Text
      // ----------------------------------------------------
      // 📍 ฟันธง: ล็อกขนาดฟอนต์ให้เล็กและคมชัดเป๊ะๆ (11px สำหรับข้อความทั่วไป, 13px สำหรับ Marker)
      ctx.fillStyle = '#e2e8f0'; ctx.font = `bold 11px Rajdhani, monospace`; 
      ctx.textAlign = 'left';
      
      const textX = 15;
      ctx.fillText(`${formatTime(new Date(analyzerRuntimeRef.current.simulatedTimeMs))} UTC, SIM`, textX, 20);
      ctx.fillText(`REF ${refLevel.toFixed(1)} dBm   AT 10 dB`, textX, 35);
      ctx.fillText(`LOG 5 dB/`, textX, 50); 
      
      if (linkActive && targetData) {
          ctx.beginPath();
          ctx.arc(textX + 4, 65 - 3, 4, 0, Math.PI * 2);
          ctx.fillStyle = trackColor;
          ctx.fill();
          ctx.shadowBlur = 8;
          ctx.shadowColor = trackColor;
          ctx.font = `bold 12px Rajdhani, monospace`; // ให้ LED Tracking เด่นขึ้นมานิดนึง
          ctx.fillText(` ${trackMode}`, textX + 10, 65);
          ctx.shadowBlur = 0; 
      }
      
      ctx.font = `bold 11px Rajdhani, monospace`; // คืนค่าฟอนต์
      
      if (linkActive) {
          const mkX = peakX; 
          const mkY = baseY - (1.0 * peakH); 
          ctx.beginPath(); 
          ctx.moveTo(mkX, mkY - 6); 
          ctx.lineTo(mkX + 5, mkY - 11); 
          ctx.lineTo(mkX - 5, mkY - 11); 
          ctx.closePath(); 
          ctx.fillStyle = isXBand ? '#ffcc00' : '#00eaff'; ctx.fill();
          
          ctx.textAlign = 'right';
          ctx.font = `bold 13px Rajdhani, monospace`; // ขยายฟอนต์ Marker ให้เด่น
          ctx.fillText(`MKR ${cf_base.toFixed(1)} MHz`, graphW - 15, 20);
          ctx.fillStyle = '#ffffff'; 
          ctx.fillText(`${(refLevel - 5).toFixed(2)} dBm`, graphW - 15, 35);
      }

      ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left'; ctx.font = `bold 11px Rajdhani, monospace`;
      ctx.fillText(`CENTER ${cf_base.toFixed(1)} MHz`, textX, h - 15);
      ctx.fillText(`#RES BW 3.0 MHz`, textX, h - 4);
      
      ctx.textAlign = 'right';
      ctx.fillText(`SPAN ${span >= 1000 ? (span/1000).toFixed(3) + ' GHz' : span.toFixed(1) + ' MHz'}`, graphW - 15, h - 15);
      ctx.fillText(`SWP 50.0 msec`, graphW - 15, h - 4);
      ctx.textAlign = 'center';
      ctx.fillText(`#VBW 10 kHz`, graphW/2, h - 4);
    };

    const xCanvas = xBandCanvasRef.current;
    if (xCanvas && showXBand) {
      const xParent = xCanvas.parentElement;
      const xW = xCanvas.width = xParent.clientWidth;
      const xH = xCanvas.height = xParent.clientHeight;
      drawSpectrum(xCanvas, xW, xH, true);
    }

    const sCanvas = sBandCanvasRef.current;
    if (sCanvas && showSBand) {
      const sParent = sCanvas.parentElement;
      const sW = sCanvas.width = sParent.clientWidth;
      const sH = sCanvas.height = sParent.clientHeight;
      drawSpectrum(sCanvas, sW, sH, false);
    }

    animationFrameId = requestAnimationFrame(draw);
  };

  draw();
  return () => cancelAnimationFrame(animationFrameId);
}, [isAnalyzerOpen, linkActive, selectedCatnr, xBandSpan, sBandSpan, showXBand, showSBand]);

// 📍 WOW Feature 1: DIAGRAM STATE
const [isDiagramOpen, setIsDiagramOpen] = useState(false);
const [diagramPos, setDiagramPos] = useState({ x: 200, y: 150 });
const [isDraggingDiagram, setIsDraggingDiagram] = useState(false);
const dragDiagramRef = useRef({ startX: 0, startY: 0, initX: 0, initY: 0 });

// 📍 WOW Feature 2 & 3: AUTO-PILOT & DOWNLINK MATRIX STATE
const [isAutoPilot, setIsAutoPilot] = useState(false);
const matrixRef = useRef(null);
const autoPilotTimer = useRef(null);

// Logic ระบบลากหน้าต่าง Diagram
const handleDiagramMouseDown = (e) => { setIsDraggingDiagram(true); bringToFront('diagram'); dragDiagramRef.current = { startX: e.clientX, startY: e.clientY, initX: diagramPos.x, initY: diagramPos.y }; };
useEffect(() => {
  const handleMouseMove = (e) => { if (isDraggingDiagram) setDiagramPos({ x: dragDiagramRef.current.initX + (e.clientX - dragDiagramRef.current.startX), y: dragDiagramRef.current.initY + (e.clientY - dragDiagramRef.current.startY) }); };
  const handleMouseUp = () => setIsDraggingDiagram(false);
  if (isDraggingDiagram) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
  return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
}, [isDraggingDiagram]);

// Logic Auto-Pilot 🤖
const autoPilotRuntimeRef = useRef({ simulatedTimeMs, nextPassTimestamp });
autoPilotRuntimeRef.current = { simulatedTimeMs, nextPassTimestamp };

useEffect(() => {
  if (autoPilotTimer.current) {
    clearInterval(autoPilotTimer.current);
    autoPilotTimer.current = null;
  }

  if (isAutoPilot) {
    if (globeRef.current) globeRef.current.controls().autoRotate = true;
    let windowCycle = 0;
    autoPilotTimer.current = setInterval(() => {
      windowCycle++;
      if (windowCycle % 3 === 0) { setIsRadarOpen(true); setIsAnalyzerOpen(false); setIsDiagramOpen(false); }
      else if (windowCycle % 3 === 1) { setIsRadarOpen(false); setIsAnalyzerOpen(true); setIsDiagramOpen(false); }
      else { setIsRadarOpen(false); setIsAnalyzerOpen(false); setIsDiagramOpen(true); }

      const runtime = autoPilotRuntimeRef.current;
      const nextPass = runtime.nextPassTimestamp;
      if (nextPass && nextPass.time) {
        const timeToAos = nextPass.time - runtime.simulatedTimeMs;
        if (timeToAos > 120000) {
          setSimulatedTimeMs(nextPass.time - 30000);
          setCustomAlert({ show: true, message: 'AUTO-PILOT: TIME TRAVEL INITIATED 🚀', type: 'success' });
        }
      }
    }, 8000);
  } else if (globeRef.current) {
    globeRef.current.controls().autoRotate = false;
  }

  return () => {
    if (autoPilotTimer.current) {
      clearInterval(autoPilotTimer.current);
      autoPilotTimer.current = null;
    }
  };
}, [isAutoPilot]);

// 📍 ฟันธง: สมองกล "MISSION AUTO-SEQUENCER" (ระบบวนลูปตารางรับสัญญาณอัตโนมัติ)
const autoSnapRef = useRef({});
const missionJumpTimerRef = useRef(null);
const missionSequencerStateRef = useRef({ validationMode, isPlaying, speedMult, selectedCatnr, stationId: activeStation.id });
missionSequencerStateRef.current = { validationMode, isPlaying, speedMult, selectedCatnr, stationId: activeStation.id };

useEffect(() => {
  return () => {
    if (missionJumpTimerRef.current) clearTimeout(missionJumpTimerRef.current);
  };
}, []);

useEffect(() => {
  if (!passSchedule || passSchedule.length === 0) return;

  const now = Date.now();
  const activeRealPass = passSchedule.find(p => now >= p.aosTime && now <= p.losTime);

  // 🚀 1. Real-Time AOS Interceptor (ระบบความปลอดภัย กรณีมีดาวเทียมเข้าจริงในปัจจุบัน)
  if (activeRealPass && !validationMode) {
    const passId = `SNAP-REAL-${activeRealPass.aosTime}`;
    if (!autoSnapRef.current[passId]) {
      autoSnapRef.current[passId] = true;
      setSimulatedTimeMs(now);
      setSpeedMult(1);
      setIsPlaying(true);
    }
  } 
  
  // 🚀 2. SIMULATION SEQUENCER (ระบบโดดข้าม Pass อัตโนมัติเมื่ออยู่ในโหมด SIM ที่ความเร็ว 1X)
  const isSimulating = Math.abs(simulatedTimeMs - now) > 60000 && speedMult === 1 && isPlaying;
  
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
            message: `🛰️ MISSION SEQUENCER: จบการรับสัญญาณ... ระบบกำลังคำนวณวงโคจรและวาร์ปไปยัง PASS ถัดไปอัตโนมัติ!`, 
            type: 'success' 
          });
          
         // 📍 รออีก 4 วินาทีให้ผู้ชมอ่านข้อความจบ แล้วกระโดดเวลา (Time Jump) ไปรอที่ AOS - 10 วินาทีของ Pass ถัดไปทันที! (จังหวะเคาต์ดาวน์เป๊ะๆ)
         if (missionJumpTimerRef.current) clearTimeout(missionJumpTimerRef.current);
         const scheduledCatnr = selectedCatnr;
         const scheduledStationId = activeStation.id;
         missionJumpTimerRef.current = setTimeout(() => {
          const runtime = missionSequencerStateRef.current;
          missionJumpTimerRef.current = null;
          if (runtime.validationMode || !runtime.isPlaying || runtime.speedMult !== 1 || runtime.selectedCatnr !== scheduledCatnr || runtime.stationId !== scheduledStationId) {
            delete autoSnapRef.current[jumpId];
            return;
          }
          setSimulatedTimeMs(nextPass.aosTime - 10000);
        }, 4000);
      }
    }
    }
  }
}, [simulatedTimeMs, passSchedule, speedMult, isPlaying, validationMode, selectedCatnr, activeStation.id]);

// 📍 ฟันธง: สมองกล Auto-Scale ปรับขนาด UI ให้พอดีกับทุกหน้าจออัตโนมัติ
const uiScale = Math.min(1, size.width / 1920, size.height / 1080);
// 📍 ฟันธง 2: สมองกลป้องกันหน้าต่างทะลุขอบจอ (Anti-OutOfBounds System)
// หากผู้ใช้ลากหัวหน้าต่างหลุดขึ้นไปขอบบน (y < 0) ระบบจะดีดกลับมาที่ขอบบนสุดอัตโนมัติ!
useEffect(() => {
  // 📍 ฟันธง: ใช้เงื่อนไข < 0 แบบเป๊ะๆ และแยกคำสั่งออกจากกัน ป้องกัน React สร้าง Loop นรก (Micro-Loop)
  if (radarPos?.y < 0) setRadarPos(p => ({ ...p, y: 0 }));
  if (gsPos?.y < 0) setGsPos(p => ({ ...p, y: 0 }));
  if (anglesPos?.y < 0) setAnglesPos(p => ({ ...p, y: 0 }));
  if (dbPos?.y < 0) setDbPos(p => ({ ...p, y: 0 }));
  if (passPos?.y < 0) setPassPos(p => ({ ...p, y: 0 }));
  if (diagramPos?.y < 0) setDiagramPos(p => ({ ...p, y: 0 }));
  if (analyzerPos?.y < 0) setAnalyzerPos(p => ({ ...p, y: 0 }));
  if (imgPos?.y < 0) setImgPos(p => ({ ...p, y: 0 })); // <-- 📍 ฟันธง: เติมหน้าต่าง imgPos ที่หายไปด้วย!
}, [radarPos.y, gsPos.y, anglesPos.y, dbPos.y, passPos.y, diagramPos.y, analyzerPos.y, imgPos.y]);
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

  {/* 📍 ฟันธง: ชุดโค้ด Globe ฉบับสมบูรณ์ แก้ปัญหาจอขาว + ป้าย 3D สมมาตร 100% */}
  {(() => {
      // 📍 ฟันธง: ลบดาวเทียมออกจาก HTML ทิ้งไปเลย เพราะเราย้ายป้ายชื่อเข้าโลก 3D แล้ว!
      const memoizedHtmlElements = [
        { type: 'station', lat: activeStation.lat, lng: activeStation.lng, name: activeStation.name, altitude: 0 }
      ];
      const memoizedRings = [{ lat: activeStation.lat, lng: activeStation.lng }];

      return (
        <Globe
            ref={globeRef} width={size.width} height={size.height}
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
                  {!showGroundTrack && orbitVisualPath.map((pathObj, i) => {
                    if (pathObj.stroke < 1.0) return null; 

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
                        key={`main-guide-${i}-${j}`} 
                        points={seg.join(' ')} 
                        fill="none" 
                        stroke="rgba(0, 234, 255, 0.7)" // 🔵 สีฟ้า Cyan
                        strokeWidth="0.2"               
                        strokeDasharray="0.5 1.5" 
                      />
                    ));
                  })}

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
                  {allSatObjects.filter(sat => selectedCatnrs.includes(sat.catnr)).map(sat => {
                    const isPrimary = sat.catnr === selectedCatnr;
                    const radiusDeg = getFootprintRadiusDeg(sat.altKm, stationMask);
                    if (isNaN(radiusDeg)) return null;
                    
                    const latRad = (sat.lat * Math.PI) / 180;
                    const cosLat = Math.max(Math.abs(Math.cos(latRad)), 0.05); 
                    const rxDeg = Math.min(radiusDeg / cosLat, 180); 
                    
                    const cx = (sat.lng + 180) / 360 * 100;
                    const cy = (90 - sat.lat) / 180 * 100;
                    const rx = rxDeg / 360 * 100;
                    const ry = radiusDeg / 180 * 100;
                    
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

      <div className="ui-layer">

     {/* 📍 ฟันธง: ล็อกจุดหมุนการหดตัวมุมซ้ายบน พร้อมชดเชยความสูงที่หดไป (Height Compensation) แก้ปัญหาหลุมดำด้านล่าง */}
     <div className="left-container" style={{ transform: `scale(${uiScale})`, transformOrigin: 'top left', maxHeight: `calc(100% / ${uiScale})`, height: `calc(100% / ${uiScale})` }}>

    {/* 📍 แถวควบคุมหลักด้านบนซ้าย: THA LOCAL + DOY */}
    <div style={{ display: 'flex', width: '100%', gap: '15px', alignItems: 'flex-start', pointerEvents: 'none', marginBottom: '15px', zIndex: 100, flexShrink: 0 }}>
           <button 
             className="menu-toggle-btn-left"
             onClick={toggleLeftPanel}
             style={{ pointerEvents: 'auto', marginBottom: 0 }}
           >
             {isLeftPanelOpen ? '✕' : '☰'}
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
          <div className="left-panel" style={{ width: '817px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', paddingBottom: '8px', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>

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
             <div className={`status-banner ${linkActive ? 'active' : 'standby'}`} style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '12px 10px', textAlign: 'center', borderRadius: '8px', marginBottom: '12px', border: linkActive ? '1px solid var(--green)' : '1px solid #ff4400', backgroundColor: 'rgba(0,0,0,0.2)' }}>
              {linkActive ? (
              <>
                <span style={{ fontSize: 'clamp(11px, 1.1vw, 14px)', fontWeight: '900', color: 'rgba(255,255,255,0.9)', letterSpacing: '1.5px' }}>SIGNAL ACQUIRED</span>
                <span style={{ display: 'flex', justifyContent: 'center', fontSize: 'clamp(22px, 2.5vw, 32px)', fontFamily: 'Orbitron', fontWeight: '900', color: 'var(--green)', textShadow: 'none', margin: '4px 0', lineHeight: 1 }}>
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
                <li>
                  <span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Source:</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', flex: '1 1 auto', minWidth: 0 }}>
                    <strong style={{ 
                      /* TV 65-inch: keep the TLE source on one line and reserve fixed space for SYNC TLE */
                      color: tleSource.includes('Failed') ? 'var(--red)' : (tleSource.includes('Fallback') || tleSource.includes('DEGRADED') || selectedTleIsStale ? 'var(--gold)' : 'var(--green)'), 
                      fontWeight: '900', textAlign: 'right', textShadow: 'none', flex: '1 1 auto', minWidth: 0,
                      fontSize: 'clamp(9px, 0.72vw, 11px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1
                    }}>
                      {tleSource}{selectedTleIsStale ? ` • STALE ${Math.floor(selectedTleAgeDays)}d` : ''}
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
            </div>
            
        {/* 📍 ANTENNA TELEMETRY - ย้ายมาไว้ฝั่งซ้ายเหนือ LOCAL WEATHER ตาม Mission/Tracking Status */}
        {/* 📍 คง Logic, สี, ขนาด, AZ/EL, TRACKING/STANDBY และ 3D SIMULATOR เดิมทั้งหมด */}
              <div className="panel-box" style={{ padding: '8px 12px', background: 'linear-gradient(145deg, rgba(0, 25, 15, 0.85), rgba(0, 10, 5, 0.95))', border: '1px solid var(--green)', marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', borderBottom: '1px dashed rgba(0,255,102,0.3)', paddingBottom: '4px', gap: '4px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'var(--green)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap' }}>ANTENNA TELEMETRY</span>
                <span className={`status-badge ${linkActive ? 'live' : 'sim'}`} style={{ fontSize: 'clamp(9px, 0.9vw, 11px)', color: linkActive ? 'var(--green)' : 'var(--gold)', fontFamily: 'Orbitron', fontWeight: '900', padding: '2px 6px', background: linkActive ? 'rgba(0,255,102,0.1)' : 'rgba(255,204,0,0.1)', borderRadius: '4px', border: `1px solid ${linkActive ? 'var(--green)' : 'var(--gold)'}`, margin: 0 }}>
                  {linkActive ? 'TRACKING' : 'STANDBY'}
                </span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                
               {/* ค่าองศาจานรับสัญญาณ (จำลองการทำงานจานจริง: นิ่งตอน Standby, หมุนตอน Tracking) */}
               <div style={{ flex: '1', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(10px, 1vw, 11px)', color: 'rgba(255,255,255,0.6)', fontFamily: 'Orbitron', letterSpacing: '1px' }}>AZIMUTH</span>
                    <strong style={{ fontSize: 'clamp(14px, 1.4vw, 18px)', color: linkActive ? 'var(--cyan)' : 'rgba(255,255,255,0.3)', fontFamily: 'Orbitron', textShadow: 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {/* 📍 ฟันธง: ถ้า linkActive (TRACKING) ให้โชว์เลขวิ่ง ถ้า STANDBY ให้โชว์มุมจอด 000.00° */}
                      {linkActive && targetData && !isNaN(targetData.azimuthDeg) ? targetData.azimuthDeg.toFixed(2).padStart(6, '0') : '000.00'}°
                    </strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(10px, 1vw, 11px)', color: 'rgba(255,255,255,0.6)', fontFamily: 'Orbitron', letterSpacing: '1px' }}>ELEVATION</span>
                    <strong style={{ fontSize: 'clamp(14px, 1.4vw, 18px)', color: linkActive ? 'var(--green)' : 'rgba(255,255,255,0.3)', fontFamily: 'Orbitron', textShadow: 'none', fontVariantNumeric: 'tabular-nums' }}>
                      {/* 📍 ฟันธง: เหมือนกันกับด้านบน */}
                      {linkActive && targetData && !isNaN(targetData.elevationDeg) ? Math.max(0, targetData.elevationDeg).toFixed(2).padStart(5, '0') : '00.00'}°
                    </strong>
                  </div>
                </div>
                
               {/* 📡 INTERNAL VECTOR ANTENNA 3D SIMULATOR */}
<button
  onClick={() => { setIsAntenna3DOpen(true); bringToFront('antenna3d'); }}
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
        <div className="panel-box" role="button" tabIndex={0} title="Open Weather Center" onClick={() => { setIsWeatherOpen(true); bringToFront('weather'); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setIsWeatherOpen(true); bringToFront('weather'); } }} style={{ padding: '12px 15px', background: 'linear-gradient(145deg, rgba(0, 20, 35, 0.85), rgba(0, 5, 15, 0.95))', border: '1px solid var(--cyan)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px dashed rgba(0,234,255,0.3)', paddingBottom: '6px', gap: '4px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'var(--cyan)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>LOCAL WEATHER (METEO)</span>
                <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'var(--gold)', fontFamily: 'Orbitron', fontWeight: '900', whiteSpace: 'nowrap', flexShrink: 0, padding: '2px 6px', background: 'rgba(255,204,0,0.1)', borderRadius: '4px', border: '1px solid rgba(255,204,0,0.4)', boxShadow: '0 0 8px rgba(255,204,0,0.2)' }}>{activeStation.id} STATION ›</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                
                {/* 📍 ปรับขนาดกล่องไอคอนให้สมดุล */}
                <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', width: 'clamp(45px, 4.5vw, 60px)', height: 'clamp(45px, 4.5vw, 60px)', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)' }}>
                  {cloudCover === null ? (
                    <span style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', filter: 'grayscale(100%)', opacity: 0.5 }}>☁️</span>
                  ) : cloudCover <= 30 ? (
                    <img src="https://api.iconify.design/solar:sun-bold-duotone.svg?color=%2300ff66" alt="Clear" style={{ width: 'clamp(30px, 3vw, 40px)', height: 'clamp(30px, 3vw, 40px)', filter: 'drop-shadow(0 0 8px rgba(0,255,102,0.8))' }} />
                  ) : cloudCover <= 70 ? (
                    <img src="https://api.iconify.design/solar:cloud-sun-bold-duotone.svg?color=%23ffcc00" alt="Partly Cloudy" style={{ width: 'clamp(30px, 3vw, 40px)', height: 'clamp(30px, 3vw, 40px)', filter: 'drop-shadow(0 0 8px rgba(255,204,0,0.8))' }} />
                  ) : (
                    <img src="https://api.iconify.design/solar:clouds-bold-duotone.svg?color=%23ffffff" alt="Overcast" style={{ width: 'clamp(30px, 3vw, 40px)', height: 'clamp(30px, 3vw, 40px)', filter: 'none' }} />
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

          </div>
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
              {isRightPanelOpen ? '✕' : '☰'}
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
           <div className="right-panel">
              
     {/* กลุ่มที่ 1: การควบคุมเวลาและความเร็ว */}
     <div className="control-group">
        {/* 📍 ฟันธง: ลบ <p>TIME & PLAYBACK</p> ทิ้งไปเลย พื้นที่จะโปร่งขึ้นทันที */}
        
        {(() => {
          // 📍 ฟันธง: สมองกลล็อกการจำลองเวลา (SIM Lock)
                // จะล็อกก็ต่อเมื่อ "เวลาคือ LIVE + มีสัญญาณดาวเทียมเข้าจริงๆ" (ห้ามกด SIM ข้ามเวลา!)
                const isRealtimePassLock = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive;

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
                  setIsPlaying(true);
                };

                return (
                  <>
                  {/* 📍 ฟันธง: ปุ่ม AUTO-EARTH เปลี่ยนเป็นสี Sci-Fi (อิงตามตัวแปร --cyan) และเปลี่ยนสีตาม Theme อัตโนมัติ */}
                  <button 
                     onClick={() => {
                      const nextState = !isAutoPilot;
                      setIsAutoPilot(nextState);
                      if (nextState) {
                        setCameraMode('FREE LOOK');
                        isTrackingRef.current = false;
                      }
                      if (!nextState && globeRef.current) {
                        globeRef.current.controls().autoRotate = false;
                        globeRef.current.pointOfView({ lat: activeStation.lat, lng: activeStation.lng, altitude: 2.2 }, 1000);
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
                        <button key={s} disabled={isRealtimePassLock} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0, opacity: isRealtimePassLock ? 0.3 : 1, cursor: isRealtimePassLock ? 'not-allowed' : 'pointer'}} onClick={() => { setSpeedMult(s); setIsPlaying(true); }}>{s}X</button>
                      ))}
                    </div>

                   {/* 📍 ฟันธง: ยุบรวม LIVE, RESET และ MODE เป็น Grid 3 คอลัมน์ ลดความอ้วนของปุ่มและประหยัดพื้นที่แนวตั้ง! */}
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: 'clamp(10px, 1.5vh, 15px)', height: 'clamp(35px, 4.5vh, 45px)' }}>
                      {(() => {
                        const isLive = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying;
                        return (
                          <div className={`status-badge ${isLive ? 'live' : 'sim'}`} style={{ margin: 0, padding: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '4px', fontSize: 'clamp(11px, 1.1vw, 14px)', letterSpacing: '1px', background: isRealtimePassLock ? 'rgba(0, 255, 102, 0.2)' : '', borderColor: isRealtimePassLock ? 'var(--green)' : '', color: isRealtimePassLock ? 'var(--green)' : '', boxShadow: isRealtimePassLock ? 'inset 0 0 10px rgba(0, 255, 102, 0.3)' : '' }}>
                            {isRealtimePassLock ? '🟢 REAL-TIME' : (isLive ? '🟢 LIVE' : '🟠 SIM')}
                          </div>
                        );
                      })()}
                      
                      <button className="btn" style={{ margin: 0, padding: '0', fontSize: 'clamp(11px, 1.1vw, 14px)', letterSpacing: '1.5px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => {
                        setValidationMode(null); setSimulatedTimeMs(Date.now()); setSpeedMult(1); setIsPlaying(true); isTrackingRef.current = false; setCameraMode('FREE LOOK');
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
                          <div style={{ position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '10px', left: 0, height: '8px', width: `${Math.max(0, Math.min(100, progressPct))}%`, background: isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'), borderRadius: '4px', pointerEvents: 'none', boxShadow: `0 0 10px ${isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)')}` }}></div>
                            <input type="range" min={minTime} max={maxTime} value={simulatedTimeMs} disabled={isRealtimePassLock} className="sci-fi-slider"
                              style={{ '--thumb-color': isRealtimePassLock ? 'var(--green)' : (sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'), '--thumb-glow': isRealtimePassLock ? 'rgba(0, 255, 102, 0.8)' : (sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.8)' : 'rgba(255, 204, 0, 0.8)'), opacity: isRealtimePassLock ? 0.5 : 1, cursor: isRealtimePassLock ? 'not-allowed' : 'grab' }}
                              onMouseDown={() => { if(!isRealtimePassLock) setIsPlaying(false); }} onChange={(e) => { if(!isRealtimePassLock) setSimulatedTimeMs(Number(e.target.value)); }} />
                          </div>
                        );
                      })()}
                      
                     {/* 📍 ฟันธง: แก้ไข Current SIM - ขยายความกว้างตัวเลขให้ห่างขึ้นเป็น 0.9em, ล็อกความกว้างแก้กระตุก และปิด text-shadow 100% */}
                     <div style={{ textAlign: 'center', fontSize: 'clamp(12px, 1.2vw, 16px)', color: 'rgba(255,255,255,0.7)', marginTop: '12px', fontVariantNumeric: 'tabular-nums', fontWeight: 'bold', letterSpacing: '1px' }}>
                        CURRENT SIM: 
                        <strong style={{ display: 'inline-flex', color: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', fontSize: 'clamp(16px, 1.8vw, 24px)', textShadow: 'none', marginLeft: '12px', fontFamily: 'Orbitron', alignItems: 'center', justifyContent: 'center' }}>
                          {formatTime(new Date(simulatedTimeMs)).split('').map((char, i) => (
                            <span key={i} style={{ display: 'inline-block', width: char === ':' ? '0.4em' : '0.9em', textAlign: 'center' }}>{char}</span>
                          ))}
                          <span style={{ marginLeft: '8px' }}>UTC</span>
                        </strong>
                      </div>

                      {/* 2D DAY/NIGHT SEASON VALIDATION - test dates only; no orbit logic is modified */}
                      <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed rgba(0,234,255,0.35)' }}>
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
           <div className="control-group">
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
            <div className="control-group" style={{ paddingBottom: '15px' }}>

              {/* 📍 ฟันธง: จับ 6 ปุ่มมัดรวมใน Grid เดียวกันทั้งหมด (3 แถว x 2 คอลัมน์) เพื่อความสมมาตร 100% */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '12px' }}>
                
                {/* 1. SATELLITE DATABASE */}
                <button 
                  className={`btn btn-cyan ${isModalOpen ? 'active' : ''}`} 
                  onClick={() => { setIsModalOpen(!isModalOpen); if (!isModalOpen) bringToFront('db'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >
                 SATELLITE DATABASE
                </button>

                {/* 2. SIGNAL ANALYZER (IQ) */}
                <button 
                  className={`btn ${linkActive ? 'btn-green' : 'btn-red'} ${isAnalyzerOpen ? 'active' : ''}`}
                  onClick={() => { setIsAnalyzerOpen(!isAnalyzerOpen); if (!isAnalyzerOpen) bringToFront('analyzer'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', boxShadow: linkActive ? '0 0 20px rgba(0,255,102,0.4)' : '0 0 20px rgba(255,51,51,0.2)', transition: 'all 0.3s' }}
                >
                  SIGNAL ANALYZER
                </button>
                
                {/* 3. GROUND STATION */}
                <button 
                  className={`btn btn-cyan ${isGsModalOpen ? 'active' : ''}`}
                  onClick={() => { setIsGsModalOpen(!isGsModalOpen); if (!isGsModalOpen) bringToFront('gs'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >GROUND STATION</button>

                {/* 4. RADAR SKYPLOT */}
                <button 
                  className={`btn btn-green ${isRadarOpen ? 'active' : ''}`} 
                  onClick={() => { setIsRadarOpen(!isRadarOpen); if (!isRadarOpen) bringToFront('radar'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >RADAR SKYPLOT</button>

                {/* 5. POINTING ANGLES */}
                <button 
                  className={`btn btn-gold ${isAnglesOpen ? 'active' : ''}`} 
                  onClick={() => { setIsAnglesOpen(!isAnglesOpen); if (!isAnglesOpen) bringToFront('angles'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', transition: 'all 0.3s' }}
                >POINTING ANGLES</button>

                {/* 6. SIGNAL FLOW */}
                <button 
                  className={`btn ${isDiagramOpen ? 'active' : ''}`} 
                  onClick={() => { setIsDiagramOpen(!isDiagramOpen); if (!isDiagramOpen) bringToFront('diagram'); }}
                  style={{ 
                    margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900',
                    background: isDiagramOpen ? '#ff00ff' : 'rgba(255, 0, 255, 0.05)', color: isDiagramOpen ? '#fff' : '#ff00ff', border: '1px solid #ff00ff', boxShadow: isDiagramOpen ? '0 0 25px #ff00ff' : 'inset 0 0 10px rgba(255, 0, 255, 0.15)', transition: 'all 0.3s'
                  }}
                >SIGNAL FLOW</button>

              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <button 
                  className={`btn btn-red ${isImgOpen ? 'active' : ''}`}
                  onClick={() => { setIsImgOpen(!isImgOpen); if (!isImgOpen) bringToFront('img'); }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', transition: 'all 0.3s' }}
                >MISSION PLAN</button>

                <button 
                  className={`btn btn-gold ${isPassModalOpen ? 'active' : ''}`} 
                  onClick={() => { setIsPassModalOpen(!isPassModalOpen); if (!isPassModalOpen) { bringToFront('pass'); if (selectedCatnr) calculateFuturePasses(selectedCatnr); } }}
                  style={{ margin: 0, padding: 'clamp(15px, 1.5vh, 22px) 5px', fontSize: 'clamp(14px, 1.5vw, 18px)', letterSpacing: '1px', fontWeight: '900', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', transition: 'all 0.3s' }}
                >PASS SCHEDULE</button>
              </div>
          </div>

          {/* 📍 SIMULATION STATUS - Summary panel for current SAT-ORBIT operating state */}
          <div className="panel-box" style={{
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
              borderBottom: '1px dashed rgba(0,234,255,0.35)'
            }}>
              SIMULATION STATUS
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '14px', rowGap: '6px' }}>
              {[
                ['TARGET', targetConfig.displayName, 'var(--cyan)'],
                ['STATION', activeStation.id, 'var(--green)'],
                ['MODE', (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive) ? 'REAL-TIME' : (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying ? 'LIVE' : 'SIM'), (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive) ? 'var(--green)' : (Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying ? 'var(--green)' : 'var(--gold)')],
                ['SPEED', `${speedMult}X`, 'var(--gold)'],
                ['TLE', isUpdatingTle ? 'SYNCING' : (!tles[selectedCatnr] ? 'NO TLE' : (selectedTleIsStale ? 'STALE' : 'SYNCED')), isUpdatingTle ? 'var(--gold)' : (!tles[selectedCatnr] || selectedTleIsStale ? 'var(--red)' : 'var(--green)')],
                ['ANTENNA', linkActive ? 'TRACKING' : 'STANDBY', linkActive ? 'var(--green)' : 'var(--gold)']
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
         <div style={{ textAlign: 'center', marginTop: '4px', fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)', fontFamily: 'Rajdhani', letterSpacing: '1px', lineHeight: '1.2', paddingBottom: '2px' }}>
             © {new Date().getFullYear()} Ground System Engineering Division:GSE <br />
             Developed by Nawattakorn Kaikaew
         </div>
         </div>
          )}
        </div>
      </div>
      
     {/* --- SKP GISTDA GROUND STATION (ป๊อปอัปขยายได้อิสระ + Auto-Scale) --- */}
     {isGsModalOpen && (
        <div className="modal-box gs-modal" onMouseDownCapture={() => bringToFront('gs')} style={{ 
          position: 'fixed', 
          top: maximizedWins.gs ? '0px' : `${gsPos.y}px`, 
          left: maximizedWins.gs ? '0px' : `${gsPos.x}px`, 
          
          /* 📍 ฟันธง: รีดความสูงเริ่มต้นเหลือ 530px และ minHeight เหลือ 420px ลอยพ้นขอบ Taskbar แน่นอน */
          width: maximizedWins.gs ? '100vw' : 'min(520px, 95vw)', 
          height: maximizedWins.gs ? '100vh' : 'min(530px, 85vh)', 
          minWidth: 'min(420px, 90vw)', minHeight: 'min(420px, 80vh)',
          
          maxWidth: '100vw', maxHeight: 'none', 
          resize: maximizedWins.gs ? 'none' : 'both', overflow: 'hidden', padding: '0',
          background: 'linear-gradient(145deg, rgba(20, 5, 0, 0.92) 0%, rgba(10, 2, 0, 0.98) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: maximizedWins.gs ? 'none' : '2px solid #FF6600', 
          borderRadius: maximizedWins.gs ? '0px' : '12px',
          boxShadow: '0 0 50px rgba(255, 102, 0, 0.4), inset 0 0 20px rgba(255, 102, 0, 0.2)', 
          display: 'flex', flexDirection: 'column',
          zIndex: windowZ?.gs || 9999,
          transition: isDraggingGs ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)' 
        }}>
          
          <style>{`
            .gs-modal .gs-icon { font-size: 26px !important; filter: drop-shadow(0 0 5px #FF6600); }
            /* 📍 ฟันธง: รีด padding แถวลงจาก 11px เหลือ 6px เพื่อคืนพื้นที่แนวตั้ง */
            .gs-modal .gs-row { padding: 6px 0 !important; display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255, 102, 0, 0.3) !important; align-items: center; }
            .gs-modal .gs-row:last-child { border-bottom: none !important; }
            .gs-modal .gs-label { font-size: 13px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
            .gs-modal .gs-value { font-size: 15px !important; color: #fff !important; font-weight: 900 !important; text-shadow: none !important; text-align: right; }
            .gs-modal .gs-value.highlight { color: #FF6600 !important; }
            .gs-no-scroll::-webkit-scrollbar { display: none; }
            .gs-no-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
          
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', cursor: maximizedWins.gs ? 'default' : (isDraggingGs ? 'grabbing' : 'grab'), flexWrap: 'nowrap', borderBottom: '2px solid rgba(255, 102, 0, 0.5)', background: 'linear-gradient(180deg, rgba(255, 102, 0, 0.15) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(255, 102, 0, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.gs) handleGsMouseDown(e); }}>
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center' }}>
               <span className="gs-icon">📡</span>
            </div>
            
            <div style={{ flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', background: 'rgba(255, 102, 0, 0.1)', border: '1px solid #FF6600', padding: '6px 20px', borderRadius: '6px', margin: '0 8px', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 10px rgba(255, 102, 0, 0.2)' }}>
               <span style={{ color: '#fff', fontSize: '17px', fontWeight: '900', fontFamily: 'Orbitron', letterSpacing: '2px', textShadow: 'none', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
               GISTDA GROUND STATION
               </span>
             </div>

            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '8px', flexShrink: 0, alignItems: 'center' }}>
               <button className="modal-close-btn" style={{ width: '30px', height: '30px', fontSize: '14px', flexShrink: 0, border: '1px solid #FF6600', color: '#FF6600', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('gs'); }}>{maximizedWins.gs ? '🗗' : '🗖'}</button>
               <button className="modal-close-btn" style={{ width: '30px', height: '30px', fontSize: '15px', flexShrink: 0, border: '1px solid #FF6600', color: '#FF6600', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsGsModalOpen(false); }}>✕</button>
             </div>
          </div>
          
          <div className="gs-no-scroll" style={{ padding: '12px 25px', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', fontFamily: 'Rajdhani', letterSpacing: '0.5px' }}>

            <div style={{ background: 'rgba(0, 234, 255, 0.05)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(0, 234, 255, 0.2)', marginBottom: '8px' }}>
                <h3 style={{ margin: '0 0 8px 0', color: 'var(--cyan)', fontSize: '14px', letterSpacing: '1px', textAlign: 'center', fontWeight: '900' }}>🌐 ACTIVE GROUND STATION NETWORK</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                  {GS_NETWORK.map(station => (
                    <button 
                      key={station.id}
                      className={`btn ${activeStation.id === station.id ? 'btn-cyan active' : 'btn-cyan'}`}
                      style={{ padding: '8px 2px', fontSize: '14px', letterSpacing: '1px', margin: 0, fontWeight: activeStation.id === station.id ? '900' : 'bold' }}
                      onClick={() => {
                        setActiveStation(station);
                      }}
                    >
                      {station.id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="gs-row">
                <span className="gs-label">LOCATION:</span>
                <span className="gs-value">{activeStation.name}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">LATITUDE:</span>
                <span className="gs-value highlight">{Math.abs(activeStation.lat).toFixed(4)}° {activeStation.lat >= 0 ? 'N' : 'S'}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">LONGITUDE:</span>
                <span className="gs-value highlight">{Math.abs(activeStation.lng).toFixed(4)}° {activeStation.lng >= 0 ? 'E' : 'W'}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">ALTITUDE (ASL):</span>
                <span className="gs-value highlight">{activeStation.alt} m</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">S-BAND (TT&C):</span>
                <span className="gs-value">2.0 - 2.3 GHz</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">X-BAND (DOWNLINK):</span>
                <span className="gs-value">8.0 - 8.4 GHz</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">SYSTEM HARDWARE:</span>
                <span className="gs-value">VIASAT / KRATOS</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">HORIZON MASK:</span>
                <span className="gs-value">5.0°</span>
              </div>
            
              <div style={{ paddingBottom: '10px' }}>
                <div className="gs-status-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: linkActive ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 102, 0, 0.1)', borderRadius: '6px', border: `1px solid ${linkActive ? 'var(--green)' : '#FF6600'}`, boxShadow: `inset 0 0 15px ${linkActive ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 102, 0, 0.2)'}`, padding: '10px 15px', marginTop: '10px' }}>
                  <span className="gs-label" style={{ color: 'rgba(255,255,255,0.8)' }}>ANTENNA STATUS:</span>
                  <span className="gs-value highlight" style={{ color: linkActive ? 'var(--green)' : '#FF6600', fontWeight: 'bold', textShadow: 'none', animation: linkActive ? 'pulse-glow 2s infinite' : 'none' }}>
                    {linkActive ? 'TRACKING (LOCKED)' : 'STANDBY'}
                  </span>
                </div>
              </div>

          </div>
        </div>
      )}


    <Antenna3DSimulatorModal
      open={isAntenna3DOpen}
      onClose={() => setIsAntenna3DOpen(false)}
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
    />


    <WeatherCenterModal
      open={isWeatherOpen}
      onClose={() => setIsWeatherOpen(false)}
      station={activeStation}
      zIndex={windowZ.weather}
      onFocus={() => bringToFront('weather')}
      summaryCloudCover={cloudCover}
      summaryMode={cloudDataMode}
    />


    {/* --- SATELLITE DATABASE --- */}
    {isModalOpen && (
        <div className="modal-box db-modal" onMouseDownCapture={() => bringToFront('db')} style={{ 
          position: 'fixed', 
          top: maximizedWins.db ? '0px' : `${dbPos.y}px`, 
          left: maximizedWins.db ? '0px' : `${dbPos.x}px`, 
          
          /* 📍 ฟันธง: ลดขนาดเริ่มต้นลงเป็น 750x480 px และขนาดต่ำสุดเป็น 550x350 px */
          width: maximizedWins.db ? '100vw' : 'min(750px, 95vw)', 
          height: maximizedWins.db ? '100vh' : 'min(480px, 85vh)', 
          minWidth: 'min(550px, 90vw)', minHeight: 'min(350px, 80vh)',
          
          maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.db ? 'none' : 'both', overflow: 'hidden', 
          background: 'linear-gradient(145deg, rgba(0, 10, 25, 0.9) 0%, rgba(0, 5, 10, 0.95) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: maximizedWins.db ? 'none' : '2px solid var(--cyan)', 
          borderRadius: maximizedWins.db ? '0px' : '12px', 
          boxShadow: '0 0 40px rgba(0, 234, 255, 0.4), inset 0 0 20px rgba(0, 234, 255, 0.2)', display: 'flex', flexDirection: 'column',
          zIndex: windowZ.db,
          transition: isDraggingDb ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>

          {/* 📍 ฟันธง: ล้างระบบ clamp() และ cqw ออกทั้งหมด กลับมาใช้ขนาด Pixel มาตรฐาน 100% UI/UX */}
          <style>{`
            .db-modal .modal-header h2 { font-size: 20px !important; }
            .db-modal .modal-clear-btn { font-size: 13px !important; padding: 6px 16px !important; }
            .db-modal .modal-sat-btn { font-size: 14px !important; padding: 14px 20px !important; }
            
            /* 📍 Grid มาตรฐาน จัดเรียงอัตโนมัติตามความกว้างหน้าต่าง (ปุ่มกว้าง 300px) */
            .db-modal .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; }

            .db-modal .group-header-row { 
              display: flex; justify-content: space-between; align-items: center; 
              background: linear-gradient(90deg, rgba(0, 234, 255, 0.15) 0%, transparent 100%);
              border-left: 4px solid var(--cyan);
              border-bottom: 1px solid rgba(0, 234, 255, 0.3);
              padding: 10px 20px;
              margin-top: 15px;
              margin-bottom: 15px;
              border-radius: 4px;
              box-shadow: 0 5px 15px -5px rgba(0, 234, 255, 0.2);
            }
            .db-modal .modal-group-title { 
              color: #fff !important; font-size: 16px !important; font-weight: 900 !important; 
              letter-spacing: 2px !important; text-transform: uppercase !important; 
              font-family: 'Orbitron', sans-serif !important; 
              text-shadow: 0 0 10px var(--cyan) !important; 
              border: none !important; margin: 0 !important; padding: 0 !important;
            }
            .db-modal .group-toggle-btn {
              font-size: 12px !important;
              padding: 6px 12px !important;
            }
          `}</style>

          {/* Header */}
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', cursor: maximizedWins.db ? 'default' : (isDraggingDb ? 'grabbing' : 'grab'), flexWrap: 'nowrap', borderBottom: '2px solid rgba(0, 234, 255, 0.5)', background: 'linear-gradient(180deg, rgba(0, 234, 255, 0.15) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(0, 234, 255, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.db) handleDbMouseDown(e); }}>
            
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center' }}>
               <span style={{fontSize: '26px', pointerEvents: 'none', filter: 'drop-shadow(0 0 5px var(--cyan))'}}>🛰️</span>
            </div>
            
            <div style={{ flex: '0 1 auto', display: 'flex', alignItems: 'center', background: 'rgba(0, 234, 255, 0.1)', border: '1px solid var(--cyan)', padding: '8px 30px', borderRadius: '6px', margin: '0 10px', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 10px rgba(0,234,255,0.2)' }}>
              <span style={{ color: '#fff', fontSize: '20px', fontWeight: 'bold', fontFamily: 'Orbitron', letterSpacing: '2px', textShadow: '0 0 10px var(--cyan)', pointerEvents: 'none' }}>
                SATELLITES DATABASE
              </span>
            </div>
            
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
              <button className="modal-clear-btn" style={{ margin: 0, whiteSpace: 'nowrap', background: 'rgba(255, 204, 0, 0.1)', color: 'var(--gold)', border: '1px solid var(--gold)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSelectedCatnrs([selectedCatnr]); }} title="Remove all secondary satellites">
                🧹 CLEAR
              </button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', flexShrink: 0, border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('db'); }}>{maximizedWins.db ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', flexShrink: 0, border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsModalOpen(false); }}>✕</button>
            </div>
          </div>
          
          <div className="modal-content" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
            {Array.from(new Set(SATELLITE_OPTIONS.map(s => s.group))).map(groupName => {
              const satsInGroup = SATELLITE_OPTIONS.filter(sat => sat.group === groupName);
              const groupCatnrs = satsInGroup.filter(s => satrecs[s.catnr]).map(s => s.catnr);
              const isAllSelected = groupCatnrs.length > 0 && groupCatnrs.every(cat => selectedCatnrs.includes(cat));

              return (
              <div key={groupName}>
                <div className="group-header-row">
                  <div className="modal-group-title">{groupName}</div>
                  <button className="group-toggle-btn" disabled={groupCatnrs.length === 0} title={groupCatnrs.length === 0 ? 'No validated TLE is available for this group' : undefined} style={groupCatnrs.length === 0 ? { opacity: 0.35, cursor: 'not-allowed' } : undefined} onClick={() => {
                      if (groupCatnrs.length === 0) return;
                      let newSelected = [...selectedCatnrs];
                      if (isAllSelected) { newSelected = newSelected.filter(c => !groupCatnrs.includes(c) || c === selectedCatnr); } 
                      else { groupCatnrs.forEach(c => { if (!newSelected.includes(c)) newSelected.push(c); }); }
                      setSelectedCatnrs(newSelected);
                    }}>
                    {groupCatnrs.length === 0 ? 'NO VALID TLE' : (isAllSelected ? '- DESELECT ALL' : '+ SELECT ALL')}
                  </button>
                </div>
                <div className="modal-grid">
                  {satsInGroup.map(sat => {
                    const hasTle = Boolean(satrecs[sat.catnr]);
                    return (
                    <button key={sat.catnr} disabled={!hasTle} title={hasTle ? sat.displayName : `${sat.displayName}: NO VALID TLE`} className={`modal-sat-btn ${sat.catnr === selectedCatnr ? 'primary' : selectedCatnrs.includes(sat.catnr) ? 'secondary' : ''}`} 
                      style={!hasTle ? { opacity: 0.38, cursor: 'not-allowed', filter: 'grayscale(80%)' } : undefined}
                      onClick={() => {
                        if (!hasTle) return;
                        let newSelected = [...selectedCatnrs];
                        if (newSelected.includes(sat.catnr)) {
                          // The application always needs one primary target. Never allow an empty selection.
                          if (newSelected.length === 1) return;
                          newSelected = newSelected.filter(c => c !== sat.catnr);
                        } else {
                          newSelected.push(sat.catnr);
                        }
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
                                if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
                                  globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
                                }
                            }
                          } catch (err) {}
                        }
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flex: 1, paddingRight: '10px' }}>
                        {sat.flag && <img src={`https://flagcdn.com/w40/${sat.flag.toLowerCase()}.png`} style={{ width: '28px', flexShrink: 0, marginRight: '12px', borderRadius: '3px', boxShadow: '0 0 5px rgba(255,255,255,0.4)' }} alt="flag" />}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'left' }}>{sat.displayName}</span>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {!hasTle ? ( <span style={{ color: 'var(--red)', fontSize: '10px', fontWeight: 900, letterSpacing: '0.5px' }}>NO TLE</span> ) : sat.catnr === selectedCatnr ? ( <span style={{ color: '#fff', textShadow: '0 0 10px #fff', fontSize: '12px', letterSpacing: '1px' }}>🎯 MAIN</span> ) : selectedCatnrs.includes(sat.catnr) ? ( <span style={{ color: '#000', fontSize: '12px' }}>●</span> ) : null}
                      </div>
                    </button>
                    );
                  })}
                </div>
              </div>
            )})}
          </div>
        </div>
      )}

   {/* --- PASS SCHEDULE --- */}
   {isPassModalOpen && (
        <div className="modal-box pass-modal" onMouseDownCapture={() => bringToFront('pass')} style={{ 
          position: 'fixed', 
          top: maximizedWins.pass ? '0px' : `${passPos.y}px`, 
          left: maximizedWins.pass ? '0px' : `${passPos.x}px`, 
          
          /* 📍 ฟันธง: ล็อกขนาดเริ่มต้นให้เล็กลงเป็น 800x520 px และขนาดต่ำสุดเป็น 600x400 px ไม่ล้นจอแน่นอน */
          width: maximizedWins.pass ? '100vw' : 'min(800px, 95vw)', 
          height: maximizedWins.pass ? '100vh' : 'min(520px, 85vh)', 
          minWidth: 'min(600px, 90vw)', minHeight: 'min(400px, 80vh)',
                
          maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.pass ? 'none' : 'both', overflow: 'hidden', 
          background: 'linear-gradient(145deg, rgba(20, 10, 0, 0.9) 0%, rgba(10, 5, 0, 0.95) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: maximizedWins.pass ? 'none' : '2px solid var(--gold)', 
          borderRadius: maximizedWins.pass ? '0px' : '12px', 
          boxShadow: '0 0 40px rgba(255, 204, 0, 0.4), inset 0 0 20px rgba(255, 204, 0, 0.2)', display: 'flex', flexDirection: 'column',
          zIndex: windowZ.pass,
          transition: isDraggingPass ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>
         <style>{`
            .pass-modal th { font-size: 12px !important; padding: 10px 8px !important; white-space: nowrap !important; }
            .pass-modal td { font-size: 14px !important; padding: 10px 8px !important; white-space: nowrap !important; }
            .pass-modal::-webkit-scrollbar { display: none; }
            .pass-modal { -ms-overflow-style: none; scrollbar-width: none; }
         `}</style>

         {/* Header */}
         <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 25px', borderBottom: '2px solid rgba(255, 204, 0, 0.5)', cursor: maximizedWins.pass ? 'default' : (isDraggingPass ? 'grabbing' : 'grab'), flexWrap: 'nowrap', flexShrink: 0, background: 'linear-gradient(180deg, rgba(255, 204, 0, 0.15) 0%, transparent 100%)' }} onMouseDown={(e) => { if(!maximizedWins.pass) handlePassMouseDown(e); }}>
            
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center', color: 'var(--gold)', fontFamily: 'Orbitron', fontWeight: 'bold', textShadow: '0 0 10px var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
              <span style={{fontSize:'20px', marginRight:'10px'}}>⏱️</span> 
              <span style={{ fontSize: '18px', overflow: 'hidden', textOverflow: 'ellipsis' }}>PASS SCHEDULE</span>
            </div>
            
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'center', gap: '10px' }}>
              {[1, 3, 7].map(d => (
                <button key={d} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPassPredictionDays(d)}
                  style={{
                    background: passPredictionDays === d ? 'var(--gold)' : 'rgba(255, 204, 0, 0.1)',
                    color: passPredictionDays === d ? '#000' : 'var(--gold)',
                    border: '1px solid var(--gold)',
                    padding: '6px 16px', borderRadius: '4px', 
                    fontSize: '13px', fontWeight: '900', fontFamily: 'Orbitron',
                    cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: passPredictionDays === d ? '0 0 15px rgba(255,204,0,0.6)' : 'none'
                  }}>
                  ±{d} DAYS
                </button>
              ))}
            </div>

            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '18px', flexShrink: 0, borderColor: 'var(--gold)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('pass'); }}>{maximizedWins.pass ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '20px', flexShrink: 0, borderColor: 'var(--gold)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsPassModalOpen(false); }}>✕</button>
            </div>
         </div>
         
         <div className="modal-content" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '15px' }}>
            {isCalculatingPass ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cyan)', fontSize: '18px', fontFamily: 'Orbitron', margin: 'auto' }}>
                CALCULATING ORBITAL TRAJECTORY...
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Rajdhani', fontSize: '14px', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(10, 5, 0, 0.95)', zIndex: 5 }}>
                  <tr style={{ borderBottom: '2px solid rgba(255, 204, 0, 0.6)', color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center', letterSpacing: '1px', fontSize: '12px', textTransform: 'uppercase', fontFamily: 'Orbitron' }}>
                    <th style={{ padding: '10px 8px' }}>STATUS</th>
                    <th style={{ padding: '10px 8px' }}>DATE (UTC)</th> 
                    <th style={{ padding: '10px 8px' }}>AOS</th> 
                    <th style={{ padding: '10px 8px' }}>MAX EL TIME</th> 
                    <th style={{ padding: '10px 8px' }}>LOS</th> 
                    <th style={{ padding: '10px 8px' }}>DURATION</th> 
                    <th style={{ padding: '10px 8px' }}>MAX EL</th> 
                    <th style={{ padding: '10px 8px' }}>AOS / LOS AZ</th>
                  </tr>
                </thead>
                <tbody>
                  {passSchedule.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: passScheduleNote ? 'var(--gold)' : 'var(--red)', fontWeight: 'bold', letterSpacing: '2px' }}>{passScheduleNote || 'NO PASSES DETECTED IN THIS TIMEFRAME'}</td></tr>
                  ) : (
                    passSchedule.map((pass, idx) => {
                      const aosD = new Date(pass.aosTime); const losD = new Date(pass.losTime); const peakD = new Date(pass.peakTime); 
                      const durMins = Math.floor(pass.durationMs / 60000); const durSecs = Math.floor((pass.durationMs % 60000) / 1000);
                      
                      const isPast = simulatedTimeMs > pass.losTime;
                      const isActive = simulatedTimeMs >= pass.aosTime && simulatedTimeMs <= pass.losTime;
                      
                      const simDateStr = new Date(simulatedTimeMs).toISOString().split('T')[0];
                      const passDateStr = aosD.toISOString().split('T')[0];
                      const isToday = !isPast && !isActive && (simDateStr === passDateStr);

                      let rowStyle = {
                        borderBottom: '1px dashed rgba(255,255,255,0.1)', 
                        cursor: 'pointer', transition: 'all 0.2s', textAlign: 'center',
                        background: 'transparent', opacity: 1, filter: 'none', borderLeft: 'none', boxShadow: 'none'
                      };

                      let statusBadge;

                      if (isActive) {
                        rowStyle.background = 'linear-gradient(90deg, rgba(0, 255, 102, 0.2) 0%, rgba(0, 255, 102, 0.05) 100%)';
                        rowStyle.borderLeft = '4px solid var(--green)';
                        rowStyle.boxShadow = 'inset 0 0 20px rgba(0, 255, 102, 0.2)';
                        statusBadge = <span style={{ color: '#000', background: 'var(--green)', padding: '2px 6px', borderRadius: '4px', fontWeight: '900', fontSize: '11px', animation: 'pulse 1.5s infinite' }}>● ACTIVE</span>;
                      } else if (isPast) {
                        rowStyle.opacity = 0.4; 
                        rowStyle.filter = 'grayscale(80%)';
                        statusBadge = <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>PAST</span>;
                      } else if (isToday) {
                        statusBadge = <span style={{ color: 'var(--gold)', fontWeight: '900', fontSize: '12px', textShadow: '0 0 8px rgba(255, 204, 0, 0.8)' }}>TODAY</span>;
                      } else {
                        statusBadge = <span style={{ color: 'rgba(0, 234, 255, 0.65)', fontSize: '12px' }}>FUTURE</span>;
                      }

                      return (
                        <tr key={idx} 
                        onClick={() => { 
                          const isRealtimePassLock = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive;
                          if (isRealtimePassLock) {
                            setCustomAlert({ show: true, message: "🔒 REAL-TIME LOCK: ปฏิเสธคำสั่ง! ระบบกำลังรับสัญญาณดาวเทียมจริง (LIVE)", type: 'error' });
                            return;
                          }
                          setSimulatedTimeMs(pass.aosTime - 10000); setSpeedMult(1); setIsPlaying(true); bringToFront('radar'); 
                        }}
                          style={rowStyle}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 204, 0, 0.15)'; e.currentTarget.style.transform = 'scale(1.01)'; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                          <td style={{ padding: '10px 8px', fontWeight: 'bold', fontFamily: 'Orbitron' }}>{statusBadge}</td>
                          <td style={{ color: 'rgba(255,255,255,0.9)', padding: '10px 8px' }}>{aosD.toISOString().split('T')[0]}</td>
                          <td style={{ color: 'var(--green)', fontWeight: 'bold', padding: '10px 8px' }}>{pad2(aosD.getUTCHours())}:{pad2(aosD.getUTCMinutes())}:{pad2(aosD.getUTCSeconds())}</td>
                          <td style={{ color: 'var(--gold)', fontWeight: 'bold', padding: '10px 8px' }}>{pad2(peakD.getUTCHours())}:{pad2(peakD.getUTCMinutes())}:{pad2(peakD.getUTCSeconds())}</td>
                          <td style={{ color: 'var(--red)', fontWeight: 'bold', padding: '10px 8px' }}>{pad2(losD.getUTCHours())}:{pad2(losD.getUTCMinutes())}:{pad2(losD.getUTCSeconds())}</td>
                          <td style={{ color: '#00eaff', fontWeight: 'bold', padding: '10px 8px' }}>{durMins}m {pad2(durSecs)}s</td>
                          <td style={{ color: '#ffffff', fontWeight: '900', padding: '10px 8px', textShadow: '0 0 8px rgba(255,255,255,0.5)' }}>{pass.maxEl.toFixed(2)}°</td>
                          <td style={{ color: 'rgba(255,255,255,0.6)', padding: '10px 8px' }}>{pass.aosAz.toFixed(1)}° → {pass.losAz.toFixed(1)}°</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
         </div>
        </div>
      )}

 {/* --- RADAR SKYPLOT --- */}
 {isRadarOpen && (
        <div ref={radarContainerRef} className="radar-perfect-scale" onMouseDownCapture={() => startTransition(() => bringToFront('radar'))} style={{
          position: 'fixed', 
          top: maximizedWins.radar ? '0px' : `${radarPos.y}px`, 
          left: maximizedWins.radar ? '0px' : `${radarPos.x}px`, 
          
          /* 📍 ฟันธง: ลดขนาดเริ่มต้น width และ height เป็น 550px เพื่อให้กรอบกะทัดรัดและยังเป็นสี่เหลี่ยมจัตุรัส */
          width: maximizedWins.radar ? '100vw' : 'min(550px, 95vw)',
          height: maximizedWins.radar ? '100vh' : 'min(550px, 85vh)', 
          minWidth: 'min(450px, 90vw)', minHeight: 'min(450px, 80vh)',

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

          {/* 📍 ฟันธง 3: เอาเส้นสีเขียวออก (borderBottom: none) และย้ายชื่อดาวเทียมไปซ้ายมือสุด */}
          <div className="modal-header" style={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 20, padding: '15px 25px', cursor: maximizedWins.radar ? 'default' : (isDraggingRadar ? 'grabbing' : 'grab'), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onMouseDown={(e) => { if(!maximizedWins.radar) handleRadarMouseDown(e); }}>
              
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', color: '#fff', fontFamily: 'Orbitron', fontWeight: 'bold', fontSize: '24px', textShadow: '0 0 10px var(--green)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                {(() => {
                  const sat = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr);
                  if (!sat) return null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 255, 102, 0.1)', border: '1px solid rgba(0, 255, 102, 0.4)', padding: '6px 20px', borderRadius: '6px', boxShadow: '0 0 10px rgba(0, 255, 102, 0.2)' }}>
                      {sat.flag && <img src={`https://flagcdn.com/w20/${sat.flag.toLowerCase()}.png`} style={{ width: '25px', marginRight: '12px', borderRadius: '3px', boxShadow: '0 0 5px var(--green)' }} alt="flag" />}
                      {sat.displayName}
                    </div>
                  );
                })()}
              </div>
              
              <div style={{ flex: 1 }}></div>
              
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '10px', alignItems: 'center' }}>
                <button onClick={() => setIsMuted(!isMuted)} style={{ background: isMuted ? 'rgba(255, 51, 51, 0.15)' : 'rgba(0, 255, 102, 0.15)', border: `1px solid ${isMuted ? 'var(--red)' : 'var(--green)'}`, color: isMuted ? 'var(--red)' : 'var(--green)', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Rajdhani', fontWeight: 'bold', fontSize: '15px', transition: 'all 0.2s' }}>
                  {isMuted ? '🔇 MUTE' : '🔊 AUDIO'}
                </button>
                <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '18px', padding: 0, borderColor: 'var(--green)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => toggleMaximize('radar')}>{maximizedWins.radar ? '🗗' : '🗖'}</button>
                <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '20px', padding: 0, borderColor: 'var(--green)', color: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => setIsRadarOpen(false)}>✕</button>
              </div>
          </div>
          
        {/* 📍 ฟันธง: แยก HUD ออกเป็น 3 มุมตามหลัก Cockpit UI เพื่อไม่ให้บังจอเรดาร์ตรงกลาง */}
          
          {/* 1. มุมซ้ายบน: EL (Elevation) */}
          <div style={{ position: 'absolute', top: '70px', left: '20px', zIndex: 15, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0, 10, 15, 0.75)', border: `1px solid ${linkActive ? 'var(--green)' : 'var(--gold)'}`, borderLeft: `5px solid ${linkActive ? 'var(--green)' : 'var(--gold)'}`, borderRadius: '6px', padding: '6px 14px', boxShadow: `0 4px 15px rgba(0,0,0,0.6), inset 0 0 15px ${linkActive ? 'rgba(0,255,102,0.1)' : 'rgba(255,204,0,0.1)'}`, display: 'flex', alignItems: 'baseline', gap: '10px', transition: 'all 0.3s' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: `${12 * radarLayout.fontScale}px`, fontWeight: '900', fontFamily: 'Orbitron', letterSpacing: '2px' }}>EL:</span>
              <span style={{ color: linkActive ? 'var(--green)' : 'var(--gold)', fontSize: `${24 * radarLayout.fontScale}px`, fontWeight: '900', fontFamily: 'Orbitron', textShadow: `0 0 15px ${linkActive ? 'var(--green)' : 'var(--gold)'}`, transition: 'all 0.3s' }}>
                {radarCurrentPos && radarCurrentPos.el ? Math.max(0, radarCurrentPos.el).toFixed(1) : '0.0'}°
              </span>
            </div>
          </div>

          {/* 2. มุมขวาบน: MAX EL */}
          <div style={{ position: 'absolute', top: '70px', right: '20px', zIndex: 15, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0, 10, 15, 0.75)', border: '1px solid var(--cyan)', borderRight: '5px solid var(--cyan)', borderRadius: '6px', padding: '6px 14px', boxShadow: '0 4px 15px rgba(0,0,0,0.6), inset 0 0 15px rgba(0,234,255,0.1)', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: `${12 * radarLayout.fontScale}px`, fontWeight: '900', fontFamily: 'Orbitron', letterSpacing: '1px' }}>MAX EL:</span>
              <span style={{ color: 'var(--cyan)', fontSize: `${20 * radarLayout.fontScale}px`, fontWeight: '900', fontFamily: 'Orbitron', textShadow: '0 0 12px var(--cyan)' }}>
                {radarData.maxEl !== 'N/A' ? `${radarData.maxEl}°` : 'N/A'}
              </span>
            </div>
          </div>

          {/* 3. มุมซ้ายล่าง: LEGEND */}
          <div style={{ position: 'absolute', bottom: '20px', left: '20px', zIndex: 15, pointerEvents: 'none' }}>
            <div style={{ background: 'rgba(0, 10, 15, 0.75)', border: '1px solid rgba(255,255,255,0.2)', borderLeft: '5px solid rgba(255,255,255,0.5)', borderRadius: '6px', padding: '10px 14px', boxShadow: '0 4px 15px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ color: 'rgba(0, 234, 255, 0.7)', fontSize: `${11 * radarLayout.fontScale}px`, fontWeight: 'bold', fontFamily: 'Orbitron', textShadow: '0 0 5px #000' }}>- - DEPARTED</div>
              <div style={{ color: 'var(--gold)', fontSize: `${11 * radarLayout.fontScale}px`, fontWeight: 'bold', fontFamily: 'Orbitron', textShadow: '0 0 5px #000' }}>- - APPROACH</div>
              <div style={{ color: 'var(--cyan)', fontSize: `${11 * radarLayout.fontScale}px`, fontWeight: 'bold', fontFamily: 'Orbitron', textShadow: '0 0 5px #000' }}>━━ VISIBLE</div>
            </div>
          </div>

          <svg width="100%" height="100%" style={{ display: 'block', position: 'relative', zIndex: 10 }}>
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
                      const lx = cx + (R + padding) * Math.sin((az * Math.PI) / 180);
                      const ly = cy - (R + padding) * Math.cos((az * Math.PI) / 180);
                      
                      let label = az + '°';
                      if (az === 0) label = "N (0°)"; if (az === 90) label = "E (90°)"; if (az === 180) label = "S (180°)"; if (az === 270) label = "W (270°)";
                      let anchor = "middle"; if (az > 0 && az < 180) anchor = "start"; if (az > 180 && az < 360) anchor = "end";
                      let dy = "0.3em"; if (az === 0) dy = "0.8em"; if (az === 180) dy = "-0.3em";

                      return (
                        <text key={`az-label-${az}`} x={lx} y={ly} dy={dy} fill={isMain ? "#00eaff" : "#ffcc00"} fontSize={isMain ? 15 * fontScale : 12 * fontScale} fontWeight="900" textAnchor={anchor} style={{ textShadow: '0 0 8px #000' }} >
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

                         <text x={aosX + aosCfg.dx} y={aosY + aosCfg.dy} fill="var(--gold)" fontSize={13 * s} fontWeight="900" fontFamily="Orbitron" textAnchor={aosCfg.anchor} alignmentBaseline="middle" style={{ textShadow: '0 0 5px #000, 0 0 10px var(--gold)' }}>AOS {radarData.aosAz.toFixed(1)}°</text>
                         <text x={losX + losCfg.dx} y={losY + losCfg.dy} fill="var(--red)" fontSize={13 * s} fontWeight="900" fontFamily="Orbitron" textAnchor={losCfg.anchor} alignmentBaseline="middle" style={{ textShadow: '0 0 5px #000, 0 0 10px var(--red)' }}>LOS {radarData.losAz.toFixed(1)}°</text>
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
              background: 'conic-gradient(from 0deg, rgba(0, 255, 102, 0) 30%, rgba(0, 255, 102, 0.15) 70%, rgba(0, 255, 102, 0.6) 98%, rgba(0, 255, 102, 1) 100%)',
              animation: linkActive ? 'none' : 'radar-sweep 3s infinite linear',
              transform: linkActive && targetData && !isNaN(targetData.azimuthDeg) ? `rotate(${targetData.azimuthDeg}deg)` : 'none',
              pointerEvents: 'none', zIndex: 5, opacity: linkActive ? 0.5 : 1,
              transition: 'transform 0.1s linear, opacity 0.3s'
            }} />
        </div>
     )}

   {/* --- IMAGING PLAN VIEWER --- */}
{isImgOpen && (
    <div className="modal-box img-modal" onMouseDownCapture={() => bringToFront('img')} style={{ 
      position: 'fixed', 
      top: maximizedWins.img ? '0px' : `${imgPos.y}px`, 
      left: maximizedWins.img ? '0px' : `${imgPos.x}px`, 
      width: maximizedWins.img ? '100vw' : '780px', 
      height: maximizedWins.img ? '100vh' : '500px', 
      minWidth: '600px', minHeight: '400px',
      maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.img ? 'none' : 'both', overflow: 'hidden', 
      background: 'rgba(2, 6, 23, 0.9)', backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)',
      
      /* 📍 เปลี่ยนสีกรอบหน้าต่างและแสงเงาเป็นสีฟ้า (Cyan) */
      border: '2px solid var(--cyan)',
      boxSizing: 'border-box', 
      borderRadius: maximizedWins.img ? '0px' : '12px',
      boxShadow: '0 0 40px rgba(0, 234, 255, 0.3), inset 0 0 20px rgba(0, 234, 255, 0.2)',
      
      display: 'flex', flexDirection: 'column',
      zIndex: windowZ.img || 10000,
      transition: isDraggingImg ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
    }}>

      {/* 📍 เปลี่ยนแสงแฟลร์พื้นหลังเป็นสีฟ้า */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '120%', height: '120%', background: 'radial-gradient(circle, rgba(0, 234, 255, 0.15) 0%, transparent 60%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0, animation: 'pulse 4s infinite' }}></div>

      {/* Header */}
      <div className="modal-header" style={{ position: 'relative', zIndex: 10, borderBottom: '2px solid var(--cyan)', padding: '12px 20px', cursor: maximizedWins.img ? 'default' : (isDraggingImg ? 'grabbing' : 'grab'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, rgba(0, 234, 255, 0.2) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(0, 234, 255, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.img) handleImgMouseDown(e); }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <button 
            onClick={() => setIsImgListOpen(!isImgListOpen)}
            style={{
              /* 📍 สีปุ่มเปิด/ปิดลิสต์เป็นสีฟ้า */
              background: isImgListOpen ? 'rgba(0, 234, 255, 0.15)' : 'var(--cyan)',
              border: '1px solid var(--cyan)',
              color: isImgListOpen ? 'var(--cyan)' : '#000',
              padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Orbitron',
              fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px',
              boxShadow: isImgListOpen ? 'none' : '0 0 15px rgba(0, 234, 255, 0.6)', transition: 'all 0.2s ease'
            }}
          >
            {isImgListOpen ? '◀ HIDE LIST' : '▶ SHOW LIST'}
          </button>
        </div>
        
        {/* 📍 หัวข้อเปลี่ยนเป็นสีฟ้า คมกริบ ไร้แสงแฟลร์ */}
        <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--cyan)', fontFamily: 'Orbitron', fontWeight: 'bold', fontSize: '20px', textShadow: 'none', pointerEvents: 'none', whiteSpace: 'nowrap', letterSpacing: '1px' }}>
          📸 IMAGING PLAN VIEWER 
          <span style={{ fontSize: '14px', color: 'var(--gold)', background: 'rgba(0,0,0,0.5)', border: '1px solid #ffffff', padding: '2px 10px', borderRadius: '4px', marginLeft: '12px', textShadow: 'none', boxShadow: 'none', letterSpacing: '2px' }}>
            ORBIT 269
          </span>
        </div>
        
        <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', padding: 0, border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => toggleMaximize('img')}>{maximizedWins.img ? '🗗' : '🗖'}</button>
          <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', padding: 0, border: '1px solid var(--red)', color: 'var(--red)', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => setIsImgOpen(false)}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '20px', gap: isImgListOpen ? '20px' : '0px', position: 'relative', zIndex: 10 }}>
        
        {/* ซ้าย: ตารางคิวถ่ายภาพ */}
        {isImgListOpen && (
          <div style={{ flex: '0 0 380px', display: 'flex', flexDirection: 'column', borderRight: '1px dashed rgba(0, 234, 255, 0.4)', paddingRight: '15px' }}>
            <style>{`.img-hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
            <div style={{ flex: '1', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="img-hide-scrollbar">
            <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontFamily: 'Rajdhani', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr style={{ color: 'rgba(255,255,255,0.7)', borderBottom: '2px solid rgba(0, 234, 255, 0.6)', fontSize: '13px' }}>
                    <th style={{ padding: '10px 5px', width: '50%', textAlign: 'center', letterSpacing: '1.5px', fontFamily: 'Orbitron' }}>DATE & TIME (UTC)</th>
                    <th style={{ padding: '10px 5px', width: '25%', textAlign: 'center', letterSpacing: '1.5px', fontFamily: 'Orbitron' }}>DURATION</th>
                    <th style={{ padding: '10px 5px', width: '25%', textAlign: 'center', letterSpacing: '1.5px', fontFamily: 'Orbitron' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {imagingPlansData.map(plan => {
                    const dStart = new Date(plan.start);
                    const isSelected = selectedPlanId === plan.id;
                    return (
                      <tr key={plan.id}
                          style={{ 
                            borderBottom: '1px solid rgba(255,255,255,0.05)', 
                            cursor: 'pointer', 
                            /* 📍 เปลี่ยนแถบไฮไลต์ตารางเป็นสีฟ้า */
                            background: isSelected ? 'linear-gradient(90deg, rgba(0, 234, 255, 0.2) 0%, transparent 100%)' : 'transparent',
                            borderLeft: isSelected ? '4px solid var(--cyan)' : '4px solid transparent',
                            transition: 'all 0.2s ease',
                            textAlign: 'center'
                          }}
                          onMouseOver={(e) => { if(!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                          onMouseOut={(e) => { if(!isSelected) e.currentTarget.style.background = 'transparent'; }}
                          onClick={() => setSelectedPlanId(isSelected ? null : plan.id)}>
                        
                        <td style={{ padding: '12px 5px', fontWeight: 'bold', fontSize: '15px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ color: isSelected ? '#ffffff' : '#e0e0e0', textShadow: isSelected ? '0 0 10px rgba(0, 234, 255, 0.8)' : 'none', letterSpacing: '1px' }}>
                              {pad2(dStart.getUTCHours())}:{pad2(dStart.getUTCMinutes())}:{pad2(dStart.getUTCSeconds())}
                            </span>
                            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: '600', marginTop: '2px' }}>
                              {dStart.getUTCFullYear()}-{pad2(dStart.getUTCMonth() + 1)}-{pad2(dStart.getUTCDate())}
                            </span>
                          </div>
                        </td>
                        
                        <td style={{ padding: '12px 5px', color: isSelected ? '#ffffff' : 'var(--gold)', fontWeight: 'bold', fontSize: '16px' }}>
                          {plan.duration.toFixed(0)} <span style={{ fontSize: '11px', color: isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(255,204,0,0.6)' }}>s</span>
                        </td>
                        
                        <td style={{ padding: '12px 5px' }}>
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <button style={{ 
                              /* 📍 ปุ่ม Play เปลี่ยนเป็นสีฟ้า */
                              background: isSelected ? 'var(--cyan)' : 'rgba(0, 234, 255, 0.1)', 
                              border: `1px solid ${isSelected ? '#fff' : 'rgba(0, 234, 255, 0.4)'}`, 
                              color: isSelected ? '#000' : 'var(--cyan)', 
                              width: '40px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', transition: 'all 0.2s', 
                              boxShadow: isSelected ? '0 0 15px rgba(0, 234, 255, 0.6)' : 'none',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const isRealtimePassLock = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying && linkActive;
                              if (isRealtimePassLock) {
                                setCustomAlert({ show: true, message: "🔒 REAL-TIME LOCK: ปฏิเสธคำสั่ง! ระบบกำลังรับสัญญาณดาวเทียมจริง (LIVE)", type: 'error' });
                                return;
                              }
                              setSelectedPlanId(plan.id);
                              setSimulatedTimeMs(new Date(plan.start).getTime() - 5000);
                              setSpeedMult(1);
                            }}>
                              ▶
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

           {/* 📍 ปุ่ม Upload สีฟ้า */}
           <div style={{ position: 'relative', zIndex: 10, marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(0, 234, 255, 0.3)', textAlign: 'center' }}>
                 <label style={{ 
                  display: 'inline-block', width: '90%', 
                  background: 'linear-gradient(90deg, rgba(0, 234, 255, 0.1) 0%, rgba(0, 234, 255, 0.2) 50%, rgba(0, 234, 255, 0.1) 100%)', 
                  border: '2px dashed var(--cyan)', color: 'var(--cyan)', 
                  padding: '10px 15px', borderRadius: '6px', cursor: 'pointer', 
                  fontSize: '13px', fontFamily: 'Orbitron', fontWeight: 'bold', 
                  letterSpacing: '1.5px', transition: 'all 0.3s ease',
                  boxShadow: '0 0 15px rgba(0, 234, 255, 0.1)'
                 }}
                      onMouseOver={(e) => { 
                        e.currentTarget.style.background = 'var(--cyan)'; 
                        e.currentTarget.style.color = '#000';
                        e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 234, 255, 0.8)'; 
                        e.currentTarget.style.transform = 'scale(1.02)';
                      }}
                      onMouseOut={(e) => { 
                        e.currentTarget.style.background = 'linear-gradient(90deg, rgba(0, 234, 255, 0.1) 0%, rgba(0, 234, 255, 0.2) 50%, rgba(0, 234, 255, 0.1) 100%)'; 
                        e.currentTarget.style.color = 'var(--cyan)'; 
                        e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 234, 255, 0.1)'; 
                        e.currentTarget.style.transform = 'scale(1)';
                      }}>
                  📂 UPLOAD NEW MISSION PLAN (PDF & JSON)
                  <input type="file" accept=".pdf, .json, .geojson" multiple style={{ display: 'none' }} onChange={handleMissionPlanUpload} />
                 </label>
            </div>
          </div>
        )}



            {/* ขวา: แผนที่ 2D */}
            <div 
               style={{ flex: 1, position: 'relative', border: '1px solid var(--cyan)', borderRadius: '6px', background: '#000', overflow: 'hidden', boxShadow: 'inset 0 0 20px rgba(0, 234, 255, 0.2)', cursor: 'crosshair', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                         const cx_deg = (p.startLng + p.endLng) / 2; const cy_deg = (p.startLat + p.endLat) / 2;
                         const cx_pct = (cx_deg + 180) / 360 * 100; const cy_pct = (90 - cy_deg) / 180 * 100;
                         tOrigin = `${cx_pct}% ${cy_pct}%`; 
                      }
                   }
                  return (
                     <div style={{
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
                            {imagingPlansData.map(p => {
                               if(isNaN(p.startLng) || isNaN(p.endLng)) return null;
                               if (simulatedTimeMs > p.end) return null; 

                               const x1 = (p.startLng + 180) / 360 * 100; const y1 = (90 - p.startLat) / 180 * 100;
                               const x2 = (p.endLng + 180) / 360 * 100; const y2 = (90 - p.endLat) / 180 * 100;
                               const isSel = selectedPlanId === p.id;
                               
                               const sw1 = (isSel ? 2.5 : 1.2) / mapZoom; 
                               const sw2 = (isSel ? 0.3 : 0.15) / mapZoom; 
                               const rDot = 1.0 / mapZoom; 

                               return (
                                  <g key={p.id}>
                                     {/* เส้นแนวถ่ายภาพสีแดงเข้มทึบแสง */}
                                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isSel ? "rgba(255, 51, 51, 1)" : "rgba(204, 0, 0, 0.9)"} strokeWidth={sw1} strokeLinecap="round" />
                                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isSel ? "#fff" : "rgba(255,255,255,0.4)"} strokeWidth={sw2} strokeDasharray={`${0.5/mapZoom} ${0.5/mapZoom}`} />
                                     {/* ซ่อนจุดแดง ถ้าไม่ได้คลิกเลือก */}
                                     {isSel && <circle cx={x1} cy={y1} r={rDot} fill="#fff" stroke="#ff3333" strokeWidth={sw2} />}
                                  </g>
                               );
                            })}
                        </svg>
                     </div>
                   )
                })()}

                {/* สร้างกริดในแผนที่ Mission Plan <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(0, 234, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 234, 255, 0.1) 1px, transparent 1px)', backgroundSize: '20px 20px', pointerEvents: 'none' }}></div>*/}
                
                {/* 📍 ฟันธง 3: เปลี่ยนจากแค่ตัวอักษร เป็น "กลุ่มปุ่มกด" ที่มีปุ่ม เปิด/ปิด Ground Track */}
                <div style={{ position:'absolute', bottom:'15px', left:'15px', display: 'flex', gap: '10px' }}>
                <div style={{ 
                    /* 📍 ฟันธง: เปลี่ยนสีตัวหนังสือเป็นสีขาวล้วน ไม่มีแสงแฟลร์ (textShadow: none) ให้คมชัด */
                    color: '#ffffff', 
                    fontFamily: 'Orbitron', 
                    fontSize: '12px', 
                    fontWeight: 'bold', 
                    textShadow: 'none', 
                    
                    /* 📍 ฟันธง: เปลี่ยนพื้นหลังเป็นสีแดงกึ่งโปร่งใส และใส่ขอบสีแดงทึบให้กลมกลืนกับธีมหลัก */
                    background: selectedPlanId !== null ? 'rgba(255, 69, 0, 0.2)' : 'rgba(0, 0, 0, 0.6)', 
                    padding: '6px 12px', 
                    borderRadius: '4px', 
                    border: selectedPlanId !== null ? '1px solid #FF4500' : '1px solid rgba(255,255,255,0.3)',
                    borderLeft: selectedPlanId !== null ? '4px solid #FF4500' : '4px solid var(--cyan)', 
                    
                    display: 'flex', 
                    alignItems: 'center',
                    letterSpacing: '1px'
                  }}>
                    {selectedPlanId !== null ? `🎯 TARGET LOCKED (ZOOM: ${mapZoom}X)` : '🌍 GLOBAL VIEW (STANDBY)'}
                  </div>
                  
                  {/* ปุ่มกด Toggle */}
                  <button 
                    onClick={() => setShowGroundTrack(!showGroundTrack)}
                    style={{ 
                      background: showGroundTrack ? 'rgba(255, 204, 0, 0.2)' : 'rgba(0, 0, 0, 0.6)',
                      border: `1px solid ${showGroundTrack ? '#ffcc00' : 'rgba(255,255,255,0.3)'}`,
                      color: showGroundTrack ? '#ffcc00' : '#fff',
                      fontFamily: 'Orbitron', fontSize: '11px', padding: '0 10px',
                      borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s'
                    }}
                  >
                    {showGroundTrack ? 'HIDE ORBIT TRACK' : 'SHOW ORBIT TRACK'}
                  </button>
                </div>
            </div>

          </div>
        </div>
      )}

{/* --- SIGNAL ANALYZER (IQ & DUAL SPECTRUM Analyzer - STRICT PHYSICS & LOGIC) --- */}
{isAnalyzerOpen && (
        <div className="modal-box analyzer-modal" onMouseDownCapture={() => startTransition(() => bringToFront('analyzer'))} style={{
          position: 'fixed', top: maximizedWins.analyzer ? '0px' : `${analyzerPos.y}px`, left: maximizedWins.analyzer ? '0px' : `${analyzerPos.x}px`,
          
          /* 📍 ฟันธง: ลดขนาดเริ่มต้น width จาก 1050px เป็น 880px และ height จาก 650px เป็น 550px */
          width: maximizedWins.analyzer ? '100vw' : 'min(880px, 95vw)', height: maximizedWins.analyzer ? '100vh' : 'min(550px, 85vh)',
          minWidth: 'min(750px, 90vw)', minHeight: 'min(480px, 80vh)',
          resize: maximizedWins.analyzer ? 'none' : 'both', overflow: 'hidden',
          
          background: 'linear-gradient(145deg, #050a15 0%, #02040a 100%)',
          border: maximizedWins.analyzer ? 'none' : `2px solid ${linkActive ? 'var(--cyan)' : 'var(--red)'}`,
          borderRadius: maximizedWins.analyzer ? '0px' : '10px',
          boxShadow: `0 0 30px rgba(0,0,0,0.8), inset 0 0 10px rgba(255,255,255,0.05)`,
          display: 'flex', flexDirection: 'column', zIndex: windowZ.analyzer || 10001,
          transition: isDraggingAnalyzer ? 'none' : 'all 0.2s ease-out'
        }}>
          
          {/* Header */}
          <div className="modal-header" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 20px', cursor: maximizedWins.analyzer ? 'default' : (isDraggingAnalyzer ? 'grabbing' : 'grab'),
            borderBottom: `1px solid rgba(255, 255, 255, 0.1)`, background: 'rgba(255,255,255,0.03)'
          }} onMouseDown={(e) => { if(!maximizedWins.analyzer) handleAnalyzerMouseDown(e); }}>
            
            {/* ซ้าย: ชื่อหน้าจอ */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', color: '#ffffff', fontFamily: 'Orbitron', fontWeight: '900', fontSize: '16px', letterSpacing: '2px', pointerEvents: 'none', textShadow: '0 0 10px rgba(255,255,255,0.4)' }}>
              <span style={{ marginRight: '10px', fontSize: '18px' }}>📻</span> RF SPECTRUM ANALYZER
            </div>

            {/* ขวา: แผงควบคุมทั้งหมด */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  onMouseDown={(e) => e.stopPropagation()} 
                  onClick={() => { if (showXBand && !showSBand) return; setShowXBand(!showXBand); }}
                  style={{ background: showXBand ? 'rgba(255,204,0,0.15)' : 'transparent', border: `1px solid ${showXBand ? '#ffcc00' : 'rgba(255,204,0,0.3)'}`, color: showXBand ? '#ffcc00' : 'rgba(255,204,0,0.5)', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s', boxShadow: showXBand ? '0 0 10px rgba(255,204,0,0.2)' : 'none' }}>
                  {showXBand ? '👁 CH1: X-BAND' : 'CH1: X-BAND (OFF)'}
                </button>
                <button 
                  onMouseDown={(e) => e.stopPropagation()} 
                  onClick={() => { if (showSBand && !showXBand) return; setShowSBand(!showSBand); }}
                  style={{ background: showSBand ? 'rgba(0,234,255,0.15)' : 'transparent', border: `1px solid ${showSBand ? '#00eaff' : 'rgba(0,234,255,0.3)'}`, color: showSBand ? '#00eaff' : 'rgba(0,234,255,0.5)', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Orbitron', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s', boxShadow: showSBand ? '0 0 10px rgba(0,234,255,0.2)' : 'none' }}>
                  {showSBand ? '👁 CH2: S-BAND' : 'CH2: S-BAND (OFF)'}
                </button>
              </div>
              
              <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)' }}></div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="modal-close-btn" style={{ width: '30px', height: '30px', fontSize: '14px', borderColor: 'rgba(255,255,255,0.3)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('analyzer'); }}>{maximizedWins.analyzer ? '🗗' : '🗖'}</button>
                <button className="modal-close-btn" style={{ width: '30px', height: '30px', fontSize: '15px', borderColor: 'var(--red)', color: 'var(--red)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsAnalyzerOpen(false); }}>✕</button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: '20px', gap: '20px', minHeight: 0 }}>
            

          {(() => {
              // 📍 2. ฐานข้อมูลวิเคราะห์สัญญาณ Baseband (IQ & Spectrum) ครอบคลุม 100%
              let spec = { name: targetConfig.name, xBand: { freq: 720.0, bw: 100, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 1.0, mod: 'BPSK' } };
              
              // 🧠 จัดกลุ่ม Modulation & Bandwidth อัตโนมัติตามประเภทดาวเทียม
              const grp = targetConfig.group;
              if (grp === 'SYNTHETIC APERTURE RADAR (SAR)') {
                spec.xBand = { freq: 720.0, bw: 300, mod: 'QPSK' }; // Radar ต้องใช้ Bandwidth กว้างมาก
              } else if (grp === 'WEATHER & EARTH RESOURCES' || grp === 'GLOBAL EESS & SCIENCE') {
                spec.xBand = { freq: 720.0, bw: 150, mod: 'O-QPSK' };
              } else if (grp === 'MEGA CONSTELLATIONS') {
                spec.xBand = { freq: 720.0, bw: 250, mod: 'QPSK' }; // Starlink/OneWeb Bandwidth มหาศาล
              } else if (grp === 'GLOBAL NAVIGATION (GNSS)') {
                spec.xBand = { freq: 720.0, bw: 20, mod: 'BPSK' }; // GPS ส่งข้อมูลต่ำแต่ทะลุทะลวง
              } else if (grp === 'THAI CUBESAT & MICROSAT') {
                spec.xBand = { freq: 720.0, bw: 5, mod: 'BPSK' }; 
              }

              // 🎯 Overrides เจาะจงเฉพาะดวง (พวกนี้เอกสารอ้างอิงชัดเจน)
              const overrides = {
                '33396': { name: 'THEOS', xBand: { freq: 720.0, bw: 120, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 0.8, mod: 'BPSK' } },
                '58016': { name: 'THEOS-2', xBand: { freq: 720.0, bw: 310, mod: 'O-QPSK' }, sBand: { freq: 70.0, bw: 0.235, mod: 'QPSK' } },
                '27424': { name: 'AQUA', xBand: { freq: 720.0, bw: 15, mod: 'SQPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
                '25994': { name: 'TERRA', xBand: { freq: 720.0, bw: 15, mod: 'SQPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
                '49260': { name: 'LANDSAT-9', xBand: { freq: 720.0, bw: 384, mod: 'O-QPSK' }, sBand: { freq: 70.0, bw: 3.0, mod: 'BPSK' } },
                '39084': { name: 'LANDSAT-8', xBand: { freq: 720.0, bw: 384, mod: 'O-QPSK' }, sBand: { freq: 70.0, bw: 3.0, mod: 'BPSK' } },
                '54234': { name: 'NOAA-21', xBand: { freq: 720.0, bw: 30, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
                '43013': { name: 'NOAA-20', xBand: { freq: 720.0, bw: 30, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
                '37849': { name: 'SUOMI NPP', xBand: { freq: 720.0, bw: 30, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
                '39634': { name: 'SENTINEL-1A', xBand: { freq: 720.0, bw: 300, mod: 'QPSK' }, sBand: { freq: 70.0, bw: 2.0, mod: 'BPSK' } },
              };

              if (overrides[selectedCatnr]) {
                spec = overrides[selectedCatnr];
              }


              // 📍 2. ลอจิกการ Lock (ฟันธง: ล็อกสัญญาณที่ 3.0 องศาเป๊ะๆ)
              const el = targetData && !isNaN(targetData.elevationDeg) ? targetData.elevationDeg : -10;
              const isAutoTrack = el >= 3.0; // สัญญาณพุ่งปรี๊ด 100% ที่ 3 องศา
              const isProgramTrack = el >= 0.0 && el < 3.0; // ช่วงเริ่มเห็นขอบฟ้า กราฟจะกระเพื่อมรอ
              
              const lockStatusText = isAutoTrack ? 'LOCKED' : (isProgramTrack ? 'ACQUIRING...' : 'NO CARRIER');
              const lockStatusColor = isAutoTrack ? 'var(--green)' : (isProgramTrack ? 'var(--gold)' : 'var(--red)');

              // ----------------------------------------------------
              // ฟังก์ชันวาดกราฟ Spectrum ด้วยสมการ Root Raised Cosine (RRC)
              // ----------------------------------------------------
              const drawSpectrumCorrectly = (canvas, w, h, isXBand) => {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#0b1121'; ctx.fillRect(0, 0, w, h);
                const graphW = w - 15; 
                
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); 
                ctx.beginPath();
                for(let i=1; i<=10; i++) { ctx.moveTo(i*(graphW/10), 0); ctx.lineTo(i*(graphW/10), h); }
                for(let i=1; i<10; i++) { ctx.moveTo(0, i*(h/10)); ctx.lineTo(graphW, i*(h/10)); }
                ctx.stroke(); ctx.setLineDash([]); 

                const bw = isXBand ? spec.xBand.bw : spec.sBand.bw;
                const span = isXBand ? xBandSpan : sBandSpan; 
                const cf_base = isXBand ? spec.xBand.freq : spec.sBand.freq; 

                // คำนวณความแรงสัญญาณตามองศา
                let signalStrength = 0; let trackMode = 'STANDBY'; let trackColor = 'var(--red)';
                if (linkActive && targetData) {
                    if (isAutoTrack) { 
                        trackMode = 'AUTOTRACK'; trackColor = '#00ff66'; signalStrength = 1.0; 
                    } else if (isProgramTrack) { 
                        trackMode = 'PROGRAM TRACK'; trackColor = '#ffcc00'; signalStrength = 0.4 + (Math.random() * 0.2); 
                    }
                }

                const peakX = graphW / 2; 
                const baseY = h - 30; const peakY = 25; 
                const dynRange = 45; 
                const pxPerDb = (baseY - peakY) / dynRange; 
                const refLevel = isXBand ? -35 : -20; 

                ctx.strokeStyle = isXBand ? '#ffcc00' : '#00eaff'; 
                ctx.lineWidth = 1.5; ctx.beginPath();

                // 📍 ฟันธง: สมการความกว้างของกราฟ กางออกเท่ากับค่า BW ของจริงเป๊ะ 100%
                const f1 = (bw * 0.65) / 2; // ยอดกราฟ (Flat Top) กว้าง 65% ของ BW
                const f2 = bw / 2; // ฐานกราฟตกถึงพื้น Noise Floor ที่ขอบ 100% ของ BW พอดีเป๊ะ

                for(let x=0; x<=graphW; x++) {
                  const f = ((x / graphW) - 0.5) * span; // แปลงพิกเซลจอเป็นแกนความถี่ (MHz) ตาม SPAN ที่เลือก
                  const f_abs = Math.abs(f);
                  
                  let signal_dB = -100;
                  if (linkActive && (isAutoTrack || isProgramTrack)) {
                      if (f_abs <= f1) {
                          signal_dB = 0; // ยอดแบนสุด (0 dBc)
                      } else if (f_abs > f1 && f_abs <= f2) {
                          // ไหล่กราฟโค้งลงแบบ Cosine (Roll-off)
                          const rollOffRatio = (f_abs - f1) / (f2 - f1);
                          const val = 0.5 * (1 + Math.cos(rollOffRatio * Math.PI));
                          signal_dB = 10 * Math.log10(Math.max(val, 1e-4)); 
                      } else {
                          // ตีนกราฟและ Side Lobes เล็กๆ
                          const out_f = f_abs - f2;
                          const sideLobeWidth = bw * 0.15;
                          signal_dB = -30 - (out_f / sideLobeWidth) * 8 + (Math.sin((out_f / sideLobeWidth) * Math.PI) * 4);
                      }
                      signal_dB += (signalStrength - 1) * 20; 
                  }
                  
                  const noise_dB = -40 + (Math.random() * 3); // Noise Floor ระดับ -40 dB
                  const p_sig = Math.pow(10, signal_dB/10);
                  const p_noise = Math.pow(10, noise_dB/10);
                  const total_dB = 10 * Math.log10(p_sig + p_noise); 
                  
                  let y = peakY - (total_dB * pxPerDb); 
                  if (y > baseY) y = baseY; // บล็อกไม่ให้กราฟทะลุขอบล่างจอ
                  
                  if (x===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();

                // Overlay Text
                ctx.fillStyle = '#e2e8f0'; ctx.font = `bold 11px Rajdhani, monospace`; ctx.textAlign = 'left';
                const textX = 15;
                ctx.fillText(`${formatTime(new Date(simulatedTimeMs))} THA, SIM`, textX, 20);
                ctx.fillText(`REF ${refLevel.toFixed(1)} dBm  AT 10 dB`, textX, 35);
                ctx.fillText(`LOG 5 dB/`, textX, 50); 
                
                if (linkActive && targetData) {
                    ctx.beginPath(); ctx.arc(textX + 4, 65 - 3, 4, 0, Math.PI * 2);
                    ctx.fillStyle = trackColor; ctx.fill();
                    ctx.shadowBlur = 8; ctx.shadowColor = trackColor;
                    ctx.font = `bold 12px Rajdhani, monospace`;
                    ctx.fillText(` ${trackMode}`, textX + 10, 65);
                    ctx.shadowBlur = 0; 
                }
                
                ctx.font = `bold 11px Rajdhani, monospace`; 
                if (linkActive && isAutoTrack) {
                    const mkX = peakX; const mkY = baseY - (1.0 * (baseY - peakY)); 
                    ctx.beginPath(); ctx.moveTo(mkX, mkY - 6); ctx.lineTo(mkX + 5, mkY - 11); ctx.lineTo(mkX - 5, mkY - 11); ctx.closePath(); 
                    ctx.fillStyle = isXBand ? '#ffcc00' : '#00eaff'; ctx.fill();
                    
                    ctx.textAlign = 'right'; ctx.font = `bold 13px Rajdhani, monospace`;
                    ctx.fillText(`MKR ${cf_base.toFixed(1)} MHz`, graphW - 15, 20);
                    ctx.fillStyle = '#ffffff'; 
                    ctx.fillText(`${(refLevel - 5).toFixed(2)} dBm`, graphW - 15, 35);
                }

                ctx.fillStyle = '#e2e8f0'; ctx.textAlign = 'left'; ctx.font = `bold 11px Rajdhani, monospace`;
                ctx.fillText(`CENTER ${cf_base.toFixed(1)} MHz`, textX, h - 15);
                ctx.fillText(`#RES BW 3.0 MHz`, textX, h - 4);
                ctx.textAlign = 'right';
                ctx.fillText(`SPAN ${span >= 1000 ? (span/1000).toFixed(3) + ' GHz' : span.toFixed(1) + ' MHz'}`, graphW - 15, h - 15);
                ctx.fillText(`SWP 50.0 msec`, graphW - 15, h - 4);
                ctx.textAlign = 'center'; ctx.fillText(`#VBW 10 kHz`, graphW/2, h - 4);
              };

              // สั่งวาดแกน X และ S
              const xCanvas = xBandCanvasRef.current;
              if (xCanvas && showXBand) {
                const xParent = xCanvas.parentElement;
                xCanvas.width = xParent.clientWidth; xCanvas.height = xParent.clientHeight;
                drawSpectrumCorrectly(xCanvas, xCanvas.width, xCanvas.height, true);
              }
              const sCanvas = sBandCanvasRef.current;
              if (sCanvas && showSBand) {
                const sParent = sCanvas.parentElement;
                sCanvas.width = sParent.clientWidth; sCanvas.height = sParent.clientHeight;
                drawSpectrumCorrectly(sCanvas, sCanvas.width, sCanvas.height, false);
              }

              // ----------------------------------------------------
              // ฟังก์ชันวาด Baseband Constellation (ฟันธง: BPSK ออก 2 จุดเป๊ะๆ)
              // ----------------------------------------------------
              const iqCanvas = iqCanvasRef.current;
              let activeMods = [];
              if (iqCanvas) {
                const iParent = iqCanvas.parentElement;
                const iW = iqCanvas.width = iParent.clientWidth; const iH = iqCanvas.height = iParent.clientHeight;
                const iqCtx = iqCanvas.getContext('2d');
                
                iqCtx.fillStyle = '#0b1121'; iqCtx.fillRect(0, 0, iW, iH);
                const centerX = iW / 2; const centerY = iH / 2; const radius = Math.min(iW, iH) * 0.35;

                iqCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; iqCtx.lineWidth = 1;
                iqCtx.beginPath(); iqCtx.moveTo(centerX, 0); iqCtx.lineTo(centerX, iH); iqCtx.stroke();
                iqCtx.beginPath(); iqCtx.moveTo(0, centerY); iqCtx.lineTo(iW, centerY); iqCtx.stroke();
                
                iqCtx.strokeStyle = 'rgba(255, 204, 0, 0.3)'; iqCtx.setLineDash([4, 4]); 
                iqCtx.beginPath(); iqCtx.arc(centerX, centerY, radius, 0, 2*Math.PI); iqCtx.stroke(); iqCtx.setLineDash([]); 

                let lockQ = 0;
                if (isAutoTrack) lockQ = 1.0;
                else if (isProgramTrack) lockQ = 0.1 + (Math.random() * 0.3); // ถ้ายัง Acquiring กลุ่มดาวจะกระจัดกระจาย

                const drawPoints = (modType, color) => {
                    let angles = [];
                    // 📍 ฟันธง: บังคับ BPSK ให้อยู่แกน X แนวนอน (0 องศา และ 180 องศา) เท่านั้น!
                    if (modType === 'BPSK') {
                        angles = [0, Math.PI]; 
                    } else {
                        angles = [Math.PI/4, 3*Math.PI/4, 5*Math.PI/4, 7*Math.PI/4]; 
                    }
                    
                    const numPts = modType === 'BPSK' ? 120 : 240; 
                    iqCtx.fillStyle = color; // ล็อกสีให้ตรงกับแชนแนล
                    
                    for(let i=0; i<numPts; i++) {
                        const isLockedPoint = Math.random() < lockQ;
                        if (isLockedPoint) {
                            const angle = angles[i % angles.length];
                            const tx = centerX + radius * Math.cos(angle);
                            const ty = centerY - radius * Math.sin(angle);
                            const jitter = modType === 'O-QPSK' ? 0.12 : 0.08;
                            
                            const u1 = Math.max(Math.random(), 0.0001); const u2 = Math.random();
                            const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
                            const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
                            
                            iqCtx.globalAlpha = Math.random() * 0.4 + 0.6;
                            iqCtx.fillRect(tx + z0*(radius*jitter*0.4) - 1.5, ty + z1*(radius*jitter*0.4) - 1.5, 3, 3);
                        } else {
                            const spread = radius * 1.35; 
                            iqCtx.globalAlpha = 1.0;
                            iqCtx.fillRect(centerX + (Math.random()-0.5)*2*spread, centerY + (Math.random()-0.5)*2*spread, 3, 3);
                        }
                    }
                    iqCtx.globalAlpha = 1.0;
                };

                // วาดกลุ่มดาวเฉพาะแชนแนลที่เปิดอยู่
                if (showXBand && !showSBand) { 
                    drawPoints(spec.xBand.mod, '#ffcc00'); // X-Band สีทอง
                    activeMods.push(`CH1: ${spec.xBand.mod}`); 
                } else if (showSBand && !showXBand) { 
                    drawPoints(spec.sBand.mod, '#00eaff'); // S-Band สีฟ้า
                    activeMods.push(`CH2: ${spec.sBand.mod}`); 
                } else if (showXBand && showSBand) {
                    drawPoints(spec.xBand.mod, '#ffcc00'); 
                    drawPoints(spec.sBand.mod, '#00eaff');
                    activeMods.push(`CH1: ${spec.xBand.mod} | CH2: ${spec.sBand.mod}`);
                }
              }

              return (
                <>
                  {/* ซ้าย: IQ Constellation */}
                  <div style={{ flex: '0 0 32%', display: 'flex', flexDirection: 'column', background: '#0b1121', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '15px' }}>
                    <div style={{ textAlign: 'center', fontFamily: 'Orbitron', fontSize: '14px', color: '#a0aec0', marginBottom: '15px', letterSpacing: '2px', fontWeight: 'bold' }}>BASEBAND CONSTELLATION</div>
                    <div style={{ flex: 1, position: 'relative', width: '100%', minHeight: 0 }}>
                      <canvas ref={iqCanvasRef} style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: '15px', fontSize: '15px', color: '#a0aec0', fontWeight: 'bold', fontFamily: 'Orbitron' }}>
                      MODULATION: <strong style={{color:'#fff'}}>{activeMods.length > 0 ? activeMods.join(' | ') : 'NONE'}</strong>
                    </div>
                  </div>

                  {/* ขวา: Dual Spectrum */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', minHeight: 0 }}>
                    {/* CH1: X-Band */}
                    {showXBand && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0b1121', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '10px 15px', minHeight: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Orbitron', fontSize: '13px', color: '#a0aec0', marginBottom: '8px', fontWeight: 'bold' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                            <span>CH1: X-BAND PAYLOAD (BW: {spec.xBand.bw} MHz)</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '2px 10px', borderRadius: '4px' }}>
                              <span style={{ fontSize: '11px', color: '#ffcc00' }}>SPAN</span>
                              <input type="range" min="50" max="1000" step="10" value={xBandSpan} onChange={(e) => setXBandSpan(Number(e.target.value))} className="sci-fi-slider" style={{ width: '120px', margin: 0, height: '6px', '--thumb-color': '#ffcc00', '--thumb-glow': 'rgba(255,204,0,0.8)' }} />
                            </div>
                          </div>
                          <span style={{ color: lockStatusColor, letterSpacing: '1px' }}>{lockStatusText}</span>
                        </div>
                        <div style={{ flex: 1, position: 'relative', width: '100%', border: '1px solid rgba(255,255,255,0.05)', minHeight: 0 }}>
                          <canvas ref={xBandCanvasRef} style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
                        </div>
                      </div>
                    )}

                    {/* CH2: S-Band */}
                    {showSBand && (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0b1121', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '10px 15px', minHeight: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Orbitron', fontSize: '13px', color: '#a0aec0', marginBottom: '8px', fontWeight: 'bold' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                            <span>CH2: S-BAND TELEMETRY (BW: {spec.sBand.bw} MHz)</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '2px 10px', borderRadius: '4px' }}>
                              <span style={{ fontSize: '11px', color: '#00eaff' }}>SPAN</span>
                              <input type="range" min="0.5" max="50" step="0.5" value={sBandSpan} onChange={(e) => setSBandSpan(Number(e.target.value))} className="sci-fi-slider" style={{ width: '120px', margin: 0, height: '6px', '--thumb-color': '#00eaff', '--thumb-glow': 'rgba(0,234,255,0.8)' }} />
                            </div>
                          </div>
                          <span style={{ color: lockStatusColor, letterSpacing: '1px' }}>{lockStatusText}</span>
                        </div>
                        <div style={{ flex: 1, position: 'relative', width: '100%', border: '1px solid rgba(255,255,255,0.05)', minHeight: 0 }}>
                          <canvas ref={sBandCanvasRef} style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

{/* --- TRACKING ANGLES (MODERN TACTICAL DATRON) --- */}
{isAnglesOpen && (
        <div className="modal-box angles-modal" onMouseDownCapture={() => bringToFront('angles')} style={{
          position: 'fixed', top: maximizedWins.angles ? '0px' : `${anglesPos.y}px`, left: maximizedWins.angles ? '0px' : `${anglesPos.x}px`,
          
          /* 📍 ฟันธง: ลดขนาดเริ่มต้นลงเป็น 780x520 px และลดขนาดต่ำสุดเป็น 600x450 px */
          width: maximizedWins.angles ? '100vw' : '780px', height: maximizedWins.angles ? '100vh' : '520px',
          minWidth: '600px', minHeight: '450px', resize: maximizedWins.angles ? 'none' : 'both', overflow: 'hidden',
          
          background: 'linear-gradient(145deg, rgba(10, 15, 25, 0.95) 0%, rgba(5, 10, 15, 0.98) 100%)', 
          border: maximizedWins.angles ? 'none' : '2px solid var(--cyan)', 
          borderRadius: maximizedWins.angles ? '0px' : '8px', 
          boxShadow: '0 0 40px rgba(0, 234, 255, 0.3), inset 0 0 15px rgba(0, 234, 255, 0.1)',
          display: 'flex', flexDirection: 'column', zIndex: windowZ.angles || 10002, 
          transition: isDraggingAngles ? 'none' : 'all 0.1s ease-out'
        }}>
          
          <style>{`
            .hide-scroll-angles::-webkit-scrollbar { display: none; }
            .hide-scroll-angles { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>

          {/* Header */}
          <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 25px', cursor: maximizedWins.angles ? 'default' : (isDraggingAngles ? 'grabbing' : 'grab'), background: 'linear-gradient(90deg, rgba(0, 234, 255, 0.15), rgba(0, 234, 255, 0.05))', borderBottom: '1px solid rgba(0, 234, 255, 0.4)', zIndex: 10 }} onMouseDown={(e) => { if(!maximizedWins.angles) handleAnglesMouseDown(e); }}>
            
            {/* 📍 หัวข้อฝั่งซ้าย */}
            <div style={{ flex: '1 1 0%', minWidth: 0, display: 'flex', alignItems: 'center', color: '#fff', fontFamily: 'Orbitron, sans-serif', fontWeight: 'bold', fontSize: '20px', letterSpacing: '2px', textShadow: '0 0 10px var(--cyan)', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <span style={{ marginRight: '10px' }}>📐</span> POINTING ANGLES
            </div>
            
            {/* 📍 ป้าย THEOS-2 กึ่งกลาง */}
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 234, 255, 0.1)', border: '1px solid var(--cyan)', padding: '8px 25px', borderRadius: '6px', boxShadow: 'inset 0 0 15px rgba(0,234,255,0.2), 0 0 15px rgba(0,234,255,0.2)' }}>
                {targetConfig.flag && <img src={`https://flagcdn.com/w40/${targetConfig.flag}.png`} style={{ width: '30px', borderRadius: '4px', marginRight: '15px', boxShadow: '0 0 10px rgba(255,255,255,0.4)' }} alt="flag" />}
                <span style={{ color: '#fff', fontSize: '22px', fontWeight: '900', fontFamily: 'Orbitron', letterSpacing: '2px', textShadow: '0 0 15px var(--cyan)' }}>{targetConfig.displayName}</span>
              </div>
            </div>

            {/* 📍 ปุ่มขยาย/ปิด ฝั่งขวา */}
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexShrink: 0 }}>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '18px', borderColor: 'var(--cyan)', color: 'var(--cyan)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => toggleMaximize('angles')}>{maximizedWins.angles ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '20px', borderColor: 'var(--red)', color: 'var(--red)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => setIsAnglesOpen(false)}>✕</button>
            </div>
          </div>

          {/* Body & Logic */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px', overflow: 'hidden' }}>
            
            {(() => {
              if (!targetSatrec || passSchedule.length === 0) return <div style={{ color: 'var(--red)', textAlign: 'center', marginTop: '50px', fontSize: '20px', fontFamily: 'Orbitron', textShadow: '0 0 10px var(--red)' }}>NO PASS SCHEDULE AVAILABLE</div>;
              
              let targetPass = passSchedule.find(p => p.losTime > simulatedTimeMs);
              if (!targetPass) targetPass = passSchedule[passSchedule.length - 1]; 

              const getSunPos = (timestamp) => {
                  const d = new Date(timestamp);
                  const tDays = (d.getTime() / 86400000) + 2440587.5 - 2451545.0;
                  const L = (280.460 + 0.9856474 * tDays) % 360;
                  const g = (357.528 + 0.9856003 * tDays) % 360;
                  const lambda = L + 1.915 * Math.sin(g*Math.PI/180) + 0.020 * Math.sin(2*g*Math.PI/180);
                  const eps = 23.439 - 0.0000004 * tDays;
                  const alpha = Math.atan2(Math.cos(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180), Math.cos(lambda*Math.PI/180)) * 180/Math.PI;
                  const delta = Math.asin(Math.sin(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180)) * 180/Math.PI;
                  
                  const gmst = (18.697374558 + 24.06570982441908 * tDays) % 24;
                  const lmst = (gmst * 15 + activeStation.lng) % 360;
                  const ha = (lmst - alpha + 360) % 360;
                  
                  const latRad = activeStation.lat * Math.PI/180;
                  const decRad = delta * Math.PI/180;
                  const haRad = ha * Math.PI/180;
                  
                  const sunElArg = Math.max(-1, Math.min(1, Math.sin(decRad)*Math.sin(latRad) + Math.cos(decRad)*Math.cos(latRad)*Math.cos(haRad)));
                  const sunElRad = Math.asin(sunElArg);
                  const sunEl = sunElRad * 180/Math.PI;
                  const azDen = Math.cos(sunElRad)*Math.cos(latRad);
                  const azCos = azDen === 0 ? 1 : Math.max(-1, Math.min(1, (Math.sin(decRad) - Math.sin(sunElRad)*Math.sin(latRad)) / azDen));
                  const sunAzRad = Math.acos(azCos);
                  let sunAz = sunAzRad * 180/Math.PI;
                  if (Math.sin(haRad) > 0) sunAz = 360 - sunAz;
                  return { el: sunEl, az: sunAz };
              };

              const stepMs = angleInterval * 1000;
              const rows = [];
              for (let t = targetPass.aosTime; t <= targetPass.losTime; t += stepMs) {
                 const pos = calculateSatData(new Date(t), targetSatrec, activeStation);
                 const sun = getSunPos(t);
                 rows.push({ time: new Date(t), satEl: pos ? Math.max(0, pos.elevationDeg) : 0, satAz: pos ? pos.azimuthDeg : 0, sunEl: sun.el, sunAz: sun.az });
              }

              const fmt3 = (num) => String(num.toFixed(3)).padStart(7, '0');
              const dStr = new Date(targetPass.aosTime).toISOString().substring(0, 10).toUpperCase();

              return (
                <>
                  {/* 📍 ฟันธง: รีดขนาดของกล่องแสดงข้อมูล AOS/LOS ให้เพรียวบางลง ลด gap และ marginBottom */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px', fontFamily: 'Orbitron' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', fontSize: '13px' }}>
                      <span style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 255, 255, 0.05)', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', color: '#fff', letterSpacing: '1px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <span style={{fontSize: '10px', color:'rgba(255,255,255,0.6)'}}>DATE</span>
                        <strong style={{ fontSize: '15px' }}>{dStr}</strong>
                      </span>
                      <span style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 204, 0, 0.1)', padding: '4px 8px', border: '1px solid var(--gold)', borderRadius: '4px', color: 'rgba(255,255,255,0.8)', letterSpacing: '1px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <span style={{fontSize: '10px', color:'rgba(255,255,255,0.6)'}}>ORBIT</span>
                        <strong style={{ color: 'var(--gold)', fontSize: '15px', textShadow: '0 0 8px var(--gold)' }}>{tles[selectedCatnr]?.line2.substring(63, 68).trim() || 'N/A'}</strong>
                      </span>
                      <span style={{ flex: 1, textAlign: 'center', background: 'rgba(0, 255, 102, 0.1)', padding: '4px 8px', border: '1px solid var(--green)', borderRadius: '4px', color: 'rgba(255,255,255,0.8)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <span style={{fontSize: '10px', color:'rgba(255,255,255,0.6)'}}>AOS</span>
                        <strong style={{ color: 'var(--green)', fontSize: '15px' }}>{new Date(targetPass.aosTime).toISOString().substring(11, 19)}</strong>
                      </span>
                      <span style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 204, 0, 0.1)', padding: '4px 8px', border: '1px solid var(--gold)', borderRadius: '4px', color: 'rgba(255,255,255,0.8)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <span style={{fontSize: '10px', color:'rgba(255,255,255,0.6)'}}>PCA</span>
                        <strong style={{ color: 'var(--gold)', fontSize: '15px' }}>{new Date(targetPass.peakTime).toISOString().substring(11, 19)}</strong>
                      </span>
                      <span style={{ flex: 1, textAlign: 'center', background: 'rgba(255, 51, 51, 0.1)', padding: '4px 8px', border: '1px solid var(--red)', borderRadius: '4px', color: 'rgba(255,255,255,0.8)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <span style={{fontSize: '10px', color:'rgba(255,255,255,0.6)'}}>LOS</span>
                        <strong style={{ color: 'var(--red)', fontSize: '15px' }}>{new Date(targetPass.losTime).toISOString().substring(11, 19)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* 📍 ฟันธง: รีดขนาดของแถบ INTERVAL SETTING ให้แคบลง (ลด padding, margin และไซส์ฟอนต์) */}
                  <div style={{ background: 'rgba(0, 0, 0, 0.5)', border: '1px solid rgba(0, 234, 255, 0.3)', padding: '6px 15px', borderRadius: '6px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontFamily: 'Orbitron', fontSize: '13px', color: 'var(--cyan)', fontWeight: 'bold' }}>INTERVAL SETTING:</span>
                    <input type="range" min="1" max="60" value={angleInterval} onChange={(e) => setAngleInterval(Number(e.target.value))} className="sci-fi-slider" style={{ flex: 1, height: '6px', '--thumb-color': 'var(--cyan)', '--thumb-glow': 'rgba(0,234,255,0.8)' }} />
                    <span style={{ background: 'rgba(0, 234, 255, 0.1)', padding: '4px 15px', border: '1px solid var(--cyan)', borderRadius: '4px', fontFamily: 'Rajdhani', fontSize: '18px', fontWeight: 'bold', color: '#fff', textShadow: '0 0 10px var(--cyan)', minWidth: '80px', textAlign: 'center' }}>{angleInterval} <span style={{fontSize:'12px', color:'rgba(255,255,255,0.6)'}}>SEC</span></span>
                  </div>

                  <div className="hide-scroll-angles" style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', borderRadius: '6px', border: '2px solid var(--cyan)', boxShadow: '0 0 15px rgba(0, 234, 255, 0.2)' }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'monospace', fontSize: '15px', color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                      <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                        <tr style={{ background: '#0b1121', color: '#e2e8f0', fontFamily: 'Orbitron', fontSize: '14px', letterSpacing: '1px' }}>
                          <th style={{ borderBottom: '1px solid var(--cyan)', padding: '12px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)' }} rowSpan={2}>TIME (UTC)</th>
                          <th style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '12px', textAlign: 'center', color: 'var(--cyan)', borderRight: '1px solid rgba(255,255,255,0.1)' }} colSpan={2}>PREDICTED SATELLITE</th>
                          <th style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '12px', textAlign: 'center', color: 'var(--gold)' }} colSpan={2}>SUN POSITION</th>
                        </tr>
                        <tr style={{ background: '#0f172a', color: '#94a3b8', fontFamily: 'Orbitron', fontSize: '13px' }}>
                          <th style={{ borderBottom: '2px solid var(--cyan)', padding: '10px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)' }}>ELEVATION</th>
                          <th style={{ borderBottom: '2px solid var(--cyan)', padding: '10px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)' }}>AZIMUTH</th>
                          <th style={{ borderBottom: '2px solid var(--gold)', padding: '10px', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)' }}>ELEVATION</th>
                          <th style={{ borderBottom: '2px solid var(--gold)', padding: '10px', textAlign: 'center' }}>AZIMUTH</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} style={{ backgroundColor: i % 2 === 0 ? '#ffffff' : '#f1f5f9', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e0f2fe'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = i % 2 === 0 ? '#ffffff' : '#f1f5f9'}>
                            <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px dashed #cbd5e1', padding: '12px', textAlign: 'center', fontWeight: 'bold' }}>{r.time.toISOString().substring(11, 23)}</td>
                            <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px dashed #cbd5e1', padding: '12px', textAlign: 'center', color: '#0369a1', fontWeight: 'bold' }}>{fmt3(r.satEl)}</td>
                            <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #94a3b8', padding: '12px', textAlign: 'center', color: '#0369a1', fontWeight: 'bold' }}>{fmt3(r.satAz)}</td>
                            <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px dashed #cbd5e1', padding: '12px', textAlign: 'center', color: '#b45309' }}>{fmt3(r.sunEl)}</td>
                            <td style={{ borderBottom: '1px solid #e2e8f0', padding: '12px', textAlign: 'center', color: '#b45309' }}>{fmt3(r.sunAz)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

{/* ===================================================================== */}
{/* 📍 WOW Feature 1: SIGNAL FLOW DIAGRAM (MASTER BLUEPRINT & COMMENTS) */}
{/* ===================================================================== */}
{isDiagramOpen && (
  <div className="modal-box diagram-modal" onMouseDownCapture={() => startTransition(() => bringToFront('diagram'))} style={{
    position: 'fixed', 
    top: maximizedWins?.diagram ? '0px' : `calc(50dvh - 325px + ${diagramPos.y - 150}px)`, 
    left: maximizedWins?.diagram ? '0px' : `calc(50vw - 550px + ${diagramPos.x - 200}px)`,
    width: maximizedWins?.diagram ? '100vw' : 'min(1050px, 95vw)', 
    height: maximizedWins?.diagram ? '100vh' : 'min(600px, 85vh)', 
    minWidth: 'min(950px, 90vw)', minHeight: 'min(500px, 80vh)',
    resize: maximizedWins?.diagram ? 'none' : 'both', 
    overflow: 'hidden',
    background: '#000 url("//unpkg.com/three-globe/example/img/night-sky.png")',
    backgroundSize: 'cover', backgroundPosition: 'center',
    border: maximizedWins?.diagram ? 'none' : `2px solid ${linkActive ? 'var(--green)' : 'var(--cyan)'}`, 
    borderRadius: maximizedWins?.diagram ? '0px' : '12px',
    boxShadow: `0 0 40px ${linkActive ? 'rgba(0,255,102,0.3)' : 'rgba(0,234,255,0.3)'}`,
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
        <div className={`status-badge-top ${linkActive ? 'active' : 'standby'}`} style={{ display: 'flex', alignItems: 'center', borderRadius: '20px', border: '2px solid', padding: '6px 20px', whiteSpace: 'nowrap', background: linkActive ? 'rgba(0,255,102,0.15)' : 'rgba(255,51,51,0.15)', borderColor: linkActive ? 'var(--green)' : 'var(--red)', boxShadow: linkActive ? '0 0 25px rgba(0,255,102,0.5), inset 0 0 15px rgba(0,255,102,0.3)' : '0 0 25px rgba(255,51,51,0.5), inset 0 0 15px rgba(255,51,51,0.3)' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: linkActive ? 'var(--green)' : 'var(--red)', marginRight: '10px', animation: linkActive ? 'pulse 1.5s infinite' : 'none', boxShadow: `0 0 12px ${linkActive ? 'var(--green)' : 'var(--red)'}` }}></div>
            <span style={{ fontFamily: 'Orbitron', fontWeight: '900', fontSize: '14px', color: linkActive ? 'var(--green)' : 'var(--red)', letterSpacing: '2px', textShadow: `0 0 10px ${linkActive ? 'var(--green)' : 'var(--red)'}` }}>
              {linkActive ? 'ACTIVE: DOWNLINK' : 'SYSTEM STANDBY'}
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
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="modal-close-btn" style={{ width: '38px', height: '38px', background: 'transparent', border: '1px solid var(--cyan)', color: 'var(--cyan)', cursor: 'pointer', borderRadius: '4px', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => toggleMaximize('diagram')}>{maximizedWins?.diagram ? '🗗' : '🗖'}</button>
          <button className="modal-close-btn" style={{ width: '38px', height: '38px', background: 'rgba(255,51,51,0.1)', border: '1px solid var(--red)', color: 'var(--red)', cursor: 'pointer', borderRadius: '4px', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsDiagramOpen(false)}>✕</button>
        </div>
      </div>
    </div>

    {/* 📍 ฟันธง: แก้ hidden เป็น visible ดาวเทียมจะทะลุขอบ 3D Pop-out ทันที! */}
    <div style={{ flex: 1, position: 'relative', overflow: 'visible' }}>
      
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
        
        return (
          <>


           {/* ========================================= */}
            {/* 🌟 เส้นสายไฟ และ คลื่นสัญญาณ (อัปเดตแกนสมมาตรใหม่ 8 - 38 - 46 - 54 - 62 - 92) */}
            {/* ========================================= */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
              
              {/* สายอวกาศ V-Shape (46 - 54) */}
              <line x1="50%" y1="8%" x2="46%" y2="55%" className={`p-line ${linkActive ? 'l-dual' : ''}`} stroke={linkActive ? 'none' : 'rgba(255,255,255,0.1)'} />
              <line x1="50%" y1="8%" x2="54%" y2="55%" className={`p-line ${linkActive ? 'l-pl' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,255,102,0.2)'} />

              {/* S-Band แนวนอน (8% -> 46%) */}
              <line x1="8%" y1="55%" x2="46%" y2="55%" className={`p-line ${linkActive ? 'l-tm' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,234,255,0.2)'} style={{ transform: 'translateY(-30px)' }} />
              <line x1="8%" y1="55%" x2="46%" y2="55%" className={`p-line ${linkActive ? 'l-tc' : ''}`} stroke={linkActive ? 'none' : 'rgba(255,204,0,0.2)'} style={{ transform: 'translateY(30px)' }} />

              {/* S-Band แนวตั้ง (8%) */}
              <line x1="8%" y1="55%" x2="8%" y2="85%" className={`p-line ${linkActive ? 'l-tm' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,234,255,0.2)'} style={{ transform: 'translateX(-30px)' }} />
              <line x1="8%" y1="85%" x2="8%" y2="55%" className={`p-line ${linkActive ? 'l-tc' : ''}`} stroke={linkActive ? 'none' : 'rgba(255,204,0,0.2)'} style={{ transform: 'translateX(30px)' }} />
              
              {/* S-Band แนวนอนล่าง (8% -> 38%) */}
              <line x1="8%" y1="85%" x2="38%" y2="85%" className={`p-line ${linkActive ? 'l-tm' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,234,255,0.2)'} />
              
              {/* X-Band (54% -> 92%) */}
              <line x1="54%" y1="55%" x2="92%" y2="55%" className={`p-line ${linkActive ? 'l-pl' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,255,102,0.2)'} />
              <line x1="92%" y1="55%" x2="92%" y2="85%" className={`p-line ${linkActive ? 'l-pl' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,255,102,0.2)'} />
              <line x1="92%" y1="85%" x2="62%" y2="85%" className={`p-line ${linkActive ? 'l-pl' : ''}`} stroke={linkActive ? 'none' : 'rgba(0,255,102,0.2)'} />

              {/* 🌟 HPA ขยับมาที่ 22% ให้สมมาตรพอดีกับเส้นที่ยาวขึ้น */}
              <g style={{ transform: 'translateY(30px)' }}>
                <svg x="22%" y="55%" style={{ overflow: 'visible' }}>
                  <g style={{ transform: 'scale(1.15)' }}>
                    <polygon points="-35,-20 -35,20 35,0" fill="#020617" stroke="var(--gold)" strokeWidth="3" />
                    <text x="-2" y="48" fill="var(--gold)" fontSize="0.8cqw" fontFamily="Orbitron" fontWeight="900" textAnchor="middle" style={{ letterSpacing: '1px' }}>HPA</text>
                  </g>
                </svg>
              </g>

              {linkActive && (
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
            {linkActive && (
              <>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--cyan)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '33%', top: 'calc(55% - 60px)', color: 'var(--cyan)', boxShadow: '0 0 10px rgba(0,234,255,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.tmFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>S-BAND TM (DOWN)</span>
                </div>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--gold)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(20, 10, 0, 0.85)', backdropFilter: 'blur(4px)', left: '33%', top: 'calc(55% + 60px)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.tcFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>S-BAND TC (UP)</span>
                </div>
                <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid var(--green)', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '73%', top: 'calc(55% - 33px)', color: 'var(--green)', boxShadow: '0 0 10px rgba(0,255,102,0.4)', transform: 'translate(-50%, -50%)' }}>
                  {satSpecs.xBandFreq}<br/><span style={{fontSize:'8px', color:'#fff'}}>X-BAND DOWNLINK</span>
                </div>

               {/* 📍 ป้าย IF 70 MHz (พลิกให้ผลักเข้ามาด้านขวาของเส้น 8% ไม่มีทางตกขอบซ้าย) */}
               <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid #FF6600', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(4px)', left: '10%', top: '70%', color: '#ffffff', boxShadow: '0 0 15px rgba(255,102,0,0.4)', transform: 'translate(15px, -50%)' }}>IF 70 MHz</div>

              {/* 📍 ป้าย IF 720 MHz (พลิกให้ผลักเข้ามาด้านซ้ายของเส้น 92% ไม่มีทางตกขอบขวา) */}
              <div style={{ position: 'absolute', pointerEvents: 'none', border: '2px solid #00aaff', borderRadius: '4px', padding: '6px 12px', fontFamily: '"Orbitron", sans-serif', fontSize: '11px', fontWeight: 900, textAlign: 'center', lineHeight: 1.2, letterSpacing: '1px', whiteSpace: 'nowrap', zIndex: 10005, background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(4px)', left: '92%', top: '70%', color: '#ffffff', boxShadow: '0 0 10px rgba(0,170,255,0.4)', transform: 'translate(calc(-100% - 15px), -50%)' }}>IF 720 MHz</div>
              </>
            )}

           {/* ========================================= */}
            {/* 🌟 6. SATELLITE IMAGE (ภาพดาวเทียม) */}
            {/* ========================================= */}
            <div style={{ position: 'absolute', left: '0', top: '-4%', width: '100%', zIndex: 20, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
              {selectedCatnr === '58016' ? (
                // 📍 ฟันธง: ใส่ onError ป้องกันภาพแตกตอนโหลดแอปครั้งแรก ถ้าโหลดไม่ทันให้ดึงรูป THEOS-2-1 มาค้ำไว้ก่อน
                <img key="signal-theos2" src={runtimeAsset('/textures/THEOS-2.webp')} onError={(e) => handleRuntimeImageError(e, runtimeAsset('/textures/THEOS-2-1.webp'))} className={linkActive ? 'anim-wobble' : ''} alt="THEOS-2" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : selectedCatnr === '33396' ? (
                <img key="signal-theos1" src={runtimeAsset('/textures/THEOS.webp')} onError={(e) => handleRuntimeImageError(e, runtimeAsset('/textures/THEOS-2-1.webp'))} className={linkActive ? 'anim-wobble' : ''} alt="THEOS" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : (
                <img key={`signal-${selectedCatnr}`} src={runtimeAsset('/textures/THEOS-2-1.webp')} onError={(e) => handleRuntimeImageError(e, null)} className={linkActive ? 'anim-wobble' : ''} alt="Satellite" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              )}
            </div>
            {/* ========================================= */}
            {/* 🌟 7. HARDWARE BOXES (กล่องอุปกรณ์ภาคพื้นดิน) */}
            {/* ========================================= */}

            {/* 📍 7.1 โหนดซ้าย (UP/DOWN) ขยับซ้ายสุดที่ 8% */}
            <div className={`flow-node ${linkActive ? 'active' : ''}`} style={{ left: '8%', top: '55%', zIndex: 20 }}>
              <img src="https://api.iconify.design/mdi:swap-vertical-bold.svg?color=%2300eaff" className="n-icon" alt="Converter" />
              <div className="n-title">UP/DOWN</div>
              <div className="n-sub">S-BAND CONVERTER</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ top: 'calc(50% - 30px)', left: '100%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ top: 'calc(50% + 30px)', left: '100%', background: 'var(--gold)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% - 30px)', top: '100%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% + 30px)', top: '100%', background: 'var(--gold)' }}></div>
              </>)}
            </div>

            {/* 📍 7.2 โหนดเสาอากาศ (SRC ซ้าย) ขยับที่ 46% */}
            <div className={`flow-node ${linkActive ? 'active' : ''}`} style={{ left: '46%', top: '55%', zIndex: 20 }}>
              <img src="https://api.iconify.design/mdi:satellite-uplink.svg?color=%2300eaff" className="n-icon" alt="Antenna" />
              <div className="n-title">{activeStation.id}</div>
              <div className="n-sub">S-BAND ANTENNA</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ top: 'calc(50% - 30px)', left: '0%' }}></div>
                <div className="conn-dot" style={{ top: 'calc(50% + 30px)', left: '0%', background: 'var(--gold)' }}></div>
              </>)}
            </div>

            {/* 📍 7.3 โหนดเสาอากาศ (SRC ขวา) ขยับที่ 54% */}
            <div className={`flow-node ${linkActive ? 'active' : ''}`} style={{ left: '54%', top: '55%', zIndex: 20, borderColor: linkActive ? 'var(--green)' : '' }}>
              <img src="https://api.iconify.design/mdi:satellite-uplink.svg?color=%2300ff66" className="n-icon" alt="Antenna" />
              <div className="n-title">{activeStation.id}</div>
              <div className="n-sub">X-BAND ANTENNA</div>
              {linkActive && (<div className="conn-dot" style={{ top: '50%', left: '100%' }}></div>)}
            </div>

            {/* 📍 7.4 โหนดขวา (DOWNCONVERTER) ขยับขวาสุดที่ 92% */}
            <div className="flow-node" style={{ left: '92%', top: '55%', zIndex: 20, borderColor: linkActive ? '#00aaff' : '' }}>
              <img src="https://api.iconify.design/mdi:radio-tower.svg?color=%2300aaff" className="n-icon" alt="Tuner" />
              <div className="n-title" style={{ color: linkActive ? '#00aaff' : '#fff' }}>X-BAND</div>
              <div className="n-sub">DOWNCONVERTER</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ top: '50%', left: '0%' }}></div>
                <div className="conn-dot" style={{ top: '100%', left: '50%' }}></div>
              </>)}
            </div>

            {/* 📍 7.5 โหนด TT&C (กล่องเล็กมุมซ้ายล่าง 8%) */}
            <div className="flow-node" style={{ left: '8%', top: '85%', zIndex: 20, borderColor: linkActive ? 'var(--gold)' : '' }}>
              <img src="https://api.iconify.design/mdi:router-wireless.svg?color=%23ffcc00" className="n-icon" alt="TTC" />
              <div className="n-title" style={{ color: linkActive ? 'var(--gold)' : '#fff' }}>TT&C</div>
              <div className="n-sub">BASEBAND SYSTEM</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ left: 'calc(50% - 30px)', top: '0%', background: 'var(--cyan)' }}></div>
                <div className="conn-dot" style={{ left: 'calc(50% + 30px)', top: '0%', background: 'var(--gold)' }}></div>
                <div className="conn-dot" style={{ left: '100%', top: '50%', background: 'var(--cyan)' }}></div>
              </>)}
            </div>

            {/* 📍 7.6 โหนด BASEBAND (กล่องเล็กมุมขวาล่าง 92%) */}
            <div className="flow-node" style={{ left: '92%', top: '85%', zIndex: 20, borderColor: linkActive ? 'var(--red)' : '' }}>
              <img src="https://api.iconify.design/mdi:server-network.svg?color=%23ff3333" className="n-icon" alt="Baseband" />
              <div className="n-title" style={{ color: linkActive ? 'var(--red)' : '#fff' }}>BASEBAND</div>
              <div className="n-sub">DEMODULATOR</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ top: '0%', left: '50%' }}></div>
                <div className="conn-dot" style={{ top: '50%', left: '0%' }}></div>
              </>)}
            </div>

            {/* ========================================= */}
            {/* 🌟 8. HUD BOXES (กล่องกราฟิกจอวิเคราะห์สัญญาณ) */}
            {/* ========================================= */}
            
            {/* 📍 8.1 กล่องจอวิเคราะห์ TT&C (ขยับเข้า 38%) */}
            <div className={`flow-node ${linkActive ? 'active' : ''}`} 
                 style={{ left: '38%', top: '85%', zIndex: 20, width: '18cqw', height: '8.5cqw', padding: '8px', borderColor: linkActive ? 'var(--gold)' : 'rgba(255,204,0,0.3)', background: '#020617', flexDirection: 'column', gap: '6px', cursor: 'pointer', boxShadow: linkActive ? '0 0 30px rgba(255,204,0,0.4), inset 0 0 15px rgba(255,204,0,0.2)' : '' }} 
                 onClick={() => { setIsAnalyzerOpen(true); bringToFront('analyzer'); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                <span style={{ color: '#fff', fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '1px' }}>
                  <span style={{ color: linkActive ? 'var(--gold)' : 'var(--red)', textShadow: linkActive ? '0 0 8px var(--gold)' : 'none', animation: linkActive ? 'pulse 1s infinite' : 'none' }}>●</span> TT&C
                </span>
                <span style={{ color: '#000', background: linkActive ? 'var(--cyan)' : 'rgba(255,255,255,0.3)', fontSize: '9px', fontFamily: 'Rajdhani', fontWeight: '900', padding: '2px 6px', borderRadius: '2px', boxShadow: linkActive ? '0 0 8px var(--cyan)' : 'none' }}>70 MHz IF</span>
              </div>
              <div style={{ display: 'flex', width: '100%', flex: 1, gap: '6px', minHeight: 0 }}>
                <div style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', width: '65%', height: '65%', transform: 'translate(-50%, -50%)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '50%' }}></div>
                  {linkActive && ['50%'].map((cy, i) => ['20%', '80%'].map((cx, j) => (
                    <div key={`bpsk-${i}-${j}`} style={{ position: 'absolute', top: cy, left: cx, transform: 'translate(-50%, -50%)' }}>
                      <div style={{ width: '3px', height: '3px', background: 'var(--cyan)', borderRadius: '50%', boxShadow: '0 0 5px var(--cyan)', position: 'absolute', top: '-1.5px', left: '-1.5px', zIndex: 2 }}></div>
                      <div style={{ width: '10px', height: '10px', background: 'rgba(0,234,255,0.6)', position: 'absolute', top: '-5px', left: '-5px', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', animation: `pulse ${0.15 + ((i + j) * 0.05)}s infinite alternate` }}></div>
                    </div>
                  )))}
                </div>
                <div style={{ flex: 1, background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '10% 20%' }}></div>
                  <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '90%', overflow: 'visible' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                    {linkActive ? (
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
            <div className={`flow-node ${linkActive ? 'active' : ''}`} 
                 style={{ left: '62%', top: '85%', zIndex: 20, width: '18cqw', height: '8.5cqw', padding: '8px', borderColor: linkActive ? 'var(--green)' : 'rgba(0,234,255,0.3)', background: '#020617', flexDirection: 'column', gap: '6px', cursor: 'pointer', boxShadow: linkActive ? '0 0 30px rgba(0,255,102,0.4), inset 0 0 15px rgba(0,255,102,0.2)' : '' }} 
                 onClick={() => { setIsAnalyzerOpen(true); bringToFront('analyzer'); }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '4px' }}>
                <span style={{ color: '#fff', fontSize: '11px', fontFamily: 'Orbitron', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px', letterSpacing: '1px' }}>
                  <span style={{ color: linkActive ? 'var(--green)' : 'var(--red)', textShadow: linkActive ? '0 0 8px var(--green)' : 'none', animation: linkActive ? 'pulse 1s infinite' : 'none' }}>●</span> BASEBAND
                </span>
                <span style={{ color: '#000', background: linkActive ? 'var(--gold)' : 'rgba(255,255,255,0.3)', fontSize: '9px', fontFamily: 'Rajdhani', fontWeight: '900', padding: '2px 6px', borderRadius: '2px', boxShadow: linkActive ? '0 0 8px var(--gold)' : 'none' }}>720 MHz</span>
              </div>
              <div style={{ display: 'flex', width: '100%', flex: 1, gap: '6px', minHeight: 0 }}>
                <div style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.1)' }}></div>
                  <div style={{ position: 'absolute', top: '50%', left: '50%', width: '65%', height: '65%', transform: 'translate(-50%, -50%)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '50%' }}></div>
                  {linkActive && ['20%', '80%'].map((cy, i) => ['20%', '80%'].map((cx, j) => (
                    <div key={`c-${i}-${j}`} style={{ position: 'absolute', top: cy, left: cx, transform: 'translate(-50%, -50%)' }}>
                      <div style={{ width: '3px', height: '3px', background: 'var(--red)', borderRadius: '50%', boxShadow: '0 0 5px var(--red)', position: 'absolute', top: '-1.5px', left: '-1.5px', zIndex: 2 }}></div>
                      <div style={{ width: '10px', height: '10px', background: 'rgba(255,255,255,0.8)', position: 'absolute', top: '-5px', left: '-5px', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', animation: `pulse ${0.15 + ((i + j) * 0.05)}s infinite alternate` }}></div>
                    </div>
                  )))}
                </div>
                <div style={{ flex: 1, background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '10% 20%' }}></div>
                  <svg style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '90%', overflow: 'visible' }} preserveAspectRatio="none" viewBox="0 0 100 100">
                    {linkActive ? (
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
)}
    </>
  );
}

export default function App() {
  return (
    <SatOrbitErrorBoundary>
      <SatOrbitCore />
    </SatOrbitErrorBoundary>
  );
}
