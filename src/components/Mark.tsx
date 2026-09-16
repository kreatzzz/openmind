export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`brand-mark ${small ? "brand-mark-small" : ""}`}
      aria-hidden="true"
    >
      <span className="brand-letter">o</span>
    </span>
  );
}
