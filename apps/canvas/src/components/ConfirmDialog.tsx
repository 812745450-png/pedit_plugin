import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

export function ConfirmDialog({
  title,
  children,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const titleId = useId();
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);
  const [portalHost] = useState(() => {
    if (typeof document === "undefined") {
      return null;
    }

    const host = document.createElement("div");
    host.setAttribute("data-confirm-dialog-root", "");
    return host;
  });

  useEffect(() => {
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;

    if (!backdrop || !dialog) {
      return;
    }

    if (portalHost && !document.body.contains(portalHost)) {
      document.body.appendChild(portalHost);
    }

    previouslyFocusedRef.current = document.activeElement;
    const backgroundElements = getBackgroundElements(portalHost);
    const previousBackgroundState = backgroundElements.map((element) => {
      const htmlElement = element as HTMLElement & { inert?: boolean };

      return {
        element: htmlElement,
        ariaHidden: htmlElement.getAttribute("aria-hidden"),
        inert: htmlElement.inert
      };
    });

    previousBackgroundState.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    focusFirstDialogControl();

    const handleFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) {
        focusFirstDialogControl();
      }
    };

    const handleOutsideClick = (event: MouseEvent | PointerEvent) => {
      if (!dialog.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        focusFirstDialogControl();
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("pointerdown", handleOutsideClick, true);
    document.addEventListener("click", handleOutsideClick, true);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("pointerdown", handleOutsideClick, true);
      document.removeEventListener("click", handleOutsideClick, true);

      previousBackgroundState.forEach(({ element, ariaHidden, inert }) => {
        element.inert = inert;

        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      });

      const previousElement = previouslyFocusedRef.current;

      if (
        previousElement instanceof HTMLElement &&
        document.contains(previousElement)
      ) {
        previousElement.focus();
      }

      if (portalHost && document.body.contains(portalHost)) {
        document.body.removeChild(portalHost);
      }
    };
  }, [portalHost]);

  const focusFirstDialogControl = () => {
    const firstFocusable = getFocusableElements(dialogRef.current)[0];

    if (firstFocusable) {
      firstFocusable.focus();
      return;
    }

    dialogRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements(dialogRef.current);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const dialogMarkup = (
    <div
      ref={backdropRef}
      className="confirm-backdrop"
      role="presentation"
      aria-label="Exit edit confirmation backdrop"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{title}</h2>
        <p>{children}</p>
        <div className="confirm-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="primary-button danger-button"
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  if (!portalHost) {
    return dialogMarkup;
  }

  return createPortal(dialogMarkup, portalHost);
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(
      (element) =>
        !element.hasAttribute("disabled") &&
        element.getAttribute("aria-hidden") !== "true"
    );
}

function getBackgroundElements(portalHost: HTMLElement | null) {
  const bodyChildren = Array.from(document.body.children).filter(
    (element) => element !== portalHost
  );
  const appShell =
    document.querySelector(".canvas-app") ?? document.querySelector(".app");
  const elements = appShell ? [...bodyChildren, appShell] : bodyChildren;

  return elements.filter(
    (element, index) =>
      elements.indexOf(element) === index &&
      !portalHost?.contains(element) &&
      !element.contains(portalHost)
  );
}
