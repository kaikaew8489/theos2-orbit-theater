// @ts-nocheck

import { useEffect, useRef, useState } from 'react'
import Globe from 'react-globe.gl'
import './App.css'

const GROUND_STATION = [
  {
    lat: 13.16,
    lng: 100.93,
    name: 'GISTDA Ground Station\\nSriracha, Thailand',
    color: '#00eaff',
  },
]

const ORBIT_PATH = Array.from({ length: 220 }, (_, index) => {
  const lng = -180 + index * (360 / 219)
  const lat = 38 * Math.sin((lng + 40) * Math.PI / 180)

  return {
    lat,
    lng,
  }
})

const SATELLITE_POSITION = [
  {
    lat: 18,
    lng: 104,
    name: 'THEOS-2',
    color: '#ffb347',
  },
]

function App() {
  const globeRef = useRef<any>(null)

  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  })

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
        altitude: 2.2,
      },
      1000,
    )

    const controls = globeRef.current.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.35
    controls.enableZoom = true
  }, [])

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

        pointsData={[...GROUND_STATION, ...SATELLITE_POSITION]}
        pointLat="lat"
        pointLng="lng"
        pointColor="color"
        pointAltitude={0.02}
        pointRadius={0.45}

        labelsData={[...GROUND_STATION, ...SATELLITE_POSITION]}
        labelLat="lat"
        labelLng="lng"
        labelText="name"
        labelColor={() => '#00eaff'}
        labelSize={1.6}
        labelDotRadius={0.35}
        labelAltitude={0.04}

        pathsData={[ORBIT_PATH]}
        pathPoints={(path) => path}
        pathPointLat="lat"
        pathPointLng="lng"
        pathColor={() => '#00eaff'}
        pathStroke={1.8}
        pathDashLength={0.04}
        pathDashGap={0.012}
        pathDashAnimateTime={4500}

        arcsData={[
          {
            startLat: 13.16,
            startLng: 100.93,
            endLat: 18,
            endLng: 104,
          },
        ]}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={() => ['#00eaff', '#ffb347']}
        arcStroke={1.4}
        arcDashLength={0.35}
        arcDashGap={0.04}
        arcDashAnimateTime={1800}
      />

      <header className="title-panel">
        <p>THAILAND SPACE EXPO</p>
        <h1>THEOS-2 ORBIT THEATER</h1>
        <span>Thailand Satellite Ground Station Experience</span>
      </header>

      <section className="status-panel">
        <span className="status-dot" />
        <div>
          <strong>SYSTEM ONLINE</strong>
          <p>Ground Station: Sriracha, Thailand</p>
        </div>
      </section>

      <section className="mission-panel">
        <p>MISSION STATUS</p>
        <h2>THEOS-2 PASS SIMULATION</h2>
        <ul>
          <li>Orbit visualization: Active</li>
          <li>Ground station: Sriracha</li>
          <li>Tracking mode: Demonstration</li>
          <li>Signal link: Simulated</li>
        </ul>
      </section>
    </main>
  )
}

export default App