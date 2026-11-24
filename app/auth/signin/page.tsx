"use client";

import { Button } from "@/app/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import type { ClientSafeProvider } from "next-auth/react";
import { getProviders, signIn } from "next-auth/react";
import { useEffect, useState } from "react";

export default function SignInPage() {
  const [providers, setProviders] = useState<Record<
    string,
    ClientSafeProvider
  > | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchProviders = async () => {
      const res = await getProviders();
      setProviders(res);
    };
    fetchProviders();
  }, []);

  const handleSignIn = async (providerId: string) => {
    setIsLoading(true);
    await signIn(providerId, { callbackUrl: "/" });
  };

  if (!providers) {
    return (
      <div className="flex flex-col min-h-dvh bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="animate-pulse h-8 w-32 bg-muted rounded-lg"></div>
          <div className="animate-pulse h-8 w-24 bg-muted rounded-lg"></div>
        </div>
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="h-12 w-12 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-muted-foreground text-sm">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {/* Minimal header to match main app */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/80 backdrop-blur-sm">
        <h1 className="text-lg font-semibold">Isabel</h1>
        <div className="text-sm text-muted-foreground">Sign In</div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4">
        <motion.div
          key="signin"
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="flex flex-col items-center gap-8 text-center">
            {/* Logo/Icon - matching overview.tsx style */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-accent/80 text-accent-foreground shadow-lg"
            >
              <Sparkles className="h-8 w-8" />
            </motion.div>

            {/* Heading */}
            <div className="space-y-2">
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold tracking-tight"
              >
                Welcome to Isabel
              </motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-muted-foreground"
              >
                Your AI-powered security vulnerability management assistant
              </motion.p>
            </div>

            {/* Sign In Button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="w-full max-w-sm space-y-4"
            >
              {Object.values(providers).map((provider: ClientSafeProvider) => (
                <Button
                  key={provider.name}
                  onClick={() => handleSignIn(provider.id)}
                  disabled={isLoading}
                  size="lg"
                  className="w-full h-12 font-medium rounded-xl transition-all duration-200 gap-2"
                >
                  {isLoading ? (
                    <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <span>
                        {provider.id === "dev-login" ? "Dev Login" : "Sign in"}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
