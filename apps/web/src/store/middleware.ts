import type { Middleware } from "@reduxjs/toolkit";

export const requestIdMiddleware: Middleware = () => (next) => (action) => {
  return next(action);
};

export const errorNormalizationMiddleware: Middleware = () => (next) => (action) => {
  return next(action);
};
