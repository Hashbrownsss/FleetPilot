import os
import time
import json
import requests
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.anomaly import Anomaly
from app.models.audit import AuditLog
from app.routes.auth import verify_any_role
import app.ml
from app.ml import metrics_lock, anomalies_list, metrics_history

router = APIRouter(tags=["metrics"])

@router.get("/api/metrics/live")
def get_live_metrics(current_user = Depends(verify_any_role)):
    """Returns live metrics enriched with hourly baseline expected values."""
    with metrics_lock:
        history = list(metrics_history[-60:])
        
    if not history or app.ml.detector is None:
        return history
        
    enriched = []
    for s in history:
        try:
            _, _, _, _, means = app.ml.detector.perform_rca(s)
            s_copy = dict(s)
            s_copy["expected"] = means
            enriched.append(s_copy)
        except Exception as e:
            enriched.append(s)
    return enriched

@router.get("/api/alerts/ml")
def get_ml_anomalies(db: Session = Depends(get_db), current_user = Depends(verify_any_role)):
    """Retrieve dynamic anomalies from Isolation Forest enriched with config rollout correlations."""
    anoms = db.query(Anomaly).order_by(Anomaly.timestamp.desc()).limit(100).all()
    
    enriched_anoms = []
    for anom in anoms:
        anom_copy = {
            "id": anom.id,
            "timestamp": anom.timestamp,
            "metric": anom.metric,
            "value": anom.value,
            "expected": anom.expected,
            "anomaly_type": anom.anomaly_type,
            "severity": anom.severity,
            "z_score": anom.z_score,
            "description": anom.description,
            "tally_count": anom.tally_count
        }
        anom_time = anom.timestamp
        
        # Look for DEPLOY_CONFIG, ROLLBACK_CONFIG, or RESTART_AGENT in audit logs in a [-10min, +2min] window
        window_start = anom_time - 600
        window_end = anom_time + 120
        
        correlated_event = db.query(AuditLog).filter(
            AuditLog.timestamp >= window_start,
            AuditLog.timestamp <= window_end,
            AuditLog.action.in_(["DEPLOY_CONFIG", "ROLLBACK_CONFIG", "RESTART_AGENT"])
        ).order_by(AuditLog.timestamp.desc()).first()
        
        if correlated_event:
            time_diff = int(anom_time - correlated_event.timestamp)
            anom_copy["correlated_event"] = {
                "action": correlated_event.action,
                "target": correlated_event.target,
                "author": correlated_event.username,
                "details": correlated_event.details,
                "time_diff_seconds": time_diff,
                "time_diff_minutes": round(abs(time_diff) / 60, 1)
            }
        else:
            anom_copy["correlated_event"] = None
            
        enriched_anoms.append(anom_copy)
        
    return enriched_anoms

@router.get("/api/alerts/deterministic")
def get_deterministic_alerts(current_user = Depends(verify_any_role)):
    """Fetch active Prometheus Alertmanager alerts (deterministic Netcool)."""
    try:
        url = "http://localhost:9093/api/v2/alerts"
        response = requests.get(url, timeout=1.5)
        if response.status_code == 200:
            return response.json()
        return []
    except Exception as e:
        return []

@router.get("/api/alerts/correlated")
def get_correlated_alerts(current_user = Depends(verify_any_role)):
    """
    Correlates rule-based Alertmanager alerts with preceding multi-variate ML driver anomalies.
    """
    try:
        deterministic_response = requests.get("http://localhost:9093/api/v2/alerts", timeout=1.5)
        deterministic_alerts = deterministic_response.json() if deterministic_response.status_code == 200 else []
    except Exception as e:
        deterministic_alerts = []

    with metrics_lock:
        ml_anomalies = list(anomalies_list)

    correlations = []

    def parse_iso(ts_str):
        try:
            clean_str = ts_str.split('.')[0].replace('Z', '')
            return time.mktime(time.strptime(clean_str, "%Y-%m-%dT%H:%M:%S"))
        except:
            return time.time()

    for alert in deterministic_alerts:
        alert_name = alert.get("labels", {}).get("alertname", "UnknownAlert")
        starts_at_str = alert.get("startsAt", "")
        alert_time = parse_iso(starts_at_str)
        severity = alert.get("labels", {}).get("severity", "warning")
        
        correlated_anomalies = []
        
        # Check alerts within 180 seconds preceding window
        for anomaly in ml_anomalies:
            time_diff = alert_time - anomaly["timestamp"]
            if -30 <= time_diff <= 180:
                correlated_anomalies.append((anomaly, time_diff))

        if correlated_anomalies:
            correlated_anomalies.sort(key=lambda item: abs(item[1]))
            primary_anomaly, t_diff = correlated_anomalies[0]
            metric = primary_anomaly["metric"]
            score = primary_anomaly["z_score"]
            
            # Map metrics to human readable labels
            labels = {
                "cpu": "CPU Saturation",
                "memory": "Memory Exhaustion",
                "disk_read": "Disk Read Spikes",
                "disk_write": "Disk Write Spikes",
                "net_recv": "Network Traffic Flood",
                "net_sent": "Network Traffic Flood",
                "processes": "Process Exhaustion"
            }
            cause = labels.get(metric, "Resource Contention")
            
            explanation = (
                f"Legacy Alert '{alert_name}' correlated with unsupervised ML Anomaly "
                f"detected {int(t_diff)}s prior. The ML engine identified that '{metric}' "
                f"was the primary driver deviating by {score:.1f} standard deviations from "
                f"the historical hourly baseline. Description: {primary_anomaly['description']}"
            )
            confidence = 80.0 + min(18.0, score * 1.5)
        else:
            confidence = 45.0
            cause = "Independent Limit Breach"
            explanation = (
                f"Deterministic alert '{alert_name}' triggered without matching ML metric anomaly patterns "
                f"in the preceding window. This indicates a static threshold breach without wider system correlation."
            )

        correlations.append({
            "alert_name": alert_name,
            "severity": severity,
            "possible_cause": cause,
            "correlation_score": confidence,
            "explanation": explanation,
            "timestamp": alert_time
        })

    correlations.sort(key=lambda c: (c["correlation_score"], c["timestamp"]), reverse=True)
    return correlations

@router.get("/api/opamp/incidents")
def get_servicenow_incidents(current_user = Depends(verify_any_role)):
    incidents_file = "servicenow_incidents.json"
    if not os.path.exists(incidents_file):
        return []
    try:
        with open(incidents_file, "r") as f:
            return json.load(f)
    except:
        return []
