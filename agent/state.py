from typing import TypedDict, Annotated, Optional, List, Dict, Any
import operator

class AgentState(TypedDict):
    # Input
    user_message: str                          # The raw natural language query
    user_id: str                               # Authenticated user making the request
    session_id: str                            # Unique session for this execution thread

    # Parsed intent (filled by orchestrator node)
    parsed_intent: Optional[Dict[str, Any]]    # Structured extraction of what the user wants

    # Execution artifacts (filled as graph progresses)
    fleet_id: Optional[str]                    # Created fleet's database ID
    fleet_name: Optional[str]                  # Fleet name string
    generated_yaml: Optional[str]              # Raw YAML string from config builder
    config_version: Optional[str]              # e.g. "v1.0.0"
    config_id: Optional[str]                   # Stored config's database ID
    validation_result: Optional[Dict]          # {valid: bool, errors: list, warnings: list}
    rollout_results: Annotated[List[Dict], operator.add]  # Per-agent push results
    ack_results: Annotated[List[Dict], operator.add]      # Per-agent acknowledgment results

    # Human-in-the-loop
    human_review_payload: Optional[Dict]       # What gets sent to frontend for confirmation
    human_decision: Optional[str]             # "approved" | "rejected" | "pending"
    human_feedback: Optional[str]             # Optional note from user on rejection

    # Execution tracking
    execution_log: Annotated[List[str], operator.add]   # Append-only step log
    current_node: Optional[str]                          # Which node is active
    error: Optional[str]                                 # If something failed
    status: str                                          # "running" | "awaiting_human" | "completed" | "failed" | "aborted"

    # Output
    final_summary: Optional[str]               # Natural language summary for the user
    audit_event_id: Optional[str]              # SQLite audit log entry ID
