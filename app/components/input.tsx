"use client";

import cx from "classnames";
import { AlertCircle, CheckCircle, Loader2, Paperclip, X } from "lucide-react";
import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWindowSize } from "usehooks-ts";

import { extractTextFromImage } from "@/lib/agent-api/functions/extractTextFromImage";
import type { ModelChoice } from "@/lib/agent-api/models";
import type { FileAttachmentMeta } from "@/lib/agent-api/types";
import {
  containsDangerousContent,
  validateChatInput,
} from "@/lib/security/input-sanitizer";
import { ArrowUpIcon, StopIcon } from "./icons";
import { ModelSelector } from "./model-selector";
import { SuggestedActions } from "./suggested-actions";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".csv",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
];
const EXTENSION_TO_FORMAT: Record<string, "pdf" | "csv" | "docx" | "image"> = {
  ".pdf": "pdf",
  ".csv": "csv",
  ".docx": "docx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
};
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIZE = 3.75 * 1024 * 1024; // 3.75 MB (Claude vision limit)
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_FILES = 3;
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30 MB

type FileAttachmentStatus = "uploading" | "success" | "error";

interface FileAttachment {
  file: File;
  status: FileAttachmentStatus;
  extractedText?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

function getFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
}

function validateFileClient(file: File): string | null {
  const ext = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return "Unsupported file type. Accepted: PDF, CSV, DOCX, PNG, JPG, WEBP";
  }
  const isImage = IMAGE_EXTENSIONS.includes(ext);
  const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
  if (file.size > sizeLimit) {
    return isImage
      ? "Image exceeds 3.75 MB limit (required for vision extraction)"
      : "File exceeds 10 MB limit";
  }
  if (file.size === 0) {
    return "File is empty";
  }
  return null;
}

/**
 * Compress an image file using Canvas API when it exceeds the vision size limit.
 * Resizes to 2048px max dimension and converts to JPEG at quality 0.85.
 */
async function compressImageIfNeeded(file: File): Promise<File> {
  const ext = getFileExtension(file.name);
  if (!IMAGE_EXTENSIONS.includes(ext) || file.size <= MAX_IMAGE_SIZE) {
    return file;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const maxDim = 2048;
      let { width, height } = img;

      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to compress image"));
            return;
          }
          const compressedName = file.name.replace(/\.[^.]+$/, ".jpg");
          resolve(new File([blob], compressedName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = url;
  });
}

export const ChatInput = ({
  isLoading,
  messagesLength,
  handleSubmit,
  handleStop,
  selectedModel,
  onSelectModel,
  availableModels,
  suggestedQueries,
  authToken,
  snowflakeUrl,
  className,
  profileSelector,
}: {
  isLoading: boolean;
  messagesLength: number;
  handleSubmit: (input: string, attachments?: FileAttachmentMeta[]) => void;
  handleStop?: () => void;
  selectedModel?: ModelChoice;
  onSelectModel?: (model: ModelChoice) => void;
  availableModels?: ModelChoice[];
  suggestedQueries?: string[];
  authToken?: string | null;
  snowflakeUrl?: string;
  className?: string;
  profileSelector?: React.ReactNode;
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { width } = useWindowSize();

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  };

  const resetHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const uploadFile = useCallback(
    async (file: File) => {
      // Compress oversized images before validation
      let processedFile = file;
      const ext = getFileExtension(file.name);
      const isImage = IMAGE_EXTENSIONS.includes(ext);
      if (isImage && file.size > MAX_IMAGE_SIZE) {
        try {
          processedFile = await compressImageIfNeeded(file);
        } catch {
          toast.error("Failed to compress image");
          return;
        }
      }

      const error = validateFileClient(processedFile);
      if (error) {
        toast.error(error);
        return;
      }

      const newAttachment: FileAttachment = { file, status: "uploading" };
      setAttachments((prev) => [...prev, newAttachment]);

      try {
        let extractedText: string;
        let metadata: Record<string, unknown>;

        if (isImage && authToken && snowflakeUrl) {
          // Client-side extraction: call Snowflake Chat Completions directly
          // Uses same PrivateLink path as Agent API — stays in-network
          const result = await extractTextFromImage(
            processedFile,
            authToken,
            snowflakeUrl,
          );
          extractedText = result.text;
          metadata = {
            filename: processedFile.name,
            characters: result.characters,
            format: "image",
            type: "image",
          };
        } else {
          // Server-side extraction: PDF, CSV, DOCX (need parsing libraries)
          const formData = new FormData();
          formData.append("file", processedFile);

          const response = await fetch("/api/v1/extract-text", {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const body = await response
              .json()
              .catch(() => ({ error: "Upload failed" }));
            setAttachments((prev) =>
              prev.map((a) =>
                a.file === file
                  ? {
                      ...a,
                      status: "error" as const,
                      error: body.error || "Upload failed",
                    }
                  : a,
              ),
            );
            toast.error(body.error || "Failed to process file");
            return;
          }

          const result = await response.json();
          extractedText = result.text;
          metadata = result.metadata;
        }

        if (!extractedText) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.file === file
                ? {
                    ...a,
                    status: "error" as const,
                    error: "No extractable text found in file",
                  }
                : a,
            ),
          );
          toast.error("No extractable text found in file");
          return;
        }

        setAttachments((prev) =>
          prev.map((a) =>
            a.file === file
              ? {
                  ...a,
                  status: "success" as const,
                  extractedText,
                  metadata,
                }
              : a,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error";
        setAttachments((prev) =>
          prev.map((a) =>
            a.file === file
              ? { ...a, status: "error" as const, error: message }
              : a,
          ),
        );
        toast.error(message);
      }
    },
    [authToken, snowflakeUrl],
  );

  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);

      // Enforce max file count
      const totalAfter = attachments.length + fileArray.length;
      if (totalAfter > MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files per message`);
        return;
      }

      // Enforce total size budget
      const currentTotalSize = attachments.reduce(
        (sum, a) => sum + a.file.size,
        0,
      );
      const newTotalSize = fileArray.reduce((sum, f) => sum + f.size, 0);
      if (currentTotalSize + newTotalSize > MAX_TOTAL_SIZE) {
        toast.error("Total file size exceeds 30 MB limit");
        return;
      }

      // Upload each file independently
      for (const file of fileArray) {
        uploadFile(file);
      }
    },
    [uploadFile, attachments],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const submitForm = useCallback(() => {
    if (!textareaRef.current) return;

    const rawInput = textareaRef.current.value;

    // Must have text input or successful file attachments
    const successfulFiles = attachments.filter(
      (a) => a.status === "success" && a.extractedText,
    );
    if (!rawInput.trim() && successfulFiles.length === 0) return;

    // Validate and sanitize text input
    let finalInput = "";

    if (rawInput.trim()) {
      const validation = validateChatInput(rawInput);
      if (!validation.isValid) {
        toast.error(validation.error || "Invalid input");
        return;
      }
      if (containsDangerousContent(rawInput)) {
        console.warn(
          "[Security] Potentially dangerous content detected in user input and sanitized",
        );
      }
      finalInput = validation.sanitizedInput;
    }

    if (!finalInput.trim() && successfulFiles.length === 0) return;

    // Build structured attachment metadata for the agent hook
    const attachmentMetas: FileAttachmentMeta[] | undefined =
      successfulFiles.length > 0
        ? successfulFiles.map((a) => {
            const meta = a.metadata || {};
            const serverFormat = meta.format as string | undefined;
            const validFormats = ["pdf", "csv", "docx", "image"];
            let format: "pdf" | "csv" | "docx" | "image";
            if (serverFormat && validFormats.includes(serverFormat)) {
              format = serverFormat as "pdf" | "csv" | "docx" | "image";
            } else {
              const ext = getFileExtension(a.file.name);
              format = EXTENSION_TO_FORMAT[ext] ?? "pdf";
            }
            return {
              filename: (meta.filename as string) || a.file.name,
              format,
              ...(meta.pages !== undefined && { pages: meta.pages as number }),
              ...(meta.rows !== undefined && { rows: meta.rows as number }),
              ...(meta.columns !== undefined && {
                columns: meta.columns as number,
              }),
              characters: (meta.characters as number) || 0,
              extractedText: a.extractedText!,
            };
          })
        : undefined;

    handleSubmit(finalInput, attachmentMetas);
    textareaRef.current.value = "";
    setInputValue("");
    setAttachments([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    resetHeight();

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [handleSubmit, width, attachments]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItems.length === 0) return;

      // Prevent default paste behavior for images
      e.preventDefault();

      // Collect paste files to enforce limits (same as handleFileSelect)
      const pasteFiles: File[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          const ext =
            file.type === "image/png"
              ? ".png"
              : file.type === "image/webp"
                ? ".webp"
                : ".jpg";
          pasteFiles.push(
            new File([file], `screenshot-${Date.now()}${ext}`, {
              type: file.type,
            }),
          );
        }
      }

      if (pasteFiles.length === 0) return;

      // Enforce max file count
      const totalAfter = attachments.length + pasteFiles.length;
      if (totalAfter > MAX_FILES) {
        toast.error(`Maximum ${MAX_FILES} files per message`);
        return;
      }

      // Enforce total size budget
      const currentTotalSize = attachments.reduce(
        (sum, a) => sum + a.file.size,
        0,
      );
      const newTotalSize = pasteFiles.reduce((sum, f) => sum + f.size, 0);
      if (currentTotalSize + newTotalSize > MAX_TOTAL_SIZE) {
        toast.error("Total file size exceeds 30 MB limit");
        return;
      }

      for (const file of pasteFiles) {
        uploadFile(file);
      }
    },
    [uploadFile, attachments],
  );

  const allFilesReady =
    attachments.length === 0 ||
    attachments.every((a) => a.status === "success");
  const anyUploading = attachments.some((a) => a.status === "uploading");
  const hasInput =
    (inputValue.length > 0 ||
      attachments.some((a) => a.status === "success" && !!a.extractedText)) &&
    allFilesReady;

  return (
    <div className="relative w-full flex flex-col gap-4">
      {messagesLength === 0 && (
        <SuggestedActions
          handleSubmit={handleSubmit}
          queries={suggestedQueries}
        />
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={
          ALLOWED_EXTENSIONS.join(",") + "," + ALLOWED_MIME_TYPES.join(",")
        }
        multiple
        onChange={(e) => handleFileSelect(e.target.files)}
        data-testid="file-input"
      />

      {/* Sleek floating input container */}
      <div
        className={cx(
          "relative rounded-2xl border bg-background shadow-sm hover:shadow-md transition-shadow focus-within:shadow-md focus-within:border-accent/50",
          isDragging
            ? "border-accent border-dashed bg-accent/5"
            : "border-border",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-accent/10 pointer-events-none">
            <p className="text-sm font-medium text-accent">
              Drop file here (PDF, CSV, DOCX)
            </p>
          </div>
        )}

        {/* File attachment badges */}
        {attachments.length > 0 && (
          <div className="px-4 pt-3 pb-1 flex flex-wrap gap-2">
            {attachments.map((att, index) => (
              <div
                key={`${att.file.name}-${index}`}
                className={cx(
                  "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
                  att.status === "uploading" &&
                    "bg-muted text-muted-foreground",
                  att.status === "success" &&
                    "bg-green-500/10 text-green-700 dark:text-green-400",
                  att.status === "error" &&
                    "bg-red-500/10 text-red-700 dark:text-red-400",
                )}
              >
                {att.status === "uploading" && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {att.status === "success" && (
                  <CheckCircle className="h-3 w-3" />
                )}
                {att.status === "error" && <AlertCircle className="h-3 w-3" />}
                <span className="truncate max-w-[200px]">{att.file.name}</span>
                <button
                  onClick={() => removeAttachment(index)}
                  className="ml-1 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  title="Remove file"
                  data-testid="remove-attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Textarea
          ref={textareaRef}
          placeholder="Ask Isabel anything..."
          className={cx(
            "min-h-[80px] max-h-[calc(75dvh)] overflow-hidden resize-none !text-base",
            "bg-transparent border-0 rounded-t-2xl px-4 py-4",
            "placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0",
            className,
          )}
          rows={2}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();

              if (isLoading) {
                // Stop generation and allow re-submit
                handleStop?.();
              } else {
                submitForm();
              }
            }
          }}
          onChange={(e) => {
            setInputValue(e.target.value);
            adjustHeight();
          }}
          onPaste={handlePaste}
        />

        {/* Toolbar row — action buttons below the textarea */}
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            {/* File attachment button */}
            <Button
              className="h-10 w-10 rounded-xl bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200"
              onClick={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
              disabled={
                isLoading || anyUploading || attachments.length >= MAX_FILES
              }
              size="icon"
              title="Attach file (PDF, CSV, DOCX)"
              data-testid="attach-file-button"
            >
              <Paperclip className="h-4 w-4" />
            </Button>

            {/* Model selector */}
            {onSelectModel && selectedModel && (
              <ModelSelector
                selectedModel={selectedModel}
                onSelectModel={onSelectModel}
                models={availableModels}
              />
            )}

            {/* Profile selector */}
            {profileSelector}
          </div>

          <SendButton
            input={hasInput ? "has-content" : ""}
            submitForm={submitForm}
            isLoading={isLoading}
            handleStop={handleStop}
          />
        </div>
      </div>

      {/* Subtle help text */}
      <p className="text-center text-xs text-muted-foreground">
        Press{" "}
        <kbd className="px-1.5 py-0.5 text-[10px] font-medium bg-muted text-foreground/80 rounded border">
          Enter
        </kbd>{" "}
        to send,{" "}
        <kbd className="px-1.5 py-0.5 text-[10px] font-medium bg-muted text-foreground/80 rounded border">
          Shift + Enter
        </kbd>{" "}
        for new line
      </p>
    </div>
  );
};

function PureSendButton({
  submitForm,
  input,
  isLoading,
  handleStop,
}: {
  submitForm: () => void;
  input: string;
  isLoading?: boolean;
  handleStop?: () => void;
}) {
  const hasInput = input.length > 0;

  // When loading, show a stop button
  if (isLoading) {
    return (
      <Button
        className="h-10 w-10 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-all duration-200"
        onClick={(event) => {
          event.preventDefault();
          handleStop?.();
        }}
        size="icon"
        title="Stop generating"
      >
        <StopIcon size={16} />
      </Button>
    );
  }

  return (
    <Button
      className={cx(
        "h-10 w-10 rounded-xl transition-all duration-200",
        hasInput
          ? "bg-accent text-accent-foreground hover:bg-accent/90 scale-100"
          : "bg-muted text-muted-foreground scale-95 opacity-60",
      )}
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={!hasInput}
      size="icon"
      aria-label="Send message"
    >
      <ArrowUpIcon size={16} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.input !== nextProps.input) return false;
  if (prevProps.isLoading !== nextProps.isLoading) return false;
  return true;
});
