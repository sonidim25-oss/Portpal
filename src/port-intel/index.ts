/**
 * Port Intel — plain-English explanations for detected ports.
 *
 * Import from this barrel rather than the individual files; it is the module's
 * public surface and the only thing INTEGRATION.md asks you to reference.
 *
 *   import { PortBadge, PortTooltip, explainPort } from '../port-intel';
 *   import '../port-intel/port-intel.css';
 */

export { CATALOG_PORTS, CATEGORY_META, PORT_CATALOG } from './catalog';
export {
  categoryBlurb,
  categoryLabel,
  explainPort,
  formatHeadline,
  matchesPortQuery,
} from './resolve';
export { CategoryIcon } from './icons';
export { PortBadge } from './PortBadge';
export { PortInfoCard } from './PortInfoCard';
export { PortLabel } from './PortLabel';
export { PortTooltip } from './PortTooltip';

export type { CategoryIconProps } from './icons';
export type { PortBadgeProps } from './PortBadge';
export type { PortInfoCardProps } from './PortInfoCard';
export type { PortLabelProps } from './PortLabel';
export type { PortTooltipProps } from './PortTooltip';
export type {
  CategoryMeta,
  PortCategory,
  PortConfidence,
  PortExplanation,
  PortFacts,
  PortLike,
} from './types';
