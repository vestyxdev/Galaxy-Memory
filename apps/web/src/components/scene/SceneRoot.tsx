import { Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { HOME_POSITION } from "../../lib/camera";
import { useGalaxy } from "../../stores/galaxy";
import { BlackHole } from "./BlackHole";
import { CameraRig } from "./CameraRig";
import { GraphEdges } from "./GraphEdges";
import { GraphNodes } from "./GraphNodes";

export function SceneRoot() {
  const selectedId = useGalaxy((s) => s.selectedId);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: [HOME_POSITION.x, HOME_POSITION.y, HOME_POSITION.z],
        fov: 45,
        near: 0.1,
        far: 240,
      }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        // clicking empty space clears selection highlights; the drawer stays
        if (selectedId) useGalaxy.setState({ selectedId: null });
      }}
    >
      <color attach="background" args={["#050507"]} />
      <Stars radius={95} depth={45} count={3800} factor={3.4} saturation={0} fade speed={0.55} />
      <BlackHole />
      <GraphEdges />
      <GraphNodes />
      <CameraRig />
      <EffectComposer>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={0.32} luminanceSmoothing={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
