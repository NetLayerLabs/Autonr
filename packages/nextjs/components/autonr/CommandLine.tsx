import { CopyButton } from "./CopyButton";

export const CommandLine = ({ command }: { command: string }) => (
  <div className="flex items-center gap-2 rounded-field bg-base-200 py-1.5 pl-3 pr-1.5 font-mono text-xs">
    <span className="select-none text-base-content/50" aria-hidden>
      $
    </span>
    <code className="grow break-all">{command}</code>
    <CopyButton value={command} label="Copy command" />
  </div>
);
