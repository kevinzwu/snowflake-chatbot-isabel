"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

interface ClientSessionProviderProps {
  children: ReactNode;
}

export function ClientSessionProvider({
  children,
}: ClientSessionProviderProps) {
  return <SessionProvider refetchInterval={5 * 60}>{children}</SessionProvider>;
}
