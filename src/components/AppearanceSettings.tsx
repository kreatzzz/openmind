import { Check, Laptop, Moon, Sun } from "lucide-react";

export const COLOR_THEMES = [
  { id: "graphite", name: "Graphite", color: "#525252" },
  { id: "blue", name: "Blue", color: "#0070f3" },
  { id: "teal", name: "Teal", color: "#067a6f" },
  { id: "violet", name: "Violet", color: "#7820bc" },
  { id: "amber", name: "Amber", color: "#946200" },
] as const;

export function AppearanceSettings({
  appearance,
  onAppearance,
  color,
  onColor,
}: {
  appearance: string;
  onAppearance: (value: string) => void;
  color: string;
  onColor: (value: string) => void;
}) {
  return (
    <div className="appearance-controls">
      <h3>Appearance</h3>
      <p>Choose a look that feels comfortable.</p>
      <div className="mode-options" role="group" aria-label="Color mode">
        {[
          { id: "light", label: "Light", Icon: Sun },
          { id: "dark", label: "Dark", Icon: Moon },
          { id: "system", label: "System", Icon: Laptop },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`mode-option ${appearance === id ? "is-selected" : ""}`}
            aria-pressed={appearance === id}
            onClick={() => onAppearance(id)}
          >
            <span
              className={`mode-miniature miniature-${id}`}
              aria-hidden="true"
            >
              <i />
              <span>
                <b />
                <b />
                <b />
              </span>
            </span>
            <span>
              <Icon size={14} />
              {label}
              {appearance === id && <Check size={14} />}
            </span>
          </button>
        ))}
      </div>
      <label>Accent color</label>
      <div className="theme-options" role="group" aria-label="Accent color">
        {COLOR_THEMES.map((theme) => (
          <button
            key={theme.id}
            aria-pressed={color === theme.id}
            className={`theme-option ${color === theme.id ? "is-selected" : ""}`}
            onClick={() => onColor(theme.id)}
          >
            <span className="theme-swatch" style={{ background: theme.color }}>
              {color === theme.id && <Check size={14} />}
            </span>
            <span>{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
