import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";
import { describeDoctorCheck } from "./doctor";
import {
  flattenResourceKeys,
  flattenResourceValues,
  LOCALE_STORAGE_KEY,
  resolveInitialLocale,
  translate
} from "./index";

describe("desktop locale resources", () => {
  it("have recursive English and French key parity", () => {
    expect(flattenResourceKeys(fr).sort()).toEqual(flattenResourceKeys(en).sort());
  });

  it("uses identical interpolation placeholders for every English and French key", () => {
    const english = flattenResourceValues(en);
    const french = flattenResourceValues(fr);
    const placeholders = (value: string) =>
      [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();

    for (const key of Object.keys(english)) {
      expect(placeholders(french[key]), key).toEqual(placeholders(english[key]));
    }
  });

  it("interpolates values without translating technical identifiers", () => {
    expect(translate("fr", "model.platform", { platform: "darwin-arm64" })).toBe(
      "Plateforme : darwin-arm64"
    );
  });

  it("fails closed instead of exposing an unresolved placeholder", () => {
    expect(() => translate("fr", "model.platform")).toThrow(
      "Missing interpolation value platform"
    );
  });

  it("restores a persisted locale before consulting browser preferences", () => {
    const storage = {
      getItem: (key: string) => (key === LOCALE_STORAGE_KEY ? "en" : null)
    };
    expect(resolveInitialLocale(storage, ["fr-CH"])).toBe("en");
    expect(resolveInitialLocale({ getItem: () => null }, ["fr-CH"])).toBe("fr");
  });

  it("falls back to browser preferences when locale storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new DOMException("Storage disabled", "SecurityError");
      }
    };
    expect(resolveInitialLocale(unavailableStorage, ["fr-CH"])).toBe("fr");
  });

  it("uses deliberately long French copy for layout-stress surfaces", () => {
    expect(fr.hero.subtitle.length).toBeGreaterThan(en.hero.subtitle.length);
    expect(fr.wizard.choose.length).toBeGreaterThan(en.wizard.choose.length);
    expect(fr.connection.metadataOnly.length).toBeGreaterThan(en.connection.metadataOnly.length);
  });

  it("localizes Doctor presentation while preserving technical values", () => {
    const french = (key: string, values?: Record<string, string | number>) =>
      translate("fr", key, values);
    expect(
      describeDoctorCheck(
        {
          code: "port_availability",
          status: "error",
          port: 8484,
          gateway_status: "foreign"
        },
        french
      )
    ).toEqual({
      title: "Disponibilité du port",
      details: "Le port 8484 est déjà utilisé par un autre processus.",
      fix: "Choisissez un autre port dans l’application ou arrêtez le processus qui utilise celui-ci."
    });
    expect(
      describeDoctorCheck(
        {
          code: "local_runtime_import",
          status: "ok",
          details: "/opt/runtime/local_runtime/__init__.py"
        },
        french
      ).details
    ).toContain("/opt/runtime/local_runtime/__init__.py");
  });

  it.each([
    [
      "gateway_configuration",
      { status: "error", details: "missing config" },
      "Gateway configuration"
    ],
    [
      "python_executable",
      { status: "error", details: "python missing" },
      "Python executable"
    ],
    [
      "local_runtime_import",
      { status: "error", details: "module missing" },
      "local_runtime import"
    ],
    [
      "gateway_sidecar_binary",
      { status: "error", details: "/missing/sidecar" },
      "Gateway sidecar binary"
    ],
    [
      "gateway_sidecar_permissions",
      { status: "error", details: "/non-executable/sidecar" },
      "Gateway sidecar permissions"
    ],
    [
      "port_availability",
      { status: "error", port: 8484, gateway_status: "foreign" },
      "Port availability"
    ],
    [
      "gateway_health",
      { status: "error", details: "HTTP 503", gateway_status: "running" },
      "Gateway health"
    ]
  ] as const)(
    "maps the native Doctor category %s to recoverable presentation",
    (code, check, title) => {
      const view = describeDoctorCheck(
        { code, ...check },
        (key, values) => translate("en", key, values)
      );

      expect(view.title).toBe(title);
      expect(view.details).not.toBe("");
      expect(view.fix).not.toBe("");
    }
  );
});
