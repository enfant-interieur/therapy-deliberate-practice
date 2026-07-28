import { describe, expect, it } from "vitest";
import { gatewayBootActivityMessage, isReadyGatewayHealth } from "./useGatewayBoot";
import { translate } from "../i18n";

describe("gateway health contract", () => {
  it("accepts only the exact public gateway identity and ready state", () => {
    expect(
      isReadyGatewayHealth({
        service: "therapy-local-runtime",
        protocol_version: "1",
        status: "ready"
      })
    ).toBe(true);
  });

  it.each([
    null,
    {},
    { service: "therapy-local-runtime", protocol: 1, status: "ready" },
    { service: "therapy-local-runtime", protocol_version: 1, status: "ready" },
    { service: "different-service", protocol_version: "1", status: "ready" },
    { service: "therapy-local-runtime", protocol_version: "1", status: "starting" }
  ])("rejects a drifted or unready payload: %j", (payload) => {
    expect(isReadyGatewayHealth(payload)).toBe(false);
  });
});

describe("gateway startup feedback", () => {
  it("reports measured phase and health attempts without timeout-percentage claims", () => {
    expect(
      gatewayBootActivityMessage({
        phase: "booting",
        runId: 1,
        attempts: 0,
        startedAtMs: 1
      })
    ).toBe("Starting the gateway process…");
    expect(
      gatewayBootActivityMessage({
        phase: "polling",
        runId: 1,
        attempts: 3,
        startedAtMs: 1,
        lastReadiness: "starting"
      })
    ).toBe("Gateway reported “starting”; checking again…");
  });

  it("reports the same measured state in French", () => {
    expect(
      gatewayBootActivityMessage(
        {
          phase: "polling",
          runId: 1,
          attempts: 3,
          startedAtMs: 1,
          lastReadiness: "starting"
        },
        (key, values) => translate("fr", key, values)
      )
    ).toBe("La passerelle indique « starting » ; nouvelle vérification…");
  });
});
