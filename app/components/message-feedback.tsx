"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useAppConfig } from "./app-config-provider";
import { ThumbDownIcon, ThumbUpIcon } from "./icons";

export interface MessageFeedbackProps {
  messageId?: string;
  database: string;
  schema: string;
  agentName: string;
  authToken: string | null;
}

type FeedbackState = "idle" | "positive" | "negative";

export function MessageFeedback({
  messageId,
  database,
  schema,
  agentName,
  authToken,
}: MessageFeedbackProps) {
  const { snowflakeUrl } = useAppConfig();
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFeedbackClick = async (positive: boolean) => {
    const newState = positive ? "positive" : "negative";

    // If clicking the same button again, toggle off
    if (feedbackState === newState) {
      setFeedbackState("idle");
      setFeedbackText("");
      return;
    }

    setFeedbackState(newState);
  };

  const handleSubmitFeedback = async () => {
    if (!authToken) {
      toast.error("Not authenticated");
      return;
    }

    if (feedbackState === "idle") {
      return;
    }

    setIsSubmitting(true);

    try {
      // Call Snowflake Feedback API directly from client to avoid DNS issues
      const feedbackUrl = `${snowflakeUrl}/api/v2/databases/${database}/schemas/${schema}/agents/${agentName}:feedback`;

      const feedbackBody: Record<string, unknown> = {
        positive: feedbackState === "positive",
      };

      if (messageId) {
        feedbackBody.orig_request_id = messageId;
      }
      if (feedbackText) {
        feedbackBody.feedback_message = feedbackText;
        feedbackBody.categories = [
          feedbackState === "positive"
            ? "Something worked well"
            : "Something needs improvement",
        ];
      }

      const response = await fetch(feedbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
          "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        },
        body: JSON.stringify(feedbackBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      toast.success("Thank you for your feedback!");

      // Keep the selection but clear the text
      setFeedbackText("");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to submit feedback",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2" data-pdf-exclude="true">
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleFeedbackClick(true)}
          disabled={isSubmitting}
          className={`p-2 rounded-md transition-colors ${
            feedbackState === "positive"
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          aria-label="Good response"
          title="Good response"
        >
          <ThumbUpIcon size={16} />
        </button>
        <button
          onClick={() => handleFeedbackClick(false)}
          disabled={isSubmitting}
          className={`p-2 rounded-md transition-colors ${
            feedbackState === "negative"
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          aria-label="Bad response"
          title="Bad response"
        >
          <ThumbDownIcon size={16} />
        </button>
        {feedbackState !== "idle" && (
          <span className="text-sm text-gray-600">
            {feedbackState === "positive"
              ? "Thanks! Want to share more?"
              : "Sorry to hear that. What went wrong?"}
          </span>
        )}
      </div>

      {feedbackState !== "idle" && (
        <div className="flex flex-col gap-2 animate-in slide-in-from-top-2 duration-200">
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={
              feedbackState === "positive"
                ? "What did you like about this response? (optional)"
                : "What could be improved? (optional)"
            }
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            disabled={isSubmitting}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSubmitFeedback}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </button>
            <button
              onClick={() => {
                setFeedbackState("idle");
                setFeedbackText("");
              }}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
