import { createContext } from "react";

export const VariableContext = createContext("root");
/** Inherited inline variable values (VariableContextProvider) */
export const VariableValuesContext = createContext<Record<string, any> | null>(
  null,
);
export const ContainerContext = createContext("root");
