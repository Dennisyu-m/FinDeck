/**
 * The shell's monochrome line-icon library: the SVG symbol defs mounted once
 * per document plus the <use>-based glyph component. Every symbol is drawn to
 * the frozen prototype artwork's geometry (24×24 viewBox, stroke=currentColor,
 * 1.6px lines, round caps — UI_REBUILD_PLAN appendix) — the appendix's own
 * chrome glyphs plus the settings rail's glyphs, which the appendix does not
 * carry because the rail's twelve destinations each need a shape of their own;
 * color follows the caller's `currentColor`, so states recolor through CSS
 * classes at the use site.
 */
import type { ReactNode } from 'react'

/** Glyph names — exactly the symbols in {@link ICON_DEFS}. */
export type IconName = 'plus' | 'grid' | 'clock' | 'calendar' | 'layers' | 'sliders' | 'chip' | 'db' | 'help' | 'back' | 'restart'
  | 'folder' | 'sparkle' | 'plug' | 'chat' | 'note' | 'puzzle' | 'gear' | 'mask'
  | 'panelCollapse' | 'panelExpand'

const ICON_NAMES = new Set<string>([
  'plus', 'grid', 'clock', 'calendar', 'layers', 'sliders', 'chip', 'db', 'help', 'back', 'restart',
  'folder', 'sparkle', 'plug', 'chat', 'note', 'puzzle', 'gear', 'mask',
  'panelCollapse', 'panelExpand',
])

/**
 * Whether `name` is a glyph this module draws.
 * @param name - a registration's icon string.
 * @returns true when {@link ShellIcon} can draw it.
 */
export function isIconName(name: string): name is IconName {
  return ICON_NAMES.has(name)
}

/** One <g> symbol per glyph. */
const ICON_DEFS: Readonly<Record<IconName, ReactNode>> = {
  plus: (<>
    <rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  grid: (<>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </>),
  clock: (<>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <polyline points="12,7.5 12,12 15.5,14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  calendar: (<>
    <rect x="4" y="5.5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <line x1="4" y1="9.5" x2="20" y2="9.5" stroke="currentColor" strokeWidth="1.6" />
    <line x1="8" y1="3.5" x2="8" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="16" y1="3.5" x2="16" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  layers: (<>
    <path d="M12 3 L21 8 L12 13 L3 8 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M4.5 12.5 L12 17 L19.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.5 16.5 L12 21 L19.5 16.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
  </>),
  sliders: (<>
    <line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="9" cy="7" r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
    <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="15" cy="12" r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
    <line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="17" r="2.2" fill="#fff" stroke="currentColor" strokeWidth="1.6" />
  </>),
  chip: (<>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <line x1="9" y1="3" x2="9" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="15" y1="3" x2="15" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="9" y1="18" x2="9" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="15" y1="18" x2="15" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  db: (<>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 5.5 V18.5 C4.5 20 17.5 20 19.5 18.5 V5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M4.5 12 C4.5 13.5 17.5 13.5 19.5 12" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </>),
  help: (<>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9.5 9.2 C9.5 7.8 10.7 7 12 7 C13.4 7 14.5 7.9 14.5 9.1 C14.5 10.9 12 11 12 12.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="12" cy="15.8" r=".9" fill="currentColor" />
  </>),
  back: (<>
    <polyline points="14,5 7,12 14,19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  restart: (<>
    <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points="21,3 21,8 16,8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  /* Settings-rail glyphs, one per destination the rail lists. The frozen
     appendix drew only the chrome's own chrome glyphs above, so these eight
     are drawn here, to the same 24×24 / 1.6px geometry. */
  folder: (<>
    <path d="M3.5 7.5 A2 2 0 0 1 5.5 5.5 H9.2 C9.8 5.5 10.4 5.7 10.8 6.1 L12.2 7.5 H18.5 A2 2 0 0 1 20.5 9.5 V16.5 A2 2 0 0 1 18.5 18.5 H5.5 A2 2 0 0 1 3.5 16.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </>),
  sparkle: (<>
    <path d="M10.5 3.5 L12.3 8.2 L17 10 L12.3 11.8 L10.5 16.5 L8.7 11.8 L4 10 L8.7 8.2 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M17.5 14.6 L18.4 16.9 L20.7 17.8 L18.4 18.7 L17.5 21 L16.6 18.7 L14.3 17.8 L16.6 16.9 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </>),
  plug: (<>
    <line x1="9.2" y1="3.2" x2="9.2" y2="7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="14.8" y1="3.2" x2="14.8" y2="7.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="6.6" y="7.4" width="10.8" height="6.8" rx="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 14.2 V20.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  chat: (<>
    <path d="M4.5 6.5 A2 2 0 0 1 6.5 4.5 H17.5 A2 2 0 0 1 19.5 6.5 V13.5 A2 2 0 0 1 17.5 15.5 H10.5 L6 19 V15.5 A2 2 0 0 1 4.5 13.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </>),
  note: (<>
    <path d="M6.5 4.5 A1.5 1.5 0 0 1 8 3.5 H13 L17.5 8 V19 A1.5 1.5 0 0 1 16 20.5 H8 A1.5 1.5 0 0 1 6.5 19 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <polyline points="13,3.5 13,8 17.5,8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <line x1="9.3" y1="12" x2="14.7" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <line x1="9.3" y1="15.5" x2="12.7" y2="15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  puzzle: (<>
    <path d="M4.5 11.5 A2 2 0 0 1 6.5 9.5 H10 A2.2 2.2 0 0 1 14.4 9.5 H17.5 A2 2 0 0 1 19.5 11.5 V12.3 A2.2 2.2 0 0 0 19.5 16.7 V17.5 A2 2 0 0 1 17.5 19.5 H6.5 A2 2 0 0 1 4.5 17.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </>),
  gear: (<>
    <path d="M19.05 10.11 L21.28 10.53 L21.28 13.47 L19.05 13.89 L18.32 15.65 L19.6 17.53 L17.53 19.6 L15.65 18.32 L13.89 19.05 L13.47 21.28 L10.53 21.28 L10.11 19.05 L8.35 18.32 L6.47 19.6 L4.4 17.53 L5.68 15.65 L4.95 13.89 L2.72 13.47 L2.72 10.53 L4.95 10.11 L5.68 8.35 L4.4 6.47 L6.47 4.4 L8.35 5.68 L10.11 4.95 L10.53 2.72 L13.47 2.72 L13.89 4.95 L15.65 5.68 L17.53 4.4 L19.6 6.47 L18.32 8.35 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </>),
  mask: (<>
    <path d="M4.5 7 C6.6 5.8 9.1 5.2 12 5.2 C14.9 5.2 17.4 5.8 19.5 7 C19.5 12.6 17 18.5 12 18.5 C7 18.5 4.5 12.6 4.5 7 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <circle cx="9.4" cy="10.6" r="1.1" fill="currentColor" />
    <circle cx="14.6" cy="10.6" r="1.1" fill="currentColor" />
  </>),
  /* Sidebar toggle pair: the same panel frame, the chevron naming the action —
     collapse pushes the column away, expand pulls it back. */
  panelCollapse: (<>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" stroke="currentColor" strokeWidth="1.6" />
    <polyline points="16.5,9.5 13.5,12 16.5,14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  panelExpand: (<>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <line x1="9.5" y1="4.5" x2="9.5" y2="19.5" stroke="currentColor" strokeWidth="1.6" />
    <polyline points="13.5,9.5 16.5,12 13.5,14.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </>),
}

/**
 * Mount the symbol defs once for the document (rendered by the root shell).
 * @returns a zero-size absolutely-positioned SVG carrying every glyph symbol.
 */
export function IconDefs(): ReactNode {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {(Object.keys(ICON_DEFS) as IconName[]).map(name => (
          <g key={name} id={`ad-i-${name}`}>{ICON_DEFS[name]}</g>
        ))}
      </defs>
    </svg>
  )
}

/** Props of the glyph component. */
export interface ShellIconProps {
  /** Glyph name (one of the mounted symbols). */
  name: IconName
  /** Square edge in px (default 16). */
  size?: number
  /** Caller's class; color follows the ambient `currentColor`. */
  className?: string | undefined
}

/**
 * Render one line-icon glyph through the mounted symbol table.
 * @param props - glyph name, size, and optional class.
 * @returns the icon svg element.
 */
export function ShellIcon({ name, size = 16, className }: ShellIconProps): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#ad-i-${name}`} />
    </svg>
  )
}
