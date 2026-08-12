"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CustomerIcon } from "./CustomerIcon";

export function CustomerSheet({
  title,
  onClose,
  closeLabel,
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
      trigger?.focus();
    };
  }, []);
  const sheet = (
    <div
      className="backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="handle" aria-hidden="true" />
        <header>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label={closeLabel || `${title} 닫기`}
          >
            <CustomerIcon name="close" />
          </button>
        </header>
        <div className="body">{children}</div>
      </section>
      <style jsx>{`
        .backdrop {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(15, 23, 42, 0.55);
          display: grid;
          align-items: end;
          padding-top: env(safe-area-inset-top);
        }
        .sheet {
          width: 100%;
          max-height: 92dvh;
          overflow: hidden;
          border-radius: 24px 24px 0 0;
          background: #fff;
          color: #111827;
          box-shadow: 0 -20px 60px rgba(15, 23, 42, 0.2);
        }
        .handle {
          width: 42px;
          height: 4px;
          margin: 9px auto 3px;
          border-radius: 99px;
          background: #d1d5db;
        }
        header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          background: #fff;
        }
        h2 {
          margin: 0;
          font-size: 20px;
        }
        button {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border: 1px solid #e5e7eb;
          border-radius: 13px;
          background: #fff;
          color: #111827;
        }
        .body {
          max-height: calc(92dvh - 68px);
          overflow: auto;
          padding: 16px 16px calc(20px + env(safe-area-inset-bottom));
        }
        @media (min-width: 700px) {
          .backdrop {
            place-items: center;
            padding: 24px;
          }
          .sheet {
            width: min(640px, 100%);
            max-height: 84vh;
            border-radius: 24px;
          }
          .body {
            max-height: calc(84vh - 68px);
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .backdrop {
            animation: sheetFade 180ms ease-out;
          }
          .sheet {
            animation: sheetEnter 200ms ease-out;
          }
        }
        @keyframes sheetFade {
          from {
            opacity: 0;
          }
        }
        @keyframes sheetEnter {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(sheet, document.body);
}
