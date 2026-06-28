import time
import json
import uuid
from kafka import KafkaConsumer
from app.config import settings
from app.database import SessionLocal
from app.models.anomaly import Anomaly

def run_alerts_consumer_loop():
    print("Backend Alerts Consumer: Starting listener for ml-alerts topic...")
    try:
        consumer = KafkaConsumer(
            'ml-alerts',
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS.split(","),
            group_id="aiops-backend-alerts-group",
            auto_offset_reset='latest',
            value_deserializer=lambda x: json.loads(x.decode('utf-8'))
        )
        print("Backend Alerts Consumer: Successfully connected to ml-alerts.")
    except Exception as e:
        print(f"Backend Alerts Consumer: Kafka connection failed: {e}")
        return

    # Keep track of timestamps for sliding-window evaluation
    # metric_name -> list of float timestamps of raw occurrences in last 120 seconds
    metric_timestamps = {}

    try:
        for message in consumer:
            alert = message.value
            metric = alert.get("metric")
            now = alert.get("timestamp", time.time())

            if not metric:
                continue

            # Update rolling 120s timestamps for the specific metric
            if metric not in metric_timestamps:
                metric_timestamps[metric] = []
            metric_timestamps[metric].append(now)
            metric_timestamps[metric] = [t for t in metric_timestamps[metric] if now - t <= 120]

            # Escalation rule: triggers >= 10 in 120 seconds
            escalate = len(metric_timestamps[metric]) >= 10

            db = SessionLocal()
            try:
                # Find an active alert for the same metric within 30 seconds
                active_alert = db.query(Anomaly).filter(
                    Anomaly.metric == metric,
                    now - Anomaly.timestamp <= 30
                ).first()

                if active_alert:
                    # Deduplicate & tally
                    active_alert.tally_count += 1
                    active_alert.timestamp = now
                    active_alert.value = alert.get("value")
                    active_alert.expected = alert.get("expected")
                    active_alert.z_score = alert.get("z_score")
                    active_alert.description = alert.get("description")
                    if escalate or alert.get("severity") == "critical":
                        active_alert.severity = "critical"
                    db.commit()
                    print(f"Backend Alerts Consumer: Tallied anomaly card for {metric} (tally={active_alert.tally_count})")
                else:
                    # Instantiate a new card
                    new_card = Anomaly(
                        id=str(uuid.uuid4()),
                        timestamp=now,
                        metric=metric,
                        value=alert.get("value"),
                        expected=alert.get("expected"),
                        anomaly_type=alert.get("anomaly_type"),
                        severity="critical" if (escalate or alert.get("severity") == "critical") else "warning",
                        z_score=alert.get("z_score"),
                        description=alert.get("description"),
                        tally_count=1
                    )
                    db.add(new_card)
                    db.commit()
                    print(f"Backend Alerts Consumer: Created new anomaly card for {metric}.")
            except Exception as db_err:
                print(f"Backend Alerts Consumer DB Error: {db_err}")
                db.rollback()
            finally:
                db.close()

    except Exception as e:
        print(f"Backend Alerts Consumer: Loop crashed: {e}")
    finally:
        consumer.close()
