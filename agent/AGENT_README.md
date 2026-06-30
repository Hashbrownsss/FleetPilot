# FleetPilot Multi-Agent Orchestration

This module powers the AI-driven orchestration engine for OpAMP Fleet Management, built with **LangGraph** and a **Heterogeneous Groq Multi-Agent Workforce**.

## Architecture Overview

We use LangGraph because it models the workflow as a stateful, checkpointable directed graph. This is critical for infrastructure automation as it provides native support for **human-in-the-loop** execution.

Instead of a single LLM bottleneck, the workload is distributed across specialized models to optimize rate limits and capabilities:
1. `orchestrator`: Uses `llama-3.3-70b-versatile` to parse natural language intent (e.g., config generation, fleet assignment, query routing) into a structured JSON execution plan.
2. `fleet_manager`: Creates new fleets via the internal API or assigns agents to existing fleets (via `ASSIGN_AGENTS_TO_FLEET`).
3. `config_builder`: Uses `qwen3-32b` to deterministically generate the appropriate OTel Collector YAML without using LLM hallucinations.
4. `yaml_validator`: Syntactically and structurally validates the YAML against our internal guards.
5. `human_review`: **HALT POINT**. The graph pauses here via `interrupt_before`. Wait for human approval.
6. `rollout_agent`: Pushes the configuration to the target agents.
7. `ack_monitor`: Polls agents to ensure they acknowledge the new config.
8. `summarizer`: Uses `llama-4-scout-17b` to generate a friendly summary of all actions taken.
9. `audit_logger`: Persists the execution trace to the SQLite audit database.
10. `query_node`: Dynamically converts time strings to Unix epochs to execute flawless chronological audit trail searches.

## How the Human-in-the-Loop Works

The core LangGraph definition sets `interrupt_before=["human_review"]`. When execution reaches this edge, LangGraph freezes the entire `AgentState` into an SQLite blob (`agent_checkpoints.db`) under a unique `session_id`.

The API returns `202 Accepted` to the frontend, which renders the exact YAML preview and targets for the user to review.

When the user clicks **Approve**, the frontend makes a POST request to `/api/agent/confirm/{session_id}`. The graph is rehydrated from SQLite and resumes execution right where it left off, moving into the `rollout_agent` node.

## API Endpoints

- `POST /api/agent/chat` - Start an agent thread.
- `POST /api/agent/confirm/{session_id}` - Resume a paused thread.
- `GET /api/agent/status/{session_id}` - Stream live execution logs and status.

## Testing Locally (cURL)

**1. Obtain an Auth Token**
First, login via the UI or generate a token programmatically.

**2. Start a Chat Session**
```bash
curl -X POST http://localhost:8000/api/agent/chat \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a new fleet called my-test-fleet and push a host metrics config to agent-01."}'
```
Response will return a `session_id` and a `status` of `"awaiting_human"`.

**3. Resume the Session (Approve)**
```bash
curl -X POST http://localhost:8000/api/agent/confirm/<SESSION_ID> \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"decision": "approved"}'
```
Response will return `status: "completed"` and a natural language summary.
