import { ThinkingOrb, type OrbState } from "thinking-orbs";

export type ModelActivityPhase = "preparing" | "responding" | "stopping";

const ACTIVITY_COPY: Record<
  ModelActivityPhase,
  { label: string; orbState: OrbState }
> = {
  preparing: { label: "Preparing a reply", orbState: "working" },
  responding: { label: "Writing a reply", orbState: "composing" },
  stopping: { label: "Stopping reply", orbState: "working" },
};

export function ModelActivity({
  phase,
  label,
}: {
  phase: ModelActivityPhase;
  label?: string;
}) {
  const activity = ACTIVITY_COPY[phase];

  return (
    <span className="model-activity">
      <span className="model-activity-orb" aria-hidden="true">
        <ThinkingOrb state={activity.orbState} size={20} theme="auto" />
      </span>
      <span>{label ?? activity.label}</span>
    </span>
  );
}
