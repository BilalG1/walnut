import { createElement, type SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Width & height in px (default 24). */
  size?: number | string
  /** Stroke width (default 2). */
  strokeWidth?: number | string
  /** Accessible label. When set the icon is exposed to assistive tech; otherwise it is `aria-hidden`. */
  title?: string
}

/** One SVG child element of an icon: a tag plus its presentation attributes. */
export interface IconChild {
  readonly tag: string
  readonly attrs: SVGProps<SVGElement>
}

export type IconNode = readonly IconChild[]

/**
 * Build a lucide-style icon component from a list of SVG child nodes. Icons inherit
 * color via `currentColor` and scale with `size`. We own this factory so the icon set
 * carries no external dependency.
 */
export function createIcon(name: string, nodes: IconNode) {
  function Icon({ size = 24, strokeWidth = 2, title, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={title === undefined ? undefined : 'img'}
        aria-hidden={title === undefined ? true : undefined}
        aria-label={title}
        {...props}
      >
        {nodes.map(({ tag, attrs }, index) => createElement(tag, { ...attrs, key: index }))}
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}
