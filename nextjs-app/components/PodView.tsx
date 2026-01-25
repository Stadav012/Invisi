"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
    OrbitControls,
    PerspectiveCamera,
    Environment,
    Float,
    MeshTransmissionMaterial,
    RoundedBox,
    ContactShadows,
    Instances,
    Instance,
    Sparkles
} from "@react-three/drei";
import * as THREE from "three";
import { BatchStatus } from "./BatchCard";
import { Thermometer, Droplets, Wind, Activity, LucideIcon } from "lucide-react";

/**
 * PodView Component
 * 
 * Renders a high-fidelity 3D visualization of a processing pod.
 * The pod appearance changes subtly based on the batch status.
 */

interface PodViewProps {
    batch: {
        status: BatchStatus;
        metrics: {
            label: string;
            value: string;
            subLabel?: string;
            progress: number;
        };
    };
}

function StatItem({ icon: Icon, label, value, color }: { icon: LucideIcon, label: string, value: string, color: string }) {
    return (
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/50 shadow-sm min-w-[160px] transition-transform hover:scale-105">
            <div className={`p-1.5 rounded-lg bg-${color}-50 text-${color}-600`}>
                <Icon size={14} />
            </div>
            <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{label}</span>
                <span className="text-sm font-bold text-gray-800 font-mono">{value}</span>
            </div>
        </div>
    );
}

// Deterministic pseudo-random number generator
function seededRandom(seed: number) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function CocoaBeans({ width, depth, height, count, activeColor }: { width: number, depth: number, height: number, count: number, activeColor: string }) {
    const beans = useMemo(() => {
        const temp = [];
        const baseColor = new THREE.Color("#4a3728"); // Richer dark brown
        const heatColor = new THREE.Color(activeColor).multiplyScalar(2); // Brighter for "glow" impression

        for (let i = 0; i < count; i++) {
            // Use index as seed for determinism
            const r1 = seededRandom(i * 3 + 1);
            const r2 = seededRandom(i * 3 + 2);
            const r3 = seededRandom(i * 3 + 3);
            const r4 = seededRandom(i * 3 + 4);

            const x = (r1 - 0.5) * (width - 0.2);
            const z = (r2 - 0.5) * (depth - 0.2);
            const y = r3 * height;

            const rotX = r4 * Math.PI;
            const rotY = r1 * Math.PI;
            const rotZ = r2 * Math.PI;

            const scale = 0.7 + r3 * 0.5;

            // Heatmap Logic: More pronounced hotspots
            const distFromCenter = Math.sqrt(x * x + z * z);
            const noise = seededRandom(i * 10);
            const heatIntensity = (1 - distFromCenter / 1.8) * 0.5 + noise * 0.5;

            // Threshold for clearly defined "hot" beans
            const isHot = heatIntensity > 0.6;
            const c = isHot ? heatColor : baseColor;

            temp.push({ position: [x, y, z], rotation: [rotX, rotY, rotZ], scale, color: c });
        }
        return temp;
    }, [count, width, depth, height, activeColor]);

    if (height <= 0.1) return null;

    return (
        <Instances range={count}>
            {/* Bean Geometry - Flattened Sphere */}
            <sphereGeometry args={[0.07, 12, 12]} />
            <meshStandardMaterial
                roughness={0.6}
                metalness={0.2}
            />

            {beans.map((bean, i) => (
                <group key={i} position={bean.position as [number, number, number]} rotation={bean.rotation as [number, number, number]} scale={[1, 0.6, 0.6]}> {/* Scale to make it bean-shaped */}
                    <Instance scale={bean.scale} color={bean.color} />
                </group>
            ))}
        </Instances>
    );
}

function ScanningLaser({ width, depth, height, color }: { width: number, depth: number, height: number, color: string }) {
    const ref = useRef<THREE.Group>(null);
    useFrame((state) => {
        if (ref.current) {
            const t = state.clock.getElapsedTime();
            const y = (Math.sin(t * 0.5) + 1) / 2 * height - (height / 2); // Slower scan
            ref.current.position.y = y;
        }
    });

    return (
        <group ref={ref}>
            {/* Grid Laser Effect */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[width, depth]} />
                <meshBasicMaterial
                    color={color}
                    transparent
                    opacity={0.15}
                    side={THREE.DoubleSide}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>
            {/* Bright Edge Lines */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, depth / 2]}>
                <boxGeometry args={[width, 0.02, 0.02]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -depth / 2]}>
                <boxGeometry args={[width, 0.02, 0.02]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
        </group>
    );
}

function SensorNode({ position, color }: { position: [number, number, number], color: string }) {
    return (
        <group position={position}>
            {/* Sensor Housing */}
            <mesh castShadow receiveShadow>
                <boxGeometry args={[0.15, 0.15, 0.05]} />
                <meshStandardMaterial color="#333" roughness={0.4} metalness={0.8} />
            </mesh>
            {/* Sensor Light/Lens */}
            <mesh position={[0, 0, 0.03]}>
                <circleGeometry args={[0.04, 16]} />
                <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            <pointLight distance={1} intensity={2} color={color} decay={2} />
        </group>
    );
}

function MetricConnectors({ sensorRefs }: { sensorRefs: React.MutableRefObject<THREE.Group | null>[] }) {
    const { camera } = useThree();
    const lineGeomRefs = useRef<(THREE.BufferGeometry | null)[]>([]);

    // Config for the 4 connectors
    const configs = [
        { yOffset: 1.2, color: "#fb923c" }, // Temp
        { yOffset: 0.4, color: "#60a5fa" }, // Humidity
        { yOffset: -0.4, color: "#c084fc" }, // pH
        { yOffset: -1.2, color: "#4ade80" }  // CO2
    ];

    // Reusable objects
    const start = useMemo(() => new THREE.Vector3(), []);
    const end = useMemo(() => new THREE.Vector3(), []);
    const mid = useMemo(() => new THREE.Vector3(), []);
    const curve = useMemo(() => new THREE.QuadraticBezierCurve3(), []);

    useFrame(() => {
        configs.forEach((_, i) => {
            const geom = lineGeomRefs.current[i];
            const target = sensorRefs[i]?.current;

            if (geom && target) {
                // 1. Calculate Start Point (Screen Space anchored)
                // We project a point from camera space to world space
                // (2.5, yOffset, -6) places it to the right of the pod in view
                start.set(2.2, configs[i].yOffset, -6).applyMatrix4(camera.matrixWorld);

                // 2. Calculate End Point (World Space target)
                target.getWorldPosition(end);

                // 3. Calculate Arc Midpoint
                mid.copy(start).lerp(end, 0.4);
                // Add some curvature based on index to differentiate lines
                mid.y += (i % 2 === 0 ? 0.3 : -0.3);
                mid.z += 1.0; // Curve outward toward camera

                // 4. Update Curve path
                curve.v0.copy(start);
                curve.v1.copy(mid);
                curve.v2.copy(end);

                // 5. Update Geometry
                const points = curve.getPoints(30);
                geom.setFromPoints(points);
            }
        });
    });

    return (
        <group>
            {configs.map((config, i) => (
                <group key={i}>
                    <line>
                        <bufferGeometry ref={(el) => { lineGeomRefs.current[i] = el; }} />
                        <lineBasicMaterial color={config.color} transparent opacity={0.8} linewidth={2} />
                    </line>
                    {/* Glowing endpoint dot at the Line Start (the "Screen" end) */}
                    {/* We don't render start dot because it's "off screen" or at the card */}
                </group>
            ))}
        </group>
    );
}

function SensorArray({ width, height, depth, activeColor }: { width: number, height: number, depth: number, activeColor: string }) {
    return (
        <group>
            {/* Front Left Sensor */}
            <SensorNode position={[-width / 2 + 0.1, 0, depth / 2 + 0.02]} color={activeColor} />
            {/* Front Right Sensor */}
            <SensorNode position={[width / 2 - 0.1, -1, depth / 2 + 0.02]} color={activeColor} />

            {/* Back Sensors (for depth) */}
            <SensorNode position={[-width / 2 + 0.1, 1, -depth / 2 - 0.02]} color="#ffffff" />

            {/* Holographic "Heatmap" lines - subtle vertical lines indicating monitoring */}
            {[...Array(5)].map((_, i) => (
                <mesh key={i} position={[(i - 2) * 0.5, 0, depth / 2 + 0.05]} rotation={[0, 0, 0]}>
                    <planeGeometry args={[0.02, height * 0.8]} />
                    <meshBasicMaterial
                        color={activeColor}
                        transparent
                        opacity={0.3}
                        side={THREE.DoubleSide}
                        blending={THREE.AdditiveBlending}
                        depthWrite={false}
                    />
                </mesh>
            ))}
        </group>
    );
}

function Pod({ batch, activeColor }: { batch: PodViewProps["batch"], activeColor: string }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const r1 = useRef<THREE.Group>(null);
    const r2 = useRef<THREE.Group>(null);
    const r3 = useRef<THREE.Group>(null);
    const r4 = useRef<THREE.Group>(null);
    const sensorRefs = [r1, r2, r3, r4];

    useFrame((state) => {
        if (meshRef.current) {
            const t = state.clock.getElapsedTime();
            meshRef.current.rotation.y = Math.sin(t / 8) * 0.05;
            meshRef.current.position.y = Math.sin(t / 3) * 0.03;
        }
    });

    // Dimensions
    const width = 3.0;
    const height = 4.0;
    const depth = 3.0;
    const frameThickness = 0.08; // Very thin frame

    const progressHeight = Math.max(0.1, (height - 0.2) * (batch.metrics.progress / 100));
    const startY = -height / 2 + 0.1;

    return (
        <group ref={meshRef}>
            <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.2}>
                {/* --- THIN METAL FRAME --- */}

                {/* Vertical Posts */}
                {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z], i) => (
                    <mesh
                        key={i}
                        position={[x * (width / 2 - frameThickness / 2), 0, z * (depth / 2 - frameThickness / 2)]}
                        castShadow
                    >
                        <boxGeometry args={[frameThickness, height, frameThickness]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                ))}

                {/* Top/Bottom Rectangles */}
                {/* Bottom Frame */}
                <group position={[0, -height / 2 + frameThickness / 2, 0]}>
                    {/* Front/Back */}
                    <mesh position={[0, 0, depth / 2 - frameThickness / 2]}>
                        <boxGeometry args={[width, frameThickness, frameThickness]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    <mesh position={[0, 0, -depth / 2 + frameThickness / 2]}>
                        <boxGeometry args={[width, frameThickness, frameThickness]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    {/* Left/Right */}
                    <mesh position={[width / 2 - frameThickness / 2, 0, 0]}>
                        <boxGeometry args={[frameThickness, frameThickness, depth]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    <mesh position={[-width / 2 + frameThickness / 2, 0, 0]}>
                        <boxGeometry args={[frameThickness, frameThickness, depth]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                </group>

                {/* Top Frame */}
                <group position={[0, height / 2 - frameThickness / 2, 0]}>
                    {/* Front/Back */}
                    <mesh position={[0, 0, depth / 2 - frameThickness / 2]}>
                        <boxGeometry args={[width, frameThickness, frameThickness]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    <mesh position={[0, 0, -depth / 2 + frameThickness / 2]}>
                        <boxGeometry args={[width, frameThickness, frameThickness]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    {/* Left/Right */}
                    <mesh position={[width / 2 - frameThickness / 2, 0, 0]}>
                        <boxGeometry args={[frameThickness, frameThickness, depth]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                    <mesh position={[-width / 2 + frameThickness / 2, 0, 0]}>
                        <boxGeometry args={[frameThickness, frameThickness, depth]} />
                        <meshStandardMaterial color="#1a1a1a" roughness={0.2} metalness={0.8} />
                    </mesh>
                </group>


                {/* --- GLASS PANELS --- */}
                <RoundedBox
                    args={[width - 0.05, height - 0.05, depth - 0.05]}
                    radius={0.02}
                    smoothness={4}
                >
                    <MeshTransmissionMaterial
                        backside
                        samples={8}
                        thickness={0.05} // Thin glass
                        chromaticAberration={0.0} // Remove chromatic aberration for cleaner look
                        anisotropy={0}
                        distortion={0.0}
                        distortionScale={0}
                        temporalDistortion={0}
                        iridescence={0}
                        roughness={0}
                        clearcoat={1}
                        attenuationDistance={10}
                        attenuationColor="#ffffff"
                        color="#ffffff"
                    />
                </RoundedBox>


                {/* --- INTERNAL CONTENT: COCOA BEANS --- */}
                <group position={[0, startY, 0]}>
                    <CocoaBeans
                        width={width - 0.2}
                        depth={depth - 0.2}
                        height={progressHeight}
                        count={1500} // Increased density
                        activeColor={activeColor}
                    />
                </group>

                {/* HEATMAP LASER SCANNER (Full Height) */}
                <ScanningLaser
                    width={width - 0.1}
                    depth={depth - 0.1}
                    height={height}
                    color={activeColor}
                />

                {/* HOLOGRAPHIC DATA DUST (Full Volume) */}
                <Sparkles
                    count={300}
                    scale={[width - 0.2, height - 0.2, depth - 0.2]}
                    size={3}
                    speed={0.2}
                    opacity={0.6}
                    color={activeColor}
                    position={[0, 0, 0]}
                />

                {/* --- SENSOR TARGET MARKERS (For Lines) --- */}
                <group ref={r1} position={[width / 2 - 0.1, 1.5, depth / 2 + 0.02]}>
                    <mesh><sphereGeometry args={[0.05]} /><meshBasicMaterial color="#fb923c" toneMapped={false} /></mesh>
                </group>
                <group ref={r2} position={[-width / 2 + 0.1, 0.2, depth / 2 + 0.02]}>
                    <mesh><sphereGeometry args={[0.05]} /><meshBasicMaterial color="#60a5fa" toneMapped={false} /></mesh>
                </group>
                <group ref={r3} position={[0, -1.0, 0]}>
                    <mesh><sphereGeometry args={[0.05]} /><meshBasicMaterial color="#c084fc" toneMapped={false} /></mesh>
                </group>
                <group ref={r4} position={[width / 2 - 0.1, -1.5, depth / 2 + 0.02]}>
                    <mesh><sphereGeometry args={[0.05]} /><meshBasicMaterial color="#4ade80" toneMapped={false} /></mesh>
                </group>

                {/* --- SENSORS & ANALYTICS --- */}
                <SensorArray width={width} height={height} depth={depth} activeColor={activeColor} />

            </Float>

            {/* --- METRIC CONNECTION LINES (Dynamic & Attached to Camera) --- */}
            <MetricConnectors sensorRefs={sensorRefs} />

            {/* Simpler Clean Shadow */}
            <ContactShadows
                position={[0, -2.5, 0]}
                opacity={0.4}
                scale={10}
                blur={2.5}
                far={4}
            />
        </group>
    );
}

export function PodView({ batch }: PodViewProps) {
    const activeColor = useMemo(() => {
        const statusColors = {
            fermenting: "#fea55f", // Orange
            drying: "#60a5fa", // Blue
            sorting: "#c084fc", // Purple
            ready: "#4ade80", // Green
        };
        return statusColors[batch.status] || "#ffffff";
    }, [batch.status]);

    return (
        <div className="relative h-[600px] w-full overflow-hidden rounded-3xl bg-gray-900 shadow-2xl group">
            <Canvas shadows dpr={[1, 2]} camera={{ position: [5, 2, 6], fov: 40 }}>
                <PerspectiveCamera makeDefault position={[5, 2, 6]} fov={40} />

                <color attach="background" args={['#111827']} /> {/* Dark background matches reference */}

                {/* STUDIO ENVIRONMENT - No Buildings */}
                <Environment preset="studio" />

                <ambientLight intensity={0.5} />
                <spotLight position={[10, 10, 10]} angle={0.3} penumbra={1} intensity={1} castShadow />
                <pointLight position={[-10, 0, -10]} intensity={0.5} color="blue" />

                <Pod batch={batch} activeColor={activeColor} />

                <OrbitControls
                    enablePan={false}
                    minPolarAngle={Math.PI / 4}
                    maxPolarAngle={Math.PI / 1.5}
                    minDistance={4}
                    maxDistance={12}
                    autoRotate
                    autoRotateSpeed={0.5}
                />
            </Canvas>

            {/* 2D OVERLAY STATS */}
            <div className="absolute top-1/2 right-8 -translate-y-1/2 flex flex-col gap-3 pointer-events-none">
                {/* Floating Header */}
                <div className="flex items-center gap-2 mb-1 pl-1 bg-black/20 backdrop-blur-sm p-2 rounded-lg self-start">
                    <div className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: activeColor, color: activeColor }} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-white/90 drop-shadow-md">Live Metrics</span>
                </div>

                <div className="pointer-events-auto">
                    <StatItem icon={Thermometer} label="Temperature" value="45.2°C" color="orange" />
                </div>
                <div className="pointer-events-auto">
                    <StatItem icon={Droplets} label="Humidity" value="65%" color="blue" />
                </div>
                <div className="pointer-events-auto">
                    <StatItem icon={Activity} label="pH Level" value="5.8" color="purple" />
                </div>
                <div className="pointer-events-auto">
                    <StatItem icon={Wind} label="CO2" value="420 ppm" color="green" />
                </div>
            </div>
        </div>
    );
}
