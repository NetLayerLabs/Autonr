import { CommandLine } from "./CommandLine";
import { InformationCircleIcon } from "@heroicons/react/24/outline";

type EmptyStateProps = { reason: string; commands?: readonly string[] };

/** What is missing and the exact commands that fix it. */
export const EmptyState = ({ reason, commands = [] }: EmptyStateProps) => (
  <div className="flex flex-col gap-3">
    <p className="m-0 flex items-start gap-2 text-sm text-base-content/80">
      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
      <span>{reason}</span>
    </p>
    {commands.length > 0 && (
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {commands.map(command => (
          <li key={command}>
            <CommandLine command={command} />
          </li>
        ))}
      </ol>
    )}
  </div>
);
