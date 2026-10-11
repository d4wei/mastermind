import type { ComponentType, SVGProps } from 'react'
import {
  GearIcon as RGearIcon,
  ChatBubbleIcon,
  ExclamationTriangleIcon,
  CheckIcon as RCheckIcon,
  DotsHorizontalIcon,
  ChevronRightIcon,
  ChevronLeftIcon as RChevronLeftIcon,
  ChevronUpIcon as RChevronUpIcon,
  ChevronDownIcon as RChevronDownIcon,
  FileIcon as RFileIcon,
  Cross2Icon,
  StrikethroughIcon as RStrikethroughIcon,
  EyeOpenIcon,
  CounterClockwiseClockIcon,
  MagnifyingGlassIcon,
  CodeIcon as RCodeIcon,
  GlobeIcon as RGlobeIcon,
} from '@radix-ui/react-icons'

type IconProps = SVGProps<SVGSVGElement>

/**
 * The app's icon set. Chrome glyphs come from @radix-ui/react-icons (15px grid,
 * currentColor); the few Radix lacks (folder, language-swap, the comment
 * diamond, the pending dot, the highlighter) stay hand-drawn at 1.5px stroke.
 * Every icon is decorative (aria-hidden) — labels/tooltips carry the meaning.
 * Existing import names are preserved so consumer call sites don't change.
 */
function radix(Icon: ComponentType<any>, size: number) {
  return function RadixGlyph(props: IconProps) {
    return <Icon width={size} height={size} aria-hidden focusable={false} {...props} />
  }
}

function base(props: IconProps, size = 14): IconProps {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...props,
  }
}

/* ---- Radix chrome glyphs (existing names preserved) ---- */
export const GearIcon = radix(RGearIcon, 14)
export const ChatIcon = radix(ChatBubbleIcon, 14)
export const AlertIcon = radix(ExclamationTriangleIcon, 14)
export const CheckIcon = radix(RCheckIcon, 14)
export const MoreIcon = radix(DotsHorizontalIcon, 15)
/** A right-pointing chevron; CSS rotates it 90° when its row is expanded. */
export const ChevronIcon = radix(ChevronRightIcon, 14)
export const ChevronLeftIcon = radix(RChevronLeftIcon, 14)
export const ChevronUpIcon = radix(RChevronUpIcon, 13)
export const ChevronDownIcon = radix(RChevronDownIcon, 13)
export const FileIcon = radix(RFileIcon, 14)

/* ---- review/chrome verbs ---- */
export const CrossIcon = radix(Cross2Icon, 14)
export const StrikethroughIcon = radix(RStrikethroughIcon, 14)
export const EyeIcon = radix(EyeOpenIcon, 14)
export const HistoryIcon = radix(CounterClockwiseClockIcon, 14)
export const SearchIcon = radix(MagnifyingGlassIcon, 14)
export const CodeIcon = radix(RCodeIcon, 14)
export const LanguageIcon = radix(RGlobeIcon, 14)

/* ---- hand-drawn glyphs Radix lacks ---- */

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base(props, 14)}>
      <path d="M2 4.5h4l1.2 1.4H14v6.1H2z" />
    </svg>
  )
}

export function OutlineIcon(props: IconProps) {
  return (
    <svg {...base(props, 14)}>
      <circle cx="3.1" cy="4" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="3.1" cy="8" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="3.1" cy="12" r="0.85" fill="currentColor" stroke="none" />
      <path d="M6 4h7.5M6 8h7.5M6 12h7.5" />
    </svg>
  )
}

export function DiamondIcon(props: IconProps) {
  return (
    <svg {...base(props, 9)}>
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PendingDot(props: IconProps) {
  return (
    <svg {...base(props, 8)}>
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" opacity={0.55} />
    </svg>
  )
}
