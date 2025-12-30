import { PropsWithChildren } from "react";
import { Navigate } from "react-router-dom";
import { useAppSelector } from "../store/hooks";

export const AdminRouteGuard = ({ children }: PropsWithChildren) => {
  const { isAdmin, adminChecked } = useAppSelector((state) => state.auth);

  if (!adminChecked) {
    return null;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
