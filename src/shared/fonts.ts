/** Font presets are shared by CLI and browser; asset URLs and CSS stacks live in ui/theme/fonts.ts. */

export interface FontFace {
  family: string
  url: string
  /** CSS font-weight descriptor — a range for variable faces, a single value for static. */
  weight: string
}

export interface FontPreset {
  id: string
  name: string
  displayFamily: string
  displayWeight: number
  displayTracking: string
  bodyFamily: string
}

export interface MonoFont {
  id: string
  name: string
  family: string
}

/** Curated display+body pairings. `grid` is the default and matches the base tokens. */
export const FONT_PRESETS: FontPreset[] = [
  { id: 'grid', name: 'Schibsted', displayFamily: 'Schibsted Grotesk', displayWeight: 800, displayTracking: '-0.02em', bodyFamily: 'Schibsted Grotesk' },
  { id: 'geist', name: 'Geist', displayFamily: 'Geist', displayWeight: 700, displayTracking: '-0.02em', bodyFamily: 'Geist' },
  { id: 'bricolage', name: 'Bricolage', displayFamily: 'Bricolage Grotesque', displayWeight: 700, displayTracking: '-0.02em', bodyFamily: 'Inter' },
  { id: 'lora', name: 'Lora', displayFamily: 'Lora', displayWeight: 600, displayTracking: '-0.01em', bodyFamily: 'Lora' },
  { id: 'crimson', name: 'Crimson', displayFamily: 'Crimson Pro', displayWeight: 600, displayTracking: '0', bodyFamily: 'Crimson Pro' },
  { id: 'manrope', name: 'Manrope', displayFamily: 'Manrope', displayWeight: 700, displayTracking: '-0.02em', bodyFamily: 'Manrope' },
  { id: 'outfit', name: 'Outfit', displayFamily: 'Outfit', displayWeight: 700, displayTracking: '-0.02em', bodyFamily: 'Outfit' },
]

export const MONO_FONTS: MonoFont[] = [
  { id: 'geist', name: 'Geist Mono', family: 'Geist Mono' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains Mono' },
  { id: 'spline', name: 'Spline Sans Mono', family: 'Spline Sans Mono' },
  { id: 'ubuntu', name: 'Ubuntu Sans Mono', family: 'Ubuntu Sans Mono' },
]

export const DEFAULT_FONT_PRESET = 'grid'
export const DEFAULT_MONO = 'geist'

export function fontPresetById(id: string | undefined): FontPreset {
  return FONT_PRESETS.find((s) => s.id === id) ?? FONT_PRESETS[0]!
}
export function monoById(id: string | undefined): MonoFont {
  return MONO_FONTS.find((m) => m.id === id) ?? MONO_FONTS[0]!
}
