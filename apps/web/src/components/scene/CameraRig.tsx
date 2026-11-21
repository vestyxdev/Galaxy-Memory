import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { HOME_POSITION, HOME_TARGET } from "../../lib/camera";
import { useGalaxy } from "../../stores/galaxy";

/**
 * OrbitControls + smooth camera flights. focusRequest from the store sets a
 * destination; any user drag cancels the flight via onStart.
 */
export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const flight = useRef<{ cam: Vector3; tgt: Vector3 } | null>(null);

  const focusRequest = useGalaxy((s) => s.focusRequest);
  const positions = useGalaxy((s) => s.positions);
  const autoRotate = useGalaxy((s) => s.settings.autoRotate);
  const selectedId = useGalaxy((s) => s.selectedId);

  useEffect(() => {
    if (focusRequest.point) {
      const target = new Vector3(...focusRequest.point);
      const cam = target
        .clone()
        .multiplyScalar(1.55)
        .add(new Vector3(0, 1.9, 0));
      flight.current = { cam, tgt: target.multiplyScalar(0.9) };
      return;
    }
    if (focusRequest.id === null) {
      flight.current = { cam: HOME_POSITION.clone(), tgt: HOME_TARGET.clone() };
      return;
    }
    const p = positions[focusRequest.id];
    if (!p) return;
    const target = new Vector3(p[0], p[1], p[2]);
    const cam = target
      .clone()
      .add(target.clone().normalize().multiplyScalar(3.2))
      .add(new Vector3(0, 1.0, 0));
    flight.current = { cam, tgt: target };
  }, [focusRequest, positions]);

  useFrame(({ camera }) => {
    const f = flight.current;
    const controls = controlsRef.current;
    if (!f || !controls) return;
    camera.position.lerp(f.cam, 0.08);
    controls.target.lerp(f.tgt, 0.08);
    if (camera.position.distanceTo(f.cam) < 0.06) flight.current = null;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      autoRotate={autoRotate && !selectedId}
      autoRotateSpeed={0.4}
      minDistance={3}
      maxDistance={30}
      enablePan={false}
      onStart={() => {
        flight.current = null;
      }}
    />
  );
}
