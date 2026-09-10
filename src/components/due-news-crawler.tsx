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
/** Soft awareness beep while unmuted. */
const BEEP_INTERVAL_MS = 18_000;

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

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as AudioWindow;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Shared context so unmute click unlocks autoplay for later interval beeps. */
let sharedAudioCtx: AudioContext | null = null;

async function ensureAudioContext(): Promise<AudioContext | null> {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === "suspended") {
    try {
      await sharedAudioCtx.resume();
    } catch {
      /* autoplay / permission still blocked */
    }
  }
  return sharedAudioCtx;
}

function scheduleBeep(ctx: AudioContext, when = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t = ctx.currentTime + when;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.055, t + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.start(t);
  osc.stop(t + 0.2);
}

async function playSoftBeep(): Promise<boolean> {
  try {
    const ctx = await ensureAudioContext();
    if (!ctx || ctx.state !== "running") return false;
    scheduleBeep(ctx);
    scheduleBeep(ctx, 0.22);
    return true;
  } catch {
    return false;
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
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  // Periodic soft beep while unmuted.
  useEffect(() => {
    if (!visible || !soundOn) return;

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void playSoftBeep();
    };

    const id = window.setInterval(tick, BEEP_INTERVAL_MS);
    const warm = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(warm);
    };
  }, [visible, soundOn, items.length]);

  // Preference restored unmuted: unlock audio on first bar interaction.
  useEffect(() => {
    if (!visible || !soundOn) return;
    const el = rootRef.current;
    if (!el) return;
    const onPointer = () => {
      void ensureAudioContext().then((ctx) => {
        if (ctx?.state === "running") void playSoftBeep();
      });
    };
    el.addEventListener("pointerdown", onPointer, { once: true });
    return () => el.removeEventListener("pointerdown", onPointer);
  }, [visible, soundOn]);

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
    void (async () => {
      const enabling = !soundOn;
      if (enabling) {
        await ensureAudioContext();
        await playSoftBeep();
      }
      setSoundOn(enabling);
      try {
        localStorage.setItem(SOUND_PREF_KEY, enabling ? "1" : "0");
      } catch {
        /* ignore */
      }
    })();
  };

  const strip = [...items, ...items];
  const durationSec = Math.max(28, Math.min(90, items.length * 7));

  return (
    <div
      ref={rootRef}
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
        aria-label={soundOn ? "Mute due ticker beep" : "Enable due ticker beep"}
        title={soundOn ? "Beep on — click to mute" : "Muted — click to enable soft beep"}
      >
        {soundOn ? <Volume2 /> : <VolumeX />}
      </button>
    </div>
  );
}
