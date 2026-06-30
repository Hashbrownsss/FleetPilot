from langgraph.checkpoint.sqlite import SqliteSaver
import sqlite3
import os
from app.config import Settings

def get_checkpointer():
    db_path = Settings.AGENT_CHECKPOINT_DB
    # Ensure directory exists if path contains directories
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    return SqliteSaver(conn)
