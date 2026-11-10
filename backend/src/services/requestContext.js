import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage();

export const runWithRequestContext = (context, callback) =>
  requestContextStorage.run({ ...context }, callback);

export const updateRequestContext = (context) => {
  const current = requestContextStorage.getStore();
  if (current) Object.assign(current, context);
  return current;
};

export const getRequestContext = () => requestContextStorage.getStore() || {};
