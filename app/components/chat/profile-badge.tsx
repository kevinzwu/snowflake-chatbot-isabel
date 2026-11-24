"use client";

import { User } from "lucide-react";

interface ProfileBadgeProps {
  profileName: string;
  /** Whether the profile has already been injected in this conversation */
  alreadyInjected: boolean;
}

/**
 * Shows an indicator when a profile is active and will be applied to the next message.
 * Hidden after the profile has been injected (first message or after a switch).
 */
export function ProfileBadge({
  profileName,
  alreadyInjected,
}: ProfileBadgeProps) {
  if (alreadyInjected) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mx-auto text-xs text-muted-foreground bg-accent/5 border border-accent/20 rounded-md">
      <User className="h-3.5 w-3.5 text-accent" />
      <span>
        Profile &ldquo;{profileName}&rdquo; will be applied to your next message
      </span>
    </div>
  );
}
