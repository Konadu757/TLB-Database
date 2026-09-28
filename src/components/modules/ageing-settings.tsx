import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TlbStoreApi } from "@/lib/store/use-tlb-store";

export function AgeingSettingsPanel({ store }: { store: TlbStoreApi }) {
  const [normalMaxDays, setNormal] = useState(store.state.ageing.normalMaxDays);
  const [attentionMaxDays, setAttention] = useState(store.state.ageing.attentionMaxDays);

  return (
    <article className="tlb-panel" style={{ marginTop: 14 }}>
      <div className="tlb-panel-heading">
        <div>
          <span>Outstanding ageing</span>
          <strong>Configurable thresholds</strong>
        </div>
      </div>
      <form
        className="tlb-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          store.setAgeing(Number(normalMaxDays), Number(attentionMaxDays));
        }}
      >
        <label>
          Normal max days
          <input
            type="number"
            min={0}
            value={normalMaxDays}
            onChange={(e) => setNormal(Number(e.target.value))}
          />
        </label>
        <label>
          Attention max days
          <input
            type="number"
            min={0}
            value={attentionMaxDays}
            onChange={(e) => setAttention(Number(e.target.value))}
          />
        </label>
        <p className="tlb-muted-line tlb-span-2">
          Bands: 0–{normalMaxDays} Normal · {normalMaxDays + 1}–{attentionMaxDays} Attention ·{" "}
          {attentionMaxDays + 1}+ Overdue
        </p>
        <div className="tlb-form-actions tlb-span-2">
          <Button type="submit">Save ageing settings</Button>
        </div>
      </form>
      {store.error && (
        <p className="tlb-flash tlb-flash-error" style={{ margin: 12 }}>
          {store.error}
        </p>
      )}
      {store.notice && (
        <p className="tlb-flash tlb-flash-ok" style={{ margin: 12 }}>
          {store.notice}
        </p>
      )}
    </article>
  );
}
