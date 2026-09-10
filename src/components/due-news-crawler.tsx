import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import {
  buildDueAwarenessItems,
  formatDueAwarenessTickerText,
  type DueAwarenessItem,
  type DueAwarenessNav,
} from "@/lib/domain/due-awareness";
import type { OutstandingRow, TlbState } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

const SOUND_PREF_KEY = "tlb.due-ticker.sound";

export type DueTickerNavigate = (
  nav: DueAwarenessNav,
  orderId?: string | null,
  productId?: string | null,
  customerId?: string | null,
  supplierId?: string | null,
  opsRequestId?: string | null,
) => void;

type Props = {
  state: TlbState;
  outstanding: OutstandingRow[];
  onNavigate: DueTickerNavigate;
  onVisibilityChange?: (visible: boolean) => void;
};

function playSoftBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.14);
    void ctx.close().catch(() => undefined);
  } catch {
    /* ignore audio failures */
  }
}

export function DueNewsCrawler({ state, outstanding, onNavigate, onVisibilityChange }: Props) {
  const items = useMemo(
    () => buildDueAwarenessItems(state, outstanding),
    [state, outstanding],
  );
  const visible = items.length > 0;
  const [soundOn, setSoundOn] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const lastBeepCount = useRef(0);

  useEffect(() => {
    try {
      setSoundOn(localStorage.getItem(SOUND_PREF_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  useEffect(() => {
    if (!visible || !soundOn) {
      lastBeepCount.current = items.length;
      return;
    }
    if (items.length > lastBeepCount.current) {
      playSoftBeep();
    }
    lastBeepCount.current = items.length;
  }, [visible, soundOn, items.length]);

  if (!visible) return null;

  const handleNavigate = (item: DueAwarenessItem) => {
    if (item.nav === "Outstanding Supplies") {
      onNavigate(item.nav, null, item.entityId ?? null);
      return;
    }
    if (
      item.nav === "Outstanding Requests" ||
      item.nav === "Exceptions / Discrepancies" ||
      item.nav === "Requests"
    ) {
      onNavigate(item.nav, null, null, null, null, item.entityId ?? null);
      return;
    }
    onNavigate(item.nav);
  };

  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_PREF_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (next) playSoftBeep();
      return next;
    });
  };

  // Duplicate strip so CSS marquee loops seamlessly
  const strip = [...items, ...items];
  const durationSec = Math.max(28, Math.min(90, items.length * 7));

  return (
    <div
      className="tlb-due-ticker"
      role="region"
      aria-label={`Due and overdue awareness, ${items.length} item${items.length === 1 ? "" : "s"}`}
    >
      <div className="tlb-due-ticker-badge" aria-hidden="true">
        <span className="tlb-due-ticker-pulse" />
        <strong>DUE</strong>
        <em>{items.length}</em>
      </div>

      <div className={cn("tlb-due-ticker-track", reducedMotion && "tlb-due-ticker-track--static")}>
        {reducedMotion ? (
          <ul className="tlb-due-ticker-static-list">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className="tlb-due-ticker-item" onClick={() => handleNavigate(item)}>
                  {formatDueAwarenessTickerText(item)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="tlb-due-ticker-marquee"
            style={{ animationDuration: `${durationSec}s` }}
          >
            {strip.map((item, index) => (
              <button
                key={`${item.id}-${index}`}
                type="button"
                className="tlb-due-ticker-item"
                onClick={() => handleNavigate(item)}
                tabIndex={index < items.length ? 0 : -1}
                aria-hidden={index >= items.length ? true : undefined}
              >
                {formatDueAwarenessTickerText(item)}
                <span className="tlb-due-ticker-sep" aria-hidden="true">
                  •
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="tlb-due-ticker-sound"
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? "Mute soft due alert beep" : "Enable soft due alert beep"}
        title={soundOn ? "Sound on — click to mute" : "Sound off — click for soft beep"}
      >
        {soundOn ? <Volume2 /> : <VolumeX />}
      </button>
    </div>
  );
}
