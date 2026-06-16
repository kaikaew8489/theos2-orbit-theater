import { useEffect, useRef } from 'react'
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  LabelStyle,
  VerticalOrigin,
  Viewer,
} from 'cesium'

import 'cesium/Build/Cesium/Widgets/widgets.css'
import './App.css'

const GROUND_STATION = {
  longitude: 100.93,
  latitude: 13.16,
}

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

    // ปิด Globe จริงของ Cesium ก่อน
    // แล้วใช้ Ellipsoid จำลองเป็นโลกแทน เพื่อพิสูจน์ WebGL
    viewer.scene.globe.show = false

    viewer.entities.add({
      name: 'Demo Earth',
      position: Cartesian3.ZERO,
      ellipsoid: {
        radii: new Cartesian3(6_378_137, 6_378_137, 6_356_752),
        material: Color.fromCssColorString('#168bd2'),
        outline: true,
        outlineColor: Color.CYAN,
      },
    })

    viewer.entities.add({
      name: 'GISTDA Ground Station — Sriracha',
      position: Cartesian3.fromDegrees(
        GROUND_STATION.longitude,
        GROUND_STATION.latitude,
      ),
      point: {
        pixelSize: 14,
        color: Color.CYAN,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: 'GISTDA GROUND STATION\nSRIRACHA',
        font: '600 15px sans-serif',
        fillColor: Color.CYAN,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -28),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })

    // บังคับกล้องให้เห็นลูกโลกจำลองเต็มใบ
    viewer.camera.flyToBoundingSphere(
      new BoundingSphere(Cartesian3.ZERO, 7_000_000),
      {
        duration: 0,
      },
    )

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