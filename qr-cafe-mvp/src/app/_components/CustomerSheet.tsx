"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { CustomerIcon } from "./CustomerIcon";

export function CustomerSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div
      className="backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-sheet-title"
      >
        <div className="handle" aria-hidden="true" />
        <header>
          <h2 id="customer-sheet-title">{title}</h2>
          <button ref={closeRef} onClick={onClose} aria-label="닫기">
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
      `}</style>
    </div>
  );
}
