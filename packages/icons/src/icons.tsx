import { createIcon } from './createIcon.tsx'

// Lucide-style 24x24 stroke icons. We author our own path data so the set has no
// runtime dependency. Add new icons here as the UI needs them.

export const ChevronDown = createIcon('ChevronDown', [{ tag: 'path', attrs: { d: 'm6 9 6 6 6-6' } }])
export const ChevronRight = createIcon('ChevronRight', [{ tag: 'path', attrs: { d: 'm9 6 6 6-6 6' } }])
export const ChevronLeft = createIcon('ChevronLeft', [{ tag: 'path', attrs: { d: 'm15 6-6 6 6 6' } }])
export const ChevronsUpDown = createIcon('ChevronsUpDown', [
  { tag: 'path', attrs: { d: 'm7 15 5 5 5-5' } },
  { tag: 'path', attrs: { d: 'm7 9 5-5 5 5' } },
])
export const Check = createIcon('Check', [{ tag: 'path', attrs: { d: 'M20 6 9 17l-5-5' } }])
export const Plus = createIcon('Plus', [
  { tag: 'path', attrs: { d: 'M5 12h14' } },
  { tag: 'path', attrs: { d: 'M12 5v14' } },
])
export const X = createIcon('X', [
  { tag: 'path', attrs: { d: 'M18 6 6 18' } },
  { tag: 'path', attrs: { d: 'm6 6 12 12' } },
])
export const Search = createIcon('Search', [
  { tag: 'circle', attrs: { cx: 11, cy: 11, r: 8 } },
  { tag: 'path', attrs: { d: 'm21 21-4.3-4.3' } },
])
export const Bell = createIcon('Bell', [
  { tag: 'path', attrs: { d: 'M10.268 21a2 2 0 0 0 3.464 0' } },
  {
    tag: 'path',
    attrs: { d: 'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326' },
  },
])
export const Database = createIcon('Database', [
  { tag: 'ellipse', attrs: { cx: 12, cy: 5, rx: 9, ry: 3 } },
  { tag: 'path', attrs: { d: 'M3 5V19A9 3 0 0 0 21 19V5' } },
  { tag: 'path', attrs: { d: 'M3 12A9 3 0 0 0 21 12' } },
])
export const Activity = createIcon('Activity', [
  {
    tag: 'path',
    attrs: { d: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2' },
  },
])
export const Settings = createIcon('Settings', [
  {
    tag: 'path',
    attrs: { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' },
  },
  { tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } },
])
export const LayoutGrid = createIcon('LayoutGrid', [
  { tag: 'rect', attrs: { width: 7, height: 7, x: 3, y: 3, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 7, x: 14, y: 3, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 7, x: 14, y: 14, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 7, x: 3, y: 14, rx: 1 } },
])
export const LayoutDashboard = createIcon('LayoutDashboard', [
  { tag: 'rect', attrs: { width: 7, height: 9, x: 3, y: 3, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 5, x: 14, y: 3, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 9, x: 14, y: 12, rx: 1 } },
  { tag: 'rect', attrs: { width: 7, height: 5, x: 3, y: 16, rx: 1 } },
])
export const Users = createIcon('Users', [
  { tag: 'path', attrs: { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' } },
  { tag: 'circle', attrs: { cx: 9, cy: 7, r: 4 } },
  { tag: 'path', attrs: { d: 'M22 21v-2a4 4 0 0 0-3-3.87' } },
  { tag: 'path', attrs: { d: 'M16 3.13a4 4 0 0 1 0 7.75' } },
])
export const KeyRound = createIcon('KeyRound', [
  {
    tag: 'path',
    attrs: { d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z' },
  },
  { tag: 'circle', attrs: { cx: 16.5, cy: 7.5, r: 0.5, fill: 'currentColor' } },
])
export const GitBranch = createIcon('GitBranch', [
  { tag: 'line', attrs: { x1: 6, x2: 6, y1: 3, y2: 15 } },
  { tag: 'circle', attrs: { cx: 18, cy: 6, r: 3 } },
  { tag: 'circle', attrs: { cx: 6, cy: 18, r: 3 } },
  { tag: 'path', attrs: { d: 'M18 9a9 9 0 0 1-9 9' } },
])
export const Building = createIcon('Building', [
  { tag: 'rect', attrs: { width: 16, height: 20, x: 4, y: 2, rx: 2 } },
  { tag: 'path', attrs: { d: 'M9 22v-4h6v4' } },
  { tag: 'path', attrs: { d: 'M8 6h.01' } },
  { tag: 'path', attrs: { d: 'M16 6h.01' } },
  { tag: 'path', attrs: { d: 'M12 6h.01' } },
  { tag: 'path', attrs: { d: 'M12 10h.01' } },
  { tag: 'path', attrs: { d: 'M12 14h.01' } },
  { tag: 'path', attrs: { d: 'M16 10h.01' } },
  { tag: 'path', attrs: { d: 'M16 14h.01' } },
  { tag: 'path', attrs: { d: 'M8 10h.01' } },
  { tag: 'path', attrs: { d: 'M8 14h.01' } },
])
export const Inbox = createIcon('Inbox', [
  { tag: 'path', attrs: { d: 'M22 12h-6l-2 3h-4l-2-3H2' } },
  {
    tag: 'path',
    attrs: { d: 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' },
  },
])
export const LogOut = createIcon('LogOut', [
  { tag: 'path', attrs: { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' } },
  { tag: 'polyline', attrs: { points: '16 17 21 12 16 7' } },
  { tag: 'line', attrs: { x1: 21, x2: 9, y1: 12, y2: 12 } },
])
export const Trash = createIcon('Trash', [
  { tag: 'path', attrs: { d: 'M3 6h18' } },
  { tag: 'path', attrs: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' } },
  { tag: 'line', attrs: { x1: 10, x2: 10, y1: 11, y2: 17 } },
  { tag: 'line', attrs: { x1: 14, x2: 14, y1: 11, y2: 17 } },
])
export const Copy = createIcon('Copy', [
  { tag: 'rect', attrs: { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 } },
  { tag: 'path', attrs: { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' } },
])
export const ShieldCheck = createIcon('ShieldCheck', [
  {
    tag: 'path',
    attrs: { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' },
  },
  { tag: 'path', attrs: { d: 'm9 12 2 2 4-4' } },
])
export const ArrowLeft = createIcon('ArrowLeft', [
  { tag: 'path', attrs: { d: 'm12 19-7-7 7-7' } },
  { tag: 'path', attrs: { d: 'M19 12H5' } },
])
export const ExternalLink = createIcon('ExternalLink', [
  { tag: 'path', attrs: { d: 'M15 3h6v6' } },
  { tag: 'path', attrs: { d: 'M10 14 21 3' } },
  { tag: 'path', attrs: { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' } },
])
export const Play = createIcon('Play', [{ tag: 'polygon', attrs: { points: '6 3 20 12 6 21 6 3' } }])
export const Walnut = createIcon('Walnut', [
  { tag: 'circle', attrs: { cx: 12, cy: 12, r: 9 } },
  { tag: 'path', attrs: { d: 'M12 3v18' } },
  { tag: 'path', attrs: { d: 'M5 8c3 2 3 6 0 8' } },
  { tag: 'path', attrs: { d: 'M19 8c-3 2-3 6 0 8' } },
])
