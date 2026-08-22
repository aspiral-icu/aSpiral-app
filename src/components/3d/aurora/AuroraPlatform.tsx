/**
 * @fileoverview Premium Aurora platform stage component
 * @module components/3d/aurora/AuroraPlatform
 * @sonarqube cognitive-complexity: 6
 * NOSONAR - R3F intrinsic JSX props: position, rotation, args, transparent,
 * metalness, roughness, blending, depthWrite, attach, count, array, itemSize,
 * sizeAttenuation, alphaMap - valid R3F/Three.js props, not standard HTML attributes.
 */

import { useMemo, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useCssThemeColors } from '@/lib/three/useCssThemeColors'
import { createGlowTexture, disposeTextures } from './textures'
import { getOptimalParticleCount } from './deviceTier'

/** Component props */
export interface AuroraPlatformProps {
    /** Override particle count (otherwise device-adaptive) */
    readonly particleCount?: number
    /** Enable sparkle particle field */
    readonly enableSparkles?: boolean
}

/** Platform geometry constants */
const GEOMETRY = Object.freeze({
    platformRadius: 6,
    hazeRadius: 8,
    innerRingOuter: 4,
    innerRingInner: 3.8,
    outerRingOuter: 6,
    outerRingInner: 5.8,
    segments: 64
} as const)

/**
 * Simple seeded PRNG (Mulberry32) for deterministic sparkle positions.
 * Using seeded PRNG instead of Math.random() for consistent visuals across renders.
 */
function createSeededRandom(seed: number): () => number {
    return () => {
        seed = Math.trunc(seed + 0x6D2B79F5)
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Creates sparkle particle positions array.
 * Distributed in cylindrical volume above platform.
 * Uses seeded PRNG for deterministic, reproducible sparkle distribution.
 */
function createSparklePositions(count: number): Float32Array {
    const positions = new Float32Array(count * 3)
    const random = createSeededRandom(42) // Fixed seed for consistent sparkle pattern

    for (let i = 0; i < count; i++) {
        const theta = random() * Math.PI * 2
        const radius = random() * 4 + 1
        const idx = i * 3

        positions[idx] = Math.cos(theta) * radius
        positions[idx + 1] = random() * 2 + 0.5
        positions[idx + 2] = Math.sin(theta) * radius
    }

    return positions
}

/**
 * Premium Aurora platform stage component.
 * Creates ambient, brand-aligned visual foundation.
 *
 * Design principles:
 * - Subtle, not distracting (platform serves content)
 * - Brand-color synchronized via CSS custom properties
 * - Device-adaptive particle density
 * - Additive blending for ethereal glow effect
 */
export function AuroraPlatform({
    particleCount,
    enableSparkles = true
}: AuroraPlatformProps): JSX.Element {
    const { colors, version } = useCssThemeColors()
    const { invalidate } = useThree()

    // Material refs for direct color updates
    const platformMatRef = useRef<THREE.MeshStandardMaterial>(null)
    const hazeMatRef = useRef<THREE.MeshBasicMaterial>(null)
    const ring1MatRef = useRef<THREE.MeshBasicMaterial>(null)
    const ring2MatRef = useRef<THREE.MeshBasicMaterial>(null)
    const sparkleMatRef = useRef<THREE.PointsMaterial>(null)

    // Device-adaptive particle count
    const sparkleCount = useMemo(
        () => getOptimalParticleCount(particleCount),
        [particleCount]
    )

    // Glow texture (created once)
    const glowTexture = useMemo(() => createGlowTexture(), [])

    // Sparkle positions (created once)
    const sparklePositions = useMemo(
        () => createSparklePositions(sparkleCount),
        [sparkleCount]
    )

    // Update materials when theme changes
    useEffect(() => {
        platformMatRef.current?.color.copy(colors.primary)
        hazeMatRef.current?.color.copy(colors.spiralGlow)
        ring1MatRef.current?.color.copy(colors.spiralAccent)
        ring2MatRef.current?.color.copy(colors.primary)
        sparkleMatRef.current?.color.copy(colors.spiralGlow)

        invalidate()
    }, [colors, version, invalidate])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            disposeTextures()
        }
    }, [])

    return (
        <group position={[0, -2, 0]}> {/* NOSONAR */}
            {/* Platform disk (subtle base) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}> {/* NOSONAR */}
                <circleGeometry args={[GEOMETRY.platformRadius, GEOMETRY.segments]} /> {/* NOSONAR */}
                <meshStandardMaterial // NOSONAR
                    ref={platformMatRef}
                    color={colors.primary}
                    transparent // NOSONAR
                    opacity={0.12}
                    metalness={0.5} // NOSONAR
                    roughness={0.8} // NOSONAR
                />
            </mesh>

            {/* Glow haze (ethereal bloom) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}> {/* NOSONAR */}
                <circleGeometry args={[GEOMETRY.hazeRadius, GEOMETRY.segments]} /> {/* NOSONAR */}
                <meshBasicMaterial // NOSONAR
                    ref={hazeMatRef}
                    color={colors.spiralGlow}
                    transparent // NOSONAR
                    opacity={0.25}
                    alphaMap={glowTexture} // NOSONAR
                    blending={THREE.AdditiveBlending} // NOSONAR
                    depthWrite={false} // NOSONAR
                />
            </mesh>

            {/* Inner ring (accent) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}> {/* NOSONAR */}
                <ringGeometry args={[ // NOSONAR
                    GEOMETRY.innerRingInner,
                    GEOMETRY.innerRingOuter,
                    GEOMETRY.segments
                ]} />
                <meshBasicMaterial // NOSONAR
                    ref={ring1MatRef}
                    color={colors.spiralAccent}
                    transparent // NOSONAR
                    opacity={0.35}
                    blending={THREE.AdditiveBlending} // NOSONAR
                    depthWrite={false} // NOSONAR
                />
            </mesh>

            {/* Outer ring (secondary aurora green) */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}> {/* NOSONAR */}
                <ringGeometry args={[ // NOSONAR
                    GEOMETRY.outerRingInner,
                    GEOMETRY.outerRingOuter,
                    GEOMETRY.segments
                ]} />
                <meshBasicMaterial // NOSONAR
                    ref={ring2MatRef}
                    color={colors.primary}
                    transparent // NOSONAR
                    opacity={0.35}
                    blending={THREE.AdditiveBlending} // NOSONAR
                    depthWrite={false} // NOSONAR
                />
            </mesh>

            {/* Sparkle field */}
            {enableSparkles && (
                <points>
                    <bufferGeometry>
                        <bufferAttribute // NOSONAR
                            attach="attributes-position" // NOSONAR
                            count={sparkleCount} // NOSONAR
                            array={sparklePositions} // NOSONAR
                            itemSize={3} // NOSONAR
                        />
                    </bufferGeometry>
                    <pointsMaterial // NOSONAR
                        ref={sparkleMatRef}
                        size={0.04}
                        color={colors.spiralGlow}
                        transparent // NOSONAR
                        opacity={0.55}
                        blending={THREE.AdditiveBlending} // NOSONAR
                        depthWrite={false} // NOSONAR
                        sizeAttenuation // NOSONAR
                    />
                </points>
            )}
        </group>
    )
}
