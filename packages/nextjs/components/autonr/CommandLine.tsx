import { CopyButton } from "./CopyButton";

export const CommandLine = ({ command }: { command: string }) => (
  <div className="code-block flex items-center gap-2 py-1.5 pl-3 pr-1.5">
    <span className="select-none text-[#474747]" aria-hidden>
      $
    </span>
    <code className="grow break-all">{command}</code>
    <CopyButton value={command} label="Copy command" />
  </div>
);
