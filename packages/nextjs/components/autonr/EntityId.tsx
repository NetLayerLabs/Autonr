import { CopyButton } from "./CopyButton";
import { ExternalLink } from "./ExternalLink";
import { shortHex } from "~~/lib/format";

type EntityIdProps = {
  value: string;
  /** HashScan (or other) page for the entity. */
  href?: string;
  /** Shorten 0x values to 0x1234…abcd; the full value stays in the tooltip and the copy button. */
  short?: boolean;
};

/** A Hedera entity id, EVM address or hash: monospace, copyable, optionally linked. */
export const EntityId = ({ value, href, short = false }: EntityIdProps) => {
  const text = short && value.startsWith("0x") ? shortHex(value) : value;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-0.5 align-middle font-mono text-xs">
      {href ? (
        <ExternalLink href={href} className="min-w-0">
          <span className="truncate" title={value}>
            {text}
          </span>
        </ExternalLink>
      ) : (
        <span className="truncate" title={value}>
          {text}
        </span>
      )}
      <CopyButton value={value} label={`Copy ${value}`} />
    </span>
  );
};
