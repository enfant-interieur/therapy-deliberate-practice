import { useEffect, useRef } from "react";
import { authClient } from "./client";
import { api } from "../store/api";
import { setUser } from "../store/authSlice";
import { useAppDispatch } from "../store/hooks";
import { resetMinigame } from "../store/minigamesSlice";
import { resetSessionState } from "../store/practiceSlice";
import { resetSettings } from "../store/settingsSlice";

export function useAuthSync() {
  const { data, isPending } = authClient.useSession();
  const dispatch = useAppDispatch();
  const previousUser = useRef<string | null>(null);
  useEffect(() => {
    // Only remove the obsolete auth credentials owned by this origin, preserving app preferences.
    for (const key of Object.keys(window.localStorage)) {
      if (/^sb-[a-z0-9]+-auth-token(?:-code-verifier)?$/.test(key))
        window.localStorage.removeItem(key);
    }
    window.localStorage.removeItem("authReturnTo");
    window.localStorage.removeItem("authError");
  }, []);
  useEffect(() => {
    if (isPending) return;
    const userId = data?.user.id ?? null;
    if (previousUser.current !== userId) {
      dispatch(api.util.resetApiState());
      dispatch(resetMinigame());
      dispatch(resetSessionState());
      dispatch(resetSettings());
      previousUser.current = userId;
    }
    dispatch(
      setUser({
        userId,
        email: data?.user.email ?? null,
        isAuthenticated: Boolean(userId),
        authChecked: true,
      }),
    );
  }, [data, isPending, dispatch]);
}
