import threading

# Global Thread-Safe ML telemetry state caches
metrics_lock = threading.RLock()
metrics_history = []          # List of aggregated dict metrics
full_baseline_history = []    # Full history for model retraining
anomalies_list = []           # Dynamic tallied anomalies list
detector = None               # Isolation Forest detector instance
