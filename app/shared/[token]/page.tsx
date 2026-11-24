"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function SharedConversationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const { status } = useSession({ required: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function forkSharedConversation() {
      try {
        const { token } = await params;

        // 1. Fetch the shared conversation
        const shareResponse = await fetch(`/api/shared/${token}`, {
          signal: controller.signal,
        });
        if (!shareResponse.ok) {
          if (shareResponse.status === 404) {
            setError(
              "This shared conversation was not found or has been revoked.",
            );
          } else if (shareResponse.status === 401) {
            setError("Please sign in to view this shared conversation.");
          } else {
            setError("Failed to load shared conversation.");
          }
          return;
        }
        const data = await shareResponse.json();

        // 2. Create a fork in the viewer's account
        const forkResponse = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.conversation.title,
            messages: data.conversation.messages,
            deepThinking: data.conversation.deepThinking,
            forkedFrom: {
              shareToken: data.shareToken,
              conversationId: data.conversation.conversationId,
              ownerUserId: data.owner.userId,
            },
          }),
          signal: controller.signal,
        });

        if (!forkResponse.ok) {
          setError("Failed to fork conversation.");
          return;
        }

        const forkedConversation = await forkResponse.json();
        toast.success("Shared conversation added to your chats");
        router.replace(`/?c=${forkedConversation.conversationId}`);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Failed to load shared conversation.");
      }
    }

    if (status === "authenticated") {
      forkSharedConversation();
    }

    return () => controller.abort();
  }, [params, status, router]);

  if (status === "loading" || !error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading shared conversation...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center space-y-4">
        <p className="text-muted-foreground">{error}</p>
        <Link
          href="/"
          className="inline-block px-4 py-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          Go to Isabel
        </Link>
      </div>
    </div>
  );
}
