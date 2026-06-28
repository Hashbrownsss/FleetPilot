from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.audit import AuditLog
from app.routes.auth import verify_any_role

router = APIRouter(prefix="/api/audit", tags=["audit"])

@router.get("")
def get_audit_logs(
    username: str = None,
    action: str = None,
    target: str = None,
    limit: int = Query(default=100, lte=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user = Depends(verify_any_role)
):
    query = db.query(AuditLog)
    
    if username:
        query = query.filter(AuditLog.username == username)
    if action:
        query = query.filter(AuditLog.action == action)
    if target:
        query = query.filter(AuditLog.target.like(f"%{target}%"))
        
    total = query.count()
    logs = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()
    
    result = []
    for log in logs:
        result.append({
            "id": log.id,
            "timestamp": log.timestamp,
            "username": log.username,
            "action": log.action,
            "target": log.target,
            "details": log.details,
            "ip_address": log.ip_address
        })
        
    return {
        "logs": result,
        "total": total,
        "limit": limit,
        "offset": offset
    }
