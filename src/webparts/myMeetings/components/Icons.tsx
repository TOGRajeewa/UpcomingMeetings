import * as React from 'react';

/**
 * Inline SVG icons. Inlining (rather than pulling in office-ui-fabric-react or
 * an icon font) keeps the bundle tiny and removes a render-blocking font load —
 * both important for the sub-second load target. Icons inherit `currentColor`.
 */

export interface IIconProps {
  className?: string;
  title?: string;
}

export const ClockIcon: React.StatelessComponent<IIconProps> = (props: IIconProps) => (
  <svg className={props.className} width="14" height="14" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden={props.title ? undefined : true}
    role={props.title ? 'img' : undefined} focusable="false">
    {props.title ? <title>{props.title}</title> : null}
    <circle cx="8" cy="8" r="6.3" />
    <path d="M8 4.5V8l2.4 1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PinIcon: React.StatelessComponent<IIconProps> = (props: IIconProps) => (
  <svg className={props.className} width="14" height="14" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden={props.title ? undefined : true}
    role={props.title ? 'img' : undefined} focusable="false">
    {props.title ? <title>{props.title}</title> : null}
    <path d="M8 14.5s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0c0 3.3 4.5 7.5 4.5 7.5z"
      strokeLinejoin="round" />
    <circle cx="8" cy="7" r="1.7" />
  </svg>
);

export const ChevronDownIcon: React.StatelessComponent<IIconProps> = (props: IIconProps) => (
  <svg className={props.className} width="12" height="12" viewBox="0 0 16 16"
    fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden={true} focusable="false">
    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
