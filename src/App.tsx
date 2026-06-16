// @ts-nocheck

import { useEffect, useMemo, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import './App.css'

const GROUND_STATION = {
  lat: 13.16,
  lng: 100.93,
  name: 'GISTDA Sriracha Ground Station',
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

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
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
  const linkActive = satelliteDistanceKm < 2600

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
        lat: 15,
        lng: 105,
        altitude: 2.9,
      },
      1000,
    )

    const controls = globeRef.current.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.18
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

        pointsData={[GROUND_STATION, satellite]}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointAltitude={(point) =>
          point.name === 'THEOS-2' ? 0.08 : 0.025
        }
        pointRadius={(point) =>
          point.name === 'THEOS-2' ? 0.55 : 0.42
        }

        labelsData={[GROUND_STATION, satellite]}
        labelLat="lat"
        labelLng="lng"
        labelText="name"
        labelColor={(label) =>
          label.name === 'THEOS-2' ? '#ffb347' : '#00eaff'
        }
        labelSize={(label) =>
          label.name === 'THEOS-2' ? 1.9 : 1.45
        }
        labelDotRadius={0.28}
        labelAltitude={(label) =>
          label.name === 'THEOS-2' ? 0.1 : 0.04
        }

        pathsData={[orbitPath]}
        pathPoints={(path) => path}
        pathPointLat="lat"
        pathPointLng="lng"
        pathColor={() => '#00eaff'}
        pathStroke={1.65}
        pathDashLength={0.035}
        pathDashGap={0.014}
        pathDashAnimateTime={3600}

        arcsData={
          linkActive
            ? [
                {
                  startLat: GROUND_STATION.lat,
                  startLng: GROUND_STATION.lng,
                  endLat: satellite.lat,
                  endLng: satellite.lng,
                },
              ]
            : []
        }
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={() => ['#00eaff', '#ffb347']}
        arcStroke={1.7}
        arcDashLength={0.32}
        arcDashGap={0.045}
        arcDashAnimateTime={1400}
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