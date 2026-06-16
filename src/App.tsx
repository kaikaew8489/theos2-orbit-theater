// @ts-nocheck

import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import * as THREE from 'three'
import './App.css'

const GROUND_STATION = {
  lat: 13.16,
  lng: 100.93,
  name: 'GISTDA Ground Station, Sriracha',
  color: '#00eaff',
}

const SPEED_OPTIONS = [1, 10, 50, 100]

function createOrbitPath() {
  return Array.from({ length: 260 }, (_, index) => {
    const lng = -180 + index * (360 / 259)
    const lat = 38 * Math.sin(((lng + 40) * Math.PI) / 180)

    return { lat, lng }
  })
}

function getSatellitePosition(progress: number) {
  const lng = -180 + progress * 360
  const lat = 38 * Math.sin(((lng + 40) * Math.PI) / 180)

  return {
    lat,
    lng,
    name: 'THEOS-2',
    color: '#ffb347',
  }
}

function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const earthRadiusKm = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180

  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h))
}

function createSatelliteModel() {
  const group = new THREE.Group()

  const gold = new THREE.MeshBasicMaterial({ color: '#d8a536' })
  const darkGold = new THREE.MeshBasicMaterial({ color: '#8f6421' })
  const bluePanel = new THREE.MeshBasicMaterial({ color: '#173d92' })
  const panelLine = new THREE.MeshBasicMaterial({ color: '#58d8ff' })
  const white = new THREE.MeshBasicMaterial({ color: '#f3f7ff' })
  const cyan = new THREE.MeshBasicMaterial({ color: '#00eaff' })

  // ตัวบัสดาวเทียมสีทอง
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.45),
    gold,
  )
  group.add(body)

  // แผง solar panel ซ้ายขวา
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

  // เส้นบนแผงโซลาร์
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

  // จาน/กล้องวงกลมด้านหน้า คล้ายรูปจริง
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

  // กล่อง payload ด้านล่าง
  const payload = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.38, 0.35),
    darkGold,
  )
  payload.position.set(0, -0.72, -0.25)
  group.add(payload)

  // จุดแสง THEOS-2
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 24),
    new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  )
  glow.position.set(0, 0, 1.05)
  group.add(glow)

  group.rotation.z = -0.25
  group.scale.set(1.5, 1.5, 1.5)

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

  // จานสายอากาศ
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

function App() {
  const globeRef = useRef<any>(null)

  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })

  const [speed, setSpeed] = useState(10)
  const [isPlaying, setIsPlaying] = useState(true)
  const [orbitProgress, setOrbitProgress] = useState(0.78)

  const orbitPath = useMemo(() => createOrbitPath(), [])
  const satellite = useMemo(
    () => getSatellitePosition(orbitProgress),
    [orbitProgress],
  )

  const satelliteDistanceKm = distanceKm(satellite, GROUND_STATION)
  const linkActive = satelliteDistanceKm < 3500


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
        type: 'ground',
        ...GROUND_STATION,
        altitude: 0.035,
      },
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
      setOrbitProgress((current) => {
        const next = current + 0.00008 * speed
        return next > 1 ? next - 1 : next
      })
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
          label.name === 'THEOS-2' ? 1.45 : 1.35
        }
        labelDotRadius={0}
        labelAltitude={(label) =>
          label.name === 'THEOS-2' ? 0.18 : 0.055
        }

        pathsData={[orbitPath]}
        pathPoints={(path) => path}
        pathPointLat="lat"
        pathPointLng="lng"
        pathColor={() => '#00eaff'}
        pathStroke={1.55}
        pathDashLength={0.035}
        pathDashGap={0.014}
        pathDashAnimateTime={3600}

        arcsData={linkArcs}
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
            lat: GROUND_STATION.lat,
            lng: GROUND_STATION.lng,
            color: linkActive ? '#27ff9a' : '#00eaff',
          },
        ]}
        ringLat="lat"
        ringLng="lng"
        ringColor={(ring) => ring.color}
        ringMaxRadius={linkActive ? 0.75 : 0.25}
        ringPropagationSpeed={linkActive ? 0.45 : 0.18}
        ringRepeatPeriod={linkActive ? 1700 : 3200}
      />

      <header className="title-panel">
        <p>THAILAND SPACE EXPO</p>
        <h1>THEOS-2 ORBIT THEATER</h1>
        <span>Thailand Satellite Ground Station Experience</span>
      </header>

      <section className="mission-panel">
        <p>MISSION STATUS</p>
        <h2>THEOS-2 PASS SIMULATION</h2>
        <ul>
          <li>Orbit visualization: Active</li>
          <li>Ground station: Sriracha</li>
          <li>AOS: {linkActive ? 'TRACKING NOW' : 'Waiting next pass'}</li>
          <li>Range: {Math.round(satelliteDistanceKm).toLocaleString()} km</li>
          <li>Speed: {speed}x Simulation</li>
          <li>Signal link: {linkActive ? 'Active' : 'Standby'}</li>
        </ul>
      </section>

      <section className="control-panel">
        <p>TIME CONTROL</p>

        <div className="control-row">
          <button onClick={() => setIsPlaying((value) => !value)}>
            {isPlaying ? 'PAUSE' : 'PLAY'}
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