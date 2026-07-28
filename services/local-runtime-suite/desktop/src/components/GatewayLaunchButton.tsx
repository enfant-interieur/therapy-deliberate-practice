import { useMemo } from "react";
import {
  gatewayBootActivityMessage,
  type GatewayBootState
} from "../hooks/useGatewayBoot";
import type { Translator } from "../i18n";

type Props = {
  boot: GatewayBootState;
  onStart: () => void;
  onCancel: () => void;
  onReset: () => void;
  disabled?: boolean;
  disabledReason?: string;
  onReadyClick?: () => void;
  t: Translator;
};

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.75 13.5 4.5 10.25l1.25-1.25 2 2 6-6 1.25 1.25-7 7Z" fill="currentColor" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="launch-spinner" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="launch-spinner-track" cx="12" cy="12" r="9" />
      <path className="launch-spinner-head" d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export function GatewayLaunchButton({
  boot,
  onStart,
  onCancel,
  onReset,
  disabled,
  disabledReason,
  onReadyClick,
  t
}: Props) {
  const isBusy = boot.phase === "booting" || boot.phase === "polling";
  const isReady = boot.phase === "ready";
  const isDisabled = Boolean(disabled) && !isBusy && !isReady;

  const activeMessage = useMemo(() => gatewayBootActivityMessage(boot, t), [boot, t]);

  const subtitle = useMemo(() => {
    if (isDisabled && disabledReason) return disabledReason;
    if (boot.phase === "idle") return t("launch.idleSubtitle");
    if (boot.phase === "booting") return t("launch.bootingSubtitle");
    if (boot.phase === "polling") {
      const http = boot.lastHttpStatus ? `HTTP ${boot.lastHttpStatus}` : t("launch.noResponse");
      const readiness = boot.lastReadiness
        ? t("launch.readinessSuffix", { status: boot.lastReadiness })
        : "";
      return t("launch.healthSubtitle", {
        attempt: boot.attempts + 1,
        http,
        readiness
      });
    }
    if (boot.phase === "ready") return t("launch.readySubtitle");
    if (boot.phase === "cancelled") return t("launch.stoppedSubtitle");
    return boot.error ?? t("launch.errorSubtitle");
  }, [
    boot.phase,
    boot.attempts,
    boot.lastHttpStatus,
    boot.lastReadiness,
    boot.error,
    disabledReason,
    isDisabled,
    t
  ]);

  const right = useMemo(() => {
    if (boot.phase === "ready") return <CheckIcon />;
    if (isBusy) return <Spinner />;
    return null;
  }, [boot.phase, isBusy]);

  const handleClick = async () => {
    if (isDisabled) {
      return;
    }
    if (isReady) {
      await onReadyClick?.();
      return;
    }
    if (isBusy) return;
    if (boot.phase === "error" || boot.phase === "cancelled") {
      onReset();
      onStart();
      return;
    }
    onStart();
  };

  return (
    <div className="launch-cta">
      <button
        type="button"
        className={[
          "launch-btn",
          isBusy ? "launch-btn--busy" : "",
          isReady ? "launch-btn--ready" : "",
          boot.phase === "error" ? "launch-btn--error" : ""
        ].join(" ")}
        onClick={handleClick}
        disabled={isBusy || isDisabled}
        aria-busy={isBusy}
      >
        <span className="launch-btn__shimmer" aria-hidden="true" />
        <span className="launch-btn__content">
          <span className="launch-btn__left">
            <span className="launch-btn__title">
              {boot.phase === "idle"
                ? t("launch.startTitle")
                : boot.phase === "ready"
                  ? t("launch.readyTitle")
                  : boot.phase === "error"
                    ? t("launch.failedTitle")
                    : t("launch.launchingTitle")}
            </span>

            <span className="launch-btn__message" key={`${boot.phase}-${activeMessage}`}>
              <span className={isBusy ? "launch-btn__messageText launch-gradientText" : "launch-btn__messageText"}>
                {activeMessage}
              </span>
            </span>

            <span className="launch-btn__subtitle">{subtitle}</span>

            {isBusy && (
              <span className="launch-btn__meta">
                <Spinner />
                <span>
                  {boot.phase === "booting"
                    ? t("launch.launchProgress")
                    : boot.attempts === 0
                      ? t("launch.healthPending")
                      : t("launch.healthChecks", {
                          count: boot.attempts,
                          checks:
                            boot.attempts === 1
                              ? t("launch.checkSingular")
                              : t("launch.checkPlural")
                        })}
                </span>
              </span>
            )}
          </span>

          <span className="launch-btn__right">{right}</span>
        </span>
      </button>

      {isBusy && (
        <button type="button" className="btn launch-cancel" onClick={onCancel}>
          {t("common.stop")}
        </button>
      )}
    </div>
  );
}
