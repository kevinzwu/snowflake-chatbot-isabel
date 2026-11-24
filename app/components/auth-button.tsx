import { Button } from "@/app/components/ui/button";
import { LogOut, User } from "lucide-react";
import { signIn, signOut, useSession } from "next-auth/react";
import Image from "next/image";

export function AuthButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2">
        <div className="animate-pulse h-8 w-8 bg-muted rounded-full"></div>
        <div className="animate-pulse h-4 w-16 bg-muted rounded-md hidden sm:block"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <Button
        onClick={() => signIn()}
        variant="default"
        size="sm"
        className="gap-2"
      >
        <User className="h-4 w-4" />
        <span>Sign In</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* User info - expanded to fit longer names */}
      <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-muted/50">
        {session.user.image ? (
          <Image
            src={session.user.image}
            alt={session.user.name || "User"}
            width={32}
            height={32}
            className="h-8 w-8 rounded-full ring-2 ring-background shrink-0"
          />
        ) : (
          <div className="h-8 w-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-accent" />
          </div>
        )}
        <div className="hidden sm:flex flex-col min-w-0">
          <span className="text-sm font-medium leading-none truncate max-w-[200px]">
            {session.user.name}
          </span>
          <span className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate max-w-[200px]">
            {session.user.email}
          </span>
        </div>
      </div>

      {/* Sign out button - minimal */}
      <Button
        onClick={() => signOut()}
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        title="Sign Out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
