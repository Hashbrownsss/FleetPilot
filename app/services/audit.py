import time
from sqlalchemy.orm import Session
from app.models.audit import AuditLog

def log_audit(db: Session, username: str, action: str, target: str = "", details: str = "", ip_address: str = ""):
    try:
        log_entry = AuditLog(
            timestamp=time.time(),
            username=username,
            action=action,
            target=target,
            details=details,
            ip_address=ip_address
        )
        db.add(log_entry)
        db.commit()
    except Exception as e:
        print(f"Audit Log Error: Failed to write audit: {e}")
