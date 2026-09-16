import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

let openDialogs = 0;
let previousBodyOverflow = "";

export function Dialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement;
    if (openDialogs === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openDialogs += 1;
    element?.showModal();
    return () => {
      element?.close();
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0)
        document.body.style.overflow = previousBodyOverflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
