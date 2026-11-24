"use client";

import type { AppConfig } from "@/lib/config/app-config";
import { createContext, useContext, type ReactNode } from "react";

const AppConfigContext = createContext<AppConfig | null>(null);

export function AppConfigProvider({
  config,
  children,
}: {
  config: AppConfig;
  children: ReactNode;
}) {
  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) {
    throw new Error("useAppConfig must be used inside <AppConfigProvider>");
  }
  return config;
}
