import { getAppConfig } from "@/lib/config/app-config";
import { ChatPage } from "./chat-page";
import { AppConfigProvider } from "./components/app-config-provider";

// Config is read per request from the runtime environment, never at build time
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <AppConfigProvider config={getAppConfig()}>
      <ChatPage />
    </AppConfigProvider>
  );
}
