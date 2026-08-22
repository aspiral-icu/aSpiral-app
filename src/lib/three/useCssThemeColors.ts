/**
 * @fileoverview CSS theme color bridge for THREE.js
 * @module lib/three/useCssThemeColors
 * @sonarqube cognitive-complexity: 5
 */

import { useMemo, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import { parseCssHsl, hslToHex } from './cssHsl'

/** CSS variable names for theme colors */
const CSS_VAR_KEYS = Object.freeze([
    'primary',
    'secondary',
    'accent',
    'spiral-glow',
    'spiral-accent',
    'aurora-green-1',
    'aurora-green-2',
    'friction-color',
    'grease-color',
    'entity-color',
    'connection-color',
    'success',
    'warning',
    'destructive'
] as const)

type CssVarKey = typeof CSS_VAR_KEYS[number]

/** THREE.Color instances mapped from CSS variables */
export interface ThemeColors {
    readonly primary: THREE.Color
    readonly secondary: THREE.Color
    readonly accent: THREE.Color
    readonly spiralGlow: THREE.Color
    readonly spiralAccent: THREE.Color
    readonly auroraGreen1: THREE.Color
    readonly auroraGreen2: THREE.Color
    readonly friction: THREE.Color
    readonly grease: THREE.Color
    readonly entity: THREE.Color
    readonly connection: THREE.Color
    readonly success: THREE.Color
    readonly warning: THREE.Color
    readonly destructive: THREE.Color
}

/** Default fallback colors (brand palette) */
const FALLBACK_COLORS = Object.freeze({
    primary: '#c084fc',      // Purple 400
    secondary: '#facc15',    // Yellow 400
    accent: '#fde047',       // Yellow 300
    spiralGlow: '#e879f9',   // Fuchsia 400
    spiralAccent: '#a78bfa', // Violet 400
    auroraGreen1: '#10e88a', // Jade 400
    auroraGreen2: '#09f759', // Emerald 400
    friction: '#ef4444',     // Red 500
    grease: '#22c55e',       // Green 500
    entity: '#8b5cf6',       // Violet 500
    connection: '#3b82f6',   // Blue 500
    success: '#22c55e',      // Green 500
    warning: '#eab308',      // Yellow 500
    destructive: '#ef4444'   // Red 500
})

/** Cache for parsed colors to avoid recalculation */
let cachedColors: ThemeColors | null = null
let cachedVersion = 0

/**
 * Reads a CSS custom property value from :root
 */
function getCssVar(name: CssVarKey, style: CSSStyleDeclaration | null): string | null {
    if (!style) return null
    return style.getPropertyValue(`--${name}`).trim() || null
}

/**
 * Creates a THREE.Color from CSS HSL variable or fallback
 */
function createThreeColor(varName: CssVarKey, fallback: string, style: CSSStyleDeclaration | null): THREE.Color {
    const cssValue = getCssVar(varName, style)
    const hsl = parseCssHsl(cssValue)

    if (hsl) {
        const hex = hslToHex(hsl)
        return new THREE.Color(hex)
    }

    return new THREE.Color(fallback)
}

/**
 * Builds the full theme colors object
 */
function buildThemeColors(): ThemeColors {
    const style = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null

    return Object.freeze({
        primary: createThreeColor('primary', FALLBACK_COLORS.primary, style),
        secondary: createThreeColor('secondary', FALLBACK_COLORS.secondary, style),
        accent: createThreeColor('accent', FALLBACK_COLORS.accent, style),
        spiralGlow: createThreeColor('spiral-glow', FALLBACK_COLORS.spiralGlow, style),
        spiralAccent: createThreeColor('spiral-accent', FALLBACK_COLORS.spiralAccent, style),
        auroraGreen1: createThreeColor('aurora-green-1', FALLBACK_COLORS.auroraGreen1, style),
        auroraGreen2: createThreeColor('aurora-green-2', FALLBACK_COLORS.auroraGreen2, style),
        friction: createThreeColor('friction-color', FALLBACK_COLORS.friction, style),
        grease: createThreeColor('grease-color', FALLBACK_COLORS.grease, style),
        entity: createThreeColor('entity-color', FALLBACK_COLORS.entity, style),
        connection: createThreeColor('connection-color', FALLBACK_COLORS.connection, style),
        success: createThreeColor('success', FALLBACK_COLORS.success, style),
        warning: createThreeColor('warning', FALLBACK_COLORS.warning, style),
        destructive: createThreeColor('destructive', FALLBACK_COLORS.destructive, style)
    })
}

// External store for theme version tracking
let themeVersion = 0
const themeListeners = new Set<() => void>()

function subscribeToTheme(callback: () => void): () => void {
    themeListeners.add(callback)
    return () => themeListeners.delete(callback)
}

function getThemeSnapshot(): number {
    return themeVersion
}

// Listen for theme changes via MutationObserver
if (typeof document !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (
                mutation.type === 'attributes' &&
                (mutation.attributeName === 'class' || mutation.attributeName === 'style')
            ) {
                themeVersion++
                cachedColors = null
                themeListeners.forEach(cb => cb())
                break
            }
        }
    })

    // Start observing when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ['class', 'style']
            })
        })
    } else {
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'style']
        })
    }
}

/**
 * React hook for accessing CSS theme colors as THREE.js Color instances.
 * Automatically updates when theme changes (light/dark mode, etc.)
 *
 * @returns Object containing themed THREE.Color instances and version number
 *
 * @example
 * ```tsx
 * function MyMesh() {
 *   const { colors } = useCssThemeColors()
 *   return (
 *     <mesh>
 *       <meshStandardMaterial color={colors.primary} />
 *     </mesh>
 *   )
 * }
 * ```
 */
export function useCssThemeColors(): { colors: ThemeColors; version: number } {
    const version = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeSnapshot)

    const colors = useMemo(() => {
        if (cachedColors && cachedVersion === version) {
            return cachedColors
        }
        cachedColors = buildThemeColors()
        cachedVersion = version
        return cachedColors
    }, [version])

    return { colors, version }
}
