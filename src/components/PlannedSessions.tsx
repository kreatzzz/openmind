import { useEffect, useState, type FormEvent } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { desktop, type PlanInput, type SessionPlan } from "../lib/desktop";
import { readSamplePlans, writeSamplePlans } from "../lib/plans";

function defaultDate() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function PlannedSessions({
  sample,
  onChanged,
}: {
  sample: boolean;
  onChanged?: () => void;
}) {
  const [plans, setPlans] = useState<SessionPlan[]>(() =>
    sample ? readSamplePlans() : [],
  );
  function publish(next: SessionPlan[]) {
    setPlans(next);
    if (sample) writeSamplePlans(next);
    onChanged?.();
  }
  const [input, setInput] = useState<PlanInput>({
    label: "Time to reflect",
    localStart: defaultDate(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    recurrence: "weekly",
    notifications: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (sample) return;
    let cancelled = false;
    desktop
      .listPlans()
      .then((items) => {
        if (!cancelled) setPlans(items);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [sample]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (
        input.notifications &&
        !sample &&
        !(await isPermissionGranted()) &&
        (await requestPermission()) !== "granted"
      ) {
        throw new Error(
          "Notifications are disabled by your system. You can still save a plan without them.",
        );
      }
      const plan = sample
        ? {
            ...input,
            id: crypto.randomUUID(),
            enabled: true,
            revision: 1,
            nextAt: new Date(input.localStart).toISOString(),
          }
        : await desktop.createPlan(input);
      publish([...plans, plan]);
      setAdding(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function update(plan: SessionPlan, remove = false) {
    setBusy(true);
    setError("");
    try {
      if (remove) {
        if (!sample) await desktop.removePlan(plan.id, plan.revision);
        publish(plans.filter((item) => item.id !== plan.id));
      } else {
        const updated = sample
          ? { ...plan, enabled: !plan.enabled, revision: plan.revision + 1 }
          : await desktop.enablePlan(plan.id, !plan.enabled, plan.revision);
        publish(plans.map((item) => (item.id === plan.id ? updated : item)));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="planned-sessions">
      <p className="settings-description">
        Set aside time to check in. Reminders arrive while Openmind is open and
        unlocked; missed times are grouped when you return.
      </p>
      {sample && (
        <p className="field-hint">
          Plans here are temporary. Desktop plans are saved in your encrypted
          workspace.
        </p>
      )}
      <div className="plans-list">
        {plans.map((plan) => (
          <div className="plan-row" key={plan.id}>
            <CalendarDays size={18} />
            <div>
              <strong>{plan.label}</strong>
              <small>
                {new Date(plan.nextAt).toLocaleString(undefined, {
                  timeZone: plan.timezone,
                })}{" "}
                · {plan.timezone}
              </small>
              <small>
                {plan.recurrence} · {plan.enabled ? "Scheduled" : "Paused"}
              </small>
            </div>
            <button
              className="text-button"
              onClick={() => void update(plan)}
              disabled={busy}
            >
              {plan.enabled ? "Pause" : "Resume"}
            </button>
            <button
              className="icon-button"
              aria-label={`Remove ${plan.label}`}
              onClick={() => void update(plan, true)}
              disabled={busy}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {!plans.length && !adding && (
        <div className="home-empty">
          <CalendarDays size={25} />
          <h3>No plans yet</h3>
          <p>Choose a time that works for you.</p>
        </div>
      )}
      {adding ? (
        <form className="settings-section plan-form" onSubmit={save}>
          <label htmlFor="plan-label">Name</label>
          <input
            id="plan-label"
            value={input.label}
            maxLength={80}
            required
            onChange={(event) =>
              setInput({ ...input, label: event.target.value })
            }
          />
          <label htmlFor="plan-time">Date and time</label>
          <input
            id="plan-time"
            type="datetime-local"
            value={input.localStart}
            required
            onChange={(event) =>
              setInput({ ...input, localStart: event.target.value })
            }
          />
          <label htmlFor="plan-timezone">Timezone</label>
          <input
            id="plan-timezone"
            disabled={sample}
            value={input.timezone}
            required
            spellCheck={false}
            onChange={(event) =>
              setInput({ ...input, timezone: event.target.value })
            }
          />
          <p className="field-hint">
            Uses this timezone when you travel. Skipped clock times move
            forward; repeated times notify once.
          </p>
          <label htmlFor="plan-repeat">Repeat</label>
          <select
            id="plan-repeat"
            value={input.recurrence}
            onChange={(event) =>
              setInput({
                ...input,
                recurrence: event.target.value as PlanInput["recurrence"],
              })
            }
          >
            <option value="once">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={input.notifications}
              onChange={(event) =>
                setInput({ ...input, notifications: event.target.checked })
              }
            />
            Send a desktop notification
          </label>
          <div className="note-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="primary-button" disabled={busy}>
              {busy ? "Saving…" : "Save plan"}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="secondary-button wide"
          onClick={() => setAdding(true)}
        >
          <Plus size={16} />
          Plan a session
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
