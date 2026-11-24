"use client";

import type { UserProfile } from "@/lib/dynamodb/types";
import { ChevronDown, User, X } from "lucide-react";
import * as React from "react";

interface ProfileSelectorProps {
  profiles: UserProfile[];
  activeProfileId: string | null;
  onSelectProfile: (profileId: string | null) => void;
  onManageProfiles: () => void;
}

export function ProfileSelector({
  profiles,
  activeProfileId,
  onSelectProfile,
  onManageProfiles,
}: ProfileSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const activeProfile = profiles.find((p) => p.profileId === activeProfileId);

  // Close on outside click
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
          activeProfile
            ? "border-accent/50 bg-accent/10 text-foreground"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
        title={
          activeProfile
            ? `Active profile: ${activeProfile.name}`
            : "No profile active"
        }
      >
        <User className="h-3.5 w-3.5" />
        <span className="max-w-[120px] truncate">
          {activeProfile?.name ?? "No Profile"}
        </span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-56 rounded-md border border-border bg-popover shadow-md">
          <div className="p-1">
            {/* No Profile option */}
            <button
              type="button"
              onClick={() => {
                onSelectProfile(null);
                setOpen(false);
              }}
              className={`w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-muted ${
                !activeProfileId ? "bg-muted font-medium" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
                No Profile
              </span>
            </button>

            {profiles.length > 0 && (
              <div className="my-1 border-t border-border" />
            )}

            {/* User profiles */}
            {profiles.map((profile) => (
              <button
                key={profile.profileId}
                type="button"
                onClick={() => {
                  onSelectProfile(profile.profileId);
                  setOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-muted ${
                  activeProfileId === profile.profileId
                    ? "bg-muted font-medium"
                    : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{profile.name}</span>
                  {profile.isDefault && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      ★
                    </span>
                  )}
                </span>
              </button>
            ))}

            <div className="my-1 border-t border-border" />

            {/* Manage action */}
            <button
              type="button"
              onClick={() => {
                onManageProfiles();
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-muted text-muted-foreground"
            >
              ⚙ Manage Profiles...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
