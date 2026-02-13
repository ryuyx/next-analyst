# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Next Analyst** is an AI-powered data analysis assistant that enables users to upload data files, execute Python code in isolated sandboxes, and interact with an intelligent assistant. The system uses a human-in-the-loop (HITL) pattern where dangerous operations (code execution) require user approval before running.

## Common Commands

```bash
# Development
npm run dev              # Start dev server on http://localhost:3000

# Production
npm run build            # Build for production
npm start                # Start production server

# Linting
npm run lint             # Run ESLint
```

## Architecture Overview

### High-Level Flow

```
Frontend (React/Next.js)
  ↓ HTTP/SSE
Backend API Routes (Next.js)
  ├─ /api/chat (POST)           → Streams LLM responses via SSE
  ├─ /api/chat/execute (POST)   → Executes Python in E2B sandbox
  └─ /api/chat/preview (POST)   → Generates file previews
  ↓
LangGraph Agent (Qwen3-coder LLM)
  ├─ Safe tools (auto-execute)
  │  ├─ confirm_action
  │  ├─ search_knowledge
  │  └─ calculate
  └─ HITL tool (requires approval)
     └─ execute_python → E2B Sandbox
```

### Key Components

**Frontend:**
- `app/page.tsx` - Main chat interface
- `app/components/ChatMessages.tsx` - Message rendering with markdown/math
- `app/components/ChatInput.tsx` - Input + file upload
- `app/components/CodeResultCard.tsx` - Code approval UI
- `app/hooks/useChat.ts` - Chat state management

**Backend:**
- `app/api/chat/route.ts` - Main chat endpoint with streaming
- `app/api/chat/agent.ts` - LangGraph agent definition + tool implementations
- `app/api/chat/execute/route.ts` - Python code execution in E2B
- `app/api/chat/preview/route.ts` - File preview generation

### Data Flow

1. User uploads file → `/api/chat/preview` generates rich metadata (shape, dtypes, head, describe)
2. User sends message → `/api/chat` runs LangGraph agent with streaming
3. Agent decides tool usage:
   - Safe tools auto-execute and loop back to agent
   - `execute_python` emits `pending_tool_call` event to client
4. User approves code → `/api/chat/execute` runs in E2B sandbox
5. Results returned to agent for follow-up analysis

### File Context Management

- **Session files**: Persist across multiple messages in a conversation
- **Pending files**: Attached to current message only
- **Generated files**: Created by code execution, auto-available for next execution
- File previews include: shape, dtypes, head, describe, null_counts

### Tool Design

- **confirm_action**: User confirmation for important operations
- **search_knowledge**: Knowledge base search (MVP)
- **calculate**: Safe mathematical expressions
- **execute_python**: Full Python code execution (HITL - requires approval)

### Important Implementation Details

**Streaming:**
- Uses Server-Sent Events (SSE) for real-time token streaming
- Client accumulates text deltas and tool calls during streaming
- Supports partial message updates

**Sandbox Isolation:**
- Each code execution gets a fresh E2B sandbox
- Files uploaded to `/home/user/` directory
- Generated files auto-detected and returned
- Prevents state leakage between executions

**Message Parts:**
- Messages can contain multiple "parts": text + tool calls
- Supports interleaved text and tool results
- Enables rich UI rendering of mixed content

**Error Handling:**
- Graceful fallbacks for file preview failures
- Sandbox cleanup in finally blocks
- File size limits: 5MB per file, 20MB total
- Deduplication of matplotlib results

## Key Dependencies

- **Next.js 16.1.6** - React framework with App Router
- **LangGraph 1.1.4** - Agent orchestration (state graph)
- **LangChain 1.2.21** - LLM framework
- **E2B Code Interpreter 2.3.3** - Isolated Python sandbox
- **React Markdown** - Markdown rendering with GFM, LaTeX math, syntax highlighting
- **Tailwind CSS 4** - Styling

## Environment Variables

Required for operation:
- `OPENAI_API_KEY` - For LLM access (Qwen3-coder via OpenAI SDK)
- `E2B_API_KEY` - For E2B sandbox access

## Development Notes

- The agent uses conditional routing in LangGraph to handle HITL tool calls
- Safe tools loop back to the agent; HITL tools stop the graph for client approval
- File previews are generated using pandas in E2B sandbox for consistency
- Math rendering uses KaTeX; code highlighting uses Highlight.js
- The system deduplicates matplotlib figures to prevent duplicate images in responses
