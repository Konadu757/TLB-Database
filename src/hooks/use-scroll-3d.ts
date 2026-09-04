import { useEffect, type RefObject } from "react";

const MOBILE_MQL = "(max-width: 900px)";
const REDUCED_MOTION_MQL = "(prefers-reduced-motion: reduce)";

/**
 * Scroll-driven 3D reveal + tilt for dashboard content cards.
 * Targets `.tlb-scroll-3d` (reveal) and `.tlb-scroll-3d-tilt` (scroll tilt).
 */
export function useScroll3D(
  scrollRootRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const content = contentRef.current;
    if (!scrollRoot || !content) return;

    const reducedMotion = window.matchMedia(REDUCED_MOTION_MQL).matches;
    const isMobile = window.matchMedia(MOBILE_MQL).matches;
    const items = content.querySelectorAll<HTMLElement>(".tlb-scroll-3d");

    if (reducedMotion) {
      items.forEach((el) => el.classList.add("tlb-scroll-3d-visible"));
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("tlb-scroll-3d-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      {
        root: isMobile ? null : scrollRoot,
        threshold: 0.1,
        rootMargin: "0px 0px -6% 0px",
      },
    );

    items.forEach((el) => {
      el.classList.remove("tlb-scroll-3d-visible");
      revealObserver.observe(el);
    });

    let rafId = 0;
    const tiltItems = content.querySelectorAll<HTMLElement>(".tlb-scroll-3d-tilt");

    const updateTilt = () => {
      const rootRect = isMobile
        ? { top: 0, height: window.innerHeight }
        : scrollRoot.getBoundingClientRect();
      const centerY = rootRect.top + rootRect.height * 0.42;
      const intensity = isMobile ? 0.35 : 1;

      tiltItems.forEach((el) => {
        if (!el.classList.contains("tlb-scroll-3d-visible")) return;

        const rect = el.getBoundingClientRect();
        const elCenterY = rect.top + rect.height / 2;
        const offsetY = (elCenterY - centerY) / Math.max(rootRect.height, 1);
        const clamped = Math.max(-1, Math.min(1, offsetY * 2.2));

        const side = el.dataset.tiltSide;
        const baseTiltY = side === "left" ? 2.5 : side === "right" ? -2.5 : 0;
        const tiltX = clamped * -2.8 * intensity;
        const tiltY = (baseTiltY + clamped * 1.2) * intensity;
        const lift = (1 - Math.abs(clamped)) * 10 * intensity;

        el.style.setProperty("--tlb-3d-tilt-x", `${tiltX.toFixed(2)}deg`);
        el.style.setProperty("--tlb-3d-tilt-y", `${tiltY.toFixed(2)}deg`);
        el.style.setProperty("--tlb-3d-lift", `${lift.toFixed(1)}px`);
      });
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateTilt);
    };

    const scrollTarget = isMobile ? window : scrollRoot;
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    updateTilt();

    return () => {
      revealObserver.disconnect();
      scrollTarget.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId);
      tiltItems.forEach((el) => {
        el.style.removeProperty("--tlb-3d-tilt-x");
        el.style.removeProperty("--tlb-3d-tilt-y");
        el.style.removeProperty("--tlb-3d-lift");
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
