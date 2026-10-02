"use client";

import { useNow } from "~~/hooks/autonr/useNow";
import { formatRelative, formatUtc } from "~~/lib/format";

/** "3m ago", with the exact UTC and local time in a tooltip. */
export const RelativeTime = ({ date }: { date: Date }) => {
  const now = useNow(5_000);
  const absolute = `${formatUtc(date)} (local ${date.toLocaleString()})`;
  return (
    <span className="tooltip tooltip-bottom" data-tip={absolute}>
      <time dateTime={date.toISOString()} className="whitespace-nowrap tabular-nums">
        {formatRelative(date.getTime(), now)}
      </time>
    </span>
  );
};
