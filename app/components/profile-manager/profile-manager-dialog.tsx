"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { PROFILE_LIMITS, type UserProfile } from "@/lib/dynamodb/types";
import { ClipboardPaste, Copy, Plus, Star, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

interface ProfileManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: UserProfile[];
  onCreateProfile: (input: {
    name: string;
    content: string;
    isDefault?: boolean;
  }) => Promise<UserProfile | null>;
  onUpdateProfile: (
    profileId: string,
    input: { name?: string; content?: string; isDefault?: boolean },
  ) => Promise<UserProfile | null>;
  onDeleteProfile: (profileId: string) => Promise<boolean>;
}

const { MAX_CONTENT_LENGTH, MAX_NAME_LENGTH } = PROFILE_LIMITS;

export function ProfileManagerDialog({
  open,
  onOpenChange,
  profiles,
  onCreateProfile,
  onUpdateProfile,
  onDeleteProfile,
}: ProfileManagerDialogProps) {
  const [editingProfile, setEditingProfile] = React.useState<
    UserProfile | "new" | null
  >(null);
  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [isDefault, setIsDefault] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const resetForm = () => {
    setEditingProfile(null);
    setName("");
    setContent("");
    setIsDefault(false);
  };

  const startEditing = (profile: UserProfile) => {
    setEditingProfile(profile);
    setName(profile.name);
    setContent(profile.content);
    setIsDefault(profile.isDefault);
  };

  const startNew = () => {
    setEditingProfile("new");
    setName("");
    setContent("");
    setIsDefault(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);

    try {
      if (editingProfile === "new") {
        await onCreateProfile({
          name: name.trim(),
          content: content.trim(),
          isDefault,
        });
      } else if (editingProfile) {
        await onUpdateProfile(editingProfile.profileId, {
          name: name.trim(),
          content: content.trim(),
          isDefault,
        });
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    const confirmed = window.confirm(
      "Delete this profile? This cannot be undone.",
    );
    if (!confirmed) return;
    await onDeleteProfile(profileId);
    if (
      editingProfile &&
      editingProfile !== "new" &&
      editingProfile.profileId === profileId
    ) {
      resetForm();
    }
  };

  const handleCopyAsJson = (profile: UserProfile) => {
    const json = JSON.stringify(
      { name: profile.name, content: profile.content },
      null,
      2,
    );
    navigator.clipboard.writeText(json);
    toast.success("Profile copied as JSON");
  };

  const handleImportFromClipboard = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast.error("Could not read clipboard. Check browser permissions.");
      return;
    }

    // Guard against oversized payloads before parsing
    if (text.length > MAX_CONTENT_LENGTH * 2) {
      toast.error("Clipboard content is too large to import");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      toast.error(
        'Clipboard does not contain valid JSON. Expected: {"name": "...", "content": "..."}',
      );
      return;
    }

    // Validate it's a plain object (not array, null, or primitive)
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      toast.error(
        'Invalid profile format. Expected: {"name": "...", "content": "..."}',
      );
      return;
    }

    // Reject prototype pollution keys
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (
      keys.includes("__proto__") ||
      keys.includes("constructor") ||
      keys.includes("prototype")
    ) {
      toast.error("Invalid profile JSON: contains disallowed keys");
      return;
    }

    // Validate required fields
    if (!obj.name || typeof obj.name !== "string" || !obj.name.trim()) {
      toast.error('Profile JSON is missing a valid "name" string');
      return;
    }
    if (
      !obj.content ||
      typeof obj.content !== "string" ||
      !obj.content.trim()
    ) {
      toast.error('Profile JSON is missing a valid "content" string');
      return;
    }

    const importName = obj.name.trim().slice(0, MAX_NAME_LENGTH);
    const importContent = obj.content.trim();

    if (importContent.length > MAX_CONTENT_LENGTH) {
      toast.error(
        `Content exceeds ${MAX_CONTENT_LENGTH} character limit (${importContent.length} chars)`,
      );
      return;
    }

    const result = await onCreateProfile({
      name: importName,
      content: importContent,
    });
    if (result) {
      toast.success(`Imported profile "${importName}"`);
    }
  };

  const contentLength = content.length;
  const isOverLimit = contentLength > MAX_CONTENT_LENGTH;
  const isNearLimit = contentLength > MAX_CONTENT_LENGTH * 0.9;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Profiles</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Profile list */}
          {!editingProfile && (
            <>
              <div className="space-y-2">
                {profiles.map((profile) => (
                  <div
                    key={profile.profileId}
                    className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 cursor-pointer"
                    onClick={() => startEditing(profile)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {profile.isDefault && (
                        <Star className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
                      )}
                      <span className="font-medium truncate">
                        {profile.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {profile.content.length} chars
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyAsJson(profile);
                        }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Copy as JSON"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(profile.profileId);
                        }}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={startNew}
                className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                New Profile
              </button>

              <button
                type="button"
                onClick={handleImportFromClipboard}
                className="w-full flex items-center justify-center gap-2 p-3 border border-dashed border-border rounded-md text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <ClipboardPaste className="h-4 w-4" />
                Import from Clipboard
              </button>
            </>
          )}

          {/* Edit/Create form */}
          {editingProfile && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) =>
                    setName(e.target.value.slice(0, MAX_NAME_LENGTH))
                  }
                  placeholder="e.g., Security Team Lead"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  maxLength={MAX_NAME_LENGTH}
                />
                <div className="text-xs text-muted-foreground mt-1 text-right">
                  {name.length} / {MAX_NAME_LENGTH}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Profile Content
                </label>
                <textarea
                  value={content}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_CONTENT_LENGTH) {
                      setContent(e.target.value);
                    }
                  }}
                  placeholder="Enter your prompt preferences... e.g., 'Always focus on the Platform Security team. Use bullet points. Include CVSS scores.'"
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent min-h-[200px] resize-y font-mono"
                  maxLength={MAX_CONTENT_LENGTH}
                />
                <div
                  className={`text-xs mt-1 text-right ${
                    isOverLimit
                      ? "text-destructive"
                      : isNearLimit
                        ? "text-yellow-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {contentLength.toLocaleString()} /{" "}
                  {MAX_CONTENT_LENGTH.toLocaleString()}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="isDefault" className="text-sm">
                  Set as default for new conversations
                </label>
              </div>

              {/* Copy as JSON (only for existing profiles) */}
              {editingProfile !== "new" && (
                <button
                  type="button"
                  onClick={() => handleCopyAsJson(editingProfile)}
                  className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy as JSON
                </button>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={
                    !name.trim() || !content.trim() || isOverLimit || saving
                  }
                  className="px-4 py-2 text-sm bg-accent text-accent-foreground rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving
                    ? "Saving..."
                    : editingProfile === "new"
                      ? "Create"
                      : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
