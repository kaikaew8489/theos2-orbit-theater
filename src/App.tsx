import { useEffect, useRef } from 'react'
import {
  Cartesian3,
  Color,
  Math as CesiumMath,
  Viewer,
} from 'cesium'

import 'cesium/Build/Cesium/Widgets/widgets.css'
import './App.css'

function App() {
  const cesiumContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = cesiumContainerRef.current
    if (!container) return

    const viewer = new Viewer(container, {
      baseLayer: false,
      skyBox: false,
      skyAtmosphere: false,

      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
    })

    viewer.scene.backgroundColor = Color.fromCssColorString('#01050c')
    viewer.scene.globe.enableLighting = false
    viewer.scene.globe.baseColor = Color.fromCssColorString('#168bd2')

    viewer.scene.globe.show = true
    viewer.scene.globe.enableLighting = false
    viewer.scene.globe.baseColor = Color.CYAN
    
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(105, 15, 22_000_000),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-90),
        roll: 0,
      },
    })
    
    viewer.scene.requestRender()

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.destroy()
      }
    }
  }, [])

  return (
    <main className="orbit-theater">
      <div ref={cesiumContainerRef} className="cesium-container" />

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
    </main>
  )
}

export default App