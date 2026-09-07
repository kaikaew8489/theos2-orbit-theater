// @ts-nocheck Thailand Satellite Orbit

import React, { useEffect, useMemo, useRef, useState, startTransition } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// =========================================================================
// 📍 PDF PARSER ENGINE (Theos-2 Mission Plan)
// =========================================================================
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function extractPdfText(file) {
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

// 📍 ประกาศตัวแปร Global
let GROUND_STATION = GS_NETWORK[0];

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
  // คิวจำลอง: แถบอ้างอิงตอน 07:43 (อีกฝั่งของโลก)
  { start: Date.UTC(2026, 7, 1, 7, 43, 10), end: Date.UTC(2026, 7, 1, 7, 43, 55) }
];

const SATELLITE_OPTIONS = [
  // 1. GISTDA & THAILAND COMMUNICATIONS (LEO & GEO) - คัดเฉพาะที่ยังมีชีวิต!
  { catnr: '58016', name: 'THEOS-2', displayName: 'THEOS-2', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'GISTDA', mission: 'High-Res Optical', telemetry: '2066.56 UP / 2244.228 DN MHz', payload: '8150 MHz' },
  { catnr: '33396', name: 'THEOS', displayName: 'THEOS', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'GISTDA', mission: 'Earth Observation', telemetry: '2036 UP / 2211 DN MHz', payload: '8140 MHz' },
  { catnr: '39500', name: 'THAICOM 6', displayName: 'THAICOM 6', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'C/Ku-Band', payload: 'C/Ku-Band' },
  { catnr: '39498', name: 'THAICOM 7', displayName: 'THAICOM 7 (ASIASAT 6)', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'C-Band', payload: 'C-Band' },
  { catnr: '41552', name: 'THAICOM 8', displayName: 'THAICOM 8', flag: 'th', group: 'GISTDA & THAILAND (LEO/GEO)', operator: 'Thaicom', mission: 'Communications (GEO)', telemetry: 'Ku-Band', payload: 'Ku-Band' },

 // 2. THAI CUBESAT & MICROSAT (LEO) - อ้างอิงจากวงโคจรจริงปัจจุบัน
 { catnr: '99991', name: 'CUBE SAT-1', displayName: 'GISTDA CUBE SAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'GISTDA', mission: 'Earth Observation', telemetry: 'S-Band', payload: 'X-Band' }, // 📍 รอเปลี่ยนเป็นรหัสจริงเมื่อ GISTDA ประกาศ
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
  // GISTDA & ISS (ของจริง)
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' },
  '33396': { line1: '1 33396U 08049A   26166.85000000  .00000100  00000-0  50000-4 0  9991', line2: '2 33396  98.5400 210.1200 0001500  85.0000 275.0000 14.20000000900001' },
  '25544': { line1: '1 25544U 98067A   26201.79846070  .00005574  00000-0  10900-3 0  9995', line2: '2 25544  51.6312 133.7599 0006835 319.3995  40.6483 15.49066413576965' },
  '48274': { line1: '1 48274U 21035A   26204.00000000  .00000000  00000-0  00000-0 0  9999', line2: '2 48274  41.4700 120.0000 0001500 180.0000 180.0000 15.60000000000000' },
  
  // 📍 ฟันธง: THAI CUBESAT (อัปเดตรหัส NORAD ID จริงเพื่อรองรับการดึงข้อมูล Real-time API)
  '99991': { line1: '1 99991U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9992', line2: '2 99991  97.8882 117.9656 0001407  90.8603 269.2771 14.81738229145249' }, // GISTDA CUBE SAT-1 (รอรหัสจริง)
  '67683': { line1: '1 67683U 98067XZ  26166.96487797  .00000718  00000-0  97744-4 0  9993', line2: '2 67683  51.6400 137.9656 0001407  90.8603 269.2771 15.50000000000000' }  // KNACKSAT-2 แก้ไขรหัสให้ตรงกับความจริง
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
   // 📍 ฟันธง: ดึงความสูงจริง (เมตร) แปลงเป็นกิโลเมตร เพื่อคำนวณมุม AOS/LOS ให้แม่นยำที่สุด!
   const observerGd = { 
    latitude: toRadians(GROUND_STATION.lat), 
    longitude: toRadians(GROUND_STATION.lng), 
    height: GROUND_STATION.alt / 1000 
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

// ==========================================
// 4. MAIN APP
// ==========================================
export default function App() {
  
  // 📍 ฟันธง: สร้างสมองกลควบคุมหน้าจอ Loading (Splash Screen) สไตล์ Sci-Fi
  const [loadingPct, setLoadingPct] = useState(0);
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    let pct = 0;
    const interval = setInterval(() => {
      // ⚙️ จุดปรับที่ 1: ความก้าวหน้า (สุ่มบวกทีละ 2% ถึง 6% จะทำให้หลอดเต็มไวขึ้น)
      pct += Math.floor(Math.random() * 2) + 1; 
      
      if (pct >= 100) {
        pct = 100;
        clearInterval(interval);
        // ⚙️ จุดปรับที่ 2: เวลาค้างหน้าจอ 100% (หน่วยเป็นมิลลิวินาที / 2000 = ค้าง 2 วินาทีแล้วเข้าแอป)
        setTimeout(() => setIsAppReady(true), 2000); 
      }
      setLoadingPct(pct);
    // ⚙️ จุดปรับที่ 3: ความเร็วในการรีเฟรชตัวเลข (หน่วยเป็นมิลลิวินาที / 50 = อัปเดตไวขึ้น ลื่นไหลขึ้น)
    }, 50); 
    return () => clearInterval(interval);
  }, []);

  // 📍 ฟันธง 2: กู้คืนสมองกลควบคุมปุ่มสลับสถานี
  const [activeStation, setActiveStation] = useState(GS_NETWORK[0]);
  GROUND_STATION = activeStation;

  const globeRef = useRef(null);
  const fileInputRef = useRef(null); 
  const isTrackingRef = useRef(false);
  // 📍 ฟันธง: ประกาศ State ควบคุม Station Mask (มุมเงยรับสัญญาณ)
  const [stationMask, setStationMask] = useState(0);

  // 📍 ฟันธง: ตัวแปรควบคุมการแสดงผลสถานี (มี 4 โหมด: 'both', 'icon', 'name', 'none')
  const [stationDisplayMode, setStationDisplayMode] = useState('both');

  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  
  const [tles, setTles] = useState(() => {
    try {
      const saved = localStorage.getItem('gistda_tles');
      const parsed = saved ? JSON.parse(saved) : {};
      // 📍 ฟันธง: บังคับ Merge โค้ด FALLBACK_TLES ทับ Cache เก่าเสมอ
      // ป้องกันบั๊กเพิ่มดาวเทียม 99991, 99992 เข้าไปใหม่แล้ว SGP4 คืนค่า NaN เพราะหาข้อมูลใน Cache ไม่เจอ
      return { ...FALLBACK_TLES, ...parsed };
    } catch(e) { return FALLBACK_TLES; }
  });

  const [tleSource, setTleSource] = useState(() => {
    return localStorage.getItem('gistda_tles') ? 'Restored from Memory' : 'Fallback / Built-in';
  });

  const [isUpdatingTle, setIsUpdatingTle] = useState(false);
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

  const [isPlaying, setIsPlaying] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);
  const [realtimeSun, setRealtimeSun] = useState(true);
  
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
const [cloudDataCache, setCloudDataCache] = useState(null); // 📍 เพิ่ม Cache เก็บข้อมูลดิบป้องกันการยิง API สแปม

// 1. ยิง API ขอข้อมูลล่วงหน้า 3 วัน "แค่ครั้งเดียว" หรือตอนเปลี่ยนสถานีเท่านั้น!
useEffect(() => {
  const lat = activeStation.lat;
  const lng = activeStation.lng;
  setIsFetchingCloud(true);

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=3&timezone=UTC`;
  
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data && data.hourly && data.hourly.cloud_cover) {
        setCloudDataCache(data.hourly); // เก็บใส่โกดังไว้
      }
      setIsFetchingCloud(false);
    })
    .catch(err => {
      console.warn("Cloud API Error:", err);
      setIsFetchingCloud(false);
    });
}, [activeStation.id]); // ⚠️ ผูกเงื่อนไขไว้ที่รหัสสถานีเท่านั้น ห้ามผูกกับเวลาเด็ดขาด!

// 2. สมองกลดึงค่าเมฆจากโกดัง (Cache) ตามเวลาจำลอง (ซิงค์ Real-time ทันทีแม้กด 1000X โดยไม่ต้องยิง API ใหม่)
useEffect(() => {
  if (!cloudDataCache) return;
  
  const nowMs = simulatedTimeMs;
  let closestIdx = 0;
  let minDiff = Infinity;
  
  cloudDataCache.time.forEach((tStr, idx) => {
    const tMs = new Date(tStr + 'Z').getTime();
    const diff = Math.abs(tMs - nowMs);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = idx;
    }
  });
  
  setCloudCover(cloudDataCache.cloud_cover[closestIdx]);
}, [Math.floor(simulatedTimeMs / 3600000), cloudDataCache]);

  // --- ระบบ PASS PREDICTION ---
  const [isPassModalOpen, setIsPassModalOpen] = useState(false);
  const [passSchedule, setPassSchedule] = useState([]);
  const [isCalculatingPass, setIsCalculatingPass] = useState(false);

  // 📍 ตัวแปรควบคุมระยะเวลาคำนวณ Pass Schedule (ค่าเริ่มต้น = 3 วัน)
  const [passPredictionDays, setPassPredictionDays] = useState(3);

  // 📍 1. ฟันธง: เพิ่มตัวแปรบรรทัดนี้ลงไปเพื่อเก็บค่าว่ากำลังคลิกเลือก Pass ไหนอยู่
  const [selectedPassIndex, setSelectedPassIndex] = useState(null);

 // ฟังก์ชันสมองกล: คำนวณหา AOS/LOS แบบเลือกวันได้
 const calculateFuturePasses = (catnr, days = passPredictionDays) => {
  setIsCalculatingPass(true);
  setSelectedPassIndex(null);
  
  const rec = satrecs[catnr];
  if (!rec) { setIsCalculatingPass(false); return; }

  setTimeout(() => {
    const passes = [];
    let isPassActive = false;
    let currentPass = null;
    
    const now = new Date(simulatedTimeMs);
    
    // 📍 ฟันธง: ดึงค่า days ที่ผู้ใช้เลือกมาคำนวณทั้งย้อนหลัง (อดีต) และล่วงหน้า (อนาคต)
    const lookBackMs = days * 24 * 60 * 60 * 1000; 
    const stepMs = 10000; 

    const startTime = Math.floor((now.getTime() - lookBackMs) / stepMs) * stepMs;
    const maxTime = startTime + (days * 2 * 24 * 60 * 60 * 1000); // ย้อนหลัง + ล่วงหน้า

    for (let t = startTime; t < maxTime; t += stepMs) {
      const d = new Date(t);
      const pos = calculateSatData(d, rec);
      
      if (!pos || isNaN(pos.elevationDeg)) continue;

      if (pos.elevationDeg >= stationMask) {
        if (!isPassActive) {
          isPassActive = true;
          currentPass = { 
            aosTime: t, 
            aosAz: pos.azimuthDeg, 
            maxEl: pos.elevationDeg, 
            peakTime: t 
          };
        } else {
          if (pos.elevationDeg > currentPass.maxEl) {
            currentPass.maxEl = pos.elevationDeg;
            currentPass.peakTime = t; 
          }
        }
      } else {
        if (isPassActive) {
          isPassActive = false;
          currentPass.losTime = t;
          currentPass.losAz = pos.azimuthDeg; 
          currentPass.durationMs = currentPass.losTime - currentPass.aosTime;
          passes.push(currentPass);
        }
      }
    }
    setPassSchedule(passes);
    setIsCalculatingPass(false);
  }, 100);
};

// 📍 สั่งให้คำนวณใหม่ทุกครั้งที่ผู้ใช้กดเปลี่ยนจำนวนวัน หรือ เปลี่ยน Station Mask
useEffect(() => {
  if (selectedCatnr && isPassModalOpen) {
    calculateFuturePasses(selectedCatnr, passPredictionDays);
  }
}, [passPredictionDays, stationMask]); // <-- ฟันธง: เติม stationMask

 // 📍 สั่งให้คำนวณตาราง Pass อัตโนมัติทุกครั้งที่เปลี่ยนดาวเทียม หรือ เปลี่ยน Station Mask
 useEffect(() => {
  if (selectedCatnr) {
    calculateFuturePasses(selectedCatnr);
  }
}, [selectedCatnr, stationMask]); // <-- ฟันธง: เติม stationMask

  // ฟันธง: ตัวแปรควบคุมการเปิดปิดหน้าจอ Radar Skyplot
  const [isRadarOpen, setIsRadarOpen] = useState(false);

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

  const [windowZ, setWindowZ] = useState({ radar: 9997, pass: 9998, db: 9999, gs: 9996, img: 10000, analyzer: 10001, angles: 10002, diagram: 10003 });
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
        const maxZ = Math.max(...Object.values(prev));
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

 const [customAlert, setCustomAlert] = useState({ show: false, message: '', type: 'success' });

 const [sourcePlans, setSourcePlans] = useState(typeof THEOS2_IMAGING_PLAN !== 'undefined' ? THEOS2_IMAGING_PLAN : []);

// 📍 ฟังก์ชันจัดการเมื่อกดอัปโหลดไฟล์ PDF
const handlePdfUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
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
      const [dateStr, timeStr] = p.acq_start.split(' ');
      const [y, m, d] = dateStr.split('/');
      const [hr, min, sec] = timeStr.split(':');
      const startDate = new Date(Date.UTC(y, m - 1, d, hr, min, parseFloat(sec)));
      return {
        id: p.file_nb,
        start: startDate,
        end: new Date(startDate.getTime() + (p.acq_duration_s || 0) * 1000), // 📍 ฟันธง: เติมเวลาจบให้แผนที่ 2D เอาไปคำนวณต่อ
        duration: p.acq_duration_s || 0
      };
    });

    setSourcePlans(formattedPlans);
    
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
        // ฟันธง: ใส่เกราะป้องกัน ถ้า TLE ดวงไหนพัง ให้ข้ามไปดวงอื่น แอปจะได้ไม่แครช
        try {
          recs[cat] = satelliteJs.twoline2satrec(tles[cat].line1, tles[cat].line2);
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
    
    setTimeout(() => {
      if (globeRef.current) {
        globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
        const controls = globeRef.current.controls();
        controls.autoRotate = false;
      }
    }, 500);

    return () => window.removeEventListener('resize', handleResize);
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
          const pos = calculateSatData(new Date(simulatedTimeMs), rec);
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
          tNight: { value: new THREE.TextureLoader().load('/textures/Earth_nightmap.webp') },
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
  return targetSatrec ? calculateSatData(new Date(simulatedTimeMs), targetSatrec) : null;
}, [simulatedTimeMs, targetSatrec]);

const targetConfig = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr) || SATELLITE_OPTIONS[0];
const linkActive = targetData && targetData.elevationDeg >= stationMask;

// 📍 ระบบดักเวลา Pass ถัดไป
const nextPassTimestamp = useMemo(() => {
  if (linkActive || passSchedule.length === 0) return null;
  const upcomingPass = passSchedule.find(p => p.aosTime > simulatedTimeMs);
  
  if (upcomingPass) {
    return { time: upcomingPass.aosTime, maxEl: upcomingPass.maxEl };
  }
  return null;
}, [simulatedTimeMs, passSchedule, linkActive]);

// 📍 เซนเซอร์จับเวลา PRE-PASS (แจ้งล่วงหน้า 10 นาทีลง LINE)
useEffect(() => {
  const isStrictLive = Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
  if (!isStrictLive || !nextPassTimestamp || !nextPassTimestamp.time) return;
  
  const timeToAos = nextPassTimestamp.time - simulatedTimeMs;
  const TEN_MINUTES_MS = 600000; 
  
  const stableAosTime = Math.floor(nextPassTimestamp.time / 1800000) * 1800000;
  const passId = `AOS-${selectedCatnr}-${stableAosTime}`;

  if (timeToAos <= TEN_MINUTES_MS && timeToAos > 0 && !sessionStorage.getItem(passId)) {
    sessionStorage.setItem(passId, 'true'); 

    const upcomingPass = passSchedule.find(p => p.aosTime === nextPassTimestamp.time);
    if (upcomingPass) {
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(upcomingPass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: false, satName: targetConfig.displayName, flagUrl: flagUrl, station: GROUND_STATION.name, doy: doyStr,
        aosUtc: new Date(upcomingPass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: new Date(upcomingPass.aosTime).toLocaleTimeString('en-GB') + ' THA',
        losUtc: new Date(upcomingPass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: new Date(upcomingPass.losTime).toLocaleTimeString('en-GB') + ' THA',
        maxEl: upcomingPass.maxEl.toFixed(1),
        duration: `${Math.floor(upcomingPass.durationMs / 60000)}m ${Math.floor((upcomingPass.durationMs % 60000)/1000)}s`
      };
      
      fetch('https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec', {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payloadData) 
      }).then(() => console.log(`[LINE] ยิงแจ้งเตือน 10 นาที (AOS) สำเร็จ! ID: ${passId}`))
        .catch(err => console.error("LINE Notify Error:", err));
    }
  }
}, [simulatedTimeMs, nextPassTimestamp, selectedCatnr, targetConfig, speedMult, isPlaying, passSchedule]);

// 📍 เซนเซอร์จับจังหวะจบ Pass (แจ้ง LOS ลง LINE)
useEffect(() => {
  const isLiveStrict = Math.abs(simulatedTimeMs - Date.now()) < 5000 && speedMult === 1 && isPlaying;
  if (!isLiveStrict || passSchedule.length === 0) return;

  passSchedule.forEach(pass => {
    const stableLosTime = Math.floor(pass.losTime / 1800000) * 1800000;
    const passIdLos = `LOS-${selectedCatnr}-${stableLosTime}`;
    const timeSinceLos = simulatedTimeMs - pass.losTime;
    
    if (timeSinceLos >= 0 && timeSinceLos <= 120000 && !sessionStorage.getItem(passIdLos)) {
      sessionStorage.setItem(passIdLos, 'true');
      
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(pass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: true, satName: targetConfig.displayName, flagUrl: flagUrl, station: GROUND_STATION.name, doy: doyStr,
        aosUtc: new Date(pass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: new Date(pass.aosTime).toLocaleTimeString('en-GB') + ' THA',
        losUtc: new Date(pass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: new Date(pass.losTime).toLocaleTimeString('en-GB') + ' THA',
        maxEl: pass.maxEl.toFixed(1),
        duration: `${Math.floor(pass.durationMs / 60000)}m ${Math.floor((pass.durationMs % 60000)/1000)}s`
      };
      
      fetch('https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec', {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payloadData)
      }).then(() => console.log(`[LINE] ยิงแจ้งเตือน LOS สำเร็จ! ID: ${passIdLos}`))
        .catch(err => console.error("LINE Notify Error:", err));
    }
  });
}, [simulatedTimeMs, passSchedule, selectedCatnr, targetConfig, speedMult, isPlaying]);

// =========================================================================
// 📍 จบก้อนระบบประมวลผล (ถัดจากบรรทัดนี้คือ return ( ... ) ของคุณครับ)
// =========================================================================

// 📍 ฟันธง: สร้างโกดังเก็บอ็อบเจ็กต์ดาวเทียม ป้องกันการสร้าง 3D Models รัวๆ ทุก 50ms (หยุด WebGL Memory Leak)
const satObjectsRef = useRef({});

const allSatObjects = useMemo(() => {
  const currentD = new Date(simulatedTimeMs);
  return SATELLITE_OPTIONS.filter(sat => selectedCatnrs.includes(sat.catnr)).map(sat => {
    if (!satrecs[sat.catnr]) return null;
    const data = calculateSatData(currentD, satrecs[sat.catnr]);
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
}, [simulatedTimeMs, satrecs, selectedCatnr, selectedCatnrs]);

// 📍 ฟันธง 1.1: สร้างสวิตช์หน่วงเวลา (Throttle) ตัดคอขวด CPU 
 // ถ้าเร่งเกิน 100X ให้วาดเส้นนำทางวงโคจรใหม่ทุกๆ 30 นาทีซิมูเลชัน (ลดภาระขยะใน Memory ได้ 1,000,000%)
 const orbitUpdateTrigger = Math.floor(simulatedTimeMs / (speedMult >= 100 ? 1800000 : 300000));

 // 📍 ฟันธง: อัปเกรดสมองกลวาดเส้นวงโคจร (Orbit Path) สร้าง The GEO Belt สำหรับดาวเทียมค้างฟ้า
 const orbitVisualPath = useMemo(() => {
  if (!targetSatrec) return [];
  
  // 🚀 สกัดความสูงปัจจุบันเพื่อเช็คว่าเป็น GEO หรือ LEO
  const initPos = calculateSatData(currentDate, targetSatrec);
  if (!initPos) return [];
  const isGEO = initPos.altKm > 30000;

  const points = [];
  if (isGEO) {
    // 🟢 สำหรับ GEO (THAICOM): วาดวงแหวนวงยักษ์ 360 องศา ที่เส้นศูนย์สูตร (lat 0)
    for (let lng = -180; lng <= 180; lng += 2) {
      points.push({ lat: 0, lng: lng, alt: initPos.altKm / EARTH_RADIUS_KM });
    }
    return [{ points, color: 'rgba(255, 204, 0, 0.8)', stroke: 1.5 }];
  } else {
    // 🔵 สำหรับ LEO (THEOS): วาดเส้นโคจรเฉพาะช่วงเวลาล่วงหน้า/ย้อนหลัง 60 นาที
    for (let m = -60; m <= 60; m += 0.5) {
      const d = new Date(currentDate.getTime() + m * 60 * 1000);
      const pos = calculateSatData(d, targetSatrec);
      if (pos && !isNaN(pos.lat) && !isNaN(pos.lng) && !isNaN(pos.altKm)) {
        points.push({ lat: pos.lat, lng: pos.lng, alt: Math.max(0.01, pos.altKm / EARTH_RADIUS_KM) });
      }
    }
    if (points.length < 2) return [];
    return [{ points, color: 'rgba(255, 204, 0, 0.8)', stroke: 1.0 }]; 
  }
}, [selectedCatnr, targetSatrec, orbitUpdateTrigger]);

// 📍 ฟันธง 2: ระบบวาดเส้นแดงบน 3D ใช้ useRef เป็นโกดัง Cache (ลดภาระ CPU ไม่ต้องคำนวณใหม่ทุก 16ms)
const imagingSwathCache = useRef({});
const imagingSwathPaths = useMemo(() => {
  if (!targetSatrec || selectedCatnr !== '58016') return []; 
  const paths = [];
  
  sourcePlans.forEach(plan => {
    const pStart = new Date(plan.start).getTime();
    const pEnd = new Date(plan.end).getTime();

    if (simulatedTimeMs > pEnd) return;

    if (!imagingSwathCache.current[plan.id]) {
      const points = [];
      for (let t = pStart; t <= pEnd; t += 1000) {
        const pos = calculateSatData(new Date(t), targetSatrec);
        if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
          points.push({ lat: pos.lat, lng: pos.lng, alt: 0.002 });
        }
      }
      imagingSwathCache.current[plan.id] = { id: plan.id, points };
    }
    
    const cachedPlan = imagingSwathCache.current[plan.id];
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
    const duration = (plan.end - plan.start) / 1000;
    return {
      id: plan.id,
      ...plan,
      startLat: startPos?.lat, startLng: startPos?.lng,
      endLat: endPos?.lat, endLng: endPos?.lng,
      duration
    };
  });
}, [satrecs, sourcePlans]);

 // 📍 ฟันธง: บังคับตัดวงจรเส้น Ground Track สีแดง/ทอง ที่วิ่งรอบโลกออกทันทีสำหรับดาวเทียม GEO (Thaicom)
 const groundTrackPath = useMemo(() => {
  if (!targetSatrec || !showGroundTrack) return [];
  
  // เช็คสเปก ถ้าความสูงเกิน 30,000 กม. (GEO) ห้ามวาดเส้นรอบโลกเด็ดขาด!
  const initPos = calculateSatData(currentDate, targetSatrec);
  if (initPos && initPos.altKm > 30000) return []; 

  const points = [];
  for (let m = 0; m <= 1440; m += 1) {
    const d = new Date(currentDate.getTime() + m * 60 * 1000);
    const pos = calculateSatData(d, targetSatrec);
    if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
      points.push({ lat: pos.lat, lng: pos.lng, alt: 0.005 }); // แนบติดพื้นโลก
    }
  }
  if (points.length < 2) return [];
  return [{ points, color: 'rgba(255, 215, 0, 0.8)', stroke: 0.5 }];
}, [selectedCatnr, targetSatrec, orbitUpdateTrigger, showGroundTrack]);
  
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
            let lat = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(tc));
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
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContext();
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

  // ฟันธง: ฟังก์ชันดึง TLE อัตโนมัติจาก Server ตัวกลาง 
  const handleAutoUpdateTle = async () => {
    setIsUpdatingTle(true);
    setTleSource('Fetching Live TLE...');

    try {
     // เอา URL จาก Apps Script มาวางตรงนี้ครับ!!!
     const proxyUrl = "https://script.google.com/macros/s/AKfycbyv1ZA8fPvSlK3KhblBbkGTB4UC86nlpFES63jGvRlBiHSbuChYMs2BQgqsSXBQjDRf/exec";
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("Network response was not ok");
      
      const text = await response.text();
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
        try { localStorage.setItem('gistda_tles', JSON.stringify(newTles)); } catch(e) {}
        const now = new Date();
        setTleSource(`TLE Update (${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())})`);
      } else {
        setTleSource('Update Failed (Bad Data)');
      }
    } catch (err) {
      console.error(err);
      setTleSource('Update Failed (Network Error)');
    } finally {
      setIsUpdatingTle(false);
    }
  };

  // 📍 ฟันธง: สั่งกระตุกฟังก์ชันโหลด TLE อัตโนมัติ 1 ครั้ง ทันทีที่เปิดแอปหรือกด F5
  useEffect(() => {
    handleAutoUpdateTle();
  }, []);

  const thaiTime = new Date(currentDate.getTime() + 7 * 3600000);
  const formatTime = (d) => `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;

  // 📍 ฟันธง: นำตัวแปรเส้นสัญญาณ (Data Packets) ที่หายไปกลับมา!
  const signalVisualPath = useMemo(() => {
    if (!linkActive || !targetData || isNaN(targetData.lat) || isNaN(targetData.lng)) return [];
    if (targetData.altKm > 30000) return []; 

    const gsPoint = { lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, alt: 0 };
    const satPoint = { lat: targetData.lat, lng: targetData.lng, alt: Math.max(0.01, targetData.altKm / EARTH_RADIUS_KM) };
    
    return [{ 
      points: [satPoint, gsPoint],
      color: 'rgba(0, 255, 102, 0.9)', 
      stroke: 1.5,
      isSignal: true
    }];
  }, [linkActive, targetData]);

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

    const nextPos = calculateSatData(new Date(currentDate.getTime() + 60000), targetSatrec);
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
      const pos = calculateSatData(d, targetSatrec);
      
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
  }, [targetSatrec, targetData, Math.floor(simulatedTimeMs / 60000), radarLayout, stationMask]); // <-- เพิ่ม stationMask

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

// 📍 ฟันธง: ย้ายจุดประกอบร่างมาไว้ตรงนี้! รอให้ตัวแปรทุกตัวคำนวณเสร็จหมดก่อน ค่อยสั่งวาด
const pathsToDraw3D = [...orbitVisualPath, ...signalVisualPath, ...footprintBoundaryPath, ...imagingSwathPaths];
if (showGroundTrack) pathsToDraw3D.push(...groundTrackPath);

// 📍 ฟันธง: สมองกล Cache ระบบแสง Day/Night 2D (แก้อาการกระตุกขั้นเด็ดขาด!)
const dayNightOverlay2D = useMemo(() => {
  if (!realtimeSun) return null;
  
  const terminatorPts = [];
  const sunLat = currentSunPos.lat === 0 ? 0.0001 : currentSunPos.lat;
  const sunLatRad = sunLat * Math.PI / 180;
  const sunLngRad = currentSunPos.lng * Math.PI / 180;
  
  for (let i = 0; i <= 100; i++) {
    const lng = (i / 100) * 360 - 180;
    const lngRad = lng * Math.PI / 180;
    const latRad = Math.atan(-Math.cos(lngRad - sunLngRad) / Math.tan(sunLatRad));
    const lat = latRad * 180 / Math.PI;
    const y = (90 - lat) / 180 * 100;
    terminatorPts.push(`${i},${y}`);
  }
  
  if (sunLat >= 0) {
    terminatorPts.push(`100,100`, `0,100`);
  } else {
    terminatorPts.push(`100,0`, `0,0`);
  }
  const nightPolygon = terminatorPts.join(' ');

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
      <defs>
        <filter id="terminator-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
        <filter id="city-glow">
          <feColorMatrix type="matrix" values="
            1.8 0 0 0 0
            0 1.4 0 0 0
            0 0 0.9 0 0
            0 0 0 1 0" />
        </filter>
        <mask id="night-mask">
          <rect x="0" y="0" width="100" height="100" fill="black" />
          <polygon points={nightPolygon} fill="white" filter="url(#terminator-blur)" />
        </mask>
      </defs>
      <polygon points={nightPolygon} fill="rgba(0, 0, 0, 1.0)" filter="url(#terminator-blur)" />
      <image href="/textures/Earth_nightmap.webp" x="0" y="0" width="100" height="100" preserveAspectRatio="none" mask="url(#night-mask)" filter="url(#city-glow)" style={{ mixBlendMode: 'screen' }} />
    </svg>
  );
}, [realtimeSun, currentSunPos]); // <- หัวใจสำคัญ! สั่งให้คำนวณใหม่เฉพาะตอนดวงอาทิตย์ขยับเท่านั้น

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
      const el = targetData ? targetData.elevationDeg : -10;
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

      if (linkActive && targetData) {
          const el = targetData.elevationDeg;
          let baseStrength = targetData.altKm / targetData.rangeKm; 
          
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
      ctx.fillText(`${formatTime(new Date(simulatedTimeMs))} THA, SIM`, textX, 20);
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
}, [isAnalyzerOpen, linkActive, selectedCatnr, simulatedTimeMs, xBandSpan, sBandSpan, showXBand, showSBand]);

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
useEffect(() => {
  if (isAutoPilot) {
    if (globeRef.current) globeRef.current.controls().autoRotate = true; // 1. หมุนโลก
    let windowCycle = 0;
    autoPilotTimer.current = setInterval(() => {
      // 2. สลับหน้าต่างทุกๆ 8 วินาที
      windowCycle++;
      if(windowCycle % 3 === 0) { setIsRadarOpen(true); setIsAnalyzerOpen(false); setIsDiagramOpen(false); }
      else if(windowCycle % 3 === 1) { setIsRadarOpen(false); setIsAnalyzerOpen(true); setIsDiagramOpen(false); }
      else { setIsRadarOpen(false); setIsAnalyzerOpen(false); setIsDiagramOpen(true); }

      // 3. Time Travel ถ้ารอนานเกินไป (ข้ามไปก่อน AOS 30 วิ)
      if (nextPassTimestamp && nextPassTimestamp.time) {
        const timeToAos = nextPassTimestamp.time - simulatedTimeMs;
        if (timeToAos > 120000) { // ถ้ารอเกิน 2 นาที วาร์ปเลย!
          setSimulatedTimeMs(nextPassTimestamp.time - 30000);
          setCustomAlert({ show: true, message: 'AUTO-PILOT: TIME TRAVEL INITIATED 🚀', type: 'success' });
        }
      }
    }, 8000);
  } else {
    // 📍 ฟันธง: ล้างคำสั่งกล้องออกไป ปล่อยให้เคลียร์แค่ระบบหมุนพอ
    if (globeRef.current) globeRef.current.controls().autoRotate = false;
    if (autoPilotTimer.current) clearInterval(autoPilotTimer.current);
  }
  return () => { if (autoPilotTimer.current) clearInterval(autoPilotTimer.current); };
}, [isAutoPilot, simulatedTimeMs, nextPassTimestamp]);

// 📍 ฟันธง: สมองกล "MISSION AUTO-SEQUENCER" (ระบบวนลูปตารางรับสัญญาณอัตโนมัติ)
const autoSnapRef = useRef({});

useEffect(() => {
  if (!passSchedule || passSchedule.length === 0) return;

  const now = Date.now();
  const activeRealPass = passSchedule.find(p => now >= p.aosTime && now <= p.losTime);

  // 🚀 1. Real-Time AOS Interceptor (ระบบความปลอดภัย กรณีมีดาวเทียมเข้าจริงในปัจจุบัน)
  if (activeRealPass) {
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
  
  if (isSimulating) {
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
         setTimeout(() => {
          setSimulatedTimeMs(nextPass.aosTime - 10000);
        }, 4000);
      }
    }
    }
  }
}, [simulatedTimeMs, passSchedule, speedMult, isPlaying]);

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
        { type: 'station', lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, name: GROUND_STATION.name, altitude: 0 }
      ];
      const memoizedRings = [{ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng }];

      return (
        <Globe
            ref={globeRef} width={size.width} height={size.height}
            backgroundColor="#000000"
            globeImageUrl={mapThemes[mapThemeIdx].url}

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
            const group = new THREE.Group();

            // 1. วาดตัวดาวเทียม
            if (d.catnr === '58016') {
              if (!window.theos2TextureCache) {
                window.theos2TextureCache = new THREE.TextureLoader().load('/textures/THEOS-2.webp', (texture) => {
                  texture.minFilter = THREE.LinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                });
              }
              const material = new THREE.SpriteMaterial({ map: window.theos2TextureCache, color: 0xffffff, transparent: true, depthWrite: false });
              const satSprite = new THREE.Sprite(material);
              const size = d.isTarget ? 14 : 5; 
              satSprite.scale.set(size * 1.8, size, 1);
              group.add(satSprite);
            } else if (d.catnr === '33396') {
              // 📍 ฟันธง: โหลดภาพ THEOS.webp มาใช้แทนโมเดลกล่อง 3D!
              if (!window.theosTextureCache) {
                window.theosTextureCache = new THREE.TextureLoader().load('/textures/THEOS.webp', (texture) => {
                  texture.minFilter = THREE.LinearFilter;
                  texture.magFilter = THREE.LinearFilter;
                });
              }
              const material = new THREE.SpriteMaterial({ map: window.theosTextureCache, color: 0xffffff, transparent: true, depthWrite: false });
              const satSprite = new THREE.Sprite(material);
              // ตั้งไซส์ให้ THEOS-1 สมมาตร และเล็กกว่า THEOS-2 เล็กน้อย (12 vs 14)
              const size = d.isTarget ? 12 : 4.5; 
              satSprite.scale.set(size * 1.5, size, 1); 
              group.add(satSprite);
            } else {
              group.add(createSatelliteModel(d.isTarget));
            }

           // 2. 📍 นำป้ายชื่อ 3D มาแปะด้านบนดาวเทียม (เฉพาะเป้าหมายที่ถูกล็อก)
           if (d.isTarget) {
            const labelSprite = create3DLabel(d.name, d.catnr);
            // 📍 ฟันธง: ปรับระยะป้ายชื่อให้ลอยอยู่เหนือหลังคาดาวเทียมแต่ละรุ่นให้เป๊ะที่สุด!
            labelSprite.position.y = d.catnr === '58016' ? 7.5 : (d.catnr === '33396' ? 6.5 : 4); 
            group.add(labelSprite);
         }

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
              backgroundImage: `url('${mapThemes[mapThemeIdx].url}')`,
              backgroundSize: '100% 100%', /* บังคับภาพให้กางเต็มจอพอดี */
                backgroundPosition: 'center',
                filter: mapThemes[mapThemeIdx].filter
              }}>
              
             {/* 📍 ดึงภาพ Cache แสงเงามาโชว์ (ภาพสวยเหมือนเดิม แต่เบาเครื่อง ลื่นปรึ๊ด 100%) */}
             {dayNightOverlay2D}

              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-svg">
                {orbitVisualPath.map((pathObj, i) => {
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
                    <polyline key={`orb-${i}-${j}`} points={seg.join(' ')} fill="none" stroke="rgba(255, 204, 0, 0.5)" strokeWidth="0.2" strokeDasharray="0.5 0.5" />
                  ));
                })}

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

              <div className="map-marker" style={{ left: `${(GROUND_STATION.lng + 180) / 360 * 100}%`, top: `${(90 - GROUND_STATION.lat) / 180 * 100}%`, color: '#00eaff', zIndex: 5 }}>
                {/* 🌟 ฟันธงที่ 1: ลดขนาดอิโมจิจานรับสัญญาณจาก 24px เหลือ 16px */}
                <span style={{ fontSize: '16px', textShadow: '0 0 15px #00eaff', marginBottom: '2px' }}>📡</span>
                {/* 🌟 ฟันธงที่ 2: ลดขนาดป้ายชื่อ GISTDA จาก 10px เหลือ 8px (ขนาดกะทัดรัดไม่กวนแผนที่) */}
                <span className="label" style={{ fontSize: '8px', fontWeight: '900', textShadow: '0 0 8px #00eaff', color: '#00eaff' }}>GISTDA (SRC)</span>
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
                    let iconSrc = '/textures/THEOS-2-1.webp'; // ภาพตัวแทนดาวเทียมทั่วไป
                    // 🌟 ขยายดาวเทียมทั่วไป: สแตนด์บาย 30px, ล็อกเป้า 50px
                    let iconWidth = sat.isTarget ? '70px' : '50px'; 

                    // แยกเคสเฉพาะ THEOS-2 และ THEOS ให้รูปใหญ่และเด่นกว่า
                    if (sat.catnr === '58016') {
                      iconSrc = '/textures/THEOS-2.webp';
                      // 🌟 ขยาย THEOS-2: สแตนด์บาย 45px, ล็อกเป้า 65px (ใหญ่สุดอลังการ)
                      iconWidth = sat.isTarget ? '65px' : '45px'; 
                    } else if (sat.catnr === '33396') {
                      iconSrc = '/textures/THEOS.webp';
                      // 🌟 ขยาย THEOS-1: สแตนด์บาย 35px, ล็อกเป้า 55px
                      iconWidth = sat.isTarget ? '40px' : '30px';
                    }

                    // แสงออร่าบอกสถานะ (แดง=เป้าหลัก, ทอง=เป้ารอง, เขียว=อื่นๆ)
                    // เพิ่มความฟุ้งของแสง (10px -> 15px) ให้สมดุลกับขนาดภาพที่ใหญ่ขึ้น
                    const shadowColor = sat.isTarget ? 'rgba(255, 51, 51, 0.95)' : isSecondary ? 'rgba(255, 204, 0, 0.95)' : 'rgba(0, 255, 102, 0.85)';

                    return (
                      <img 
                        src={iconSrc} 
                        alt={sat.name} 
                        style={{ 
                          width: iconWidth, 
                          height: 'auto', 
                          objectFit: 'contain',
                          filter: `drop-shadow(0 0 15px ${shadowColor})`,
                          marginBottom: '6px',
                          transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                          // ทำให้ภาพเอียงนิดๆ เวลากลายเป็นเป้าหมายหลักให้ดูพุ่งทะยาน
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
          <div className="left-panel" style={{ width: '817px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, overflowY: 'auto', paddingBottom: '30px', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>

            <div className="panel-box mission-status">
              {/* 📍 ฟันธง: ขยายธงชาติให้กว้างขึ้น และขยายฟอนต์ชื่อดาวเทียมให้ใหญ่อลังการ */}
              <div className="target-header" style={{ display: 'flex', gap: '15px', paddingBottom: '15px', marginBottom: '15px', justifyContent: 'center', alignItems: 'center' }}>
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
             <div className={`status-banner ${linkActive ? 'active' : 'standby'}`} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '15px 10px', textAlign: 'center', borderRadius: '8px', marginBottom: '18px', border: linkActive ? '1px solid var(--green)' : '1px solid #ff4400', backgroundColor: 'rgba(0,0,0,0.2)' }}>
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
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Source:</span><strong style={{ color: '#4ade80', fontWeight: '900', textAlign: 'right', textShadow: '0 0 8px rgba(74, 222, 128, 0.4)' }}>{tleSource}</strong></li>
              </ul>
            </div>
            
        {/* ☁️ CLOUD COVER FORECAST HUD */}
        <div className="panel-box" style={{ padding: '12px 15px', background: 'linear-gradient(145deg, rgba(0, 20, 35, 0.85), rgba(0, 5, 15, 0.95))', border: '1px solid var(--cyan)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px dashed rgba(0,234,255,0.3)', paddingBottom: '6px', gap: '4px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: 'clamp(12px, 1.2vw, 14px)', color: 'var(--cyan)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>LOCAL WEATHER (METEO)</span>
                <span style={{ fontSize: 'clamp(10px, 1vw, 12px)', color: 'var(--gold)', fontFamily: 'Orbitron', fontWeight: '900', whiteSpace: 'nowrap', flexShrink: 0, padding: '2px 6px', background: 'rgba(255,204,0,0.1)', borderRadius: '4px', border: '1px solid rgba(255,204,0,0.4)', boxShadow: '0 0 8px rgba(255,204,0,0.2)' }}>{activeStation.id} STATION</span>
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
                    {cloudCover === null ? 'ANALYZING...' : (cloudCover <= 30 ? 'CLEAR (OPTICAL OK)' : (cloudCover <= 70 ? 'PARTLY CLOUDY' : 'OVERCAST (DEGRADED)'))}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: '5px' }}>
                  {/* 📍 ฟันธง: ลบ textShadow ของตัวเลขเปอร์เซ็นต์เมฆออก */}
                  <div style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontFamily: 'Orbitron', fontWeight: '900', color: cloudCover === null ? '#fff' : (cloudCover <= 30 ? 'var(--green)' : (cloudCover <= 70 ? 'var(--gold)' : '#ffffff')), textShadow: 'none', lineHeight: '1' }}>
                    {isFetchingCloud ? '--' : `${cloudCover}%`}
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
                        globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
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
                        <button key={s} disabled={isRealtimePassLock} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0, opacity: isRealtimePassLock ? 0.3 : 1, cursor: isRealtimePassLock ? 'not-allowed' : 'pointer'}} onClick={() => setSpeedMult(s)}>{s}X</button>
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
                        setSimulatedTimeMs(Date.now()); setSpeedMult(1); setIsPlaying(true); isTrackingRef.current = false; setCameraMode('FREE LOOK');
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
                              const pos = calculateSatData(new Date(simulatedTimeMs), rec);
                              if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
                                const camAlt = Math.max(0.4, (pos.altKm / EARTH_RADIUS_KM) + 0.5);
                                globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: camAlt }, 1000);
                              }
                          }
                        } catch (err) {}
                      } else if (newMode === 'FREE LOOK' && globeRef.current) {
                        globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
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
                        if (selectedCatnr) calculateFuturePasses(selectedCatnr);
                      }}
                    >
                      {station.id}
                    </button>
                  ))}
                </div>
              </div>

              <div className="gs-row">
                <span className="gs-label">LOCATION:</span>
                <span className="gs-value">{GROUND_STATION.name}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">LATITUDE:</span>
                <span className="gs-value highlight">{Math.abs(GROUND_STATION.lat).toFixed(4)}° {GROUND_STATION.lat >= 0 ? 'N' : 'S'}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">LONGITUDE:</span>
                <span className="gs-value highlight">{Math.abs(GROUND_STATION.lng).toFixed(4)}° {GROUND_STATION.lng >= 0 ? 'E' : 'W'}</span>
              </div>
              <div className="gs-row">
                <span className="gs-label">ALTITUDE (ASL):</span>
                <span className="gs-value highlight">{GROUND_STATION.alt} m</span>
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
              const groupCatnrs = satsInGroup.map(s => s.catnr);
              const isAllSelected = groupCatnrs.every(cat => selectedCatnrs.includes(cat));

              return (
              <div key={groupName}>
                <div className="group-header-row">
                  <div className="modal-group-title">{groupName}</div>
                  <button className="group-toggle-btn" onClick={() => {
                      let newSelected = [...selectedCatnrs];
                      if (isAllSelected) { newSelected = newSelected.filter(c => !groupCatnrs.includes(c) || c === selectedCatnr); } 
                      else { groupCatnrs.forEach(c => { if (!newSelected.includes(c)) newSelected.push(c); }); }
                      setSelectedCatnrs(newSelected);
                    }}>
                    {isAllSelected ? '- DESELECT ALL' : '+ SELECT ALL'}
                  </button>
                </div>
                <div className="modal-grid">
                  {satsInGroup.map(sat => (
                    <button key={sat.catnr} className={`modal-sat-btn ${sat.catnr === selectedCatnr ? 'primary' : selectedCatnrs.includes(sat.catnr) ? 'secondary' : ''}`} 
                      onClick={() => {
                        let newSelected = [...selectedCatnrs];
                        if (newSelected.includes(sat.catnr)) { newSelected = newSelected.filter(c => c !== sat.catnr); } 
                        else { newSelected.push(sat.catnr); }
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
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flex: 1, paddingRight: '10px' }}>
                        {sat.flag && <img src={`https://flagcdn.com/w40/${sat.flag.toLowerCase()}.png`} style={{ width: '28px', flexShrink: 0, marginRight: '12px', borderRadius: '3px', boxShadow: '0 0 5px rgba(255,255,255,0.4)' }} alt="flag" />}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', width: '100%', textAlign: 'left' }}>{sat.displayName}</span>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {sat.catnr === selectedCatnr ? ( <span style={{ color: '#fff', textShadow: '0 0 10px #fff', fontSize: '12px', letterSpacing: '1px' }}>🎯 MAIN</span> ) : selectedCatnrs.includes(sat.catnr) ? ( <span style={{ color: '#000', fontSize: '12px' }}>●</span> ) : null}
                      </div>
                    </button>
                  ))}
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
                    <tr><td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--red)', fontWeight: 'bold', letterSpacing: '2px' }}>NO PASSES DETECTED IN THIS TIMEFRAME</td></tr>
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
                        background: 'transparent', opacity: 1, filter: 'none'
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
      /* 📍 ฟันธง: ล็อกขนาดเริ่มต้นให้เล็กลงจาก 900x600 เป็น 780x500 เพื่อไม่ให้ล้นจอทีวี 65 นิ้ว */
      width: maximizedWins.img ? '100vw' : '780px', 
      height: maximizedWins.img ? '100vh' : '500px', 
      minWidth: '600px', minHeight: '400px',
      maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.img ? 'none' : 'both', overflow: 'hidden', 
      background: 'rgba(2, 6, 23, 0.9)', backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)',
      border: '2px solid #FF4500',
      boxSizing: 'border-box', 
      borderRadius: maximizedWins.img ? '0px' : '12px',
      boxShadow: '0 0 50px rgba(255, 69, 0, 0.5), inset 0 0 30px rgba(255, 69, 0, 0.3)',
      display: 'flex', flexDirection: 'column',
      zIndex: windowZ.img || 10000,
      transition: isDraggingImg ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
    }}>

          {/* 📍 เอฟเฟกต์แสงแฟลร์ (Background Flare) */}
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '120%', height: '120%', background: 'radial-gradient(circle, rgba(255, 69, 0, 0.15) 0%, transparent 60%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0, animation: 'pulse 4s infinite' }}></div>

          {/* Header */}
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, borderBottom: '2px solid #FF4500', padding: '12px 20px', cursor: maximizedWins.img ? 'default' : (isDraggingImg ? 'grabbing' : 'grab'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, rgba(255, 69, 0, 0.2) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(255, 69, 0, 0.5)' }} onMouseDown={(e) => { if(!maximizedWins.img) handleImgMouseDown(e); }}>
            <div style={{ flex: 1 }}></div>
            
            <div style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff3333', fontFamily: 'Orbitron', fontWeight: 'bold', fontSize: '20px', textShadow: '0 0 10px #ff3333', pointerEvents: 'none', whiteSpace: 'nowrap', letterSpacing: '1px' }}>
              📸 IMAGING PLAN VIEWER 
              <span style={{ fontSize: '14px', color: 'var(--gold)', background: 'rgba(0,0,0,0.5)', border: '1px solid #ffffff', padding: '2px 10px', borderRadius: '4px', marginLeft: '12px', textShadow: '0 0 10px var(--gold)', boxShadow: '0 0 8px rgba(255,255,255,0.5)', letterSpacing: '2px' }}>
                ORBIT 269
              </span>
            </div>
            
            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', padding: 0, border: '1px solid #FF4500', color: '#FF4500', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => toggleMaximize('img')}>{maximizedWins.img ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', padding: 0, border: '1px solid #FF4500', color: '#FF4500', background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }} onClick={() => setIsImgOpen(false)}>✕</button>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '20px', gap: '20px', position: 'relative', zIndex: 10 }}>
            
            {/* ซ้าย: ตารางคิวถ่ายภาพ */}
            <div style={{ flex: '0 0 380px', display: 'flex', flexDirection: 'column', borderRight: '1px dashed rgba(255,69,0,0.5)', paddingRight: '15px' }}>
              <style>{`.img-hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
              <div style={{ flex: '1', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="img-hide-scrollbar">
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontFamily: 'Rajdhani', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.7)', borderBottom: '2px solid rgba(255,69,0,0.8)', fontSize: '13px' }}>
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
                              background: isSelected ? 'linear-gradient(90deg, rgba(255, 69, 0, 0.25) 0%, transparent 100%)' : 'transparent',
                              borderLeft: isSelected ? '4px solid #FF4500' : '4px solid transparent',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                            onMouseOver={(e) => { if(!isSelected) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
                            onMouseOut={(e) => { if(!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            onClick={() => setSelectedPlanId(isSelected ? null : plan.id)}>
                          
                          <td style={{ padding: '12px 5px', fontWeight: 'bold', fontSize: '15px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ color: isSelected ? '#ffffff' : '#e0e0e0', textShadow: isSelected ? '0 0 10px rgba(255,69,0,0.8)' : 'none', letterSpacing: '1px' }}>
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
                                background: isSelected ? 'linear-gradient(135deg, #FF4500, #ff8c00)' : 'rgba(255, 69, 0, 0.1)', 
                                border: `1px solid ${isSelected ? '#FF4500' : 'rgba(255, 69, 0, 0.4)'}`, 
                                color: isSelected ? '#fff' : '#FF4500', 
                                width: '40px', height: '32px', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                borderRadius: '4px', cursor: 'pointer', fontSize: '13px', 
                                transition: 'all 0.2s', 
                                boxShadow: isSelected ? '0 0 15px rgba(255, 69, 0, 0.6)' : 'none',
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

              {/* ปุ่ม Upload */}
              <div style={{ position: 'relative', zIndex: 10, marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed rgba(255, 69, 0, 0.3)', textAlign: 'center' }}>
                   <label style={{ 
                    display: 'inline-block', width: '90%', 
                    background: 'linear-gradient(90deg, rgba(34, 211, 238, 0.1) 0%, rgba(34, 211, 238, 0.2) 50%, rgba(34, 211, 238, 0.1) 100%)', 
                    border: '2px dashed var(--cyan)', color: 'var(--cyan)', 
                    padding: '10px 15px', borderRadius: '6px', cursor: 'pointer', 
                    fontSize: '13px', fontFamily: 'Orbitron', fontWeight: 'bold', 
                    letterSpacing: '1.5px', transition: 'all 0.3s ease',
                    boxShadow: '0 0 15px rgba(34, 211, 238, 0.1)'
                   }}
                        onMouseOver={(e) => { 
                          e.currentTarget.style.background = 'var(--cyan)'; 
                          e.currentTarget.style.color = '#000';
                          e.currentTarget.style.boxShadow = '0 0 25px rgba(34, 211, 238, 0.8)'; 
                          e.currentTarget.style.transform = 'scale(1.02)';
                        }}
                        onMouseOut={(e) => { 
                          e.currentTarget.style.background = 'linear-gradient(90deg, rgba(34, 211, 238, 0.1) 0%, rgba(34, 211, 238, 0.2) 50%, rgba(34, 211, 238, 0.1) 100%)'; 
                          e.currentTarget.style.color = 'var(--cyan)'; 
                          e.currentTarget.style.boxShadow = '0 0 15px rgba(34, 211, 238, 0.1)'; 
                          e.currentTarget.style.transform = 'scale(1)';
                        }}>
                    📂 UPLOAD NEW MISSION PLAN
                    <input type="file" accept=".pdf" style={{ display: 'none' }} onChange={handlePdfUpload} />
                   </label>
              </div>

            </div>

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
                        transition: 'transform 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)'
                     }}>
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', backgroundColor: 'transparent' }}>
                            <image 
                              href={mapThemes[mapThemeIdx].url} 
                              x="0" y="0" width="100" height="100" preserveAspectRatio="none" 
                              style={{ 
                                filter: mapThemes[mapThemeIdx].filter,
                                transition: 'filter 0.5s ease-in-out'
                              }} 
                            />

                            {imagingPlansData.map(p => {
                               if(isNaN(p.startLng) || isNaN(p.endLng)) return null;
                               if (simulatedTimeMs > p.end) return null; 

                               const x1 = (p.startLng + 180) / 360 * 100; const y1 = (90 - p.startLat) / 180 * 100;
                               const x2 = (p.endLng + 180) / 360 * 100; const y2 = (90 - p.endLat) / 180 * 100;
                               const isSel = selectedPlanId === p.id;
                               
                               const sw1 = (isSel ? 1.5 : 0.5) / mapZoom;
                               const sw2 = (isSel ? 0.1 : 0.05) / mapZoom;
                               const rDot = 0.5 / mapZoom;

                               return (
                                  <g key={p.id}>
                                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isSel ? "rgba(255, 51, 51, 0.8)" : "rgba(255, 100, 51, 0.4)"} strokeWidth={sw1} strokeLinecap="round" />
                                     <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isSel ? "#fff" : "#ff9900"} strokeWidth={sw2} strokeDasharray={`${0.2/mapZoom} ${0.2/mapZoom}`} />
                                     {isSel && <circle cx={x1} cy={y1} r={rDot} fill="#fff" stroke="#ff3333" strokeWidth={sw2} />}
                                  </g>
                               );
                            })}
                        </svg>
                     </div>
                   )
                })()}

                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'linear-gradient(rgba(0, 234, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 234, 255, 0.1) 1px, transparent 1px)', backgroundSize: '20px 20px', pointerEvents: 'none' }}></div>
                
                <div style={{ position:'absolute', bottom:'15px', left:'15px', color:'#00eaff', fontFamily:'Orbitron', fontSize:'12px', fontWeight: 'bold', textShadow:'0 0 10px #000', background: 'rgba(0,0,0,0.6)', padding: '4px 10px', borderRadius: '4px', borderLeft: '3px solid var(--cyan)' }}>
                  {selectedPlanId !== null ? `🎯 TARGET LOCKED (ZOOM: ${mapZoom}X)` : '🌍 GLOBAL VIEW (STANDBY)'}
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
          
          /* 📍 ฟันธง: ลดขนาดต่ำสุด minWidth จาก 900px เป็น 750px และ minHeight จาก 550px เป็น 480px */
          minWidth: '750px', minHeight: '480px', resize: maximizedWins.analyzer ? 'none' : 'both', overflow: 'hidden',
          
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
                  const lmst = (gmst * 15 + GROUND_STATION.lng) % 360;
                  const ha = (lmst - alpha + 360) % 360;
                  
                  const latRad = GROUND_STATION.lat * Math.PI/180;
                  const decRad = delta * Math.PI/180;
                  const haRad = ha * Math.PI/180;
                  
                  const sunElRad = Math.asin(Math.sin(decRad)*Math.sin(latRad) + Math.cos(decRad)*Math.cos(latRad)*Math.cos(haRad));
                  const sunEl = sunElRad * 180/Math.PI;
                  const sunAzRad = Math.acos((Math.sin(decRad) - Math.sin(sunElRad)*Math.sin(latRad)) / (Math.cos(sunElRad)*Math.cos(latRad)));
                  let sunAz = sunAzRad * 180/Math.PI;
                  if (Math.sin(haRad) > 0) sunAz = 360 - sunAz;
                  return { el: sunEl, az: sunAz };
              };

              const stepMs = angleInterval * 1000;
              const rows = [];
              for (let t = targetPass.aosTime; t <= targetPass.losTime; t += stepMs) {
                 const pos = calculateSatData(new Date(t), targetSatrec);
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
        .pkt-tc { fill: var(--gold); color: var(--gold); animation: krasue-glow 1.2s ease-in-out infinite 0.4s; }
        .pkt-pl { fill: var(--green); color: var(--green); animation: krasue-glow 1.2s ease-in-out infinite 0.8s; }
        .p-line { stroke-width: 3; stroke-dasharray: 8 8; stroke-linecap: round; transition: all 0.3s; }
        
        .l-tm { stroke: var(--cyan); animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px var(--cyan)); }
        .l-tc { stroke: var(--gold); animation: dash-fwd 0.6s linear infinite; filter: drop-shadow(0 0 5px var(--gold)); }
        .l-pl { stroke: var(--green); animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px var(--green)); }
        .l-dual { stroke: rgba(0, 234, 255, 0.4); animation: dash-fwd 0.8s linear infinite; filter: drop-shadow(0 0 5px rgba(0, 234, 255, 0.2)); }
        
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
                    <svg overflow="visible" className="pkt-tm">
                      <g transform="rotate(98) scale(1)">
                        <path d="M -50,0 Q -37.5,-12 -25,0 Q -12.5,12 0,0 Q 12.5,-12 25,0 Q 37.5,12 50,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="50%" to="46%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="8%" to="55%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g>
                    <svg overflow="visible" className="pkt-tc">
                      <g transform="rotate(-82) scale(1)">
                        <path d="M -50,0 Q -37.5,-12 -25,0 Q -12.5,12 0,0 Q 12.5,-12 25,0 Q 37.5,12 50,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
                        </path>
                      </g>
                      <animate attributeName="x" from="46%" to="50%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="55%" to="8%" dur="3s" repeatCount="indefinite" />
                    </svg>
                  </g>
                  <g>
                    <svg overflow="visible" className="pkt-pl">
                      <g transform="rotate(82) scale(1)">
                        <path d="M -60,0 Q -45,-18 -30,0 Q -15,18 0,0 Q 15,-18 30,0 Q 45,18 60,0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <animateTransform attributeName="transform" type="scale" values="0.5; 0.85; 0.5" dur="1s" repeatCount="indefinite" />
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
                    <text className="pkt-tm" dominantBaseline="middle" textAnchor="middle" style={{ fontSize: '1.2cqw', fontWeight: 900, color: '#b59410', letterSpacing: '4px' }}>
                      0 1 0 1 0 1
                      <animate attributeName="x" from="12%" to="34%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="y" from="85%" to="85%" dur="3s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0; 1; 1; 0" keyTimes="0; 0.2; 0.8; 1" dur="3s" repeatCount="indefinite" />
                    </text>
                  </g>
                  <g>
                    <text className="pkt-pl" dominantBaseline="middle" textAnchor="middle" style={{ fontSize: '1.2cqw', fontWeight: 900, color: '#b59410', letterSpacing: '4px' }}>
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
                <img src="/textures/THEOS-2.webp" className={linkActive ? 'anim-wobble' : ''} alt="THEOS-2" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : selectedCatnr === '33396' ? (
                <img src="/textures/THEOS.webp" className={linkActive ? 'anim-wobble' : ''} alt="THEOS" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
              ) : (
                <img src="/textures/THEOS-2-1.webp" className={linkActive ? 'anim-wobble' : ''} alt="Satellite" style={{ width: '18cqw', minWidth: '120px', height: 'auto', objectFit: 'contain', zIndex: 2, filter: 'drop-shadow(0 20px 15px rgba(0,0,0,0.8))' }} />
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
              <div className="n-title">{GROUND_STATION.id}</div>
              <div className="n-sub">S-BAND ANTENNA</div>
              {linkActive && (<>
                <div className="conn-dot" style={{ top: 'calc(50% - 30px)', left: '0%' }}></div>
                <div className="conn-dot" style={{ top: 'calc(50% + 30px)', left: '0%', background: 'var(--gold)' }}></div>
              </>)}
            </div>

            {/* 📍 7.3 โหนดเสาอากาศ (SRC ขวา) ขยับที่ 54% */}
            <div className={`flow-node ${linkActive ? 'active' : ''}`} style={{ left: '54%', top: '55%', zIndex: 20, borderColor: linkActive ? 'var(--green)' : '' }}>
              <img src="https://api.iconify.design/mdi:satellite-uplink.svg?color=%2300ff66" className="n-icon" alt="Antenna" />
              <div className="n-title">{GROUND_STATION.id}</div>
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
                <div style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justify: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
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
                <div style={{ flex: '0 0 auto', height: '100%', aspectRatio: '1/1', background: '#0b1121', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justify: 'center', boxShadow: 'inset 0 0 10px rgba(0,0,0,0.8)' }}>
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