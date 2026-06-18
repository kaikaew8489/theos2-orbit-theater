// @ts-nocheck

import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as THREE from 'three'
import './App.css'
import * as satelliteJs from 'satellite.js/dist/satellite.es.js'

const GROUND_STATION = {
  lat: 13.16,
  lng: 100.93,
  name: 'GISTDA',
  color: '#ff8a8a',
}

const FALLBACK_TLE = {
  name: 'THEOS-2',
  line1: '1 58016U 23155A   26166.96487797  .00000718  00000-0  97744-4 0  9995',
  line2: '2 58016  97.8882 237.9656 0001407  90.8603 269.2771 14.81738229145245',
  source: 'Fallback',
  fetchedAt: '',
}

const TLE_CACHE_KEY = 'theos2-orbit-theater-tle-v1'
const TLE_API_FALLBACK_URL = 'https://theos2-orbit-theater.vercel.app/api/tle'

function getTleApiUrl() {
  if (window.location.hostname.endsWith('vercel.app')) {
    return '/api/tle'
  }

  return TLE_API_FALLBACK_URL
}

function isValidTle(tle: any) {
  return (
    tle &&
    typeof tle.line1 === 'string' &&
    typeof tle.line2 === 'string' &&
    tle.line1.startsWith('1 58016') &&
    tle.line2.startsWith('2 58016')
  )
}

function loadCachedTle() {
  try {
    const cached = localStorage.getItem(TLE_CACHE_KEY)
    if (!cached) return FALLBACK_TLE

    const parsed = JSON.parse(cached)
    if (isValidTle(parsed)) return parsed
  } catch {
    // use fallback
  }

  return FALLBACK_TLE
}

function saveCachedTle(tle: any) {
  try {
    localStorage.setItem(TLE_CACHE_KEY, JSON.stringify(tle))
  } catch {
    // ignore cache error
  }
}

function createSatrec(tle: any) {
  return satelliteJs.twoline2satrec(tle.line1, tle.line2)
}

const SPEED_OPTIONS = [1, 10, 50, 100]
const PASS_MIN_ELEVATION_DEG = 5
const NEXT_PASS_LOOKAHEAD_HOURS = 24
const NEXT_PASS_STEP_SECONDS = 60
const NEXT_PASS_PRE_ROLL_MINUTES = 5

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI
}

function getTheos2PositionByDate(date: Date, satrec: any) {
  const positionAndVelocity = satelliteJs.propagate(satrec, date)

  if (
    !positionAndVelocity ||
    !positionAndVelocity.position ||
    positionAndVelocity.position === true
  ) {
    return {
      lat: GROUND_STATION.lat,
      lng: GROUND_STATION.lng,
      altitudeKm: 560,
      name: 'THEOS-2',
      color: '#ffb347',
    }
  }

  const gmst = satelliteJs.gstime(date)

  const geodetic = satelliteJs.eciToGeodetic(
    positionAndVelocity.position as any,
    gmst,
  )

  return {
    lat: satelliteJs.degreesLat(geodetic.latitude),
    lng: satelliteJs.degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    name: 'THEOS-2',
    color: '#ffb347',
  }
}

function getTheos2LookAnglesByDate(date: Date, satrec: any) {
  const positionAndVelocity = satelliteJs.propagate(satrec, date)

  if (
    !positionAndVelocity ||
    !positionAndVelocity.position ||
    positionAndVelocity.position === true
  ) {
    return {
      elevationDeg: -90,
      azimuthDeg: 0,
      rangeKm: Number.POSITIVE_INFINITY,
    }
  }

  const gmst = satelliteJs.gstime(date)

  const positionEcf = satelliteJs.eciToEcf(
    positionAndVelocity.position as any,
    gmst,
  )

  const observerGd = {
    latitude: toRadians(GROUND_STATION.lat),
    longitude: toRadians(GROUND_STATION.lng),
    height: 0.05,
  }

  const lookAngles = satelliteJs.ecfToLookAngles(observerGd, positionEcf)

  return {
    elevationDeg: toDegrees(lookAngles.elevation),
    azimuthDeg: toDegrees(lookAngles.azimuth),
    rangeKm: lookAngles.rangeSat,
  }
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function pad3(value: number) {
  return String(value).padStart(3, '0')
}

function getUtcDayOfYear(date: Date) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1)
  const currentDay = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  )

  return Math.floor((currentDay - startOfYear) / 86400000) + 1
}

function getClockInfo(date: Date) {
  const thailandDate = new Date(date.getTime() + 7 * 60 * 60 * 1000)

  return {
    localTime: `${pad2(thailandDate.getUTCHours())}:${pad2(
      thailandDate.getUTCMinutes(),
    )}:${pad2(thailandDate.getUTCSeconds())}`,
    utcTime: `${pad2(date.getUTCHours())}:${pad2(
      date.getUTCMinutes(),
    )}:${pad2(date.getUTCSeconds())}`,
    doy: pad3(getUtcDayOfYear(date)),
  }
}

function createTleOrbitPath(baseDate: Date, satrec: any, minutes = 100) {
  return Array.from({ length: 220 }, (_, index) => {
    const offsetMinutes = -minutes / 2 + (minutes * index) / 219
    const date = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000)
    const pos = getTheos2PositionByDate(date, satrec)

    return {
      lat: pos.lat,
      lng: pos.lng,
    }
  })
}

function createSatelliteModel() {
  const group = new THREE.Group()

  const gold = new THREE.MeshBasicMaterial({ color: '#d8a536' })
  const darkGold = new THREE.MeshBasicMaterial({ color: '#8f6421' })
  const bluePanel = new THREE.MeshBasicMaterial({ color: '#173d92' })
  const panelLine = new THREE.MeshBasicMaterial({ color: '#58d8ff' })
  const white = new THREE.MeshBasicMaterial({ color: '#f3f7ff' })
  const cyan = new THREE.MeshBasicMaterial({ color: '#00eaff' })

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.45),
    gold,
  )
  group.add(body)

  const leftPanel = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.06, 0.95),
    bluePanel,
  )
  leftPanel.position.x = -1.85
  group.add(leftPanel)

  const rightPanel = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.06, 0.95),
    bluePanel,
  )
  rightPanel.position.x = 1.85
  group.add(rightPanel)

  for (let i = -2; i <= 2; i += 1) {
    const lineLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.075, 0.95),
      panelLine,
    )
    lineLeft.position.set(-1.85 + i * 0.32, 0.045, 0)
    group.add(lineLeft)

    const lineRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.075, 0.95),
      panelLine,
    )
    lineRight.position.set(1.85 + i * 0.32, 0.045, 0)
    group.add(lineRight)
  }

  const dish = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.12, 40),
    white,
  )
  dish.rotation.x = Math.PI / 2
  dish.position.z = 0.78
  group.add(dish)

  const dishRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.025, 12, 48),
    cyan,
  )
  dishRing.position.z = 0.86
  group.add(dishRing)

  const payload = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.38, 0.35),
    darkGold,
  )
  payload.position.set(0, -0.72, -0.25)
  group.add(payload)

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 24),
    new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  )
  glow.position.set(0, 0, 1.05)
  group.add(glow)

  group.rotation.z = -0.25
  group.scale.set(2.2, 2.2, 2.2)
  return group
}

function createGroundStationModel() {
  const group = new THREE.Group()

  const cyan = new THREE.MeshBasicMaterial({ color: '#00eaff' })
  const green = new THREE.MeshBasicMaterial({ color: '#27ff9a' })
  const white = new THREE.MeshBasicMaterial({ color: '#dffaff' })

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 0.22, 32),
    green,
  )
  base.position.y = -0.2
  group.add(base)

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.9, 16),
    cyan,
  )
  mast.position.y = 0.25
  group.add(mast)

  const dish = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 0.38, 40, 1, true),
    white,
  )
  dish.rotation.x = Math.PI / 2
  dish.position.set(0, 0.75, 0.25)
  group.add(dish)

  const dishEdge = new THREE.Mesh(
    new THREE.TorusGeometry(0.75, 0.035, 12, 48),
    cyan,
  )
  dishEdge.rotation.x = Math.PI / 2
  dishEdge.position.set(0, 0.75, 0.25)
  group.add(dishEdge)

  group.scale.set(0.22, 0.22, 0.22)

  return group
}

function createGroundTrackPoints(centerDate: Date, satrec: any) {
  const points: { lat: number; lng: number; alt: number }[] = []

  for (let minute = -25; minute <= 25; minute += 1) {
    const d = new Date(centerDate.getTime() + minute * 60 * 1000)
    const pos = getTheos2PositionByDate(d, satrec)

    if (!pos) continue

    points.push({
      lat: pos.lat,
      lng: pos.lng,
      alt: 0.012, // ยกเส้นขึ้นจากผิวโลกเล็กน้อย ให้มองเห็นชัด
    })
  }

  return points
}

function getInclinationDeg(line2: string) {
  const parts = line2.trim().split(/\s+/)
  return Number(parts[2] || 0)
}


function formatUtcDateTime(date: Date | null) {
  if (!date) return 'N/A'

  return date.toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' UTC'
}

function formatThaiDateTime(date: Date | null) {
  if (!date) return 'N/A'

  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' THA'
}

function getSatelliteSpeedKmS(date: Date, satrec: any) {
  const positionAndVelocity = satelliteJs.propagate(satrec, date)

  if (!positionAndVelocity.velocity) {
    return Number.NaN
  }

  const velocity = positionAndVelocity.velocity as {
    x: number
    y: number
    z: number
  }

  return Math.sqrt(
    velocity.x * velocity.x +
      velocity.y * velocity.y +
      velocity.z * velocity.z,
  )
}

function getPassDirection(aos: Date | null, los: Date | null, satrec: any) {
  if (!aos || !los) return 'N/A'

  const aosPos = getTheos2PositionByDate(aos, satrec)
  const losPos = getTheos2PositionByDate(los, satrec)

  if (!aosPos || !losPos) return 'N/A'

  if (losPos.lat > aosPos.lat) {
    return 'Northbound / Ascending'
  }

  return 'Southbound / Descending'
}

function getPassSummary(baseDate: Date, satrec: any) {
  const baseTimeMs = baseDate.getTime()
  const stepMs = 10 * 1000
  const thresholdDeg = PASS_MIN_ELEVATION_DEG
  const searchBackMs = 40 * 60 * 1000
  const searchForwardMs = NEXT_PASS_LOOKAHEAD_HOURS * 60 * 60 * 1000
  const maxPassDurationMs = 35 * 60 * 1000

  const baseLook = getTheos2LookAnglesByDate(baseDate, satrec)
  const isCurrentPass = baseLook.elevationDeg >= thresholdDeg

  let aosMs: number | null = null
  let losMs: number | null = null

  if (isCurrentPass) {
    for (
      let timeMs = baseTimeMs;
      timeMs >= baseTimeMs - searchBackMs;
      timeMs -= stepMs
    ) {
      const look = getTheos2LookAnglesByDate(new Date(timeMs), satrec)

      if (look.elevationDeg < thresholdDeg) {
        aosMs = timeMs + stepMs
        break
      }
    }

    if (!aosMs) {
      aosMs = baseTimeMs
    }

    for (
      let timeMs = baseTimeMs;
      timeMs <= baseTimeMs + maxPassDurationMs;
      timeMs += stepMs
    ) {
      const look = getTheos2LookAnglesByDate(new Date(timeMs), satrec)

      if (look.elevationDeg < thresholdDeg) {
        losMs = timeMs - stepMs
        break
      }
    }
  } else {
    for (
      let timeMs = baseTimeMs;
      timeMs <= baseTimeMs + searchForwardMs;
      timeMs += stepMs
    ) {
      const look = getTheos2LookAnglesByDate(new Date(timeMs), satrec)

      if (look.elevationDeg >= thresholdDeg) {
        aosMs = timeMs
        break
      }
    }

    if (aosMs) {
      for (
        let timeMs = aosMs;
        timeMs <= aosMs + maxPassDurationMs;
        timeMs += stepMs
      ) {
        const look = getTheos2LookAnglesByDate(new Date(timeMs), satrec)

        if (timeMs > aosMs && look.elevationDeg < thresholdDeg) {
          losMs = timeMs - stepMs
          break
        }
      }
    }
  }

  if (!aosMs) {
    return {
      passType: 'NO PASS FOUND',
      aos: null,
      los: null,
      aosAzimuthDeg: Number.NaN,
      losAzimuthDeg: Number.NaN,
      maxElevationDeg: Number.NaN,
      maxElevationTime: null,
      durationMin: Number.NaN,
      direction: 'N/A',
    }
  }

  if (!losMs) {
    losMs = aosMs + maxPassDurationMs
  }

  let maxElevationDeg = -90
  let maxElevationTimeMs = aosMs

  for (let timeMs = aosMs; timeMs <= losMs; timeMs += stepMs) {
    const look = getTheos2LookAnglesByDate(new Date(timeMs), satrec)

    if (look.elevationDeg > maxElevationDeg) {
      maxElevationDeg = look.elevationDeg
      maxElevationTimeMs = timeMs
    }
  }

  const aos = new Date(aosMs)
  const los = new Date(losMs)
  const aosLook = getTheos2LookAnglesByDate(aos, satrec)
  const losLook = getTheos2LookAnglesByDate(los, satrec)

  return {
    passType: isCurrentPass ? 'CURRENT PASS' : 'NEXT PASS',
    aos,
    los,
    aosAzimuthDeg: aosLook.azimuthDeg,
    losAzimuthDeg: losLook.azimuthDeg,
    maxElevationDeg,
    maxElevationTime: new Date(maxElevationTimeMs),
    durationMin: (losMs - aosMs) / 60000,
    direction: getPassDirection(aos, los, satrec),
  }
}


const EARTH_RADIUS_KM = 6371

function createOrbitVisualPath(centerDate: Date, satrec: any) {
  const points: { lat: number; lng: number; alt: number }[] = []

  // ประมาณหนึ่งรอบของ THEOS-2 จาก TLE จริง
  for (let minute = -55; minute <= 55; minute += 1) {
    const d = new Date(centerDate.getTime() + minute * 60 * 1000)
    const pos = getTheos2PositionByDate(d, satrec)

    if (!pos) continue

    points.push({
      lat: pos.lat,
      lng: pos.lng,
      alt: Math.max(0.09, pos.altitudeKm / EARTH_RADIUS_KM),
    })
  }

  return points
}

function createThinSignalArcs(
  satellitePos: {
    lat: number
    lng: number
    altitudeKm: number
  },
  active: boolean,
) {
  if (!active) return []

  return [
    {
      type: 'signal-glow',
      startLat: satellitePos.lat,
      startLng: satellitePos.lng,
      endLat: GROUND_STATION.lat,
      endLng: GROUND_STATION.lng,
      altitude: 0.16,
      color: ['rgba(255, 179, 71, 0.05)', 'rgba(255, 179, 71, 0.42)'],
      stroke: 0.75,
      dashLength: 1,
      dashGap: 0,
      animateTime: 0,
    },
    {
      type: 'signal-core',
      startLat: satellitePos.lat,
      startLng: satellitePos.lng,
      endLat: GROUND_STATION.lat,
      endLng: GROUND_STATION.lng,
      altitude: 0.16,
      color: ['rgba(255, 255, 255, 0.18)', 'rgba(255, 244, 190, 0.95)'],
      stroke: 0.28,
      dashLength: 1,
      dashGap: 0,
      animateTime: 0,
    },
    {
      type: 'signal-pulse',
      startLat: satellitePos.lat,
      startLng: satellitePos.lng,
      endLat: GROUND_STATION.lat,
      endLng: GROUND_STATION.lng,
      altitude: 0.16,
      color: ['rgba(255, 198, 80, 0)', 'rgba(255, 235, 150, 1)'],
      stroke: 0.48,
      dashLength: 0.025,
      dashGap: 0.16,
      animateTime: 780,
    },
  ]
}


function App() {
  const globeRef = useRef<any>(null)

  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  const [speed, setSpeed] = useState(1)
  const [tle, setTle] = useState(() => loadCachedTle())
  const [tleStatus, setTleStatus] = useState('TLE: cache/fallback ready')
  const [tleUpdating, setTleUpdating] = useState(false)

const satrec = useMemo(() => createSatrec(tle), [tle.line1, tle.line2])
  const [isPlaying, setIsPlaying] = useState(true)
  const [simulatedTimeMs, setSimulatedTimeMs] = useState(() => Date.now())

  const orbitPathKey = Math.floor(simulatedTimeMs / (5 * 60 * 1000))

  const orbitPath = useMemo(
    () => createTleOrbitPath(new Date(simulatedTimeMs), satrec, 100),
    [orbitPathKey, satrec],
  )

  const satellite = useMemo(
    () => getTheos2PositionByDate(new Date(simulatedTimeMs), satrec),
    [simulatedTimeMs, satrec],
  )

  const simulatedDate = useMemo(
    () => new Date(simulatedTimeMs),
    [simulatedTimeMs],
  )
  
  const groundTrackPaths = useMemo(() => {
    if (!satrec) return []
  
    const points = createGroundTrackPoints(simulatedDate, satrec)
  
    return [
      {
        type: 'glow',
        color: 'rgba(255, 150, 0, 0.65)',
        stroke: 3.2,
        dashLength: 1,
        dashGap: 0,
        animateTime: 0,
        points,
      },
      {
        type: 'core',
        color: 'rgba(255, 235, 90, 1)',
        stroke: 1.6,
        dashLength: 0.18,
        dashGap: 0.08,
        animateTime: 1800,
        points,
      },
    ]
  }, [simulatedDate, satrec])


  const lookAngles = useMemo(
    () => getTheos2LookAnglesByDate(new Date(simulatedTimeMs), satrec),
    [simulatedTimeMs, satrec],
  )

  const satelliteDistanceKm = lookAngles.rangeKm
  const linkActive = lookAngles.elevationDeg >= PASS_MIN_ELEVATION_DEG


  const orbitVisualPath = useMemo(
    () => createOrbitVisualPath(new Date(simulatedTimeMs), satrec),
    [simulatedTimeMs, satrec],
  )
  
  const thinSignalArcs = useMemo(
    () => createThinSignalArcs(satellite, linkActive),
    [
      satellite.lat,
      satellite.lng,
      satellite.altitudeKm,
      linkActive,
    ],
  )


  const satelliteSpeedKmS = useMemo(
    () => getSatelliteSpeedKmS(new Date(simulatedTimeMs), satrec),
    [simulatedTimeMs, satrec],
  )

  const inclinationDeg = useMemo(
    () => getInclinationDeg(tle.line2),
    [tle.line2],
  )
  
  const passSummaryKey = Math.floor(simulatedTimeMs / (30 * 1000))

  const passSummary = useMemo(
    () => getPassSummary(new Date(simulatedTimeMs), satrec),
    [passSummaryKey, satrec],
  )

  async function updateTle() {
    try {
      setTleUpdating(true)
      setTleStatus('TLE: updating from CelesTrak...')
  
      const response = await fetch(getTleApiUrl(), {
        cache: 'no-store',
      })
  
      if (!response.ok) {
        throw new Error(`API error ${response.status}`)
      }
  
      const data = await response.json()
  
      if (!isValidTle(data)) {
        throw new Error('Invalid TLE data')
      }
  
      const nextTle = {
        name: data.name || 'THEOS-2',
        line1: data.line1,
        line2: data.line2,
        source: data.source || 'CelesTrak',
        fetchedAt: data.fetchedAt || new Date().toISOString(),
      }
  
      setTle(nextTle)
      saveCachedTle(nextTle)
      setTleStatus('TLE: updated from CelesTrak')
    } catch (error) {
      setTleStatus('TLE: update failed, using cache/fallback')
    } finally {
      setTleUpdating(false)
    }
  }

  const clockInfo = useMemo(
    () => getClockInfo(new Date(simulatedTimeMs)),
    [simulatedTimeMs],
  )

  function jumpToNextPass() {
    const startTimeMs = simulatedTimeMs + 60 * 1000
    const endTimeMs =
      startTimeMs + NEXT_PASS_LOOKAHEAD_HOURS * 60 * 60 * 1000

    let bestTimeMs = startTimeMs
    let bestRangeKm = Number.POSITIVE_INFINITY
    let firstActiveTimeMs: number | null = null

    for (
      let timeMs = startTimeMs;
      timeMs <= endTimeMs;
      timeMs += NEXT_PASS_STEP_SECONDS * 1000
    ) {
      const testLookAngles = getTheos2LookAnglesByDate(new Date(timeMs), satrec)
      const testElevationDeg = testLookAngles.elevationDeg
      const testRangeKm = testLookAngles.rangeKm

      if (testRangeKm < bestRangeKm) {
        bestRangeKm = testRangeKm
        bestTimeMs = timeMs
      }

      if (testElevationDeg >= PASS_MIN_ELEVATION_DEG) {
        firstActiveTimeMs = timeMs
        break
      }
    }

    const targetTimeMs =
      (firstActiveTimeMs ?? bestTimeMs) -
      NEXT_PASS_PRE_ROLL_MINUTES * 60 * 1000

    setSimulatedTimeMs(targetTimeMs)
    setSpeed(1)
    setIsPlaying(true)
  }

  const linkArcs = useMemo(() => {
    if (!linkActive) return []

    const link = {
      startLat: GROUND_STATION.lat,
      startLng: GROUND_STATION.lng,
      endLat: satellite.lat,
      endLng: satellite.lng,
    }

    return [
      {
        ...link,
        type: 'beam',
      },
      {
        ...link,
        type: 'pulse',
        offset: 0,
      },
      {
        ...link,
        type: 'pulse',
        offset: 0.33,
      },
      {
        ...link,
        type: 'pulse',
        offset: 0.66,
      },
    ]
  }, [linkActive, satellite])

  const objectsData = useMemo(
    () => [
      {
        type: 'satellite',
        ...satellite,
        altitude: 0.18,
      },
    ],
    [satellite],
  )

  useEffect(() => {
    const handleResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    }

    window.addEventListener('resize', handleResize)

    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!globeRef.current) return

    globeRef.current.pointOfView(
      {
        lat: 13,
        lng: 101,
        altitude: 2.25,
      },
      1000,
    )

    const controls = globeRef.current.controls()
    controls.autoRotate = false
    controls.enableZoom = true
  }, [])

  useEffect(() => {
    if (!isPlaying) return

    const timer = window.setInterval(() => {
      setSimulatedTimeMs((current) => current + 50 * speed)
    }, 50)

    return () => window.clearInterval(timer)
  }, [isPlaying, speed])

  return (
    <main className="orbit-theater">
      <Globe
        ref={globeRef}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"

        objectsData={objectsData}
        objectLat="lat"
        objectLng="lng"
        objectAltitude="altitude"
        objectLabel="name"
        objectThreeObject={(object) =>
          object.type === 'satellite'
            ? createSatelliteModel()
            : createGroundStationModel()
        }

        labelsData={[GROUND_STATION, satellite]}
        labelLat="lat"
        labelLng="lng"
        labelText="name"
        labelColor={(label) =>
          label.name === 'THEOS-2' ? '#ffb347' : '#00eaff'
        }
        labelSize={(label) =>
          label.name === 'THEOS-2' ? 1.45 : 0.55
        }


        labelDotRadius={0}
        labelAltitude={(label) =>
        label.name === 'THEOS-2' ? 0.18 : 0.035
        }

        arcsData={linkArcs.filter((arc: any) => arc.type === 'beam')}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcAltitude={() => 0.055}
        arcColor={() => [
          'rgba(255, 160, 30, 0.38)',
          'rgba(255, 220, 110, 1)',
        ]}
        arcStroke={() => 0.22}
        arcDashLength={() => 1}
        arcDashGap={() => 0}
        arcDashInitialGap={() => 0}
        arcDashAnimateTime={() => 0}

        
        pathsData={[]}
        pathPoints={(path: any) => path.points}
        pathPointLat="lat"
        pathPointLng="lng"
        pathPointAlt="alt"
        pathColor={(path: any) => path.color}
        pathStroke={(path: any) => path.stroke}
        pathDashLength={(path: any) => path.dashLength}
        pathDashGap={(path: any) => path.dashGap}
        pathDashInitialGap={() => 0}
        pathDashAnimateTime={(path: any) => path.animateTime}

        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={(arc) =>
          arc.type === 'beam'
            ? ['rgba(0, 234, 255, 0.28)', 'rgba(0, 234, 255, 0.08)']
            : ['#ffb347', '#fff1a8']
        }
        arcStroke={(arc) => (arc.type === 'beam' ? 0.7 : 2.4)}
        arcDashLength={(arc) => (arc.type === 'beam' ? 1 : 0.045)}
        arcDashGap={(arc) => (arc.type === 'beam' ? 0 : 0.22)}
        arcDashInitialGap={(arc) => arc.offset ?? 0}
        arcDashAnimateTime={(arc) =>
          arc.type === 'beam' ? 0 : Math.max(420, 1800 / Math.sqrt(speed))
        }

        ringsData={[
          {
            type: 'station',
            lat: GROUND_STATION.lat,
            lng: GROUND_STATION.lng,
            color: linkActive ? '#27ff9a' : '#00eaff',
          },
        ]}
        ringLat="lat"
        ringLng="lng"
        ringColor={(ring: any) => ring.color}
        ringMaxRadius={() => (linkActive ? 0.75 : 0.25)}
        ringPropagationSpeed={() => (linkActive ? 0.45 : 0.18)}
        ringRepeatPeriod={() => (linkActive ? 1700 : 3200)}
      />

      <header className="title-panel">
        <p>THAILAND SPACE EXPO</p>
        <h1>THEOS-2 ORBIT</h1>
        <span>Thailand Satellite Ground Station</span>
      </header>


      <section className="clock-panel">
  <div className="clock-item">
    <span>THA LOCAL</span>
    <strong>{clockInfo.localTime}</strong>
  </div>

  <div className="clock-item">
    <span>DOY</span>
    <strong>{clockInfo.doy}</strong>
  </div>

  <div className="clock-item">
    <span>UTC</span>
    <strong>{clockInfo.utcTime}</strong>
  </div>
</section>

<section className="mission-panel">
  <p>MISSION STATUS</p>
  <h2>THEOS-2 PASS</h2>

  <ul>
    <li>Orbit visualization: Active</li>
    <li>Ground station: Sriracha</li>

    <li>AOS: {linkActive ? 'TRACKING NOW' : 'Waiting next pass'}</li>
<li>Pass Window: {passSummary.passType}</li>
<li>Mask Elevation: {PASS_MIN_ELEVATION_DEG.toFixed(1)}°</li>

<li>AOS UTC: {formatUtcDateTime(passSummary.aos)}</li>
<li>LOS UTC: {formatUtcDateTime(passSummary.los)}</li>
<li>AOS THA: {formatThaiDateTime(passSummary.aos)}</li>
<li>LOS THA: {formatThaiDateTime(passSummary.los)}</li>

<li>
  Max Elevation:{' '}
  {Number.isFinite(passSummary.maxElevationDeg)
    ? `${passSummary.maxElevationDeg.toFixed(1)}°`
    : 'N/A'}
</li>

<li>Max EL UTC: {formatUtcDateTime(passSummary.maxElevationTime)}</li>

<li>
  Duration:{' '}
  {Number.isFinite(passSummary.durationMin)
    ? `${passSummary.durationMin.toFixed(1)} min`
    : 'N/A'}
</li>

<li>
  Pass Direction: {passSummary.direction}
</li>

<li>
  AOS Azimuth:{' '}
  {Number.isFinite(passSummary.aosAzimuthDeg)
    ? `${passSummary.aosAzimuthDeg.toFixed(1)}°`
    : 'N/A'}
</li>

<li>
  LOS Azimuth:{' '}
  {Number.isFinite(passSummary.losAzimuthDeg)
    ? `${passSummary.losAzimuthDeg.toFixed(1)}°`
    : 'N/A'}
</li>

<li>Elevation Now: {lookAngles.elevationDeg.toFixed(1)}°</li>
<li>Azimuth Now: {lookAngles.azimuthDeg.toFixed(1)}°</li>
<li>Range: {Math.round(satelliteDistanceKm).toLocaleString()} km</li>
<li>Altitude: {satellite.altitudeKm.toFixed(0)} km</li>

<li>
  Sat Speed:{' '}
  {Number.isFinite(satelliteSpeedKmS)
    ? `${satelliteSpeedKmS.toFixed(2)} km/s`
    : 'N/A'}
</li>

<li>Inclination: {inclinationDeg.toFixed(2)}°</li>


    <li>Speed: {speed}x Simulation</li>
    <li>Signal link: {linkActive ? 'Active' : 'Standby'}</li>

    <li>TLE Source: {tle.source || 'Fallback'}</li>

    <li>
      TLE Updated:{' '}
      {tle.fetchedAt
        ? new Date(tle.fetchedAt).toLocaleString('en-GB', {
            timeZone: 'Asia/Bangkok',
            hour12: false,
          })
        : 'Fallback only'}
    </li>

    <li>TLE Epoch: {tle.line1.substring(18, 32)}</li>

    <li>
      TLE Status:{' '}
      {tle.source === 'CelesTrak'
        ? 'updated from CelesTrak'
        : 'using fallback TLE'}
    </li>
  </ul>
</section>

      <section className="control-panel">
        <p>TIME CONTROL</p>

        <div className="control-row">
          <button onClick={() => setIsPlaying((value) => !value)}>
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </button>

          <button onClick={jumpToNextPass}>
            NEXT PASS
          </button>

          <button onClick={updateTle} disabled={tleUpdating}>
        {tleUpdating ? 'UPDATING' : 'UPDATE TLE'}
      </button>

        <button
          onClick={() => {
            setSimulatedTimeMs(Date.now())
            setSpeed(1)
            setIsPlaying(true)
          }}
        >
          RESET NOW
        </button>

        {SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            className={speed === option ? 'active' : ''}
            onClick={() => setSpeed(option)}
          >
            {option}x
          </button>
        ))}
        </div>
      </section>

      <section className="status-panel">
        <span className="status-dot" />
        <div>
          <strong>{linkActive ? 'TRACKING ACTIVE' : 'SYSTEM ONLINE'}</strong>
          <p>Ground Station: Sriracha, Thailand</p>
        </div>
      </section>
    </main>
  )
}


export default App