import { Citation } from "@/lib/agent-api";
import { extractRelevantCitations } from "@/lib/agent-api/functions/chat/extractRelevantCitations";
import { CitationDialog } from "./citation-dialog";

export interface ChatCitationsComponentProps {
  citations: Citation[];
  agentApiText: string;
}

export function ChatCitationsComponent(props: ChatCitationsComponentProps) {
  const { citations, agentApiText } = props;
  const relevantCitationsOnly = extractRelevantCitations(
    agentApiText,
    citations,
  );

  return (
    <div className="flex flex-row gap-4" data-pdf-exclude="true">
      {relevantCitationsOnly.map((citation: Citation) => (
        <CitationDialog
          key={citation.text}
          citationsNumber={citation.number}
          citation={citation.text}
        />
      ))}
    </div>
  );
}
