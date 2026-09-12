import { Leaf } from "lucide-react";

export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`brand-mark ${small ? "brand-mark-small" : ""}`}
      aria-hidden="true"
    >
      <Leaf strokeWidth={1.4} />
    </span>
  );
}
