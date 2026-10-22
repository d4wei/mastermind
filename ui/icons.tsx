import type { ComponentType, SVGProps } from 'react'
import {
  EnterFullScreenIcon,
  ExitFullScreenIcon,
  GearIcon as RGearIcon,
  ChatBubbleIcon,
  ExclamationTriangleIcon,
  CheckIcon as RCheckIcon,
  DotsHorizontalIcon,
  ChevronUpIcon as RChevronUpIcon,
  ChevronDownIcon as RChevronDownIcon,
  FileIcon as RFileIcon,
  Cross2Icon,
  Pencil1Icon,
  EyeOpenIcon,
  CounterClockwiseClockIcon,
  MagnifyingGlassIcon,
  CodeIcon as RCodeIcon,
  GlobeIcon as RGlobeIcon,
} from '@radix-ui/react-icons'

type IconProps = SVGProps<SVGSVGElement>

/** Icons are decorative; their controls supply accessible names and tooltips. */
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

/* ---- Radix chrome glyphs ---- */
export const ExpandIcon = radix(EnterFullScreenIcon, 14)
export const CollapseIcon = radix(ExitFullScreenIcon, 14)
export const GearIcon = radix(RGearIcon, 14)
export const ChatIcon = radix(ChatBubbleIcon, 14)
export const AlertIcon = radix(ExclamationTriangleIcon, 14)
export const CheckIcon = radix(RCheckIcon, 14)
export const MoreIcon = radix(DotsHorizontalIcon, 15)
export const ChevronUpIcon = radix(RChevronUpIcon, 13)
export const ChevronDownIcon = radix(RChevronDownIcon, 13)
export const FileIcon = radix(RFileIcon, 14)

/* ---- review/chrome verbs ---- */
export const CrossIcon = radix(Cross2Icon, 14)
export const PencilIcon = radix(Pencil1Icon, 14)
export const EyeIcon = radix(EyeOpenIcon, 14)
export const HistoryIcon = radix(CounterClockwiseClockIcon, 14)
export const SearchIcon = radix(MagnifyingGlassIcon, 14)
export const CodeIcon = radix(RCodeIcon, 14)
export const LanguageIcon = radix(RGlobeIcon, 14)

/* ---- hand-drawn glyphs Radix lacks ---- */

export function DiamondIcon(props: IconProps) {
  return (
    <svg {...base(props, 9)}>
      <path d="M8 1.5 14.5 8 8 14.5 1.5 8z" fill="currentColor" stroke="none" />
    </svg>
  )
}
