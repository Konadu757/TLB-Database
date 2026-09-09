import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DetailBackState = { label: string; onBack: () => void } | null;

type DetailBackContextValue = {
  detailBack: DetailBackState;
  setDetailBack: (next: DetailBackState) => void;
};

const DetailBackContext = createContext<DetailBackContextValue>({
  detailBack: null,
  setDetailBack: () => {},
});

export function DetailBackProvider({ children }: { children: ReactNode }) {
  const [detailBack, setDetailBackState] = useState<DetailBackState>(null);
  const setDetailBack = useCallback((next: DetailBackState) => {
    setDetailBackState(next);
  }, []);
  const value = useMemo(() => ({ detailBack, setDetailBack }), [detailBack, setDetailBack]);
  return <DetailBackContext.Provider value={value}>{children}</DetailBackContext.Provider>;
}

export function useDetailBack() {
  return useContext(DetailBackContext);
}

/** Registers a detail-page back target in the app header while mounted. */
export function useRegisterDetailBack(label: string, onBack: () => void, enabled = true) {
  const { setDetailBack } = useDetailBack();
  useEffect(() => {
    if (!enabled) {
      setDetailBack(null);
      return;
    }
    setDetailBack({ label, onBack });
    return () => setDetailBack(null);
  }, [label, onBack, enabled, setDetailBack]);
}
