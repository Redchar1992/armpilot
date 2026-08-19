"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type MutableRefObject, useMemo, useRef } from "react";

import type { Frame, GeomDef } from "@/lib/sceneTypes";

function GeomObject({
  def,
  register,
}: {
  def: GeomDef;
  register: (id: number, object: THREE.Object3D | null) => void;
}) {
  const color = useMemo(
    () => new THREE.Color(def.rgba[0], def.rgba[1], def.rgba[2]),
    [def.rgba],
  );
  const meshGeometry = useMemo(() => {
    if (def.type !== "mesh" || !def.verts || !def.faces) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(def.verts, 3));
    geometry.setIndex(def.faces);
    geometry.computeVertexNormals();
    return geometry;
  }, [def.faces, def.type, def.verts]);

  const material = (
    <meshStandardMaterial
      color={color}
      transparent={def.rgba[3] < 1}
      opacity={def.rgba[3]}
      roughness={def.name.includes("block") ? 0.42 : 0.64}
      metalness={def.name.includes("arm") || def.name.includes("wrist") ? 0.14 : 0.02}
      side={def.type === "plane" ? THREE.DoubleSide : THREE.FrontSide}
      depthWrite={def.rgba[3] > 0.4}
    />
  );

  let content: React.ReactNode;
  switch (def.type) {
    case "plane":
      content = (
        <mesh receiveShadow>
          <planeGeometry args={[def.size[0] * 2, def.size[1] * 2]} />
          {material}
        </mesh>
      );
      break;
    case "box":
      content = (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[def.size[0] * 2, def.size[1] * 2, def.size[2] * 2]} />
          {material}
        </mesh>
      );
      break;
    case "sphere":
      content = (
        <mesh castShadow>
          <sphereGeometry args={[def.size[0], 24, 24]} />
          {material}
        </mesh>
      );
      break;
    case "cylinder":
      content = (
        <mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[def.size[0], def.size[0], def.size[1] * 2, 32]} />
          {material}
        </mesh>
      );
      break;
    case "capsule":
      content = (
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[def.size[0], def.size[1] * 2, 8, 16]} />
          {material}
        </mesh>
      );
      break;
    case "mesh":
      content = (
        <mesh geometry={meshGeometry!} castShadow receiveShadow>
          {material}
        </mesh>
      );
      break;
    default:
      return null;
  }

  return <group ref={(object) => register(def.id, object)}>{content}</group>;
}

function FrameApplier({
  frameRef,
  objects,
  order,
}: {
  frameRef: MutableRefObject<Frame | null>;
  objects: MutableRefObject<Map<number, THREE.Object3D>>;
  order: number[];
}) {
  useFrame(() => {
    const frame = frameRef.current;
    if (!frame) return;
    for (let index = 0; index < frame.poses.length; index += 1) {
      const object = objects.current.get(order[index]);
      if (!object) continue;
      const pose = frame.poses[index];
      object.position.set(pose[0], pose[1], pose[2]);
      object.quaternion.set(pose[4], pose[5], pose[6], pose[3]);
    }
  });
  return null;
}

export default function Viewer({
  geoms,
  frameRef,
}: {
  geoms: GeomDef[];
  frameRef: MutableRefObject<Frame | null>;
}) {
  const objects = useRef(new Map<number, THREE.Object3D>());
  const order = useMemo(() => geoms.map((geom) => geom.id), [geoms]);
  const register = (id: number, object: THREE.Object3D | null) => {
    if (object) objects.current.set(id, object);
    else objects.current.delete(id);
  };

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [1.14, -1.06, 0.78], up: [0, 0, 1], fov: 39 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#080d10"]} />
      <fog attach="fog" args={["#080d10", 1.35, 2.45]} />
      <hemisphereLight args={["#c8e9ff", "#16231f", 0.86]} />
      <directionalLight
        position={[0.7, -0.75, 1.45]}
        intensity={2.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={3}
        shadow-camera-left={-1}
        shadow-camera-right={1}
        shadow-camera-top={1}
        shadow-camera-bottom={-1}
      />
      <pointLight position={[0.3, 0.45, 0.7]} intensity={1.2} color="#b8f35a" />
      <gridHelper
        args={[1.65, 22, "#2a4a42", "#172720"]}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0.46, 0.04, 0.003]}
      />
      {geoms.map((geom) => (
        <GeomObject key={geom.id} def={geom} register={register} />
      ))}
      <FrameApplier frameRef={frameRef} objects={objects} order={order} />
      <OrbitControls
        makeDefault
        target={[0.43, 0.02, 0.13]}
        enableDamping
        dampingFactor={0.075}
        minDistance={0.72}
        maxDistance={2.1}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 2.08}
      />
    </Canvas>
  );
}
