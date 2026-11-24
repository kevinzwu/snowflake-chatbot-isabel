"use client";

import { saveQueryStandalone } from "@/app/hooks/use-saved-queries";
import { cn } from "@/lib/utils";
import { Bookmark, Check, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input-field";

export interface ChatTextComponentProps {
  text: string;
  role: string;
}

export function ChatTextComponent(props: ChatTextComponentProps) {
  const { text, role } = props;
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isSaved, setIsSaved] = React.useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name for the query");
      return;
    }

    setIsSaving(true);
    try {
      await saveQueryStandalone(
        name.trim(),
        text,
        description.trim() || undefined,
      );
      toast.success("Query saved successfully");
      setIsSaved(true);
      setIsDialogOpen(false);
      setName("");
      setDescription("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save query",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-row gap-2 items-start group/text">
      <div
        className={cn("flex flex-col gap-4", {
          "bg-[#f7f7f7] px-4 py-3 rounded-xl": role === "user",
        })}
      >
        <Markdown>{text}</Markdown>
      </div>

      {/* Save button for user messages */}
      {role === "user" && !isSaved && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
              title="Save query"
            >
              <Bookmark className="h-3.5 w-3.5" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Query</DialogTitle>
              <DialogDescription>
                Save this query to quickly run it again later.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id="name"
                  placeholder="e.g., Critical vulnerabilities this month"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="description" className="text-sm font-medium">
                  Description (optional)
                </label>
                <Input
                  id="description"
                  placeholder="What does this query do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                <strong>Query:</strong> {text.slice(0, 100)}
                {text.length > 100 && "..."}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Query"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {role === "user" && isSaved && (
        <div className="h-7 w-7 flex items-center justify-center text-green-600 shrink-0">
          <Check className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
}
