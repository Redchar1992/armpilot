"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { MutableRefObject, useMemo, useRef } from "react";

export type GeomDef = {
  id: number;
  name: string;
  type: string;
  size: number[];
  rgba: number[];
  verts?: number[];
  faces?: number[];
};

export type Frame = { t: number; poses: number[][]; holding: string | null };

function GeomObject({
  def,
  register,
}: {
  def: GeomDef;
  register: (id: number, o: THREE.Object3D | null) => void;
}) {
  const color = useMemo(
    () => new THREE.Color(def.rgba[0], def.rgba[1], def.rgba[2]),
    [def]
  );
  const meshGeo = useMemo(() => {
    if (def.type !== "mesh" || !def.verts || !def.faces) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(def.verts, 3));
    geo.setIndex(def.faces);
    geo.computeVertexNormals();
    return geo;
  }, [def]);

  const mat = (
    <meshStandardMaterial
      color={color}
      transparent={def.rgba[3] < 1}
      opacity={def.rgba[3]}
      roughness={0.65}
      metalness={0.05}
      side={def.type === "plane" ? THREE.DoubleSide : THREE.FrontSide}
    />
  );

  let inner: React.ReactNode;
  switch (def.type) {
    case "plane":
      inner = (
        <mesh receiveShadow>
          <planeGeometry args={[8, 8]} />
          {mat}
        </mesh>
      );
      break;
    case "box":
      inner = (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[def.size[0] * 2, def.size[1] * 2, def.size[2] * 2]} />
          {mat}
        </mesh>
      );
      break;
    case "sphere":
      inner = (
        <mesh castShadow>
          <sphereGeometry args={[def.size[0], 24, 24]} />
          {mat}
        </mesh>
      );
      break;
    // MuJoCo cylinders/capsules are z-axis aligned, three.js ones are y-axis
    case "cylinder":
      inner = (
        <mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[def.size[0], def.size[0], def.size[1] * 2, 32]} />
          {mat}
        </mesh>
      );
      break;
    case "capsule":
      inner = (
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[def.size[0], def.size[1] * 2, 8, 16]} />
          {mat}
        </mesh>
      );
      break;
    case "mesh":
      inner = (
        <mesh geometry={meshGeo!} castShadow receiveShadow>
          {mat}
        </mesh>
      );
      break;
    default:
      return null;
  }
  return <group ref={(o) => register(def.id, o)}>{inner}</group>;
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
    const f = frameRef.current;
    if (!f) return;
    for (let i = 0; i < f.poses.length; i++) {
      const obj = objects.current.get(order[i]);
      if (!obj) continue;
      const p = f.poses[i];
      obj.position.set(p[0], p[1], p[2]);
      obj.quaternion.set(p[4], p[5], p[6], p[3]); // mujoco wxyz -> three xyzw
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
  const order = useMemo(() => geoms.map((g) => g.id), [geoms]);
  const register = (id: number, o: THREE.Object3D | null) => {
    if (o) objects.current.set(id, o);
    else objects.current.delete(id);
  };
  return (
    <Canvas shadows camera={{ position: [1.3, -1.1, 0.9], up: [0, 0, 1], fov: 42 }}>
      <color attach="background" args={["#14161a"]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[1, -1, 2]}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {geoms.map((g) => (
        <GeomObject key={g.id} def={g} register={register} />
      ))}
      <FrameApplier frameRef={frameRef} objects={objects} order={order} />
      <OrbitControls makeDefault target={[0.45, 0, 0.08]} />
    </Canvas>
  );
}
