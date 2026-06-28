// Global chart references
let cpuChart, memChart;
const CHART_LIMIT = 40;

// Initialize telemetry graphs using Chart.js
function initCharts() {
    const chartOptions = (color) => ({
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                grid: { display: false },
                ticks: { display: false }
            },
            y: {
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: '#64748b', font: { family: 'Outfit', size: 10 } }
            }
        },
        plugins: {
            legend: { display: false }
        },
        elements: {
            point: { radius: 0 },
            line: { tension: 0.3 }
        }
    });

    // CPU Chart
    const ctxCpu = document.getElementById('cpuChart').getContext('2d');
    cpuChart = new Chart(ctxCpu, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#a78bfa',
                borderWidth: 2,
                backgroundColor: 'rgba(139, 92, 246, 0.05)',
                fill: true
            }]
        },
        options: chartOptions('#a78bfa')
    });

    // Memory Chart
    const ctxMem = document.getElementById('memChart').getContext('2d');
    memChart = new Chart(ctxMem, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                data: [],
                borderColor: '#6366f1',
                borderWidth: 2,
                backgroundColor: 'rgba(99, 102, 241, 0.05)',
                fill: true
            }]
        },
        options: chartOptions('#6366f1')
    });
}

// Format Unix timestamps to readable time string
function formatTime(unixSeconds) {
    if (!unixSeconds) return '--:--:--';
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

// Fetch and render metrics
async function pollMetrics() {
    try {
        const response = await fetch('/api/metrics/live');
        const data = await response.json();
        if (data && data.length > 0) {
            // Get latest values
            const latest = data[data.length - 1];
            document.getElementById('cpu-current').innerText = latest.cpu ? latest.cpu.toFixed(2) : '0.00';
            document.getElementById('mem-current').innerText = latest.memory ? latest.memory.toFixed(1) + '%' : '0.0%';
            
            // Map values for charts
            const labels = data.map(item => formatTime(item.timestamp));
            const cpuData = data.map(item => item.cpu || 0.0);
            const memData = data.map(item => item.memory || 0.0);
            
            // Update CPU Chart
            cpuChart.data.labels = labels;
            cpuChart.data.datasets[0].data = cpuData;
            cpuChart.update('none'); // Update without animation for performance
            
            // Update Memory Chart
            memChart.data.labels = labels;
            memChart.data.datasets[0].data = memData;
            memChart.update('none');
            
            // Update OTel and Kafka flow indicators if we are receiving data
            document.getElementById('flow-otel').classList.add('active');
            document.getElementById('flow-kafka').classList.add('active');
        } else {
            document.getElementById('flow-otel').classList.remove('active');
            document.getElementById('flow-kafka').classList.remove('active');
        }
    } catch (error) {
        console.error('Error fetching live metrics:', error);
        document.getElementById('flow-otel').classList.remove('active');
        document.getElementById('flow-kafka').classList.remove('active');
    }
}

// Fetch and render deterministic (rule-based Netcool) alerts
async function pollDeterministicAlerts() {
    try {
        const response = await fetch('/api/alerts/deterministic');
        const alerts = await response.json();
        
        const countBadge = document.getElementById('netcool-count');
        const feed = document.getElementById('netcool-feed');
        
        if (alerts && alerts.length > 0) {
            countBadge.innerText = `${alerts.length} Active`;
            countBadge.className = 'badge red-bg';
            
            let html = '';
            alerts.forEach(alert => {
                const alertName = alert.labels?.alertname || 'MetricAlert';
                const severity = alert.labels?.severity || 'warning';
                const desc = alert.annotations?.description || alert.annotations?.summary || 'Metric threshold exceeded.';
                const startsAt = alert.startsAt ? new Date(alert.startsAt).toLocaleTimeString() : '';
                
                html += `
                    <div class="alert-item severity-${severity}">
                        <div class="alert-item-header">
                            <span class="alert-title text-red"><i class="fa-solid fa-triangle-exclamation"></i> ${alertName}</span>
                            <span class="alert-time">${startsAt}</span>
                        </div>
                        <p class="alert-desc">${desc}</p>
                        <div class="alert-meta">
                            <span><i class="fa-solid fa-circle-exclamation"></i> Severity: ${severity}</span>
                            <span><i class="fa-solid fa-server"></i> Netcool Node</span>
                        </div>
                    </div>
                `;
            });
            feed.innerHTML = html;
        } else {
            countBadge.innerText = '0 Active';
            countBadge.className = 'badge';
            feed.innerHTML = `
                <div class="feed-placeholder">
                    <i class="fa-solid fa-circle-check placeholder-icon green"></i>
                    <p>No rule violations active in Alertmanager.</p>
                </div>
            `;
        }
        return alerts || [];
    } catch (error) {
        console.error('Error polling Alertmanager alerts:', error);
        return [];
    }
}

// Fetch and render dynamic ML anomalies
async function pollMLAnomalies() {
    try {
        const response = await fetch('/api/alerts/ml');
        const anomalies = await response.json();
        
        const countBadge = document.getElementById('ml-count');
        const feed = document.getElementById('ml-feed');
        
        if (anomalies && anomalies.length > 0) {
            countBadge.innerText = `${anomalies.length} Detected`;
            countBadge.className = 'badge violet-bg';
            
            // Render last 5 anomalies (reversed to show latest first)
            let html = '';
            const recentAnomalies = anomalies.slice(-5).reverse();
            recentAnomalies.forEach(anom => {
                html += `
                    <div class="alert-item severity-${anom.severity}">
                        <div class="alert-item-header">
                            <span class="alert-title"><i class="fa-solid fa-bolt"></i> ${anom.anomaly_type}</span>
                            <span class="alert-time">${formatTime(anom.timestamp)}</span>
                        </div>
                        <p class="alert-desc">${anom.description}</p>
                        <div class="alert-meta">
                            <span><i class="fa-solid fa-brain"></i> Score: ${anom.z_score.toFixed(1)}</span>
                            <span><i class="fa-solid fa-network-wired"></i> AIOps Pipeline</span>
                        </div>
                    </div>
                `;
            });
            feed.innerHTML = html;
            
            document.getElementById('flow-aiops').classList.add('active');
        } else {
            countBadge.innerText = '0 Detected';
            countBadge.className = 'badge';
            feed.innerHTML = `
                <div class="feed-placeholder">
                    <i class="fa-solid fa-circle-nodes placeholder-icon violet"></i>
                    <p>No dynamic anomalies detected. Collecting baseline telemetry...</p>
                </div>
            `;
            document.getElementById('flow-aiops').classList.remove('active');
        }
        return anomalies || [];
    } catch (error) {
        console.error('Error polling ML anomalies:', error);
        return [];
    }
}

// Fetch and render correlated root cause alerts
async function pollCorrelationConsole() {
    try {
        const response = await fetch('/api/alerts/correlated');
        const correlations = await response.json();
        
        const consoleEl = document.getElementById('rca-console');
        const rcaStatus = document.getElementById('rca-status');
        
        if (correlations && correlations.length > 0) {
            rcaStatus.innerText = 'Correlated Alert Active';
            rcaStatus.className = 'badge gold-bg';
            
            // Render latest correlation result
            const topCorr = correlations[0];
            consoleEl.innerHTML = `
                <div class="rca-result">
                    <div class="rca-title-row">
                        <span class="rca-alert-name"><i class="fa-solid fa-triangle-exclamation"></i> ${topCorr.alert_name}</span>
                        <div class="rca-score-container">
                            <span class="rca-score">${topCorr.correlation_score.toFixed(0)}%</span>
                            <span class="rca-score-label">RCA Confidence</span>
                        </div>
                    </div>
                    <div class="rca-detail-box">
                        <span class="rca-cause-label">Identified Cause:</span>
                        <span class="rca-cause-value"><i class="fa-solid fa-magnifying-glass-arrow-right"></i> ${topCorr.possible_cause}</span>
                    </div>
                    <div class="rca-detail-box">
                        <span class="rca-cause-label">Correlation Explanation:</span>
                        <p class="rca-explanation">${topCorr.explanation}</p>
                    </div>
                </div>
            `;
        } else {
            rcaStatus.innerText = 'Idle';
            rcaStatus.className = 'badge';
            consoleEl.innerHTML = `
                <div class="rca-placeholder">
                    <i class="fa-solid fa-magnifying-glass-chart rca-placeholder-icon"></i>
                    <p>No active anomalies to correlate. Real-time correlation engine is running.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error polling correlation console:', error);
    }
}

// Fetch simulator status and sync controls
async function syncSimulatorState() {
    try {
        const response = await fetch('/api/simulator/status');
        const data = await response.json();
        
        const btnCpu = document.getElementById('btn-cpu');
        const btnMem = document.getElementById('btn-mem');
        const btnStop = document.getElementById('btn-stop');
        const statusBadge = document.getElementById('sim-status-badge');
        const flowSim = document.getElementById('flow-sim');
        
        if (data.status === 'normal') {
            btnCpu.disabled = false;
            btnCpu.classList.remove('btn-disabled');
            btnMem.disabled = false;
            btnMem.classList.remove('btn-disabled');
            
            btnStop.disabled = true;
            btnStop.classList.add('btn-disabled');
            
            statusBadge.innerText = 'Simulator Idle';
            statusBadge.className = 'badge';
            
            flowSim.classList.remove('active');
        } else {
            // Simulation active (either cpu or memory)
            btnCpu.disabled = true;
            btnCpu.classList.add('btn-disabled');
            btnMem.disabled = true;
            btnMem.classList.add('btn-disabled');
            
            btnStop.disabled = false;
            btnStop.classList.remove('btn-disabled');
            
            statusBadge.innerText = `Simulating ${data.status.toUpperCase()} chaos`;
            statusBadge.className = 'badge red-bg';
            
            flowSim.classList.add('active');
        }
    } catch (error) {
        console.error('Error syncing simulator state:', error);
    }
}

// Trigger Simulation endpoint
async function triggerSimulation(type) {
    try {
        const url = `/api/simulator/${type}`;
        const response = await fetch(url, { method: 'POST' });
        const resData = await response.json();
        console.log(resData.message);
        syncSimulatorState();
    } catch (error) {
        console.error(`Error triggering simulation ${type}:`, error);
    }
}

// Stop Simulation endpoint
async function stopSimulation() {
    try {
        const response = await fetch('/api/simulator/stop', { method: 'POST' });
        const resData = await response.json();
        console.log(resData.message);
        syncSimulatorState();
    } catch (error) {
        console.error('Error stopping simulation:', error);
    }
}

// Orchestrator loop to update health indicator and feeds
async function orchestrateDashboard() {
    // Poll telemetry metrics (1.5s interval)
    await pollMetrics();
    
    // Poll alerts (3s interval)
    const netcoolAlerts = await pollDeterministicAlerts();
    const mlAnomalies = await pollMLAnomalies();
    await pollCorrelationConsole();
    await syncSimulatorState();
    
    // Update overall system health dot based on active critical issues
    const healthDot = document.getElementById('health-dot');
    const healthText = document.getElementById('health-text');
    
    const activeNetcoolCriticals = netcoolAlerts.some(a => a.labels?.severity === 'critical');
    const activeMLCriticals = mlAnomalies.some(a => a.severity === 'critical');
    
    if (activeNetcoolCriticals || activeMLCriticals) {
        healthDot.className = 'status-dot anomaly';
        healthText.innerText = 'Critical Alert Active';
    } else if (netcoolAlerts.length > 0 || mlAnomalies.length > 0) {
        healthDot.className = 'status-dot anomaly';
        healthDot.style.backgroundColor = '#fbbf24'; // amber Z-score warning
        healthText.innerText = 'System Warnings';
    } else {
        healthDot.className = 'status-dot pulsing';
        healthDot.style.backgroundColor = ''; // default green
        healthText.innerText = 'System Live';
    }
}

// Start polling loops on load
window.addEventListener('DOMContentLoaded', () => {
    initCharts();
    
    // Initial run
    orchestrateDashboard();
    
    // Set intervals
    setInterval(pollMetrics, 1500);
    setInterval(orchestrateDashboard, 3000);
});
