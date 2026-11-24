"use client";

import { User } from "lucide-react";

interface ProfileSwitchDividerProps {
  profileName: string | null;
}

/**
 * Visual divider shown in the conversation timeline when a profile switch occurs.
 */
export function ProfileSwitchDivider({
  profileName,
}: ProfileSwitchDividerProps) {
  return (
    <div className="flex items-center gap-2 py-2 px-4">
      <div className="flex-1 border-t border-border/50" />
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <User className="h-3 w-3" />
        {profileName
          ? `Switched to "${profileName}" profile`
          : "Profile cleared"}
      </span>
      <div className="flex-1 border-t border-border/50" />
    </div>
  );
}
