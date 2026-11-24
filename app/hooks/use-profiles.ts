"use client";

import type { UserProfile } from "@/lib/dynamodb/types";
import { useSession } from "next-auth/react";
import * as React from "react";
import { toast } from "sonner";
import useSWR from "swr";

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const error = new Error("Failed to fetch") as Error & { status: number };
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return res.json();
};

/**
 * Hook for managing user profiles with SWR.
 */
export function useProfiles() {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";

  const { data, error, isLoading, mutate } = useSWR<{
    profiles: UserProfile[];
  }>(isAuthenticated ? "/api/profiles" : null, fetcher, {
    revalidateOnFocus: false,
  });

  const profiles = data?.profiles ?? [];
  const defaultProfile = profiles.find((p) => p.isDefault) ?? null;

  const createProfile = React.useCallback(
    async (input: {
      name: string;
      content: string;
      isDefault?: boolean;
    }): Promise<UserProfile | null> => {
      try {
        const res = await fetch("/api/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
        });

        if (!res.ok) {
          const err = await res.json();
          toast.error(err.message || "Failed to create profile");
          return null;
        }

        const profile = await res.json();
        await mutate();
        toast.success(`Profile "${input.name}" created`);
        return profile;
      } catch {
        toast.error("Failed to create profile");
        return null;
      }
    },
    [mutate],
  );

  const updateProfile = React.useCallback(
    async (
      profileId: string,
      input: { name?: string; content?: string; isDefault?: boolean },
    ): Promise<UserProfile | null> => {
      try {
        const res = await fetch(`/api/profiles/${profileId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
        });

        if (!res.ok) {
          const err = await res.json();
          toast.error(err.message || "Failed to update profile");
          return null;
        }

        const profile = await res.json();
        await mutate();
        return profile;
      } catch {
        toast.error("Failed to update profile");
        return null;
      }
    },
    [mutate],
  );

  const deleteProfile = React.useCallback(
    async (profileId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/profiles/${profileId}`, {
          method: "DELETE",
          credentials: "include",
        });

        if (!res.ok) {
          toast.error("Failed to delete profile");
          return false;
        }

        await mutate();
        toast.success("Profile deleted");
        return true;
      } catch {
        toast.error("Failed to delete profile");
        return false;
      }
    },
    [mutate],
  );

  const shareProfile = React.useCallback(
    async (profileId: string, shared: boolean): Promise<string | null> => {
      try {
        const res = await fetch(`/api/profiles/${profileId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ shared }),
        });

        if (!res.ok) {
          toast.error("Failed to toggle sharing");
          return null;
        }

        const data = await res.json();
        await mutate();

        if (shared) {
          toast.success("Profile sharing enabled");
          return data.shareToken;
        } else {
          toast.success("Profile unshared");
          return null;
        }
      } catch {
        toast.error("Failed to toggle sharing");
        return null;
      }
    },
    [mutate],
  );

  const forkProfile = React.useCallback(
    async (shareToken: string): Promise<UserProfile | null> => {
      try {
        const res = await fetch(`/api/profiles/shared/${shareToken}/fork`, {
          method: "POST",
          credentials: "include",
        });

        if (!res.ok) {
          const err = await res.json();
          toast.error(err.message || "Failed to fork profile");
          return null;
        }

        const profile = await res.json();
        await mutate();
        toast.success(`Profile "${profile.name}" added to your collection`);
        return profile;
      } catch {
        toast.error("Failed to fork profile");
        return null;
      }
    },
    [mutate],
  );

  return {
    profiles,
    defaultProfile,
    isLoading,
    error,
    createProfile,
    updateProfile,
    deleteProfile,
    shareProfile,
    forkProfile,
    mutate,
  };
}
