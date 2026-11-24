# Isabel Feedback Mechanism

This document describes the feedback mechanism implemented for Isabel, allowing users to provide feedback on assistant responses using Snowflake's Cortex Agents Feedback API.

## Overview

The feedback mechanism consists of:

- **Thumbs up/down buttons** that appear at the end of each assistant message when the agent is idle
- **Optional feedback text** that users can provide when they click a feedback button
- **Integration with Snowflake Cortex Agents Feedback API** to store and track feedback

## Architecture

### Components

#### 1. `MessageFeedback` Component (`app/components/message-feedback.tsx`)

A reusable React component that displays the feedback UI and handles user interactions.

**Features:**

- Thumbs up/down buttons with hover states
- Collapsible textarea for detailed feedback
- Submit/Cancel buttons
- Loading states during submission
- Success/error toast notifications
- DRY principle: Single component handles both positive and negative feedback

**Props:**

```typescript
interface MessageFeedbackProps {
  messageId?: string; // Snowflake request ID (optional)
  database: string; // Database name
  schema: string; // Schema name
  agentName: string; // Agent name
  authToken: string | null; // JWT token for authentication
}
```

#### 2. Feedback API Route (`app/api/feedback/route.ts`)

Server-side API endpoint that proxies feedback requests to Snowflake.

**Endpoint:** `POST /api/feedback`

**Request Body:**

```typescript
{
  database: string;
  schema: string;
  agentName: string;
  origRequestId?: string;    // Optional Snowflake request ID
  positive: boolean;
  feedbackMessage?: string;
  categories?: string[];
  threadId?: number;
}
```

**Response:**

```json
{
  "status": "Feedback submitted successfully"
}
```

#### 3. Type Definitions (`lib/agent-api/types.ts`)

Extended the `AgentMessage` interface to include optional `requestId` field:

```typescript
export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  requestId?: string; // For Snowflake feedback API
  content: [...];
}
```

## User Flow

1. **User receives assistant response** - Message is rendered with content
2. **Agent state becomes IDLE** - Feedback buttons appear
3. **User clicks thumbs up or down** - Feedback form expands with textarea
4. **User optionally enters details** - Explains what worked well or needs improvement
5. **User clicks Submit** - Feedback is sent to Snowflake
6. **Success confirmation** - Toast notification appears, form remains with selection visible

## Integration Points

### Message Component (`app/components/message.tsx`)

- Imports `MessageFeedback` component
- Renders feedback UI only for assistant messages in IDLE state
- Passes authentication token and agent configuration

### Messages Component (`app/components/messages.tsx`)

- Receives feedback props from parent
- Passes them through to individual `PreviewMessage` components

### Page Component (`app/page.tsx`)

- Provides JWT token from `useAccessToken` hook
- Passes agent configuration (database, schema, agentName)
- Maintains agent configuration in single `agentConfig` object (DRY)

## Security Considerations

1. **Authentication**: All feedback requests require valid JWT token
2. **Server-side proxy**: Feedback API route validates requests before forwarding to Snowflake
3. **Error handling**: Comprehensive error handling with user-friendly messages
4. **Input validation**: Required fields validated on both client and server

## Snowflake Integration

The feedback is sent to Snowflake's Cortex Agents Feedback API:

**Endpoint:**

```
POST /api/v2/databases/{database}/schemas/{schema}/agents/{agentName}:feedback
```

**Headers:**

```
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

**Payload:**

```json
{
  "orig_request_id": "optional-snowflake-request-id",
  "positive": true,
  "feedback_message": "User's detailed feedback",
  "categories": ["Something worked well"]
}
```

## Future Enhancements

1. **Request ID Tracking**: Currently `requestId` is optional. Future implementation should capture the `X-Snowflake-Request-ID` header from agent responses.

2. **Feedback Categories**: Expand category options based on feedback type:

   - Positive: "Accurate", "Helpful", "Fast", "Well-formatted"
   - Negative: "Inaccurate", "Incomplete", "Slow", "Hard to understand"

3. **Analytics Dashboard**: View aggregated feedback data to improve agent performance

4. **Thread Support**: Implement thread IDs for multi-turn conversation feedback

5. **Keyboard Shortcuts**: Add hotkeys for quick feedback (e.g., Cmd+Shift+Up for positive)

## Development Guidelines

### Adding Feedback to New Message Types

To add feedback to new message types, ensure:

1. Message has `role === AgentMessageRole.ASSISTANT`
2. Component receives required props (authToken, database, schema, agentName)
3. Feedback only shows when `agentState === AgentApiState.IDLE`

### Styling Customization

Feedback component uses Tailwind classes. Key classes:

- Button states: `bg-green-100`, `bg-red-100` for active states
- Animations: `animate-in slide-in-from-top-2 duration-200`
- Form controls: Standard Next.js input styling

### Testing Checklist

- [ ] Feedback buttons appear after assistant message completes
- [ ] Clicking thumbs up shows positive feedback form
- [ ] Clicking thumbs down shows negative feedback form
- [ ] Clicking same button twice toggles off
- [ ] Submit sends data to Snowflake successfully
- [ ] Cancel button clears form
- [ ] Toast notifications appear on success/error
- [ ] Loading states prevent double-submission

## Troubleshooting

### Feedback buttons don't appear

- Check `agentState === AgentApiState.IDLE`
- Verify all required props are passed (authToken, database, schema, agentName)
- Ensure message role is `ASSISTANT`

### "Not authenticated" error

- Verify JWT token is valid
- Check token isn't expired
- Ensure `Authorization` header is properly formatted

### Feedback submission fails

- Check Snowflake URL configuration in `.env.local`
- Verify database/schema/agent name are correct
- Review browser console and server logs for detailed errors

## References

- [Snowflake Cortex Agents Feedback API Documentation](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-agents-feedback-rest-api)
- [React Best Practices](https://react.dev/learn/thinking-in-react)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
