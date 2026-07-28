import { useCallback, useEffect, useState } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

const getFullscreenElement = () => {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

export const useFullscreen = (target?: HTMLElement | null) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const element = (target ?? document.documentElement) as FullscreenElement;
    setIsSupported(
      Boolean(element.requestFullscreen || element.webkitRequestFullscreen),
    );
  }, [target]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleChange = () => {
      setIsFullscreen(Boolean(getFullscreenElement()));
    };
    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    handleChange();
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
    };
  }, []);

  const enter = useCallback(async () => {
    const element = (target ?? document.documentElement) as FullscreenElement;
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
      await element.webkitRequestFullscreen();
    }
  }, [target]);

  const exit = useCallback(async () => {
    const doc = document as FullscreenDocument;
    if (doc.exitFullscreen) {
      await doc.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
    }
  }, []);

  const toggle = useCallback(async () => {
    if (getFullscreenElement()) {
      await exit();
    } else {
      await enter();
    }
  }, [enter, exit]);

  return {
    isFullscreen,
    isSupported,
    enter,
    exit,
    toggle,
  };
};
