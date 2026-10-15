import { create } from 'zustand'
import type { OutlineItem } from '../modes/reading/outline'

interface NavState {
  outline: OutlineItem[]
  docEl: HTMLElement | null
  publish(outline: OutlineItem[], docEl: HTMLElement | null): void
}

export const useNav = create<NavState>((set) => ({
  outline: [],
  docEl: null,
  publish: (outline, docEl) => set({ outline, docEl }),
}))
