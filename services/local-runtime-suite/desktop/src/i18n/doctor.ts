import type { Translator } from "./index";

export type DoctorCheck = {
  code: string;
  status: string;
  details?: string | null;
  port?: number;
  gateway_status?: string;
};

export type DoctorCheckView = {
  title: string;
  details: string;
  fix?: string;
};

export const describeDoctorCheck = (
  check: DoctorCheck,
  t: Translator
): DoctorCheckView => {
  const details = check.details || t("doctor.noTechnicalDetail");
  switch (check.code) {
    case "gateway_configuration":
      return {
        title: t("doctor.gatewayConfiguration.title"),
        details: t("doctor.gatewayConfiguration.error", { details }),
        fix: t("doctor.gatewayConfiguration.fix")
      };
    case "python_executable":
      return {
        title: t("doctor.pythonExecutable.title"),
        details:
          check.status === "ok"
            ? check.details
              ? t("doctor.pythonExecutable.okVersion", { version: check.details })
              : t("doctor.pythonExecutable.ok")
            : t("doctor.pythonExecutable.error", { details }),
        fix:
          check.status === "ok"
            ? undefined
            : t("doctor.pythonExecutable.fix")
      };
    case "local_runtime_import":
      return {
        title: t("doctor.localRuntimeImport.title"),
        details:
          check.status === "ok"
            ? t("doctor.localRuntimeImport.ok", { path: details })
            : t("doctor.localRuntimeImport.error", { details }),
        fix:
          check.status === "ok"
            ? undefined
            : t("doctor.localRuntimeImport.fix")
      };
    case "gateway_sidecar_binary":
      return {
        title: t("doctor.gatewaySidecarBinary.title"),
        details:
          check.status === "ok"
            ? t("doctor.gatewaySidecarBinary.ok", { path: details })
            : t("doctor.gatewaySidecarBinary.error"),
        fix:
          check.status === "ok"
            ? undefined
            : t("doctor.gatewaySidecarBinary.fix")
      };
    case "gateway_sidecar_permissions":
      return {
        title: t("doctor.gatewaySidecarPermissions.title"),
        details: t("doctor.gatewaySidecarPermissions.error", { path: details }),
        fix: t("doctor.gatewaySidecarPermissions.fix")
      };
    case "port_availability": {
      const port = check.port ?? "—";
      if (check.gateway_status === "free") {
        return {
          title: t("doctor.portAvailability.title"),
          details: t("doctor.portAvailability.free", { port })
        };
      }
      if (check.gateway_status === "running") {
        return {
          title: t("doctor.portAvailability.title"),
          details: t("doctor.portAvailability.running", { port })
        };
      }
      if (check.gateway_status === "starting") {
        return {
          title: t("doctor.portAvailability.title"),
          details: t("doctor.portAvailability.starting", { port }),
          fix: t("doctor.portAvailability.wait")
        };
      }
      return {
        title: t("doctor.portAvailability.title"),
        details: t("doctor.portAvailability.inUse", { port }),
        fix: t("doctor.portAvailability.fix")
      };
    }
    case "gateway_health":
      if (check.status === "ok") {
        return {
          title: t("doctor.gatewayHealth.title"),
          details: t("doctor.gatewayHealth.ok", { details })
        };
      }
      if (check.gateway_status === "running") {
        return {
          title: t("doctor.gatewayHealth.title"),
          details: t("doctor.gatewayHealth.error", { details }),
          fix: t("doctor.gatewayHealth.inspectLogs")
        };
      }
      if (check.gateway_status === "starting") {
        return {
          title: t("doctor.gatewayHealth.title"),
          details: t("doctor.gatewayHealth.starting"),
          fix: t("doctor.gatewayHealth.wait")
        };
      }
      return {
        title: t("doctor.gatewayHealth.title"),
        details: t("doctor.gatewayHealth.stopped"),
        fix: t("doctor.gatewayHealth.start")
      };
    default:
      return {
        title: t("doctor.unknown.title", { code: check.code }),
        details
      };
  }
};
