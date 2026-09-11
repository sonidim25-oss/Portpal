import { CategoryIcon } from './icons';
import { categoryBlurb, categoryLabel, explainPort } from './resolve';
import type { PortConfidence, PortLike } from './types';

/**
 * How the explanation was arrived at, said plainly. `known` gets no note —
 * there is nothing to caveat when the port is an exact match.
 */
const CONFIDENCE_NOTE: Record<PortConfidence, string | null> = {
  known: null,
  project: 'Matched to a project folder found on this machine.',
  process: 'Identified from the name of the program using this port.',
  range: 'No exact match. This is what the port number range alone tells us.',
};

export interface PortInfoCardProps {
  port: PortLike;
  /** Hide the "is this normal here?" line. Shown by default. */
  showContext?: boolean;
  className?: string;
  /** Rendered as the card heading element. Defaults to a div, since the card is often inside a popover. */
  headingLevel?: 'h2' | 'h3' | 'h4';
}

/**
 * The full explanation of a port: what it is called in plain words, what it
 * does, whether it is normal to see here, and how sure we are.
 */
export function PortInfoCard({
  port,
  showContext = true,
  className,
  headingLevel: Heading = 'h3',
}: PortInfoCardProps) {
  const explanation = explainPort(port);
  const note = CONFIDENCE_NOTE[explanation.confidence];

  return (
    <div
      className={['pi-card', className].filter(Boolean).join(' ')}
      data-category={explanation.category}
    >
      <div className="pi-card__head">
        <CategoryIcon category={explanation.category} size={20} className="pi-card__icon" />
        <Heading className="pi-card__title">{explanation.headline}</Heading>
      </div>

      <div className="pi-card__meta">
        <span className="pi-card__chip">{categoryLabel(explanation.category)}</span>
        <span className="pi-card__blurb">{categoryBlurb(explanation.category)}</span>
      </div>

      <p className="pi-card__description">{explanation.description}</p>

      {showContext && explanation.context ? (
        <p className="pi-card__context">
          <span className="pi-card__context-label">Is this normal?</span> {explanation.context}
        </p>
      ) : null}

      {note ? <p className="pi-card__note">{note}</p> : null}
    </div>
  );
}
