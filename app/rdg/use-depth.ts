"use client";
import { useEffect, useRef, useState } from "react";
export function useDepth() {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    try {
      setEnabled(localStorage.getItem("rdg-depth") !== "off");
    } catch {
      setEnabled(true);
    }
  }, []);
  function toggle() {
    setEnabled((v) => {
      try {
        localStorage.setItem("rdg-depth", v ? "off" : "on");
      } catch {}
      return !v;
    });
  }
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const media = matchMedia(
      "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)",
    );
    let card: HTMLElement | null = null,
      frame = 0;
    const reset = () => {
      cancelAnimationFrame(frame);
      card?.style.removeProperty("--tilt-x");
      card?.style.removeProperty("--tilt-y");
      card = null;
    };
    const move = (e: PointerEvent) => {
      if (!media.matches) return reset();
      const target = (e.target as HTMLElement).closest<HTMLElement>(
        ".idea-card, .pick-card, .hero-image",
      );
      if (target !== card) {
        reset();
        card = target;
      }
      if (!card) return;
      const rect = card.getBoundingClientRect(),
        x = (e.clientX - rect.left) / rect.width - 0.5,
        y = (e.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card?.style.setProperty("--tilt-x", `${-y * 5}deg`);
        card?.style.setProperty("--tilt-y", `${x * 5}deg`);
      });
    };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", reset);
    media.addEventListener("change", reset);
    return () => {
      reset();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", reset);
      media.removeEventListener("change", reset);
    };
  }, [enabled]);
  return { ref, enabled, toggle };
}
