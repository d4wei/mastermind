import { create } from 'zustand'
import type { OutlineItem } from '../modes/reading/outline'

/** Outline geometry and navigation for Markdown mode, which has no rendered heading elements. */
export interface SourceOutline {
  headingTop(offset: number): number
  scrollTo(offset: number): void
}

interface NavState {
  outline: OutlineItem[]
  docEl: HTMLElement | null
  source: SourceOutline | null
  publish(outline: OutlineItem[], docEl: HTMLElement | null): void
}

export const useNav = create<NavState>((set) => ({
  outline: [],
  docEl: null,
  source: null,
  publish: (outline, docEl) => set({ outline, docEl }),
}))
