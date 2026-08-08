// @ts-nocheck
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import * as satelliteJs from 'satellite.js';

// =========================================================================
// 📍 PDF PARSER ENGINE (Theos-2 Mission Plan) - อ้างอิงจากโค้ดของทีมงาน GISTDA
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
  { id: 'SRC', name: 'GISTDA (SRC)', lat: 13.101195, lng: 100.928091, alt: 17 },     // ศรีราชา (~17 เมตร)
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

  // 2. THAI CUBESAT & MICROSAT (LEO) - คัดเฉพาะที่ยังอยู่!
  { catnr: '46292', name: 'NAPA-1', displayName: 'NAPA-1 / RTAF-SAT-1', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: 'UHF/VHF', payload: 'S-Band' },
  { catnr: '48900', name: 'NAPA-2', displayName: 'NAPA-2 / RTAF-SAT-2', flag: 'th', group: 'THAI CUBESAT & MICROSAT', operator: 'RTAF', mission: 'Earth Observation', telemetry: 'UHF/VHF', payload: 'S-Band' },

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
  // GISTDA & ISS
  '58016': { line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995', line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245' },
  '33396': { line1: '1 33396U 08049A   26166.85000000  .00000100  00000-0  50000-4 0  9991', line2: '2 33396  98.5400 210.1200 0001500  85.0000 275.0000 14.20000000900001' },
  '25544': { line1: '1 25544U 98067A   26201.79846070  .00005574  00000-0  10900-3 0  9995', line2: '2 25544  51.6312 133.7599 0006835 319.3995  40.6483 15.49066413576965' },
  '48274': { line1: '1 48274U 21035A   26204.00000000  .00000000  00000-0  00000-0 0  9999', line2: '2 48274  41.4700 120.0000 0001500 180.0000 180.0000 15.60000000000000' }
};


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
    
    .left-container { display: flex; flex-direction: column; align-items: flex-start; pointer-events: none; height: 100%; z-index: 20; overflow: hidden; }
    .menu-toggle-btn-left { width: 42px; height: 42px; background: linear-gradient(135deg, rgba(0,234,255,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--cyan); color: var(--cyan); font-size: 22px; cursor: pointer; border-radius: 8px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-bottom: 15px; box-shadow: 0 0 15px rgba(0,234,255,0.6), inset 0 0 10px rgba(0,234,255,0.3); flex-shrink: 0; }
    .menu-toggle-btn-left:hover { background: var(--cyan); color: #000; box-shadow: 0 0 30px var(--cyan); transform: scale(1.1); }
    
    .left-panel { width: 517px !important; box-sizing: border-box !important; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInLeft 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; }
    .left-panel::-webkit-scrollbar { display: none; }
    @keyframes slideInLeft { from { opacity: 0; transform: translateX(-40px); } to { opacity: 1; transform: translateX(0); } }

    /* 📍 อัปเกรดแสงแฟลร์สีฟ้า (Cyan Flare) ของแผงข้อมูลให้สว่างวาบยิ่งขึ้น */
    .panel-box { 
      box-sizing: border-box !important;
      background: linear-gradient(145deg, rgba(0, 25, 45, 0.85) 0%, rgba(0, 5, 15, 0.95) 100%) !important; 
      backdrop-filter: blur(15px) !important; 
      border: 2px solid #00eaff !important; 
      border-radius: 10px; padding: 20px; 
      box-shadow: 0 0 60px rgba(0, 234, 255, 0.45), inset 0 0 30px rgba(0, 234, 255, 0.25) !important; 
      position: relative; overflow: hidden;
      flex-shrink: 0 !important; /* 📍 ฟันธง: ล็อกห้ามกล่องโดนบีบความสูง ป้องกันตัวหนังสือแหว่ง 100% */
    }

    .control-group { 
      background: linear-gradient(145deg, rgba(0, 15, 30, 0.85) 0%, rgba(0, 5, 15, 0.95) 100%) !important; 
      backdrop-filter: blur(15px) !important; 
      border: 1px solid var(--cyan); border-top: 2px solid var(--cyan);
      border-radius: 8px; padding: 20px; 
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 234, 255, 0.3), inset 0 0 20px rgba(0, 234, 255, 0.15); 
      position: relative; overflow: hidden;
      flex-shrink: 0; /* 📍 ฟันธง: บังคับไม่ให้กล่องหดตัวตามความสูงหน้าจอ ป้องกันปุ่มแหว่ง! */
    }
    
    .main-title h1 { margin: 0 0 8px 0; font-family: 'Orbitron', sans-serif; font-size: 30px; font-weight: 900; color: #ffffff; text-shadow: 0 0 20px #00eaff, 0 0 40px #00eaff; letter-spacing: 2px; }
    .main-title span { display: block !important; font-size: 13px !important; color: #ffffff !important; font-weight: 600 !important; letter-spacing: 2px !important; text-shadow: 0 0 10px rgba(255,255,255,0.8) !important; text-transform: uppercase !important; }

    /* 📍 อัปเกรดนาฬิกาเป็น "ส้มเรืองแสง (Orange Flare)" และปรับขนาดฟอนต์เพื่อลดอาการตาล้าตามหลัก UI/UX */
    .global-clock-hud { 
      display: flex; flex-direction: column; width: 460px !important; box-sizing: border-box !important; 
      background: linear-gradient(180deg, rgba(20, 5, 0, 0.95), rgba(5, 0, 0, 0.98)); 
      backdrop-filter: blur(20px); 
      border: 1px solid rgba(255, 69, 0, 0.5); border-top: 2px solid #FF4500;
      border-radius: 8px; padding: 15px 20px 15px 20px; 
      box-shadow: 0 10px 30px rgba(0,0,0,0.8), inset 0 0 20px rgba(255, 69, 0, 0.15);
      pointer-events: auto; position: relative; margin-top: 10px; gap: 15px; 
    }
    .clock-row { display: flex; justify-content: space-between; width: 100%; align-items: center; }
    .global-clock-hud .clock-item { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 33%; }
    
    .global-clock-hud .clock-item span { 
      font-size: 13px; color: rgba(255, 255, 255, 0.5); font-weight: 800; letter-spacing: 2px; margin-bottom: 4px; text-transform: uppercase; 
    }
    
    .global-clock-hud .clock-item strong { 
      font-family: 'Orbitron', sans-serif; font-size: 26px; color: #FF8800; font-weight: 900; font-variant-numeric: tabular-nums; 
      text-shadow: 0 0 15px rgba(255, 69, 0, 0.8); letter-spacing: 1.5px; line-height: 1; 
    }
    
    /* 📍 ฟันธง: อัปเกรด DOY (วันที่) ขยายไซส์ให้เป็นจุดศูนย์กลางและเปลี่ยนเป็นสีทอง Golden Amber สไตล์ Sci-Fi */
    .global-clock-hud .clock-item.doy-item strong {
      color: #ffcc00 !important; /* สีเหลืองทองสว่าง */
      font-size: 35px !important; /* ขยายให้ใหญ่กระแทกตากว่าเวลาปกติ (26px -> 35px) */
      text-shadow: 0 0 20px rgba(255, 204, 0, 0.8), 0 0 10px rgba(255, 255, 255, 0.5) !important; /* แสงออร่าสีทองเปล่งประกาย */
      line-height: 0.85; /* จัดระเบียบบรรทัดไม่ให้ดันกล่องสูงเกินไป */
    }
    .global-clock-hud .clock-item.doy-item span { 
      color: rgba(255, 204, 0, 0.8) !important; /* เปลี่ยนป้ายตัวอักษร DOY เป็นสีทองให้เข้าชุดกัน */
      letter-spacing: 3px !important;
    }
    
    /* 📍 จัดกึ่งกลางป้าย Status โดดเด่น ชัดเจน ทรงพลัง */
    .status-badge { 
      width: 100%; display: flex; justify-content: center; align-items: center; gap: 10px;
      padding: 8px 0; border-radius: 4px; font-size: 13px; font-weight: 900; font-family: 'Orbitron', sans-serif; 
      letter-spacing: 3px; border: 1px solid; text-transform: uppercase; 
    }
    
    .status-badge.live { background: rgba(0, 255, 102, 0.1); border-color: #00ff66; color: #00ff66; box-shadow: inset 0 0 15px rgba(0, 255, 102, 0.2); }
    .status-badge.sim { background: rgba(255, 171, 46, 0.1); border-color: #ffab2e; color: #ffab2e; box-shadow: inset 0 0 15px rgba(255, 171, 46, 0.2); }

    /* 📍 แก้ข้อ 2: บังคับธงชาติและชื่อดาวเทียมให้อยู่ตรงกลางและบรรทัดเดียวกันเป๊ะๆ */
    .target-header { display: flex; flex-direction: row !important; align-items: center; justify-content: center; gap: 15px; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px dashed rgba(0,234,255,0.4); }
    .target-header img { width: 40px; border-radius: 4px; border: 1px solid var(--cyan); box-shadow: 0 0 15px var(--cyan); }
    .target-header h2 { margin: 0; font-family: 'Orbitron', sans-serif; font-size: 26px; font-weight: 900; color: #fff; letter-spacing: 2px; text-shadow: 0 0 15px var(--cyan); }
    
    .status-banner { text-align: center; font-family: 'Orbitron', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: 2px; padding: 15px; margin-bottom: 20px; border-radius: 8px; transition: all 0.3s; }
    .status-banner.standby { background: linear-gradient(180deg, rgba(255, 51, 51, 0.2), rgba(0,0,0,0.6)); border: 2px solid var(--red); color: var(--red); box-shadow: 0 0 30px rgba(255, 51, 51, 0.6), inset 0 0 20px rgba(255, 51, 51, 0.4); text-shadow: 0 0 10px var(--red); }
    .status-banner.active { background: linear-gradient(180deg, rgba(0, 234, 255, 0.2), rgba(0,0,0,0.6)); border: 2px solid var(--cyan); color: var(--cyan); box-shadow: 0 0 30px rgba(0, 234, 255, 0.6), inset 0 0 20px rgba(0, 234, 255, 0.4); text-shadow: 0 0 10px var(--cyan); }

    /* 📍 แก้ไขกรอบวงสีแดง (Telemetry Grid): ขยายช่องและตัวเลขให้ใหญ่กระแทกตา ปรับสี Label ให้อ่านง่าย */
    .telemetry-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .t-box { background: linear-gradient(145deg, rgba(0, 15, 30, 0.6) 0%, rgba(0, 5, 10, 0.8) 100%); border: 1px solid rgba(0, 234, 255, 0.15); border-left: 3px solid rgba(0, 234, 255, 0.5); border-radius: 8px; padding: 15px 18px; display: flex; flex-direction: column; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
    .t-box:hover { border-color: var(--gold); border-left: 3px solid var(--gold); background: rgba(255, 204, 0, 0.08); box-shadow: 0 0 20px rgba(255, 204, 0, 0.2); transform: translateY(-3px); z-index: 5; }
    .t-box.highlight { border-left: 3px solid var(--red); background: linear-gradient(90deg, rgba(255, 51, 51, 0.15) 0%, transparent 100%); box-shadow: inset 0 0 20px rgba(255, 51, 51, 0.1); }
    
    .t-box span { font-size: 13px; color: rgba(255, 255, 255, 0.6); text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    .t-box strong { font-family: 'Orbitron', sans-serif; font-size: 22px; color: #ffffff; margin-top: 6px; text-shadow: 0 0 10px rgba(255, 255, 255, 0.4); letter-spacing: 1px; }

    /* 📍 อัปเกรด Info List (ข้อมูลดาวเทียม): ถอดเส้นคั่น ขยายฟอนต์ และกระชับบรรทัด */
    .info-list { list-style: none; padding: 15px 0 0 0; margin: 15px 0 0 0; border-top: 1px dashed rgba(0, 234, 255, 0.4); font-size: 16px; line-height: 1.6; }
    .info-list li { display: flex; justify-content: space-between; align-items: center; border-bottom: none; padding-bottom: 2px; margin-bottom: 6px; }
    .info-list li:last-child { margin-bottom: 0; padding-bottom: 0; }
    .info-list span { color: rgba(255, 255, 255, 0.65); font-weight: 600; letter-spacing: 0.5px; }
    .info-list strong { color: var(--cyan); font-weight: 900; text-shadow: 0 0 10px rgba(0, 234, 255, 0.4); text-align: right; font-size: 18px; letter-spacing: 1px; }

    .right-container { display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; height: 100%; z-index: 20; }
    .menu-toggle-btn { width: 42px; height: 42px; background: linear-gradient(135deg, rgba(255,204,0,0.2), rgba(0,0,0,0.8)); backdrop-filter: blur(12px); border: 2px solid var(--gold); color: var(--gold); font-size: 22px; cursor: pointer; border-radius: 8px; pointer-events: auto; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease; margin-bottom: 15px; box-shadow: 0 0 15px rgba(255,204,0,0.6), inset 0 0 10px rgba(255,204,0,0.3); }
    .menu-toggle-btn:hover { background: var(--gold); color: #000; box-shadow: 0 0 30px var(--gold); transform: scale(1.1); }
    
    /* 📍 ขยายความกว้างแผงขวาจาก 300px เป็น 440px พร้อมเปิดระบบไถสกอร์ลแบบไร้ขอบ */
    .right-panel { width: 440px !important; display: flex; flex-direction: column; gap: 15px; pointer-events: auto; flex: 1; min-height: 0; animation: slideInRight 0.4s cubic-bezier(0.25, 0.8, 0.25, 1); overflow-y: auto; scrollbar-width: none; }
    .right-panel::-webkit-scrollbar { display: none; } /* 📍 ซ่อน Scrollbar ให้ UI ดูคลีนสไตล์ Sci-Fi */

    /* 📍 ฟันธง: อัปเกรดหัวข้อแผงขวา เปลี่ยนฟอนต์เป็นสีขาวล้วนให้ลอยเด่น และแยกแสงออร่าตามกรุ๊ป */
    .control-group p { text-align: center; margin: 0 0 18px 0; font-size: 18px !important; font-weight: 900; letter-spacing: 4px !important; padding-bottom: 10px !important; color: #ffffff !important; }
    .control-group:nth-child(1) p { border-bottom: 1px dashed rgba(255, 204, 0, 0.5); text-shadow: 0 0 12px rgba(255, 204, 0, 0.8); }
    .control-group:nth-child(2) p { border-bottom: 1px dashed rgba(0, 255, 102, 0.5); text-shadow: 0 0 12px rgba(0, 255, 102, 0.8); }
    .control-group:nth-child(3) p { border-bottom: 1px dashed rgba(0, 234, 255, 0.5); text-shadow: 0 0 12px rgba(0, 234, 255, 0.8); }
    
    /* 📍 ขยายขนาดปุ่มทั้งหมด: Padding จาก 12px เป็น 16px และขยายฟอนต์จาก 15px เป็น 18px */
    .btn { display: block; width: 100%; background: rgba(0, 15, 30, 0.5); border: 1px solid rgba(0, 234, 255, 0.5); color: var(--cyan); padding: 16px !important; margin-bottom: 12px; font-family: 'Rajdhani', sans-serif; font-size: 18px !important; font-weight: 800; cursor: pointer; text-align: center; border-radius: 6px; transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); letter-spacing: 2px !important; text-transform: uppercase; text-shadow: 0 0 8px rgba(0, 234, 255, 0.6); box-shadow: 0 5px 15px rgba(0,0,0,0.4); position: relative; overflow: hidden; }
    
    .btn::before { content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent); transform: skewX(-20deg); transition: 0.5s; }
    .btn:hover::before { left: 150%; }
    .btn:disabled { opacity: 0.3; pointer-events: none; filter: grayscale(100%); }
    .speed-row { display: flex; gap: 8px; margin-bottom: 8px; }

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
    .control-group:nth-child(1) p { color: var(--gold); border-bottom-color: rgba(255, 204, 0, 0.5); text-shadow: 0 0 10px var(--gold); }
    
    /* 📍 บังคับให้ปุ่มทุกตัวในกลุ่มนี้เป็นสีทองเรืองแสง (ยกแผง) */
    .control-group:nth-child(1) .btn { border-color: rgba(255,204,0,0.4) !important; color: var(--gold) !important; text-shadow: 0 0 8px var(--gold) !important; background: rgba(255,204,0,0.05) !important; }
    
    /* 📍 คืนชีพสีส้มการ์เดียน (Hover) กลับมาสว่างวาบ พร้อมเปลี่ยนอักษรเป็นสีขาวมีเงาดำ */
    .control-group:nth-child(1) .btn:hover { background: linear-gradient(135deg, #ffcc00, #ff6600) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: 0 0 8px rgba(0,0,0,0.8) !important; transform: translateY(-2px); }
    
    /* 📍 คืนชีพสีส้มการ์เดียน (Active - เช่น ปุ่มที่กำลังกดอยู่) */
    .control-group:nth-child(1) .btn.active { background: linear-gradient(135deg, #ffcc00, #ff8800) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--gold) !important; text-shadow: 0 0 8px rgba(0,0,0,0.8) !important; }

    /* 📍 แยกเป้าหมายเฉพาะปุ่ม PAUSE ให้เป็นสีแดงอันตราย! */
    .control-group:nth-child(1) .btn.btn-pause { border-color: rgba(255,51,51,0.6) !important; color: var(--red) !important; text-shadow: 0 0 8px var(--red) !important; background: rgba(255,51,51,0.05) !important; }
    .control-group:nth-child(1) .btn.btn-pause:hover, .control-group:nth-child(1) .btn.btn-pause.active { background: linear-gradient(135deg, #ff3333, #aa0000) !important; color: #fff !important; border-color: #fff !important; box-shadow: 0 0 25px var(--red) !important; text-shadow: 0 0 8px rgba(0,0,0,0.8) !important; }

    /* 📍 สไตล์ปุ่มเครื่องเล่นเทป (Media Controls) - ซ่อนข้อความ ขยายไอคอน */
    .media-btn { display: flex !important; flex-direction: row; align-items: center; justify-content: center; padding: 14px !important; }
    .media-btn .icon { font-size: 32px; line-height: 1; filter: drop-shadow(0 0 10px currentColor); }

    /* 🖥️ กลุ่มที่ 2: DISPLAY CONTROLS (ขอบเขียว) */
    .control-group:nth-child(2) { border-color: var(--green); border-top-color: var(--green); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 20px rgba(0, 255, 102, 0.15), inset 0 0 20px rgba(0, 255, 102, 0.05); }
    .control-group:nth-child(2) p { color: var(--green); border-bottom-color: rgba(0, 255, 102, 0.4); text-shadow: 0 0 10px var(--green); }

    /* 🌟 เพิ่มคลาสปุ่มสีทอง (Gold) สำหรับ PASS SCHEDULE */
    .btn-gold { background: rgba(255, 204, 0, 0.05) !important; border: 1px solid rgba(255, 204, 0, 0.5) !important; color: var(--gold) !important; text-shadow: 0 0 8px var(--gold) !important; }
    .btn-gold:hover, .btn-gold.active { background: var(--gold) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--gold) !important; transform: scale(1.02) !important; }

    /* 🛠️ กลุ่มที่ 3: DATA & TOOLS (ล้าง Hover สีส้มทิ้ง สร้างคลาสสีมาตรฐาน Invert Color) */
    .control-group:nth-child(3) { border-color: var(--cyan); border-top-color: var(--cyan); box-shadow: 0 10px 30px rgba(0,0,0,0.8), 0 0 30px rgba(0, 234, 255, 0.2), inset 0 0 20px rgba(0, 234, 255, 0.1); }
    .control-group:nth-child(3) p { color: var(--cyan); border-bottom-color: rgba(0, 234, 255, 0.4); text-shadow: 0 0 10px var(--cyan); }
    .control-group:nth-child(3) button { transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important; }
    
    .btn-cyan { background: rgba(0, 15, 30, 0.6) !important; border: 1px solid rgba(0, 234, 255, 0.5) !important; color: var(--cyan) !important; text-shadow: 0 0 8px rgba(0, 234, 255, 0.5) !important; box-shadow: inset 0 0 10px rgba(0, 234, 255, 0.05) !important; }
    .btn-cyan:hover, .btn-cyan.active { background: var(--cyan) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--cyan) !important; transform: scale(1.02) !important; }

    .btn-red { background: rgba(255, 51, 51, 0.05) !important; border: 1px solid rgba(255, 51, 51, 0.5) !important; color: var(--red) !important; text-shadow: 0 0 8px var(--red) !important; }
    .btn-red:hover, .btn-red.active { background: var(--red) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 30px var(--red) !important; transform: scale(1.02) !important; }

    .btn-green { background: rgba(0, 255, 102, 0.05) !important; border: 1px solid rgba(0, 255, 102, 0.5) !important; color: var(--green) !important; text-shadow: 0 0 8px var(--green) !important; }
    .btn-green:hover, .btn-green.active { background: var(--green) !important; color: #000 !important; border-color: #fff !important; text-shadow: none !important; box-shadow: 0 0 25px var(--green) !important; transform: scale(1.02) !important; }

    /* 🗓️ ปุ่มล่างสุด PASS SCHEDULE (ขอบทอง -> Hover ทองอร่าม) ขยายให้ใหญ่สมส่วน */
    .right-panel > button:last-child { background: linear-gradient(145deg, rgba(30, 15, 0, 0.8), rgba(10, 5, 0, 0.9)) !important; border: 2px solid var(--gold) !important; color: var(--gold) !important; padding: 18px !important; font-size: 20px !important; font-weight: 900 !important; letter-spacing: 3px !important; box-shadow: 0 0 20px rgba(255, 204, 0, 0.2), inset 0 0 10px rgba(255, 204, 0, 0.1) !important; margin-top: 5px; }
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

    /* 2D MAP */
    .flat-map-wrap { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--bg); display: flex; align-items: center; justify-content: center; z-index: 5; padding: 25px 320px 25px 420px; box-sizing: border-box; transition: padding 0.3s ease-in-out; }
    .flat-map-wrap.panel-closed { padding-right: 25px; }
    .flat-map-wrap.left-panel-closed { padding-left: 25px; }
    .flat-map-container { position: relative; width: 100%; aspect-ratio: 2 / 1; max-height: 100vh; max-width: 200vh; background-color: #000; box-shadow: 0 0 50px rgba(0, 234, 255, 0.3); border: 2px solid var(--cyan); border-radius: 8px; overflow: hidden; }
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

// ==========================================
// 4. MAIN APP
// ==========================================
export default function App() {
  
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
  
  const [sliderMode, setSliderMode] = useState('DAILY');

// 📍 สมองกลควบคุมการกดค้างปุ่มข้ามเวลา (Hold to Seek)
const seekRef = useRef({ isHolding: false, interval: null, timeout: null });

const handleSeekDown = (amount) => {
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

 useEffect(() => {
   // 📍 ฟันธง: เปลี่ยนมาดึงค่าจาก activeStation แทน GROUND_STATION ที่เป็น Global 
   const lat = activeStation.lat;
   const lng = activeStation.lng;
   setIsFetchingCloud(true);

   const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=cloud_cover&forecast_days=3&timezone=UTC`;
   
   fetch(url)
     .then(r => r.json())
     .then(data => {
       if (data && data.hourly && data.hourly.cloud_cover) {
         const nowMs = simulatedTimeMs;
         let closestIdx = 0;
         let minDiff = Infinity;
         
         data.hourly.time.forEach((tStr, idx) => {
           const tMs = new Date(tStr + 'Z').getTime();
           const diff = Math.abs(tMs - nowMs);
           if (diff < minDiff) {
             minDiff = diff;
             closestIdx = idx;
           }
         });
         
         setCloudCover(data.hourly.cloud_cover[closestIdx]);
       }
       setIsFetchingCloud(false);
     })
     .catch(err => {
       console.warn("Cloud API Error:", err);
       setIsFetchingCloud(false);
     });
 }, [Math.floor(simulatedTimeMs / 3600000), activeStation.id]); // <-- 📍 ฟันธง: เพิ่ม activeStation.id ตรงนี้! เพื่อบังคับให้ดึงข้อมูลใหม่ทันทีที่กดสลับปุ่มสถานี

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

 // 📍 อัปเดต Z-Index ให้รองรับหน้าต่างใหม่ (img)
 const [windowZ, setWindowZ] = useState({ radar: 9997, pass: 9998, db: 9999, gs: 9996, img: 10000 });

 // 📍 ฟันธง: สมองกลควบคุมระบบ Maximize (ขยายเต็มจอ) ของหน้าต่างทั้งหมด
 const [maximizedWins, setMaximizedWins] = useState({ radar: false, pass: false, db: false, img: false, gs: false });
 const toggleMaximize = (winName) => {
   setMaximizedWins(prev => ({ ...prev, [winName]: !prev[winName] }));
   bringToFront(winName);
 };

  
 const bringToFront = (winName) => {
   setWindowZ(prev => {
     const maxZ = Math.max(...Object.values(prev));
     if (prev[winName] === maxZ) return prev; 
     return { ...prev, [winName]: maxZ + 1 }; 
   });
 };

 // 📍 ฟันธง: สมองกลควบคุมหน้าต่าง IMAGING PLAN VIEWER
 const [isImgOpen, setIsImgOpen] = useState(false);

 const [customAlert, setCustomAlert] = useState({ show: false, message: '', type: 'success' });

 const [sourcePlans, setSourcePlans] = useState(typeof THEOS2_IMAGING_PLAN !== 'undefined' ? THEOS2_IMAGING_PLAN : []);

// 📍 ฟังก์ชันจัดการเมื่อกดอัปโหลดไฟล์ PDF
const handlePdfUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
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
const [gsPos, setGsPos] = useState({ x: 20, y: 150 });
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
            globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng }, 0);
          }
        }
      } catch (err) { }
    }
  }, [simulatedTimeMs, selectedCatnr, isFlatMap, isPlaying, satrecs]);

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
    // 📍 ฟันธง: หรี่ไฟบรรยากาศโลกให้ต่ำสุดตอนกลางคืน ลบสีฟ้าทิ้ง เพื่อให้เงามืดดำสนิท
    ambient.intensity = realtimeSun ? 0.05 : 1.2; 
    ambient.color.setHex(0xffffff); 
  }

  let sunLight = scene.children.find(c => c.name === 'SunLight');
  if (!sunLight) {
    // 📍 ฟันธง: บูสต์แสงอาทิตย์ (DirectionalLight) ให้สว่างจ้ากระแทกตาสู้กับแผนที่เมฆ (จาก 2.8 เป็น 5.5)
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
    // 📍 ฟันธง: เปลี่ยน HemisphereLight เป็นสีขาว-ดำ และลดความแรงลงสุดๆ เพื่อไม่ให้ทะเลเรืองแสงสีน้ำเงินในตอนกลางคืน
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.05); 
    hemiLight.name = 'HemiLight';
    scene.add(hemiLight);
  }
  hemiLight.visible = realtimeSun;

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
            // 📍 1. สมมาตร Day/Night Line
            float intensity = dot(normalize(vWorldNormal), normalize(sunDirection));
            float nightMix = 1.0 - smoothstep(-0.15, 0.15, intensity);
            
            vec4 nightTex = texture2D(tNight, vUv);
            
            // 📍 2. ฟันธง! คำนวณความสว่าง (Brightness/Luma) ของภาพแผนที่
            float brightness = dot(nightTex.rgb, vec3(0.299, 0.587, 0.114));
            
            // 📍 3. Luma Key: "ฆ่าสีน้ำเงินทิ้ง!" พิกเซลไหนมืด (น้ำทะเล) ให้กลายเป็น 0 (ดำสนิท) 
            float mask = smoothstep(0.08, 0.20, brightness); 
            
            // 📍 4. บูสต์ไฟเมืองสีทองเฉพาะจุดที่สว่าง (ไฟเมืองจะพุ่งทะลุจอ)
            vec3 cityLights = nightTex.rgb * mask * vec3(3.5, 2.5, 1.2);
            
            // 📍 5. บังคับพื้นหลังฝั่งกลางคืนให้เป็น "สีดำอวกาศ (True Black 0,0,0)" 1,000,000%
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
  const targetData = targetSatrec ? calculateSatData(currentDate, targetSatrec) : null;
  const targetConfig = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr) || SATELLITE_OPTIONS[0];
  // 📍 ฟันธง: อัปเดต linkActive ให้ทำงานตาม stationMask แบบ Real-time
  const linkActive = targetData && targetData.elevationDeg >= stationMask;

  // 📍 ฟันธง: สมองกลตัวนับถอยหลัง ดึงข้อมูลอ้างอิงจากตาราง PASS SCHEDULE โดยตรง! (ข้อมูลจะตรงกัน 1,000,000%)
  const nextPassTimestamp = useMemo(() => {
    if (linkActive || passSchedule.length === 0) return null;
    
    // หา Pass แรกสุดที่เวลา AOS (เริ่มเข้าขอบฟ้า) ยังมาไม่ถึง (เวลาอนาคต)
    const upcomingPass = passSchedule.find(p => p.aosTime > simulatedTimeMs);
    
    if (upcomingPass) {
      return { time: upcomingPass.aosTime, maxEl: upcomingPass.maxEl };
    }
    return null;
  }, [simulatedTimeMs, passSchedule, linkActive]);

// 📍 1. อัปเกรดเป็น useRef แทน State เพื่อความเร็วระดับมิลลิวินาที ป้องกันการยิง API ซ้ำ (Race Condition)
const notifiedPassesRef = useRef({});

// 📍 2. สมองกลเซนเซอร์จับเวลาล่วงหน้า 10 นาที (Pre-AOS Trigger)
useEffect(() => {
  // 📍 ฟันธง: สร้างตัวแปรเช็คความเป็น LIVE อ้างอิงจากเวลาจริงแบบเป๊ะๆ
  const isLive = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying;
  
  // 📍 ฟันธง: ถ้าไม่ได้อยู่ในโหมด LIVE (คือเล่นซิมไถลบาร์เวลาอยู่) ให้เบรกทันที! ป้องกันยิง LINE รัวๆ
  if (!nextPassTimestamp || !nextPassTimestamp.time || !isLive) return;
  
  const timeToAos = nextPassTimestamp.time - simulatedTimeMs;
  const TEN_MINUTES_MS = 600000; 
  
  // 📍 ฟันธง: ปัดเศษเวลาให้กว้างระดับ "1 ชั่วโมง (3600000 ms)" 
  // ดาวเทียม LEO 1 รอบใช้เวลา ~90 นาที ไม่มีทางซ้อนทับกันในชั่วโมงเดียวกัน ป้องกัน ID แกว่ง 100%
  const stableAosTime = Math.floor(nextPassTimestamp.time / 3600000) * 3600000;
  const passId = `AOS-${selectedCatnr}-${stableAosTime}`;

  if (timeToAos <= TEN_MINUTES_MS && timeToAos > 0 && !notifiedPassesRef.current[passId]) {
    // 📍 ล็อกประตูทันที! เขียนลง useRef จะบล็อกการยิงซ้ำแบบ Real-time
    notifiedPassesRef.current[passId] = true;

    const upcomingPass = passSchedule.find(p => p.aosTime === nextPassTimestamp.time);
    
    if (upcomingPass) {
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(upcomingPass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: false, 
        satName: targetConfig.displayName,
        flagUrl: flagUrl,
        station: GROUND_STATION.name,
        doy: doyStr,
        aosUtc: new Date(upcomingPass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: new Date(upcomingPass.aosTime).toLocaleTimeString('en-GB') + ' THA',
        losUtc: new Date(upcomingPass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: new Date(upcomingPass.losTime).toLocaleTimeString('en-GB') + ' THA',
        maxEl: upcomingPass.maxEl.toFixed(1),
        duration: `${Math.floor(upcomingPass.durationMs / 60000)}m ${Math.floor((upcomingPass.durationMs % 60000)/1000)}s`
      };
      
      const gasUrl = 'https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec';
      
      fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
        body: JSON.stringify(payloadData) 
      })
      .then(response => console.log(`[LINE] ยิงแจ้งเตือน 10 นาที (AOS) สำเร็จ! ID: ${passId}`))
      .catch(err => {
         console.error("LINE Notify Error:", err);
         notifiedPassesRef.current[passId] = false; // ถ้าส่งล้มเหลว ค่อยปลดล็อกให้ระบบพยายามส่งใหม่
      });
    }
  }
}, [simulatedTimeMs, nextPassTimestamp, selectedCatnr, targetConfig, speedMult, isPlaying, passSchedule]);


// 📍 3. สมองกลเซนเซอร์จับจังหวะ "จบ Pass (LOS Notification)"
useEffect(() => {
  // 📍 ฟันธง: เสริมเกราะป้องกัน SIM Mode ให้อีกชั้นที่นี่!
  const isLive = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying;
  
  // 📍 ฟันธง: ตัดจบการทำงานทันทีถ้าไม่ได้อยู่โหมด LIVE เพื่อรักษา Token LINE
  if (passSchedule.length === 0 || !isLive) return;

  passSchedule.forEach(pass => {
    // 📍 ปัดเศษระดับ "1 ชั่วโมง" ป้องกัน ID แกว่ง
    const stableLosTime = Math.floor(pass.losTime / 3600000) * 3600000;
    const passIdLos = `LOS-${selectedCatnr}-${stableLosTime}`;
    
    const timeSinceLos = simulatedTimeMs - pass.losTime;
    
    if (timeSinceLos >= 0 && timeSinceLos <= 15000 && !notifiedPassesRef.current[passIdLos]) {
      // 📍 ล็อกประตูทันที!
      notifiedPassesRef.current[passIdLos] = true; 
      
      const flagUrl = targetConfig.flag ? `https://flagcdn.com/w40/${targetConfig.flag}.png` : 'https://raw.githubusercontent.com/line/line-bot-sdk-nodejs/master/examples/kitchensink/public/logo.png';
      const doyStr = String(getUtcDayOfYear(new Date(pass.aosTime))).padStart(3, '0');

      const payloadData = {
        isLos: true, 
        satName: targetConfig.displayName,
        flagUrl: flagUrl,
        station: GROUND_STATION.name,
        doy: doyStr,
        aosUtc: new Date(pass.aosTime).toISOString().substring(11, 19) + ' UTC',
        aosLocal: new Date(pass.aosTime).toLocaleTimeString('en-GB') + ' THA',
        losUtc: new Date(pass.losTime).toISOString().substring(11, 19) + ' UTC',
        losLocal: new Date(pass.losTime).toLocaleTimeString('en-GB') + ' THA',
        maxEl: pass.maxEl.toFixed(1),
        duration: `${Math.floor(pass.durationMs / 60000)}m ${Math.floor((pass.durationMs % 60000)/1000)}s`
      };
      
      const gasUrl = 'https://script.google.com/macros/s/AKfycbycFFsbPQW1tc6GJXyKZ9B4h31BY1-OK735ukxpflIRjUKIsEznMkUIMA4Ha-ywN5TL/exec';
      
      fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
        body: JSON.stringify(payloadData)
      })
      .then(response => console.log(`[LINE] ยิงแจ้งเตือน LOS (PASS COMPLETE) สำเร็จ! ID: ${passIdLos}`))
      .catch(err => {
         console.error("LINE Notify Error:", err);
         notifiedPassesRef.current[passIdLos] = false;
      });
    }
  });
}, [simulatedTimeMs, passSchedule, selectedCatnr, targetConfig, speedMult, isPlaying]);

  const allSatObjects = useMemo(() => {
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
  }, [currentDate, satrecs, selectedCatnr, selectedCatnrs]); 

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

 // 📍 ฟันธง 2: ระบบวาดเส้นแดงบน 3D (อัปเกรดให้รองรับไฟล์ PDF และกันบั๊กเวลา)
const imagingSwathPaths = useMemo(() => {
  if (!targetSatrec || selectedCatnr !== '58016') return []; 
  const paths = [];
  
  sourcePlans.forEach(plan => {
    const points = [];
    // แปลงเวลาให้เป็นตัวเลข Number ที่แน่นอน ป้องกันบั๊ก String ทับซ้อน
    const pStart = new Date(plan.start).getTime();
    const pEnd = new Date(plan.end).getTime();

    if (simulatedTimeMs > pEnd) return;

    for (let t = pStart; t <= pEnd; t += 1000) {
      const pos = calculateSatData(new Date(t), targetSatrec);
      if (pos && !isNaN(pos.lat) && !isNaN(pos.lng)) {
        points.push({ lat: pos.lat, lng: pos.lng, alt: 0.002 });
      }
    }
    
    if (points.length >= 2) {
      const isImagingNow = simulatedTimeMs >= pStart && simulatedTimeMs <= pEnd;
      paths.push({ 
        points, 
        color: isImagingNow ? 'rgba(255, 51, 51, 1)' : 'rgba(255, 100, 51, 0.45)', 
        stroke: isImagingNow ? 6.0 : 4.0 
      });
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
  
// 📍 อัปเกรดเส้นขอบ Footprint ให้เนียนกริบและเป็นสีแดง Tactical ตามบัญชา Commander!
const footprintBoundaryPath = useMemo(() => {
  const paths = [];
  allSatObjects.forEach(sat => {
    if (selectedCatnrs.includes(sat.catnr)) {
      const isPrimary = sat.catnr === selectedCatnr;
      const radiusDeg = getFootprintRadiusDeg(sat.altKm, stationMask);
      if (!isNaN(radiusDeg)) {
        // 📍 ฟันธง: เพิ่มความละเอียดวงกลมเป็น 128 จุดให้เนียนกริบ และยกลอยขึ้นมาที่ alt: 0.005
        const pts = getCirclePolygon(sat.lat, sat.lng, radiusDeg, 128).map(c => ({ lng: c[0], lat: c[1], alt: 0.005 }));
        if (pts.length >= 3) {
          paths.push({
            points: pts,
            // 📍 ฟันธง: ใช้สีแดงสดสว่างวาบ (Red Solid) สำหรับเป้าหมายหลัก
            color: isPrimary ? 'rgba(255, 51, 51, 0.95)' : 'rgba(255, 51, 51, 0.3)',
            // 📍 ฟันธง: เพิ่มความหนาของเส้น (Stroke) ให้ชัดเจนทะลุจอ!
            stroke: isPrimary ? 2.5 : 1.0 
          });
        }
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
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
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
        setTleSource(`Live Update (${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())})`);
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
    const uiScale = Math.max(1, Math.min(1.8, radarDim.w / 360)); 
    // 📍 ฟันธง: เพิ่ม Margin บนและล่าง เพื่อสร้าง Safe Zone ให้ตัวหนังสือลอยได้อย่างอิสระ ไม่บัง UI
    const topMargin = 95 * uiScale; 
    const bottomMargin = 65 * uiScale;
    const sideMargin = 45 * uiScale;
    const R = Math.max(50, Math.min(radarDim.w - sideMargin * 2, radarDim.h - topMargin - bottomMargin) / 2);
    const cx = radarDim.w / 2;
    const cy = (radarDim.h - topMargin - bottomMargin) / 2 + topMargin - 10; 
    return { R, cx, cy, uiScale };
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

  return (
    <>
      <Globe
        ref={globeRef} width={size.width} height={size.height}
        backgroundColor="#000000"
        
        /* 📍 ฟันธง: ปลดล็อก 3D Globe ให้ดึงรูปจากระบบ Theme ตามที่ Commander สั่ง! */
        globeImageUrl={mapThemes[mapThemeIdx].url}
        
        /* 📍 รักษาระบบภูมิประเทศภูเขา (Bump Map) ให้สมจริงเหมือนเดิม */
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        
        /* 📍 รักษาออร่าชั้นบรรยากาศสีฟ้าให้คงอยู่เหมือนเดิม */
        showAtmosphere={true}
        atmosphereColor="#00b3ff"
        atmosphereAltitude={0.15}
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
            if (globeRef.current) {
              // ฟันธง: ซูมกล้องถอยหลังให้พ้นระยะความสูงของดาวเทียม (GEO สูงมาก กล้องต้องถอยไกล)
              const camAlt = Math.max(0.4, (d.altKm / EARTH_RADIUS_KM) + 0.5);
              globeRef.current.pointOfView({ lat: d.lat, lng: d.lng, altitude: camAlt }, 1000);
            }
          }
        }}

        htmlElementsData={[
          { type: 'station', lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, name: GROUND_STATION.name, altitude: 0 },
          ...allSatObjects.filter(sat => sat.isTarget)
        ]}
        htmlLat="lat" htmlLng="lng" htmlAltitude="altitude"
        htmlElement={d => {
          const el = document.createElement('div');
          
         /* 📍 ถ้าเป็นสถานีภาคพื้นดิน (ระบบเลือกโหมดแสดงผล Dynamic) */
         if (d.type === 'station') {
          if (stationDisplayMode === 'none') {
            el.innerHTML = ``; // ไม่แสดงอะไรเลย (ล่องหน)
          } else {
            const showIcon = stationDisplayMode === 'both' || stationDisplayMode === 'icon';
            const showName = stationDisplayMode === 'both' || stationDisplayMode === 'name';
            
            el.innerHTML = `
              <div style="position: relative; display: flex; align-items: center; justify-content: center; pointer-events: none;">
                ${showIcon ? `<span style="font-size: 38px; line-height: 1; filter: drop-shadow(0 0 15px #00eaff);">📡</span>` : `<span style="width: 38px; height: 38px; display: inline-block;"></span>`}
                ${showName ? `<span style="position: absolute; top: 100%; left: 50%; transform: translateX(-50%); color: #00eaff; font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 14px; text-shadow: 0 0 8px #000, 0 0 15px #00eaff; margin-top: 4px; letter-spacing: 1.5px; white-space: nowrap;">${d.name}</span>` : ''}
              </div>
            `;
          }
        }
          /* 📍 ถ้าเป็นดาวเทียมเป้าหมาย */
          else {
            const satInfo = SATELLITE_OPTIONS.find(s => s.catnr === d.catnr);
            const flagUrl = satInfo?.flag ? `https://flagcdn.com/w20/${satInfo.flag}.png` : '';
            el.innerHTML = `
              <div style="display: flex; align-items: center; color: #fff; font-family: 'Rajdhani', sans-serif; font-size: 15px; font-weight: 900; letter-spacing: 1px; text-shadow: 0 0 5px #000, 0 0 15px #00eaff; transform: translate(15px, -15px); pointer-events: none; white-space: nowrap;">
                ${flagUrl ? `<img src="${flagUrl}" style="width:20px; margin-right:8px; border-radius:2px; box-shadow: 0 0 8px rgba(0,234,255,0.8);" />` : ''}
                ${d.name}
              </div>`;
          }
          return el;
        }}

    

        pathsData={pathsToDraw3D}
        pathPoints="points"
        pathPointLat="lat" pathPointLng="lng" pathPointAlt="alt"
        pathColor="color" pathStroke="stroke"
        pathResolution={4}
        pathTransitionDuration={0}

        /* 📍 ฟันธง 4: สั่งให้เฉพาะเส้นที่ฝังแท็ก isSignal วิ่งเป็นช็อตๆ ลงมาที่สถานี */
        pathDashLength={d => d.isSignal ? 0.05 : 0}
        pathDashGap={d => d.isSignal ? 0.05 : 0}
        pathDashAnimateTime={d => d.isSignal ? 1500 : 0}
        
        ringsData={[{ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng }]}
        ringColor={() => linkActive ? t => `rgba(255, 170, 0, ${1-t})` : t => `rgba(255, 51, 51, ${1-t})`}
        ringMaxRadius={linkActive ? 8 : 4}
        ringPropagationSpeed={1.5}
        ringRepeatPeriod={800}
      />

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
              
            </div> {/* 📍 ปิดแท็กกล่อง Inner Wrapper */}
          </div>
        </div>
      )}

      <div className="ui-layer">

      <div className="left-container">
          {/* 📍 แถวควบคุมหลักด้านบนซ้าย: เพิ่ม flexShrink: 0 ป้องกันเมนูบีบตัว */}
          <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-start', pointerEvents: 'none', marginBottom: '15px', zIndex: 100, flexShrink: 0 }}>
            
            <button 
              className="menu-toggle-btn-left"
              onClick={toggleLeftPanel}
              style={{ pointerEvents: 'auto', marginBottom: 0 }}
            >
              {isLeftPanelOpen ? '✕' : '☰'}
            </button>

            <div className="global-clock-hud" style={{ margin: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                <div className="clock-item">
                  <span>THA LOCAL</span>
                  <strong>{formatTime(thaiTime)}</strong>
                </div>
                <div className="clock-item doy-item">
                  <span>DOY</span>
                  <strong>{pad3(getUtcDayOfYear(currentDate))}</strong>
                </div>
                <div className="clock-item">
                  <span>UTC</span>
                  <strong>{formatTime(currentDate)}</strong>
                </div>
              </div>
            </div>
          </div>
          
          {/* 📍 ปลดล็อก Scrollbar ให้แผงซ้าย */}
          {isLeftPanelOpen && (
          <div className="left-panel" style={{ width: '517px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', flex: 1, overflowY: 'auto', paddingBottom: '30px', msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
            
            <div className="panel-box" style={{ textAlign: 'center', padding: '20px 15px', background: 'rgba(0, 10, 20, 0.45)', border: '1px solid rgba(0, 234, 255, 0.5)', borderRadius: '4px', boxShadow: '0 0 20px rgba(0, 234, 255, 0.2) inset' }}>
              <h1 style={{ margin: '0 0 8px 0', fontFamily: 'Orbitron, sans-serif', fontSize: '30px', fontWeight: '900', color: '#ffffff', textShadow: '0 0 15px #00eaff, 0 0 30px #00eaff', letterSpacing: '2px' }}>SATELLITE ORBIT</h1>
              <span style={{ display: 'block', fontSize: '16px', color: '#ffaa00', fontWeight: '600', letterSpacing: '2px', textShadow: '0 0 8px rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>Thailand Satellite Ground Station</span>
            </div>

            {/* ☁️ CLOUD COVER FORECAST HUD */}
            <div className="panel-box" style={{ padding: '15px 20px', background: 'linear-gradient(145deg, rgba(0, 20, 35, 0.85), rgba(0, 5, 15, 0.95))', border: '1px solid var(--cyan)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px dashed rgba(0,234,255,0.3)', paddingBottom: '6px', gap: '5px' }}>
                <span style={{ fontFamily: 'Orbitron', fontSize: '16px', color: 'var(--cyan)', fontWeight: 'bold', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>ATMOSPHERIC CLOUD COVER</span>
                <span style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)', fontFamily: 'Rajdhani', whiteSpace: 'nowrap', flexShrink: 0 }}>OPEN-METEO API</span>
              </div>
              
              {/* 📍 ฟันธง: แก้ flexWrap ออก บังคับให้อยู่บรรทัดเดียวกันเสมอ และจัด align ให้ชิดขอบล่าง (flex-end) */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ flex: '1', overflow: 'hidden' }}>
                  {/* 📍 ฟันธง: ใช้ clamp() เพื่อให้ฟอนต์หดตัวอัตโนมัติเมื่อจอแคบ ป้องกันตัวหนังสือล้นกรอบ */}
                  <div style={{ fontSize: 'clamp(12px, 1.2vw, 16px)', fontFamily: 'Orbitron', fontWeight: 'bold', color: cloudCover < 30 ? 'var(--green)' : (cloudCover < 70 ? 'var(--gold)' : 'var(--red)'), lineHeight: '1.2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cloudCover === null ? 'ANALYZING...' : (cloudCover < 30 ? 'NOMINAL (CLEAR)' : (cloudCover < 70 ? 'MODERATE CLOUDS' : 'HIGH OBSCUREMENT'))}
                  </div>
                </div>
                
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 'clamp(22px, 2vw, 28px)', fontFamily: 'Orbitron', fontWeight: '900', color: '#fff', textShadow: '0 0 10px var(--cyan)', lineHeight: '1' }}>
                    {isFetchingCloud ? '--' : `${cloudCover}%`}
                  </div>
                </div>
              </div>
            </div>

            <div className="panel-box mission-status">
              <div className="target-header">
                {targetConfig.flag ? <img src={`https://flagcdn.com/w40/${targetConfig.flag}.png`} alt="flag" /> : <span style={{fontSize: '30px'}}>🛰️</span>}
                <h2>{targetConfig.displayName}</h2>
              </div>

              <style>{`
                @keyframes pulse-glow {
                  0% { box-shadow: 0 0 15px rgba(0, 234, 255, 0.4), inset 0 0 10px rgba(0, 234, 255, 0.2); }
                  50% { box-shadow: 0 0 30px rgba(0, 234, 255, 1), inset 0 0 20px rgba(0, 234, 255, 0.8); }
                  100% { box-shadow: 0 0 15px rgba(0, 234, 255, 0.4), inset 0 0 10px rgba(0, 234, 255, 0.2); }
                }
                .status-banner.active { animation: pulse-glow 2s infinite ease-in-out; }
              `}</style>

              <div className={`status-banner ${linkActive ? 'active' : 'standby'}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '15px 10px' }}>
              {linkActive ? (
              <>
                <span style={{ fontSize: '14px', fontWeight: '900', color: 'rgba(255,255,255,0.8)' }}>SIGNAL ACQUIRED</span>
                <span style={{ fontSize: '32px', fontFamily: 'Orbitron', fontWeight: '900', letterSpacing: '2px', color: 'var(--green)', textShadow: '0 0 20px rgba(0, 255, 102, 0.6)', margin: '2px 0' }}>
                  {(() => {
                    const activePass = passSchedule.find(p => simulatedTimeMs >= p.aosTime && simulatedTimeMs <= p.losTime);
                    if (activePass) {
                      const diffMs = activePass.losTime - simulatedTimeMs;
                      const mins = Math.floor(diffMs / 60000);
                      const secs = Math.floor((diffMs % 60000) / 1000);
                      return `- ${pad2(mins)}m ${pad2(secs)}s`;
                    }
                    return "TRACKING...";
                  })()}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--green)', letterSpacing: '2px' }}>TIME TO LOS (END OF PASS)</span>
              </>
                ) : nextPassTimestamp && nextPassTimestamp.time && (nextPassTimestamp.time > simulatedTimeMs) ? (
                   <>
                     <span style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)', letterSpacing: '1px' }}>NEXT PASS (AOS) IN</span>
                     <span style={{ fontSize: '35px', fontFamily: 'Orbitron', fontWeight: '900', letterSpacing: '2px', color: 'var(--gold)', textShadow: '0 0 15px rgba(255, 204, 0, 0.5)', margin: '2px 0' }}>
                       {(() => {
                         const diffMs = nextPassTimestamp.time - simulatedTimeMs;
                         const hrs = Math.floor(diffMs / 3600000);
                         const mins = Math.floor((diffMs % 3600000) / 60000);
                         const secs = Math.floor((diffMs % 60000) / 1000);
                         return `- ${pad2(hrs)}h ${pad2(mins)}m ${pad2(secs)}s`;
                       })()}
                     </span>
                     <span style={{ fontSize: '16px', color: 'rgba(255, 255, 255, 0.6)' }}>EXPECTED MAX EL: <strong style={{color: 'var(--cyan)', fontSize: '16px'}}>{nextPassTimestamp.maxEl.toFixed(1)}°</strong></span>
                   </>
                ) : (
                   <span style={{ fontSize: '16px' }}>NO UPCOMING PASS</span>
                )}
              </div>

              <div className="telemetry-grid">
                {/* 📍 พิกัด (เปลี่ยนเป็นสีฟ้าเนวิเกเตอร์) */}
                <div className="t-box"><span>LATITUDE</span><strong style={{ color: '#33ccff', textShadow: '0 0 10px rgba(51, 204, 255, 0.4)' }}>{targetData && !isNaN(targetData.lat) ? targetData.lat.toFixed(4) : '---'}°</strong></div>
                <div className="t-box"><span>LONGITUDE</span><strong style={{ color: '#33ccff', textShadow: '0 0 10px rgba(51, 204, 255, 0.4)' }}>{targetData && !isNaN(targetData.lng) ? targetData.lng.toFixed(4) : '---'}°</strong></div>
                
                {/* 🎯 มุมชี้เป้า (สีเขียวเรืองแสง) */}
                <div className={`t-box ${linkActive ? 'highlight' : ''}`}><span>ELEVATION</span><strong style={{ color: 'var(--green)', textShadow: '0 0 10px rgba(0, 255, 102, 0.4)' }}>{targetData && !isNaN(targetData.elevationDeg) ? targetData.elevationDeg.toFixed(2) : '---'}°</strong></div>
                <div className="t-box"><span>AZIMUTH</span><strong style={{ color: 'var(--green)', textShadow: '0 0 10px rgba(0, 255, 102, 0.4)' }}>{targetData && !isNaN(targetData.azimuthDeg) ? targetData.azimuthDeg.toFixed(2) : '---'}°</strong></div>
                
                {/* 📏 ระยะทาง (สีเหลืองทอง) */}
                <div className="t-box"><span>SLANT RANGE</span><strong style={{ color: 'var(--gold)', textShadow: '0 0 10px rgba(255, 204, 0, 0.4)' }}>{targetData && !isNaN(targetData.rangeKm) ? Math.round(targetData.rangeKm).toLocaleString() : '---'} km</strong></div>
                <div className="t-box"><span>ALTITUDE</span><strong style={{ color: 'var(--gold)', textShadow: '0 0 10px rgba(255, 204, 0, 0.4)' }}>{targetData && !isNaN(targetData.altKm) ? targetData.altKm.toFixed(0) : '---'} km</strong></div>
                
                {/* 🚀 ไดนามิกวงโคจร (สีส้ม) */}
                <div className="t-box"><span>ORBITAL SPEED</span><strong style={{ color: '#ff6600', textShadow: '0 0 10px rgba(255, 102, 0, 0.4)' }}>{targetData && !isNaN(targetData.speedKmS) ? targetData.speedKmS.toFixed(2) : '---'} km/s</strong></div>
                <div className="t-box"><span>INCLINATION</span><strong style={{ color: '#ff6600', textShadow: '0 0 10px rgba(255, 102, 0, 0.4)' }}>{tles[selectedCatnr] ? getInclinationDeg(tles[selectedCatnr].line2).toFixed(4) : '---'}°</strong></div>
              </div>

              <ul className="info-list">
                {/* ข้อมูลทั่วไป (เปลี่ยนเป็นสีเงินแพลตตินัมให้ดูเป็นทางการ) */}
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Operator / Agency:</span><strong style={{ color: '#e2e8f0', textAlign: 'right' }}>{targetConfig.operator || 'Unknown'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Mission Type:</span><strong style={{ color: '#e2e8f0', textAlign: 'right' }}>{targetConfig.mission || 'Various'}</strong></li>
                
                {/* ข้อมูลระยะ (สีเหลืองทอง) */}
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Orbit Class:</span><strong style={{ color: 'var(--gold)', textAlign: 'right' }}>{targetData?.altKm > 2000 ? (targetData?.altKm > 30000 ? 'GEO' : 'MEO') : 'LEO'}</strong></li>
                
                {/* ข้อมูลตัวแปรเรดาร์ (สีเขียว) */}
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Station Mask:</span><strong style={{ color: 'var(--green)', textShadow: '0 0 5px rgba(0, 255, 102, 0.4)', textAlign: 'right' }}>{stationMask.toFixed(1)}°</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Footprint Radius:</span><strong style={{ color: 'var(--green)', textShadow: '0 0 5px rgba(0, 255, 102, 0.4)', textAlign: 'right' }}>{targetData && !isNaN(targetData.altKm) ? Math.round(getFootprintRadiusDeg(targetData.altKm, stationMask) * (Math.PI / 180) * EARTH_RADIUS_KM).toLocaleString() : '---'} km</strong></li>
                
                {/* ข้อมูลการสื่อสาร (สีฟ้าไซแอน) */}
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Telemetry (TT&C):</span><strong style={{ color: 'var(--cyan)', textShadow: '0 0 5px rgba(0, 234, 255, 0.4)', textAlign: 'right' }}>{targetConfig.telemetry || 'N/A'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>Payload Downlink:</span><strong style={{ color: 'var(--cyan)', textShadow: '0 0 5px rgba(0, 234, 255, 0.4)', textAlign: 'right' }}>{targetConfig.payload || 'N/A'}</strong></li>
                
                {/* ข้อมูล TLE (เปลี่ยนเป็นสีเขียวเทอร์มินัล ให้อารมณ์ System Log) */}
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Epoch:</span><strong style={{ color: '#4ade80', fontWeight: '900', textAlign: 'right', textShadow: '0 0 8px rgba(74, 222, 128, 0.4)' }}>{tles[selectedCatnr] ? tles[selectedCatnr].line1.substring(18, 32) : '---'}</strong></li>
                <li><span style={{ color: 'rgba(255, 255, 255, 0.5)' }}>TLE Source:</span><strong style={{ color: '#4ade80', fontWeight: '900', textAlign: 'right', textShadow: '0 0 8px rgba(74, 222, 128, 0.4)' }}>{tleSource}</strong></li>
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
              
        {/* กลุ่มที่ 1: การควบคุมเวลาและความเร็ว */}
        <div className="control-group">
              <p>TIME & PLAYBACK</p>
              
             {/* แถว 1: ปุ่มเครื่องเล่นเทป (Media Controls) เอาข้อความออก ขยายไอคอน */}
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <button className="btn media-btn" onMouseDown={() => handleSeekDown(-30000)} onMouseUp={() => handleSeekUp(-30000)} onMouseLeave={() => handleSeekUp(0)} onTouchStart={() => handleSeekDown(-30000)} onTouchEnd={() => handleSeekUp(-30000)}>
                  <span className="icon">⏪</span>
                </button>
                <button className={`btn media-btn btn-pause ${!isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(false)}>
                  <span className="icon">⏸</span>
                </button>
                <button className={`btn media-btn ${isPlaying ? 'active' : ''}`} onClick={() => setIsPlaying(true)}>
                  <span className="icon">▶</span>
                </button>
                <button className="btn media-btn" onMouseDown={() => handleSeekDown(30000)} onMouseUp={() => handleSeekUp(30000)} onMouseLeave={() => handleSeekUp(0)} onTouchStart={() => handleSeekDown(30000)} onTouchEnd={() => handleSeekUp(30000)}>
                  <span className="icon">⏩</span>
                </button>
              </div>

              {/* แถว 2: ความเร็ว */}
              <div className="speed-row">
                {[1, 100, 300, 500].map(s => (
                  <button key={s} className={`btn ${speedMult === s ? 'active' : ''}`} style={{marginBottom: 0, fontSize: '14px'}} onClick={() => setSpeedMult(s)}>{s}X</button>
                ))}
              </div>

            {/* 📍 ฟันธง: แถว 3 ประกอบร่างป้าย LIVE/SIM คู่กับปุ่ม RESET ปรับขนาดให้สมมาตร 50/50 */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', height: '48px' }}>
                {(() => {
                  const isLive = Math.abs(simulatedTimeMs - Date.now()) < 60000 && speedMult === 1 && isPlaying;
                  return (
                    <div className={`status-badge ${isLive ? 'live' : 'sim'}`} style={{ flex: '1', margin: 0, padding: '0', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '6px', fontSize: '15px', letterSpacing: '2px' }}>
                      {isLive ? '🟢 LIVE' : '🟠 SIM'}
                    </div>
                  );
                })()}
               {/* 📍 ฟันธง: อัปเกรดปุ่ม RESET ให้เคลียร์ค้างการเลือก Plan และซูมทั้งหมด */}
               <button className="btn" style={{ flex: '1', margin: 0, padding: '0', fontSize: '15px', letterSpacing: '2px', display: 'flex', justifyContent: 'center', alignItems: 'center' }} onClick={() => {
                  setSimulatedTimeMs(Date.now());
                  setSpeedMult(1);
                  setIsPlaying(true);
                  isTrackingRef.current = false;
                  setCameraMode('FREE LOOK');
                  
                  // 📍 ฟันธง: ชุดคำสั่ง "ล้างบาง" สถานะที่ค้างอยู่ทั้งหมด!
                  setSelectedPlanId(null); 
                  setMapZoom(1); 
                  setImgMapOrigin('center center'); 
                  setTacticalZoom(1); 
                  setZoomOrigin('center center');

                  if (globeRef.current) globeRef.current.pointOfView({ lat: GROUND_STATION.lat, lng: GROUND_STATION.lng, altitude: 2.2 }, 1000);
                }}>RESET TO LIVE</button>
              </div>

              {/* 📍 แถว 4: TIME SCRUB BAR (แบบ Dynamic Scale 2 In 1) ฟันธง! */}
              <div className="time-scrubber-container">
                <div className="scrubber-labels" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ width: '70px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontSize: '10px', fontFamily: 'Orbitron' }}>
                    {sliderMode === 'DAILY' ? '00:00 UTC' : 'AOS -5m'}
                  </span>
                  
                  {/* 📍 ปุ่มสลับโหมดสเกลเวลา (Dynamic Scale Toggle) */}
                  <button 
                    onClick={() => setSliderMode(sliderMode === 'DAILY' ? 'PASS' : 'DAILY')}
                    style={{ 
                      background: sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.1)' : 'rgba(255, 204, 0, 0.15)', 
                      border: `1px solid ${sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'}`, 
                      color: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', 
                      borderRadius: '4px', padding: '4px 10px', fontSize: '11px',
                      cursor: 'pointer', fontFamily: 'Orbitron', fontWeight: 'bold',
                      letterSpacing: '1px', transition: 'all 0.3s',
                      boxShadow: `0 0 10px ${sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.2)' : 'rgba(255, 204, 0, 0.3)'}`
                    }}
                  >
                    MODE: {sliderMode === 'DAILY' ? '🌍 24H GLOBAL' : '🎯 ACTIVE PASS'} ⟲
                  </button>

                  <span style={{ width: '70px', textAlign: 'right', color: 'rgba(255,255,255,0.5)', fontSize: '10px', fontFamily: 'Orbitron' }}>
                    {sliderMode === 'DAILY' ? '23:59 UTC' : 'LOS +5m'}
                  </span>
                </div>
                
                {(() => {
                  const currentSimDate = new Date(simulatedTimeMs);
                  let minTime = Date.UTC(currentSimDate.getUTCFullYear(), currentSimDate.getUTCMonth(), currentSimDate.getUTCDate(), 0, 0, 0);
                  let maxTime = minTime + 86400000 - 1; // 24 Hours

                  // 📍 สมองกลคำนวณช่วงเวลาของ Pass ที่ใกล้ที่สุด (โหมดเจาะจง)
                  if (sliderMode === 'PASS' && passSchedule.length > 0) {
                    let targetPass = passSchedule.find(p => simulatedTimeMs >= p.aosTime - 300000 && simulatedTimeMs <= p.losTime + 300000);
                    // ถ้าไม่อยู่ในช่วง Pass ใดๆ เลย ให้จับคู่กับ Pass ที่ใกล้ที่สุดแทน
                    if (!targetPass) {
                      targetPass = passSchedule.reduce((prev, curr) => Math.abs(curr.peakTime - simulatedTimeMs) < Math.abs(prev.peakTime - simulatedTimeMs) ? curr : prev);
                    }
                    if (targetPass) {
                      minTime = targetPass.aosTime - 300000; // เริ่มก่อน AOS 5 นาที
                      maxTime = targetPass.losTime + 300000; // จบหลัง LOS 5 นาที
                    }
                  }
                  
                  // คำนวณเปอร์เซ็นต์สำหรับแถบ Progress
                  const progressPct = ((simulatedTimeMs - minTime) / (maxTime - minTime)) * 100;

                  return (
                    <div style={{ position: 'relative' }}>
                      {/* วาดแถบเส้น Progress สีวิ่งตามหัว Thumb */}
                      <div style={{ 
                        position: 'absolute', top: '10px', left: 0, height: '8px', 
                        width: `${Math.max(0, Math.min(100, progressPct))}%`, 
                        background: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', 
                        borderRadius: '4px', pointerEvents: 'none',
                        boxShadow: `0 0 10px ${sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)'}`
                      }}></div>
                      
                      <input 
                        type="range" 
                        min={minTime} 
                        max={maxTime} 
                        value={simulatedTimeMs}
                        className="sci-fi-slider"
                        style={{ 
                          // เปลี่ยนลูกเล่นสีสไลด์บาร์ตาม Mode ทันที
                          '--thumb-color': sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)',
                          '--thumb-glow': sliderMode === 'DAILY' ? 'rgba(0, 234, 255, 0.8)' : 'rgba(255, 204, 0, 0.8)'
                        }}
                        onMouseDown={() => {
                          // ฟันธง: ทันทีที่จับสไลด์บาร์ ต้องตัดระบบออกจากสถานะ Live อัตโนมัติ (เข้าสู่โหมดจำลอง)
                          setIsPlaying(false);
                        }}
                        onChange={(e) => setSimulatedTimeMs(Number(e.target.value))}
                      />
                    </div>
                  );
                })()}
                
                <div style={{ textAlign: 'center', fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '5px', fontVariantNumeric: 'tabular-nums' }}>
                  CURRENT SIM: <strong style={{ color: sliderMode === 'DAILY' ? 'var(--cyan)' : 'var(--gold)', fontSize: '14px', textShadow: `0 0 5px ${sliderMode === 'DAILY' ? 'rgba(0,234,255,0.5)' : 'rgba(255,204,0,0.5)'}` }}>{formatTime(new Date(simulatedTimeMs))} UTC</strong>
                </div>
              </div>
            </div>

           {/* กลุ่มที่ 2: การแสดงผลมุมมอง */}
           <div className="control-group">
              <p>DISPLAY CONTROLS</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {/* 📍 ฟันธง: ปุ่มกดสลับมุม Station Mask แบบ Real-time (0°, 3°, 5°) */}
                <button 
                  className="btn btn-green active"
                  style={{ marginBottom: 0, fontSize: '14px', padding: '12px 5px', letterSpacing: '1.5px', gridColumn: 'span 2' }} 
                  onClick={() => setStationMask(prev => prev === 5 ? 0 : (prev === 0 ? 3 : 5))}
                >
                STATION MASK: {stationMask}° 
                </button>
                <button 
                  className={`btn btn-green ${realtimeSun ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: '12px', padding: '10px 5px', letterSpacing: '0.5px' }} 
                  onClick={() => setRealtimeSun(!realtimeSun)}
                >
                  {realtimeSun ? 'DAY/NIGHT' : 'SUN OFF'}
                </button>
                
                <button 
                  className={`btn btn-green${isFlatMap ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: '12px', padding: '10px 5px', letterSpacing: '0.5px' }} 
                  onClick={() => setIsFlatMap(!isFlatMap)}
                >
                  {isFlatMap ? '2D TACTICAL' : '3D GLOBE'}
                </button>
                {/* 📍 ฟันธง: ปุ่มกดสลับโหมดแสดงสถานี (วนลูป 4 สถานะ) */}
                <button 
              className={`btn btn-green ${stationDisplayMode !== 'none' ? 'active' : ''}`}
              style={{ marginBottom: 0, fontSize: '12px', padding: '10px 5px', letterSpacing: '0.5px' }}
              onClick={() => {
                const modes = ['both', 'icon', 'name', 'none'];
                const nextIndex = (modes.indexOf(stationDisplayMode) + 1) % modes.length;
                setStationDisplayMode(modes[nextIndex]);
              }}
            >
              {`STATION: ${stationDisplayMode.toUpperCase()}`}
            </button>
                <button 
                  className={`btn btn-green ${showGroundTrack ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: '12px', padding: '10px 5px', letterSpacing: '0.5px' }} 
                  onClick={() => setShowGroundTrack(!showGroundTrack)}
                >
                  GROUND TRACK
                </button>

                <button 
                  className={`btn btn-green ${cameraMode === 'TRACKING' ? 'active' : ''}`} 
                  style={{ marginBottom: 0, fontSize: '15px', padding: '14px 5px', letterSpacing: '0.5px', gridColumn: 'span 2' }}
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
                              const camAlt = Math.max(0.4, (pos.altKm / EARTH_RADIUS_KM) + 0.5);
                              globeRef.current.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: camAlt }, 1000);
                            }
                        }
                      } catch (err) {}
                    }
                  }}
                >
                  TARGET LOCK
                </button>

                {/* 📍 ปุุ่มใหม่: สลับ Theme แผนที่ 2D (กดแล้ววนลูปไปเรื่อยๆ) */}
                <button 
                  className="btn btn-cyan" 
                  style={{ marginBottom: 0, fontSize: '13px', padding: '12px 5px', letterSpacing: '1.5px', gridColumn: 'span 2', borderColor: 'var(--cyan)', color: 'var(--cyan)', textShadow: '0 0 8px var(--cyan)' }} 
                  onClick={() => setMapThemeIdx((prev) => (prev + 1) % mapThemes.length)}
                >
                THEME: {mapThemes[mapThemeIdx].name}
                </button>
              </div>
            </div>

          {/* 🛠️ กลุ่มที่ 3: DATA & TOOLS (Redesigned & Regrouped) */}
          <div className="control-group" style={{ paddingBottom: '15px' }}>
             <p>DATA & TOOLS</p>

             {/* แถว 1: Database กลาง (Full width) */}
             <button 
               className={`btn btn-cyan ${isModalOpen ? 'active' : ''}`} 
               onClick={() => { setIsModalOpen(!isModalOpen); if (!isModalOpen) bringToFront('db'); }}
               style={{ width: '100%', marginBottom: '10px', padding: '16px', fontSize: '16px', letterSpacing: '2px', fontWeight: '900' }}
             >
              SATELLITE DATABASE
             </button>

             {/* แถว 2: TLE Sync & Upload รวมไว้ด้วยกัน */}
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
               <button 
                 className="btn btn-cyan" 
                 onClick={handleAutoUpdateTle} 
                 disabled={isUpdatingTle}
                 style={{ margin: 0, padding: '12px 5px', fontSize: '13px' }}
               >
                 {isUpdatingTle ? 'FETCHING...' : 'AUTO UPDATE TLE'}
               </button>
               
               <input type="file" accept=".txt,.tle" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
               <button 
                 className="btn btn-cyan" 
                 onClick={() => fileInputRef.current && fileInputRef.current.click()} 
                 disabled={isUpdatingTle}
                 style={{ margin: 0, padding: '12px 5px', fontSize: '13px' }}
               >
                 UPLOAD TLE
               </button>
             </div>

             {/* แถว 3: IMAGING PLAN (ขยายใหญ่ โดดเด่น) */}
             <button 
               className={`btn btn-red ${isImgOpen ? 'active' : ''}`}
               onClick={() => { setIsImgOpen(!isImgOpen); if (!isImgOpen) bringToFront('img'); }}
               style={{ width: '100%', marginBottom: '10px', padding: '18px', fontSize: '20px', letterSpacing: '3px', fontWeight: '900' }}
             >
              MISSION PLAN
             </button>

             {/* แถว 4: Ground Station & Radar Skyplot */}
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
               <button 
                 className={`btn btn-cyan ${isGsModalOpen ? 'active' : ''}`}
                 onClick={() => { setIsGsModalOpen(!isGsModalOpen); if (!isGsModalOpen) bringToFront('gs'); }}
                 style={{ margin: 0, padding: '14px 5px', fontSize: '14px' }}
               >
                GROUND STATION
               </button>

               <button 
                 className={`btn btn-green ${isRadarOpen ? 'active' : ''}`} 
                 onClick={() => { setIsRadarOpen(!isRadarOpen); if (!isRadarOpen) bringToFront('radar'); }}
                 style={{ margin: 0, padding: '14px 5px', fontSize: '14px' }}
               >
                RADAR SKYPLOT
               </button>
             </div>
           </div>

           {/* 🗓️ PASS SCHEDULE (นำใส่กล่อง control-group ให้สมมาตรกับด้านบน) */}
           <div className="control-group" style={{ 
             marginTop: '15px', 
             padding: '20px',
             borderColor: 'var(--gold)', 
             borderTopColor: 'var(--gold)', 
             boxShadow: '0 10px 30px rgba(0,0,0,0.8), 0 0 30px rgba(255, 204, 0, 0.15), inset 0 0 20px rgba(255, 204, 0, 0.05)' 
           }}>
             <button 
               className={`btn btn-gold ${isPassModalOpen ? 'active' : ''}`} 
               onClick={() => {
                 setIsPassModalOpen(!isPassModalOpen);
                 if (!isPassModalOpen) {
                   bringToFront('pass');
                   if (selectedCatnr) calculateFuturePasses(selectedCatnr);
                 }
               }}
               style={{ 
                 margin: 0, 
                 padding: '18px',
                 display: 'flex',      
                 justifyContent: 'center', 
                 alignItems: 'center', 
                 fontWeight: '900',
                 letterSpacing: '4px',
                 fontSize: '22px'
               }}
             >
               ⏱️ PASS SCHEDULE
             </button>
           </div>

           {/* 📍 เครดิตลิขสิทธิ์และผู้พัฒนา */}
           <div style={{ textAlign: 'center', marginTop: '15px', fontSize: '16px', color: 'rgba(255, 255, 255, 0.8)', fontFamily: 'Rajdhani', letterSpacing: '1px' }}>
             © 2026 GISTDA.Ground System Engineering Division
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
          width: maximizedWins.gs ? '100vw' : '480px', /* 📍 ขยายความกว้างให้อ่านสบายตาขึ้น */
          height: maximizedWins.gs ? '100vh' : '690px', /* 📍 ขยายความสูงเริ่มต้นเป็น 690px เพื่อให้เห็นข้อมูลครบถ้วนโดยไม่ต้องเลื่อน */
          minWidth: '400px', minHeight: '650px',
          maxWidth: 'none', maxHeight: 'none', 
          resize: maximizedWins.gs ? 'none' : 'both', overflow: 'hidden', padding: '0',
          background: 'linear-gradient(145deg, rgba(20, 5, 0, 0.92) 0%, rgba(10, 2, 0, 0.98) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: maximizedWins.gs ? 'none' : '2px solid #FF6600', 
          borderRadius: maximizedWins.gs ? '0px' : '12px',
          boxShadow: '0 0 50px rgba(255, 102, 0, 0.4), inset 0 0 20px rgba(255, 102, 0, 0.2)', 
          display: 'flex', flexDirection: 'column', containerType: 'inline-size',
          zIndex: windowZ?.gs || 9999,
          transition: isDraggingGs ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)' 
        }}>
          
          {/* 📍 ปรับสมดุลสีตามหลัก UX: แยกสีส้มและสีขาวเพื่อให้มองง่ายแยกแยะข้อมูลชัดเจน */}
          <style>{`
            .gs-modal .gs-header-text { font-size: 22px !important; }
            .gs-modal .gs-icon { font-size: 24px !important; filter: drop-shadow(0 0 5px #FF6600); }
            .gs-modal .gs-row { padding: 14px 0 !important; display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255, 102, 0, 0.3) !important; align-items: center; }
            .gs-modal .gs-row:last-child { border-bottom: none !important; }
            .gs-modal .gs-label { font-size: 14px !important; color: rgba(255,255,255,0.7) !important; font-weight: bold; letter-spacing: 1px; }
            .gs-modal .gs-value { font-size: 16px !important; color: #fff !important; font-weight: 900 !important; text-shadow: 0 0 8px rgba(255, 255, 255, 0.4); text-align: right; }
            .gs-modal .gs-value.highlight { color: #FF6600 !important; text-shadow: 0 0 10px rgba(255, 102, 0, 0.6); }
            .gs-no-scroll::-webkit-scrollbar { display: none; }
            .gs-no-scroll { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
          
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', cursor: maximizedWins.gs ? 'default' : (isDraggingGs ? 'grabbing' : 'grab'), flexWrap: 'nowrap', borderBottom: '2px solid rgba(255, 102, 0, 0.5)', background: 'linear-gradient(180deg, rgba(255, 102, 0, 0.15) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(255, 102, 0, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.gs) handleGsMouseDown(e); }}>
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center' }}>
               <span className="gs-icon">📡</span>
            </div>
            
            <div style={{ flex: '0 1 auto', display: 'flex', alignItems: 'center', background: 'rgba(255, 102, 0, 0.1)', border: '1px solid #FF6600', padding: '6px 20px', borderRadius: '6px', margin: '0 10px', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 10px rgba(255, 102, 0, 0.2)' }}>
              <span style={{ color: '#fff', fontSize: '15px', fontWeight: 'bold', fontFamily: 'Orbitron', letterSpacing: '2px', textShadow: '0 0 10px #FF6600', pointerEvents: 'none' }}>
              GISTDA GROUND STATION
              </span>
            </div>

            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', flexShrink: 0, border: '1px solid #FF6600', color: '#FF6600', background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('gs'); }}>{maximizedWins.gs ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', flexShrink: 0, border: '1px solid #FF6600', color: '#FF6600', background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsGsModalOpen(false); }}>✕</button>
            </div>
          </div>
          
          <div className="gs-no-scroll" style={{ padding: '20px 30px', display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', fontFamily: 'Rajdhani', letterSpacing: '0.5px' }}>

              {/* 📍 ฟันธง 3: แผงควบคุมสลับสถานี 4 จังหวัด (ลบตัวซ้ำซ้อนออกแล้ว) */}
              <div style={{ background: 'rgba(0, 234, 255, 0.05)', padding: '15px', borderRadius: '8px', border: '1px solid rgba(0, 234, 255, 0.2)', marginBottom: '20px' }}>
                <h3 style={{ margin: '0 0 10px 0', color: 'var(--cyan)', fontSize: '14px', letterSpacing: '2px' }}>🌐 ACTIVE GROUND STATION NETWORK</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                  {GS_NETWORK.map(station => (
                    <button 
                      key={station.id}
                      className={`btn ${activeStation.id === station.id ? 'btn-cyan active' : 'btn-cyan'}`}
                      style={{ padding: '10px 5px', fontSize: '14px', margin: 0, fontWeight: activeStation.id === station.id ? '900' : 'normal' }}
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

              {/* 📍 ฟันธง: ดึงพิกัดสถานีแบบ Real-time */}
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
            
            {/* 📍 ฟันธง: สร้างเกราะป้องกันหุ้มกล่อง Status บังคับให้เบราว์เซอร์ดันขอบล่างออกไป 40px เสมอ! */}
            <div style={{ paddingBottom: '40px' }}>
              <div className="gs-status-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: linkActive ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 102, 0, 0.1)', borderRadius: '6px', border: `1px solid ${linkActive ? 'var(--green)' : '#FF6600'}`, boxShadow: `inset 0 0 15px ${linkActive ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 102, 0, 0.2)'}`, padding: '15px', marginTop: '15px' }}>
                <span className="gs-label" style={{ color: 'rgba(255,255,255,0.8)' }}>ANTENNA STATUS:</span>
                <span className="gs-value highlight" style={{ color: linkActive ? 'var(--green)' : '#FF6600', fontWeight: 'bold', textShadow: `0 0 10px ${linkActive ? 'var(--green)' : '#FF6600'}`, animation: linkActive ? 'pulse-glow 2s infinite' : 'none' }}>
                  {linkActive ? 'TRACKING (LOCKED)' : 'STANDBY'}
                </span>
              </div>
            </div>

            {/* 📍 ฟันธง: ใส่กล่องอากาศ (Spacer) ดันขอบล่าง บังคับไม่ให้ทับเส้นขอบ 100% */}
            <div style={{ minHeight: '40px', flexShrink: 0, width: '100%' }}></div>

          </div>
        </div>
      )}
      {/* --- SATELLITE DATABASE --- */}
      {isModalOpen && (
        <div className="modal-box db-modal" onMouseDownCapture={() => bringToFront('db')} style={{ 
          position: 'fixed', 
          top: maximizedWins.db ? '0px' : `${dbPos.y}px`, 
          left: maximizedWins.db ? '0px' : `${dbPos.x}px`, 
          width: maximizedWins.db ? '100vw' : '900px', 
          height: maximizedWins.db ? '100vh' : '600px', 
          minWidth: '400px', minHeight: '300px',
          maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.db ? 'none' : 'both', overflow: 'hidden', 
          background: 'linear-gradient(145deg, rgba(0, 10, 25, 0.9) 0%, rgba(0, 5, 10, 0.95) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
         border: maximizedWins.db ? 'none' : '2px solid var(--cyan)', 
         borderRadius: maximizedWins.db ? '0px' : '12px', 
         boxShadow: '0 0 40px rgba(0, 234, 255, 0.4), inset 0 0 20px rgba(0, 234, 255, 0.2)', display: 'flex', flexDirection: 'column', containerType: 'inline-size',
          zIndex: windowZ.db,
          transition: isDraggingDb ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>

          {/* 📍 ปลดล็อกขนาดตัวอักษรไม่ให้ขยายจนล้นจอ และอัปเกรดแถบชื่อหมวดหมู่ */}
          <style>{`
            .db-modal .modal-header h2 { font-size: 22px !important; }
            .db-modal .modal-clear-btn { font-size: 12px !important; padding: 6px 15px !important; }
            .db-modal .modal-sat-btn { font-size: 14px !important; padding: 12px 20px !important; }
            
            /* 📍 อัปเกรดเส้นแบ่งหมวดหมู่ดาวเทียมให้เป็นแถบ Banner เรืองแสง */
            .db-modal .group-header-row { 
              display: flex; justify-content: space-between; align-items: center; 
              background: linear-gradient(90deg, rgba(0, 234, 255, 0.15) 0%, transparent 100%);
              border-left: 4px solid var(--cyan);
              border-bottom: 1px solid rgba(0, 234, 255, 0.3);
              padding: 10px 15px;
              margin-top: 10px;
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
          `}</style>

          {/* Header */}
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', cursor: maximizedWins.db ? 'default' : (isDraggingDb ? 'grabbing' : 'grab'), flexWrap: 'nowrap', borderBottom: '2px solid rgba(0, 234, 255, 0.5)', background: 'linear-gradient(180deg, rgba(0, 234, 255, 0.15) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(0, 234, 255, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.db) handleDbMouseDown(e); }}>
            
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center' }}>
               <span style={{fontSize:'24px', pointerEvents: 'none', filter: 'drop-shadow(0 0 5px var(--cyan))'}}>🛰️</span>
            </div>
            
            <div style={{ flex: '0 1 auto', display: 'flex', alignItems: 'center', background: 'rgba(0, 234, 255, 0.1)', border: '1px solid var(--cyan)', padding: '6px 25px', borderRadius: '6px', margin: '0 10px', whiteSpace: 'nowrap', boxShadow: 'inset 0 0 10px rgba(0,234,255,0.2)' }}>
              <span style={{ color: '#fff', fontSize: '16px', fontWeight: 'bold', fontFamily: 'Orbitron', letterSpacing: '2px', textShadow: '0 0 10px var(--cyan)', pointerEvents: 'none' }}>
                SATELLITES DATABASE
              </span>
            </div>
            
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
              <button className="modal-clear-btn" style={{ margin: 0, padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap', background: 'rgba(255, 204, 0, 0.1)', color: 'var(--gold)', border: '1px solid var(--gold)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSelectedCatnrs([selectedCatnr]); }} title="Remove all secondary satellites">
                🧹 CLEAR
              </button>
              {/* 📍 แก้ปุ่มเป็นสีฟ้า Cyan ให้สว่าง ไม่ดำกลืนไปกับพื้น */}
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', flexShrink: 0, border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('db'); }}>{maximizedWins.db ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', flexShrink: 0, border: '1px solid var(--cyan)', color: 'var(--cyan)', background: 'rgba(0,0,0,0.5)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsModalOpen(false); }}>✕</button>
            </div>
          </div>
          
          <div className="modal-content" style={{ flex: 1, overflowY: 'auto' }}>
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
                      {sat.displayName}
                      {sat.catnr === selectedCatnr ? ( <span style={{ color: '#fff', textShadow: '0 0 10px #fff', fontSize: '15px', letterSpacing: '1px' }}>🎯 MAIN</span> ) : selectedCatnrs.includes(sat.catnr) ? ( <span style={{ color: '#000', fontSize: '14px' }}>●</span> ) : null}
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
          width: maximizedWins.pass ? '100vw' : '850px', 
          height: maximizedWins.pass ? '100vh' : '550px', 
          minWidth: '500px', minHeight: '350px',
          maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.pass ? 'none' : 'both', overflow: 'hidden', 
          background: 'linear-gradient(145deg, rgba(20, 10, 0, 0.9) 0%, rgba(10, 5, 0, 0.95) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
         border: maximizedWins.pass ? 'none' : '2px solid var(--gold)', 
         borderRadius: maximizedWins.pass ? '0px' : '12px', 
         boxShadow: '0 0 40px rgba(255, 204, 0, 0.4), inset 0 0 20px rgba(255, 204, 0, 0.2)', display: 'flex', flexDirection: 'column', containerType: 'inline-size',
          zIndex: windowZ.pass,
          transition: isDraggingPass ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>
          <style>{`
            .pass-modal .auto-scale-header { font-size: clamp(16px, 2.2cqw, 40px) !important; }
            .pass-modal .auto-scale-badge { font-size: clamp(12px, 1.5cqw, 28px) !important; padding: clamp(4px, 0.8cqw, 15px) clamp(15px, 2cqw, 30px) !important; }
            .pass-modal .auto-scale-flag { width: clamp(18px, 2.2cqw, 40px) !important; margin-right: clamp(8px, 1cqw, 15px) !important; }
            .pass-modal th { font-size: clamp(11px, 1.5cqw, 26px) !important; padding: clamp(8px, 1.2cqw, 20px) clamp(4px, 0.8cqw, 15px) !important; }
            .pass-modal td { font-size: clamp(13px, 1.7cqw, 30px) !important; padding: clamp(8px, 1.2cqw, 20px) clamp(4px, 0.8cqw, 15px) !important; }
          `}</style>

<div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 15px', borderBottom: '1px solid rgba(255, 204, 0, 0.5)', cursor: maximizedWins.pass ? 'default' : (isDraggingPass ? 'grabbing' : 'grab'), flexWrap: 'nowrap', flexShrink: 0 }} onMouseDown={(e) => { if(!maximizedWins.pass) handlePassMouseDown(e); }}>
            <div style={{ flex: '1 1 0%', display: 'flex', alignItems: 'center', color: 'var(--gold)', fontFamily: 'Orbitron', fontWeight: 'bold', textShadow: '0 0 10px var(--gold)', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>
              <span className="auto-scale-header" style={{marginRight:'8px'}}>⏱️</span> 
              <span className="auto-scale-header" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>PASS SCHEDULE</span>
            </div>
            
            {/* 📍 ฟันธง: เพิ่มเมนูเลือกวัน (1D, 3D, 7D) ไว้ตรงกลาง Header */}
            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'center', gap: '5px' }}>
              {[1, 3, 7].map(d => (
                <button key={d} onMouseDown={(e) => e.stopPropagation()} onClick={() => setPassPredictionDays(d)}
                  style={{
                    background: passPredictionDays === d ? 'var(--gold)' : 'rgba(255, 204, 0, 0.1)',
                    color: passPredictionDays === d ? '#000' : 'var(--gold)',
                    border: '1px solid var(--gold)',
                    padding: '4px 15px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold', fontFamily: 'Orbitron',
                    cursor: 'pointer', transition: 'all 0.2s',
                    boxShadow: passPredictionDays === d ? '0 0 15px rgba(255,204,0,0.6)' : 'none'
                  }}>
                  ±{d} DAYS
                </button>
              ))}
            </div>

            <div style={{ flex: '1 1 0%', display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '17px', flexShrink: 0, borderColor: 'var(--gold)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.2)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggleMaximize('pass'); }}>{maximizedWins.pass ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '36px', height: '36px', fontSize: '16px', flexShrink: 0, borderColor: 'var(--gold)', color: 'var(--gold)', boxShadow: '0 0 10px rgba(255,204,0,0.2)' }} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setIsPassModalOpen(false); }}>✕</button>
            </div>
          </div>
          
          <div className="modal-content" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {isCalculatingPass ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--cyan)', fontSize: '22px', fontFamily: 'Orbitron', margin: 'auto' }}>
                CALCULATING ORBITAL TRAJECTORY...
              </div>
            ) : (
              <table className="hide-scroll" style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'Rajdhani', fontSize: '18px', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'rgba(10, 5, 0, 0.95)', zIndex: 5 }}>
                  <tr style={{ borderBottom: '2px solid rgba(255, 204, 0, 0.6)', color: 'rgba(255, 255, 255, 0.7)', textAlign: 'center', letterSpacing: '1.5px', fontSize: '14px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px 5px' }}>STATUS</th>
                    <th style={{ padding: '12px 5px' }}>DATE (UTC)</th> 
                    <th style={{ padding: '12px 5px' }}>AOS</th> 
                    <th style={{ padding: '12px 5px' }}>MAX EL TIME</th> 
                    <th style={{ padding: '12px 5px' }}>LOS</th> 
                    <th style={{ padding: '12px 5px' }}>DURATION</th> 
                    <th style={{ padding: '12px 5px' }}>MAX EL</th> 
                    <th style={{ padding: '12px 5px' }}>AOS / LOS AZ</th>
                  </tr>
                </thead>
                <tbody>
                  {passSchedule.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: 'var(--red)', fontWeight: 'bold', letterSpacing: '2px' }}>NO PASSES DETECTED IN THIS TIMEFRAME</td></tr>
                  ) : (
                    passSchedule.map((pass, idx) => {
                      const aosD = new Date(pass.aosTime); const losD = new Date(pass.losTime); const peakD = new Date(pass.peakTime); 
                      const durMins = Math.floor(pass.durationMs / 60000); const durSecs = Math.floor((pass.durationMs % 60000) / 1000);
                      
                      // 📍 สมองกลแยกแยะ อดีต / ปัจจุบัน / วันนี้ / อนาคต
                      const isPast = simulatedTimeMs > pass.losTime;
                      const isActive = simulatedTimeMs >= pass.aosTime && simulatedTimeMs <= pass.losTime;
                      
                      // 📍 ฟันธง: ดึงวันที่ของ Simulator กับ วันที่ของ Pass มาเทียบกันตรงๆ ว่าใช่วันเดียวกันหรือไม่
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
                        statusBadge = <span style={{ color: '#000', background: 'var(--green)', padding: '2px 8px', borderRadius: '4px', fontWeight: '900', fontSize: '13px', animation: 'pulse 1.5s infinite' }}>● ACTIVE</span>;
                      } else if (isPast) {
                        rowStyle.opacity = 0.4; 
                        rowStyle.filter = 'grayscale(80%)';
                        statusBadge = <span style={{ color: 'rgba(255,255,255,0.5)' }}>PAST</span>;
                      } else if (isToday) {
                        // 📍 ฟันธง: คิวของวันนี้ (TODAY) ใช้สีเหลืองทองกระแทกตา สื่อถึงความพร้อม Standby
                        statusBadge = <span style={{ color: 'var(--gold)', fontWeight: '900', textShadow: '0 0 8px rgba(255, 204, 0, 0.8)' }}>TODAY</span>;
                      } else {
                        // 📍 ฟันธง: คิวของวันพรุ่งนี้ขึ้นไป (FUTURE) ใช้สีฟ้าไซแอนดรอปแสงลง สื่อถึงคิวล่วงหน้าที่ยังไม่ต้องรีบ
                        statusBadge = <span style={{ color: 'rgba(0, 234, 255, 0.65)' }}>FUTURE</span>;
                      }

                      return (
                        <tr key={idx} 
                          onClick={() => { setSimulatedTimeMs(pass.aosTime - 60000); setSpeedMult(30); setIsPlaying(true); bringToFront('radar'); }}
                          style={rowStyle}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 204, 0, 0.15)'; e.currentTarget.style.transform = 'scale(1.01)'; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                        >
                          <td style={{ padding: '12px 5px', fontWeight: 'bold', fontFamily: 'Orbitron' }}>{statusBadge}</td>
                          <td style={{ color: 'rgba(255,255,255,0.9)', padding: '12px 5px' }}>{aosD.toISOString().split('T')[0]}</td>
                          <td style={{ color: isActive ? 'var(--green)' : 'var(--green)', fontWeight: 'bold', padding: '12px 5px' }}>{pad2(aosD.getUTCHours())}:{pad2(aosD.getUTCMinutes())}:{pad2(aosD.getUTCSeconds())}</td>
                          <td style={{ color: isActive ? 'var(--gold)' : 'var(--gold)', fontWeight: 'bold', padding: '12px 5px' }}>{pad2(peakD.getUTCHours())}:{pad2(peakD.getUTCMinutes())}:{pad2(peakD.getUTCSeconds())}</td>
                          <td style={{ color: isActive ? 'var(--red)' : 'var(--red)', fontWeight: 'bold', padding: '12px 5px' }}>{pad2(losD.getUTCHours())}:{pad2(losD.getUTCMinutes())}:{pad2(losD.getUTCSeconds())}</td>
                          <td style={{ color: '#00eaff', fontWeight: 'bold', padding: '12px 5px' }}>{durMins}m {pad2(durSecs)}s</td>
                          <td style={{ color: '#ffffff', fontWeight: '900', padding: '12px 5px', textShadow: '0 0 8px rgba(255,255,255,0.5)' }}>{pass.maxEl.toFixed(2)}°</td>
                          <td style={{ color: 'rgba(255,255,255,0.6)', padding: '12px 5px' }}>{pass.aosAz.toFixed(1)}° → {pass.losAz.toFixed(1)}°</td>
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
        <div ref={radarContainerRef} className="radar-perfect-scale" onMouseDownCapture={() => bringToFront('radar')} style={{
          position: 'fixed', 
          top: maximizedWins.radar ? '0px' : `${radarPos.y}px`, 
          left: maximizedWins.radar ? '0px' : `${radarPos.x}px`, 
          width: maximizedWins.radar ? '100vw' : '440px', /* 📍 ขยายความกว้างเริ่มต้นจาก 360px เป็น 440px */
          height: maximizedWins.radar ? '100vh' : '520px', /* 📍 ขยายความสูงเริ่มต้นจาก 460px เป็น 520px */
          minWidth: '350px', minHeight: '400px', overflow: 'hidden',
          resize: maximizedWins.radar ? 'none' : 'both',
          background: 'linear-gradient(145deg, rgba(0, 20, 10, 0.9) 0%, rgba(0, 10, 5, 0.95) 100%)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          border: maximizedWins.radar ? 'none' : '2px solid var(--green)', 
          borderRadius: maximizedWins.radar ? '0px' : '12px', 
          boxShadow: '0 0 40px rgba(0, 255, 102, 0.4), inset 0 0 20px rgba(0, 255, 102, 0.2)',
          zIndex: windowZ.radar,
          transition: isDraggingRadar ? 'none' : 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
        }}>
          
          {/* 📍 1. สร้าง Header แบบ HTML เหมือนหน้าต่างอื่น แก้อาการปุ่มวิ่งหนีและซ้อนทับ! */}
          <div className="modal-header" style={{ position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 20, borderBottom: '2px solid rgba(0, 255, 102, 0.5)', padding: '12px 15px', cursor: maximizedWins.radar ? 'default' : (isDraggingRadar ? 'grabbing' : 'grab'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, rgba(0, 255, 102, 0.2) 0%, transparent 100%)', boxShadow: '0 10px 20px -5px rgba(0, 255, 102, 0.3)' }} onMouseDown={(e) => { if(!maximizedWins.radar) handleRadarMouseDown(e); }}>
              {/* ซ้าย: ว่างไว้ดันให้ตรงกลาง */}
              <div style={{ flex: 1 }}></div>
              
              {/* 📍 2. จัดกึ่งกลางชื่อดาวเทียมและธงชาติ */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'Orbitron', fontWeight: 'bold', fontSize: '18px', textShadow: '0 0 10px var(--green)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                {(() => {
                  const sat = SATELLITE_OPTIONS.find(s => s.catnr === selectedCatnr);
                  if (!sat) return null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0, 255, 102, 0.1)', border: '1px solid rgba(0, 255, 102, 0.4)', padding: '4px 15px', borderRadius: '6px', boxShadow: '0 0 10px rgba(0, 255, 102, 0.2)' }}>
                      {sat.flag && <img src={`https://flagcdn.com/w20/${sat.flag.toLowerCase()}.png`} style={{ width: '22px', marginRight: '10px', borderRadius: '2px', boxShadow: '0 0 5px var(--green)' }} alt="flag" />}
                      {sat.displayName}
                    </div>
                  );
                })()}
              </div>
              
              {/* ขวา: ปุ่ม Audio, Maximize, Close */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => setIsMuted(!isMuted)} style={{ background: isMuted ? 'rgba(255, 51, 51, 0.15)' : 'rgba(0, 255, 102, 0.15)', border: `1px solid ${isMuted ? 'var(--red)' : 'var(--green)'}`, color: isMuted ? 'var(--red)' : 'var(--green)', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer', fontFamily: 'Rajdhani', fontWeight: 'bold', fontSize: '12px', transition: 'all 0.2s' }}>
                  {isMuted ? '🔇 MUTE' : '🔊 AUDIO'}
                </button>
                <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', padding: 0, borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => toggleMaximize('radar')}>{maximizedWins.radar ? '🗗' : '🗖'}</button>
                <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', padding: 0, borderColor: 'var(--green)', color: 'var(--green)' }} onClick={() => setIsRadarOpen(false)}>✕</button>
              </div>
          </div>

          <svg width="100%" height="100%" style={{ display: 'block', position: 'relative', zIndex: 10 }}>
            {/* ข้อมูลมุม EL */}
            <text x="15" y={75 * radarLayout.uiScale} fill="var(--cyan)" fontSize={11 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron" textAnchor="start">EL: {radarCurrentPos && radarCurrentPos.el ? Math.max(0, radarCurrentPos.el).toFixed(1) : '0.0'}°</text>
            <text x={radarDim.w - 15} y={75 * radarLayout.uiScale} fill="var(--cyan)" fontSize={11 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron" textAnchor="end">MAX EL: {radarData.maxEl !== 'N/A' ? `${radarData.maxEl}°` : 'N/A'}</text>

            {/* วงแหวนเรดาร์และเส้น Grid */}
            <g style={{ pointerEvents: 'none' }}>
              {(() => {
                const { R, cx, cy, uiScale } = radarLayout;
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
                       {/* 📍 3. เพิ่มความเข้มเส้นแฉก */}
                       return <line key={`az-${az}`} x1={cx} y1={cy} x2={x2} y2={y2} stroke="rgba(0, 255, 102, 0.85)" strokeWidth={isMain ? "1.8" : "1.0"} strokeDasharray={isMain ? "none" : "3 3"} />
                    })}

                    {rings.map(el => {
                      const r = R * ((90 - el) / 90);
                      return (
                        <React.Fragment key={`el-${el}`}>
                          {/* 📍 3. เพิ่มความเข้มวงแหวน */}
                          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0, 255, 102, 0.9)" strokeWidth="1.5" strokeDasharray="4 4" />
                          {R > 120 && el % 30 === 0 && ( <text x={cx + 2} y={cy - r + (9 * uiScale)} fill="#ffcc00" fontSize={10 * uiScale} fontWeight="bold">{el}°</text> )}
                        </React.Fragment>
                      )
                    })}
                    
                    {/* ขอบเรดาร์วงนอกสุด */}
                    <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(0, 255, 102, 1)" strokeWidth="2.5" />
                    
                    {[0, 45, 90, 135, 180, 225, 270, 315].map(az => {
                      const isMain = az % 90 === 0;
                      const padding = isMain ? 15 * uiScale : 12 * uiScale; 
                      const lx = cx + (R + padding) * Math.sin((az * Math.PI) / 180);
                      const ly = cy - (R + padding) * Math.cos((az * Math.PI) / 180);
                      
                      let label = az + '°';
                      if (az === 0) label = "N (0°)"; if (az === 90) label = "E (90°)"; if (az === 180) label = "S (180°)"; if (az === 270) label = "W (270°)";
                      let anchor = "middle"; if (az > 0 && az < 180) anchor = "start"; if (az > 180 && az < 360) anchor = "end";
                      let dy = "0.3em"; if (az === 0) dy = "0em"; if (az === 180) dy = "0.8em";

                      return (
                        <text key={`az-label-${az}`} x={lx} y={ly} dy={dy} fill={isMain ? "#00eaff" : "#ffcc00"} fontSize={isMain ? 12 * uiScale : 10 * uiScale} fontWeight={isMain ? "bold" : "normal"} textAnchor={anchor} >
                          {label}
                        </text>
                      );
                    })}
                  </>
                );
              })()}

             {/* ชิ้นพิซซ่า */}
             {radarData.sectorEdgePoints && radarData.sectorEdgePoints.length > 0 && radarData.aosAz !== null && (
                <g>
                  <polygon points={`${radarLayout.cx},${radarLayout.cy} ${radarData.sectorEdgePoints.join(' ')}`} fill="rgba(0, 255, 102, 0.15)" />
                  {(() => {
                    const s = radarLayout.uiScale;
                    
                    const aosX = radarLayout.cx + radarLayout.R * Math.sin((radarData.aosAz * Math.PI) / 180); 
                    const aosY = radarLayout.cy - radarLayout.R * Math.cos((radarData.aosAz * Math.PI) / 180);
                    const losX = radarLayout.cx + radarLayout.R * Math.sin((radarData.losAz * Math.PI) / 180); 
                    const losY = radarLayout.cy - radarLayout.R * Math.cos((radarData.losAz * Math.PI) / 180);
                    
                    const getPad = (az) => {
                     if (az > 150 && az < 210) return 38 * s; 
                     if (az > 330 || az < 30) return 30 * s;  
                     if ((az > 60 && az < 120) || (az > 240 && az < 300)) return 34 * s; 
                     return 22 * s; 
                   };
                   
                   const padAos = getPad(radarData.aosAz);
                   const padLos = getPad(radarData.losAz);

                   const textAosX = radarLayout.cx + (radarLayout.R + padAos) * Math.sin((radarData.aosAz * Math.PI) / 180);
                   const textAosY = radarLayout.cy - (radarLayout.R + padAos) * Math.cos((radarData.aosAz * Math.PI) / 180);
                   const textLosX = radarLayout.cx + (radarLayout.R + padLos) * Math.sin((radarData.losAz * Math.PI) / 180);
                   const textLosY = radarLayout.cy - (radarLayout.R + padLos) * Math.cos((radarData.losAz * Math.PI) / 180);

                   return (
                       <>
                         <line x1={radarLayout.cx} y1={radarLayout.cy} x2={aosX} y2={aosY} stroke="var(--gold)" strokeWidth={2 * s} strokeDasharray="4 4" />
                         <line x1={radarLayout.cx} y1={radarLayout.cy} x2={losX} y2={losY} stroke="var(--red)" strokeWidth={2 * s} strokeDasharray="4 4" />
                         
                         <circle cx={aosX} cy={aosY} r={4 * s} fill="var(--gold)" style={{ filter: 'drop-shadow(0 0 8px var(--gold))' }} />
                         <circle cx={losX} cy={losY} r={4 * s} fill="var(--red)" style={{ filter: 'drop-shadow(0 0 8px var(--red))' }} />

                         <text x={textAosX} y={textAosY} fill="var(--gold)" fontSize={12 * s} fontWeight="bold" fontFamily="Orbitron" textAnchor="middle" alignmentBaseline="middle" style={{ textShadow: '0 0 5px #000, 0 0 10px var(--gold)' }}>AOS {radarData.aosAz.toFixed(1)}°</text>
                         <text x={textLosX} y={textLosY} fill="var(--red)" fontSize={12 * s} fontWeight="bold" fontFamily="Orbitron" textAnchor="middle" alignmentBaseline="middle" style={{ textShadow: '0 0 5px #000, 0 0 10px var(--red)' }}>LOS {radarData.losAz.toFixed(1)}°</text>
                       </>
                     );
                  })()}
                </g>
              )}

              {/* วาดเส้นพาสดาวเทียม */}
              {radarData.segments.map((seg, i) => ( <line key={i} x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2} stroke={seg.color} strokeWidth={seg.width} strokeDasharray={seg.dash} /> ))}
              
              {/* ตำแหน่งดาวเทียมปัจจุบัน */}
              {radarCurrentPos && ( <circle cx={radarCurrentPos.x} cy={radarCurrentPos.y} r={7 * radarLayout.uiScale} fill="#ff9900" stroke="#ffffff" strokeWidth={2 * radarLayout.uiScale} style={{ filter: `drop-shadow(0 0 ${12 * radarLayout.uiScale}px #ff9900)` }} /> )}
              {/* จุดกึ่งกลาง (สถานีรับสัญญาณ) */}
              <circle cx={radarLayout.cx} cy={radarLayout.cy} r={4 * radarLayout.uiScale} fill="var(--red)" style={{ filter: `drop-shadow(0 0 8px var(--red))` }} />
            </g>

            {/* Legend ด้านล่าง */}
            <text x={radarDim.w / 2} y={radarDim.h - (15 * radarLayout.uiScale)} fontSize={11 * radarLayout.uiScale} fontWeight="bold" fontFamily="Orbitron" textAnchor="middle">
              <tspan fill="rgba(0, 234, 255, 0.6)">- - DEPARTED</tspan>
              <tspan dx={20 * radarLayout.uiScale} fill="var(--gold)">- - APPROACH</tspan>
              <tspan dx={20 * radarLayout.uiScale} fill="var(--cyan)">━━ VISIBLE</tspan>
            </text>
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
          width: maximizedWins.img ? '100vw' : '900px', 
          height: maximizedWins.img ? '100vh' : '550px', 
          minWidth: '600px', minHeight: '400px',
          maxWidth: 'none', maxHeight: 'none', resize: maximizedWins.img ? 'none' : 'both', overflow: 'hidden', 
          background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(15px)', WebkitBackdropFilter: 'blur(15px)',
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

          {/* 📍 POPUP SCI-FI ALERT (อัปเกรดแสงแฟลร์เป็นสีเขียว/แดง ตามสถานะ) */}
          {customAlert.show && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(2, 6, 15, 0.85)', backdropFilter: 'blur(10px)', zIndex: 99999, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: 'inherit' }}>
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(0, 20, 10, 0.95), rgba(0, 5, 2, 0.95))', 
                border: `2px solid ${customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'}`, 
                boxShadow: `0 0 50px ${customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.4)' : 'rgba(255, 51, 51, 0.4)'}, inset 0 0 20px ${customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 51, 51, 0.2)'}`, 
                borderRadius: '8px', padding: '35px 50px', textAlign: 'center', minWidth: '420px', position: 'relative', overflow: 'hidden',
                animation: 'slideInRight 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)' 
              }}>
                
                {/* เอฟเฟกต์แสงแฟลร์ (Flare) เปลี่ยนสีอัตโนมัติตามสถานะ */}
                <div style={{ position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%', background: `radial-gradient(circle at center, ${customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.15)' : 'rgba(255, 51, 51, 0.15)'} 0%, transparent 60%)`, pointerEvents: 'none', animation: 'pulse 2.5s infinite' }}></div>
                
                <h2 style={{ fontFamily: 'Orbitron', color: customAlert.type === 'success' ? 'var(--green)' : 'var(--red)', fontSize: '28px', margin: '0 0 15px 0', textShadow: `0 0 20px ${customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'}`, letterSpacing: '2px', position: 'relative', zIndex: 1 }}>
                  {customAlert.type === 'success' ? '🚀 SYSTEM SUCCESS' : '❌ SYSTEM ERROR'}
                </h2>
                <p style={{ fontFamily: 'Rajdhani', color: '#fff', fontSize: '20px', marginBottom: '30px', letterSpacing: '1.5px', fontWeight: 'bold', textShadow: '0 0 10px rgba(255, 255, 255, 0.5)', position: 'relative', zIndex: 1 }}>{customAlert.message}</p>
                
                <button 
                  onClick={() => setCustomAlert({ show: false, message: '', type: 'success' })} 
                  style={{ 
                    background: customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 51, 51, 0.1)', 
                    border: `1px solid ${customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'}`, 
                    color: customAlert.type === 'success' ? 'var(--green)' : 'var(--red)', 
                    padding: '12px 50px', fontSize: '18px', fontFamily: 'Orbitron', fontWeight: '900', cursor: 'pointer', borderRadius: '4px', letterSpacing: '3px', transition: 'all 0.2s', position: 'relative', zIndex: 1,
                    boxShadow: `0 0 15px ${customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 51, 51, 0.2)'}`
                  }}
                  onMouseOver={(e) => { 
                    e.currentTarget.style.background = customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'; 
                    e.currentTarget.style.color = '#000'; 
                    e.currentTarget.style.boxShadow = `0 0 30px ${customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'}`; 
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseOut={(e) => { 
                    e.currentTarget.style.background = customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.1)' : 'rgba(255, 51, 51, 0.1)'; 
                    e.currentTarget.style.color = customAlert.type === 'success' ? 'var(--green)' : 'var(--red)'; 
                    e.currentTarget.style.boxShadow = `0 0 15px ${customAlert.type === 'success' ? 'rgba(0, 255, 102, 0.2)' : 'rgba(255, 51, 51, 0.2)'}`;
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  ACKNOWLEDGE
                </button>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="modal-header" style={{ position: 'relative', zIndex: 10, borderBottom: '2px solid #FF4500', padding: '12px 20px', cursor: maximizedWins.img ? 'default' : (isDraggingImg ? 'grabbing' : 'grab'), display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, rgba(255, 69, 0, 0.2) 0%, transparent 100%)', boxShadow: '0 10px 30px -10px rgba(255, 69, 0, 0.5)' }} onMouseDown={(e) => { if(!maximizedWins.img) handleImgMouseDown(e); }}>
            {/* กล่องซ้าย */}
            <div style={{ flex: 1 }}></div>
            
            {/* กล่องกลาง (หัวข้อ) */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff3333', fontFamily: 'Orbitron', fontWeight: 'bold', fontSize: '24px', textShadow: '0 0 10px #ff3333', pointerEvents: 'none', whiteSpace: 'nowrap', letterSpacing: '1px' }}>
              📸 IMAGING PLAN VIEWER 
              <span style={{ fontSize: '18px', color: 'var(--gold)', background: 'rgba(0,0,0,0.5)', border: '1px solid #ffffff', padding: '2px 12px', borderRadius: '4px', marginLeft: '15px', textShadow: '0 0 10px var(--gold)', boxShadow: '0 0 8px rgba(255,255,255,0.5), inset 0 0 8px rgba(255,255,255,0.2)', letterSpacing: '2px' }}>
                ORBIT 269
              </span>
            </div>
            
           {/* กล่องขวา (ปุ่มปิด) */}
           <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {/* 📍 แก้ปุ่มดำ: คืนค่าสีขอบและตัวอักษรเป็นสีส้มแดง ให้มองเห็นชัดเจนตั้งแต่แรกเปิด! */}
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '15px', padding: 0, border: '1px solid #FF4500', color: '#FF4500' }} onClick={() => toggleMaximize('img')}>{maximizedWins.img ? '🗗' : '🗖'}</button>
              <button className="modal-close-btn" style={{ width: '32px', height: '32px', fontSize: '16px', padding: 0, border: '1px solid #FF4500', color: '#FF4500' }} onClick={() => setIsImgOpen(false)}>✕</button>
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', padding: '20px', gap: '20px', position: 'relative', zIndex: 10 }}>
            
            {/* ซ้าย: ตารางคิวถ่ายภาพ */}
            <div style={{ flex: '0 0 clamp(380px, 40vw, 500px)', display: 'flex', flexDirection: 'column', borderRight: '1px dashed rgba(255,69,0,0.5)', paddingRight: '20px' }}>
              <style>{`.img-hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
              <div style={{ flex: '1', overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', msOverflowStyle: 'none' }} className="img-hide-scrollbar">
              <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontFamily: 'Rajdhani', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ color: 'rgba(255,255,255,0.7)', borderBottom: '2px solid rgba(255,69,0,0.8)' }}>
                      <th style={{ padding: '12px 5px', width: '50%', textAlign: 'center', fontSize: 'clamp(12px, 1.2vw, 15px)', letterSpacing: '1.5px' }}>DATE & TIME (UTC)</th>
                      <th style={{ padding: '12px 5px', width: '25%', textAlign: 'center', fontSize: 'clamp(12px, 1.2vw, 15px)', letterSpacing: '1.5px' }}>DURATION</th>
                      <th style={{ padding: '12px 5px', width: '25%', textAlign: 'center', fontSize: 'clamp(12px, 1.2vw, 15px)', letterSpacing: '1.5px' }}>ACTION</th>
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
                          
                          <td style={{ padding: '16px 5px', fontWeight: 'bold', fontSize: 'clamp(14px, 1.5vw, 17px)', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                              <span style={{ color: isSelected ? '#ffffff' : '#e0e0e0', textShadow: isSelected ? '0 0 10px rgba(255,69,0,0.8)' : 'none', letterSpacing: '1px' }}>
                                {pad2(dStart.getUTCHours())}:{pad2(dStart.getUTCMinutes())}:{pad2(dStart.getUTCSeconds())}
                              </span>
                              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8em', fontWeight: '600', marginTop: '4px' }}>
                                {dStart.getUTCFullYear()}-{pad2(dStart.getUTCMonth() + 1)}-{pad2(dStart.getUTCDate())}
                              </span>
                            </div>
                          </td>
                          
                          <td style={{ padding: '16px 5px', color: isSelected ? '#ffffff' : 'var(--gold)', fontWeight: 'bold', fontSize: 'clamp(16px, 1.8vw, 20px)' }}>
                            {plan.duration.toFixed(0)} <span style={{ fontSize: '0.65em', color: isSelected ? 'rgba(255,255,255,0.6)' : 'rgba(255,204,0,0.6)' }}>s</span>
                          </td>
                          
                          <td style={{ padding: '16px 5px' }}>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                              <button style={{ 
                                background: isSelected ? 'linear-gradient(135deg, #FF4500, #ff8c00)' : 'rgba(255, 69, 0, 0.1)', 
                                border: `1px solid ${isSelected ? '#FF4500' : 'rgba(255, 69, 0, 0.4)'}`, 
                                color: isSelected ? '#fff' : '#FF4500', 
                                width: '48px', height: '36px', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                borderRadius: '4px', cursor: 'pointer', fontSize: '14px', 
                                transition: 'all 0.2s', 
                                boxShadow: isSelected ? '0 0 15px rgba(255, 69, 0, 0.6)' : 'none',
                              }}
                                      onClick={(e) => {
                                        e.stopPropagation();
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
              <div style={{ position: 'relative', zIndex: 10, marginTop: '15px', paddingTop: '15px', borderTop: '1px dashed rgba(255, 69, 0, 0.3)', textAlign: 'center' }}>
                 <label style={{ 
                   display: 'inline-block', width: '85%', 
                   background: 'linear-gradient(90deg, rgba(34, 211, 238, 0.1) 0%, rgba(34, 211, 238, 0.2) 50%, rgba(34, 211, 238, 0.1) 100%)', 
                   border: '2px dashed var(--cyan)', color: 'var(--cyan)', 
                   padding: '14px 20px', borderRadius: '8px', cursor: 'pointer', 
                   fontSize: '16px', fontFamily: 'Orbitron', fontWeight: 'bold', 
                   letterSpacing: '2px', transition: 'all 0.3s ease',
                   boxShadow: '0 0 15px rgba(34, 211, 238, 0.1)'
                 }}
                        onMouseOver={(e) => { 
                          e.currentTarget.style.background = 'var(--cyan)'; 
                          e.currentTarget.style.color = '#000';
                          e.currentTarget.style.boxShadow = '0 0 30px rgba(34, 211, 238, 0.8), inset 0 0 15px rgba(255,255,255,0.5)'; 
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
               style={{ flex: 1, position: 'relative', border: '1px solid var(--cyan)', borderRadius: '4px', background: '#000', overflow: 'hidden', boxShadow: 'inset 0 0 20px rgba(0, 234, 255, 0.2)', cursor: 'crosshair', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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
                           {/* 📍 ฟันธง: แก้จอหลุมดำ! เปลี่ยนกลับมาใช้ High-Res URL ผ่าน CDN ที่โหลดติด 100% พร้อมดันสีให้สดแบบ Tactical */}
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
               
               <div style={{ position:'absolute', bottom:'15px', left:'15px', color:'#00eaff', fontFamily:'Orbitron', fontSize:'14px', fontWeight: 'bold', textShadow:'0 0 10px #000', background: 'rgba(0,0,0,0.5)', padding: '5px 10px', borderRadius: '2px', borderLeft: '3px solid var(--cyan)' }}>
                 {selectedPlanId !== null ? `🎯 TARGET LOCKED (ZOOM: ${mapZoom}X)` : '🌍 GLOBAL VIEW (STANDBY)'}
               </div>
            </div>

          </div>
        </div>
      )}

      <div className="scanlines"></div>
    </>
  );
}