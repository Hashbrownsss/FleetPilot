import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import yaml from 'js-yaml';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import {
  Brain,
  Terminal,
  Activity,
  Cpu,
  HardDrive,
  Network,
  StopCircle,
  AlertTriangle,
  CheckCircle,
  Search,
  Skull,
  Server,
  Zap,
  ExternalLink,
  ShieldCheck,
  MessageSquare,
  Settings,
  Key,
  RefreshCw,
  Send,
  Check,
  Lock,
  LogOut,
  UserPlus,
  Plus,
  Trash2,
  ArrowLeftRight,
  CheckSquare,
  Square,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

// Register ChartJS modules
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const COMPONENT_PRESETS = {
  postgresql: `endpoint: "localhost:5432"
username: "postgres"
password: "db_password_123"
collection_interval: 10s`,
  nginx: `endpoint: "http://localhost:80/status"
collection_interval: 5s`,
  hostmetrics: `collection_interval: 5s
scrapers:
  cpu:
  memory:
  disk:
  network:`,
  prometheus: `config:
  scrape_configs:
    - job_name: 'custom-scrape'
      static_configs:
        - targets: ['localhost:9090']`,
  otlp: `endpoint: "localhost:4317"
tls:
  insecure: true`,
  kafka: `brokers: ["localhost:9094"]
topic: "custom-metrics"
encoding: "otlp_json"`
};

const getDiagnosticInfo = (err) => {
  if (!err) return null;
  const lower = err.toLowerCase();
  
  if (lower.includes("address already in use") || lower.includes("bind: address")) {
    return {
      title: "Port Binding Conflict",
      cause: "The collector tried to bind to a network port that is already in use by another process on this machine.",
      fix: [
        "Check if another instance of the OpenTelemetry Collector is already running.",
        "Verify if another service is listening on the conflicting port (e.g., 4317 for OTLP gRPC, 8889 for Prometheus Exporter).",
        "Modify the receiver configuration in the Raw YAML Editor to use a different, unoccupied port."
      ],
      severity: "critical"
    };
  }
  
  if (lower.includes("unknown receiver") || lower.includes("receiver type") || lower.includes("unsupported receiver")) {
    return {
      title: "Unsupported or Unknown Receiver",
      cause: "The collector configuration references a receiver type that is not compiled into the agent's collector binary.",
      fix: [
        "Verify that there is no typo in the receiver name (e.g., 'hostmetrics' vs 'hostmetric').",
        "Check if you are running the 'core' distribution instead of 'contrib'. Receivers like 'postgresql' or 'nginx' require the OpenTelemetry Collector Contrib distribution.",
        "Change the receiver type in the visual settings or raw YAML to a supported receiver."
      ],
      severity: "warning"
    };
  }

  if (lower.includes("unknown exporter") || lower.includes("exporter type") || lower.includes("unsupported exporter")) {
    return {
      title: "Unsupported or Unknown Exporter",
      cause: "The configuration references an exporter type that is not recognized or supported by this agent's collector binary.",
      fix: [
        "Verify the exporter name spelling (e.g. 'otlp', 'prometheus', 'kafka', 'debug').",
        "Ensure the exporter is supported by the collector distribution being run (e.g. Kafka exporter is part of Contrib).",
        "Revert or update the exporter definition in the Raw YAML Editor."
      ],
      severity: "warning"
    };
  }
  
  if (lower.includes("unmarshal errors") || lower.includes("yaml:") || lower.includes("failed to unmarshal")) {
    return {
      title: "YAML Syntax / Formatting Error",
      cause: "The configuration contains malformed YAML syntax or invalid indentation.",
      fix: [
        "Check for tab characters in the YAML editor; OpenTelemetry YAML files must only use spaces for indentation.",
        "Ensure key-value pairs are properly formatted with a colon followed by a space (e.g. 'scrapers:').",
        "Verify that list elements are correctly prefixed with dashes (e.g. '- hostmetrics').",
        "Use the 'Raw YAML Editor' to check for syntax highlighting warnings."
      ],
      severity: "critical"
    };
  }
  
  if (lower.includes("failed to build pipelines") || lower.includes("missing receiver") || lower.includes("missing exporter")) {
    return {
      title: "Pipeline Components Reference Mismatch",
      cause: "A component listed in the service pipeline is not declared in the top-level sections (receivers, processors, exporters).",
      fix: [
        "Check the 'service.pipelines' block and list all receivers, processors, and exporters.",
        "Verify that every listed name exists under the corresponding top-level section (e.g., if metrics pipeline has receiver '[hostmetrics]', then 'receivers:' must define 'hostmetrics').",
        "Make sure names match exactly, including casing and custom IDs (e.g. 'otlp/elastic')."
      ],
      severity: "critical"
    };
  }

  if (lower.includes("permission denied") || lower.includes("bind: permission denied")) {
    return {
      title: "Privileged Port Binding Restriction",
      cause: "The agent does not have administrative/root permissions to bind to a low-numbered port (typically below 1024).",
      fix: [
        "Modify the configuration to use ports above 1024 (e.g. 4317, 8889, 9090).",
        "If you must use a low port, restart the agent supervisor with elevated/administrator/root privileges."
      ],
      severity: "warning"
    };
  }
  
  return {
    title: "Collector Agent Runtime Error",
    cause: err,
    fix: [
      "Check the physical agent supervisor logs for the full trace.",
      "Review the combined effective configuration for syntax issues or mismatched block structures.",
      "Try deploying the 'Default' template configuration to restore the agent to a known good state."
    ],
    severity: "critical"
  };
};

function App() {
  // Authentication states
  const [token, setToken] = useState(localStorage.getItem('aiops_token') || '');
  const [role, setRole] = useState(localStorage.getItem('aiops_role') || '');
  const [username, setUsername] = useState(localStorage.getItem('aiops_username') || '');
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'signup'
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authRole, setAuthRole] = useState('user'); // 'user' | 'admin'
  const [authError, setAuthError] = useState('');

  // Live telemetry states
  const [metrics, setMetrics] = useState([]);
  const [netcoolAlerts, setNetcoolAlerts] = useState([]);
  const [mlAnomalies, setMlAnomalies] = useState([]);
  const [rcaCorrelations, setRcaCorrelations] = useState([]);
  const [simStatus, setSimStatus] = useState('normal');
  const [isConnected, setIsConnected] = useState(true);

  // Fleet management states
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'opamp'
  const [opampAgents, setOpampAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [agentDetails, setAgentDetails] = useState(null);
  const [loadedAgentId, setLoadedAgentId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('All');
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [bulkGroup, setBulkGroup] = useState('Default');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'topology'
  const [hoveredAgent, setHoveredAgent] = useState(null);

  // Fleets state variables
  const [fleets, setFleets] = useState([]);
  const [selectedFleet, setSelectedFleet] = useState(null);
  const [fleetTelemetry, setFleetTelemetry] = useState(null);
  const [showAddAgentsModal, setShowAddAgentsModal] = useState(false);
  const [agentsToAssign, setAgentsToAssign] = useState([]);

  // Configurations state variables
  const [configurations, setConfigurations] = useState([]);
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [configVersions, setConfigVersions] = useState([]);
  const [compareVersionA, setCompareVersionA] = useState(null);
  const [compareVersionB, setCompareVersionB] = useState(null);
  const [draftConfigYaml, setDraftConfigYaml] = useState('');
  const [configsFilter, setConfigsFilter] = useState('');
  const [configChangeDesc, setConfigChangeDesc] = useState('');
  const [prevConfigName, setPrevConfigName] = useState('');

  // Config editor & injector states
  const [configInput, setConfigInput] = useState('');
  const [yamlValidationError, setYamlValidationError] = useState('');
  const [injCompType, setInjCompType] = useState('receivers');
  const [injCompName, setInjCompName] = useState('');
  const [injCompPreset, setInjCompPreset] = useState('postgresql');
  const [injCompConfig, setInjCompConfig] = useState(COMPONENT_PRESETS.postgresql);

  // OpAMP details form states
  const [tlsMin, setTlsMin] = useState('TLSv1.2');
  const [proxyUrl, setProxyUrl] = useState('');
  const [msgCapability, setMsgCapability] = useState('io.opentelemetry.custom.health');
  const [msgType, setMsgType] = useState('get_health');
  const [msgData, setMsgData] = useState('');

  // Feedback Status
  const [opampFeedback, setOpampFeedback] = useState({ type: '', text: '' });
  const [opampLoading, setOpampLoading] = useState(false);

  // Audit Logs States
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLimit, setAuditLimit] = useState(50);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditFilterUser, setAuditFilterUser] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('');
  const [auditFilterTarget, setAuditFilterTarget] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [expandedAuditId, setExpandedAuditId] = useState(null);
  const [ssoConfig, setSsoConfig] = useState(null);

  // BindPlane UI Visual editor states
  const [configMode, setConfigMode] = useState('visual'); // 'visual' | 'raw'
  const [visualConfig, setVisualConfig] = useState({
    sources: {
      hostmetrics: { enabled: false, collection_interval: '10s', cpu: true, memory: true, disk: true, network: true, processes: true },
      postgresql: { enabled: false, endpoint: 'localhost:5432', username: 'postgres', password: '', collection_interval: '10s' },
      nginx: { enabled: false, endpoint: 'http://localhost/status', collection_interval: '10s' },
      otlp: { enabled: false, grpc_endpoint: '0.0.0.0:4317', http_endpoint: '0.0.0.0:4318' }
    },
    destinations: {
      prometheus: { enabled: false, endpoint: '0.0.0.0:8889', namespace: 'otelcol' },
      kafka: { enabled: false, brokers: 'kafka:9092', topic: 'raw-metrics', encoding: 'otlp_json' },
      otlp: { enabled: false, endpoint: 'localhost:4317' },
      debug: { enabled: false, verbosity: 'detailed' }
    },
    batchProcessor: false
  });

  const parseYamlToVisual = (yamlStr) => {
    if (!yamlStr || !yamlStr.trim()) {
      return {
        sources: {
          hostmetrics: { enabled: false, collection_interval: '10s', cpu: true, memory: true, disk: true, network: true, processes: true },
          postgresql: { enabled: false, endpoint: 'localhost:5432', username: 'postgres', password: '', collection_interval: '10s' },
          nginx: { enabled: false, endpoint: 'http://localhost/status', collection_interval: '10s' },
          otlp: { enabled: false, grpc_endpoint: '0.0.0.0:4317', http_endpoint: '0.0.0.0:4318' }
        },
        destinations: {
          prometheus: { enabled: false, endpoint: '0.0.0.0:8889', namespace: 'otelcol' },
          kafka: { enabled: false, brokers: 'kafka:9092', topic: 'raw-metrics', encoding: 'otlp_json' },
          otlp: { enabled: false, endpoint: 'localhost:4317' },
          debug: { enabled: false, verbosity: 'detailed' }
        },
        batchProcessor: false
      };
    }
    try {
      const doc = yaml.load(yamlStr) || {};
      const sources = {
        hostmetrics: { enabled: false, collection_interval: '10s', cpu: true, memory: true, disk: true, network: true, processes: true },
        postgresql: { enabled: false, endpoint: 'localhost:5432', username: 'postgres', password: '', collection_interval: '10s' },
        nginx: { enabled: false, endpoint: 'http://localhost/status', collection_interval: '10s' },
        otlp: { enabled: false, grpc_endpoint: '0.0.0.0:4317', http_endpoint: '0.0.0.0:4318' }
      };
      const destinations = {
        prometheus: { enabled: false, endpoint: '0.0.0.0:8889', namespace: 'otelcol' },
        kafka: { enabled: false, brokers: 'kafka:9092', topic: 'raw-metrics', encoding: 'otlp_json' },
        otlp: { enabled: false, endpoint: 'localhost:4317' },
        debug: { enabled: false, verbosity: 'detailed' }
      };
      let batchProcessor = false;

      if (doc.receivers) {
        if (doc.receivers.hostmetrics) {
          sources.hostmetrics.enabled = true;
          const hm = doc.receivers.hostmetrics;
          if (hm.collection_interval) sources.hostmetrics.collection_interval = String(hm.collection_interval);
          if (hm.scrapers) {
            sources.hostmetrics.cpu = hm.scrapers.cpu !== undefined;
            sources.hostmetrics.memory = hm.scrapers.memory !== undefined;
            sources.hostmetrics.disk = hm.scrapers.disk !== undefined;
            sources.hostmetrics.network = hm.scrapers.network !== undefined;
            sources.hostmetrics.processes = hm.scrapers.processes !== undefined;
          }
        }
        if (doc.receivers.postgresql) {
          sources.postgresql.enabled = true;
          const pg = doc.receivers.postgresql;
          if (pg.endpoint) sources.postgresql.endpoint = pg.endpoint;
          if (pg.username) sources.postgresql.username = pg.username;
          if (pg.password) sources.postgresql.password = pg.password;
          if (pg.collection_interval) sources.postgresql.collection_interval = String(pg.collection_interval);
        }
        if (doc.receivers.nginx) {
          sources.nginx.enabled = true;
          const ng = doc.receivers.nginx;
          if (ng.endpoint) sources.nginx.endpoint = ng.endpoint;
          if (ng.collection_interval) sources.nginx.collection_interval = String(ng.collection_interval);
        }
        if (doc.receivers.otlp) {
          sources.otlp.enabled = true;
          const ot = doc.receivers.otlp;
          if (ot.protocols) {
            if (ot.protocols.grpc) sources.otlp.grpc_endpoint = ot.protocols.grpc.endpoint || '';
            if (ot.protocols.http) sources.otlp.http_endpoint = ot.protocols.http.endpoint || '';
          }
        }
      }

      if (doc.processors) {
        if (doc.processors.batch) {
          batchProcessor = true;
        }
      }

      if (doc.exporters) {
        if (doc.exporters.prometheus) {
          destinations.prometheus.enabled = true;
          const pr = doc.exporters.prometheus;
          if (pr.endpoint) destinations.prometheus.endpoint = pr.endpoint;
          if (pr.namespace) destinations.prometheus.namespace = pr.namespace;
        }
        if (doc.exporters.kafka) {
          destinations.kafka.enabled = true;
          const kf = doc.exporters.kafka;
          if (kf.brokers) destinations.kafka.brokers = Array.isArray(kf.brokers) ? kf.brokers.join(', ') : kf.brokers;
          if (kf.metrics && kf.metrics.topic) destinations.kafka.topic = kf.metrics.topic;
          if (kf.metrics && kf.metrics.encoding) destinations.kafka.encoding = kf.metrics.encoding;
        }
        if (doc.exporters.otlp) {
          destinations.otlp.enabled = true;
          const otl = doc.exporters.otlp;
          if (otl.endpoint) destinations.otlp.endpoint = otl.endpoint;
        }
        if (doc.exporters.debug) {
          destinations.debug.enabled = true;
          const dbg = doc.exporters.debug;
          if (dbg.verbosity) destinations.debug.verbosity = dbg.verbosity;
        }
      }

      return { sources, destinations, batchProcessor };
    } catch (e) {
      console.error("YAML parsing error in visual parsing:", e);
      return null;
    }
  };

  const generateYamlFromVisual = (visualObj) => {
    const doc = {
      extensions: {
        health_check: {
          endpoint: "0.0.0.0:13133"
        }
      },
      receivers: {},
      processors: {},
      exporters: {},
      service: {
        extensions: ["health_check"],
        pipelines: {
          metrics: {
            receivers: [],
            processors: [],
            exporters: []
          }
        }
      }
    };

    // Receivers
    if (visualObj.sources.hostmetrics.enabled) {
      const hm = {
        collection_interval: visualObj.sources.hostmetrics.collection_interval,
        scrapers: {}
      };
      if (visualObj.sources.hostmetrics.cpu) hm.scrapers.cpu = null;
      if (visualObj.sources.hostmetrics.memory) hm.scrapers.memory = null;
      if (visualObj.sources.hostmetrics.disk) hm.scrapers.disk = null;
      if (visualObj.sources.hostmetrics.network) hm.scrapers.network = null;
      if (visualObj.sources.hostmetrics.processes) hm.scrapers.processes = null;
      doc.receivers.hostmetrics = hm;
      doc.service.pipelines.metrics.receivers.push("hostmetrics");
    }
    if (visualObj.sources.postgresql.enabled) {
      doc.receivers.postgresql = {
        endpoint: visualObj.sources.postgresql.endpoint,
        username: visualObj.sources.postgresql.username,
        password: visualObj.sources.postgresql.password,
        collection_interval: visualObj.sources.postgresql.collection_interval
      };
      doc.service.pipelines.metrics.receivers.push("postgresql");
    }
    if (visualObj.sources.nginx.enabled) {
      doc.receivers.nginx = {
        endpoint: visualObj.sources.nginx.endpoint,
        collection_interval: visualObj.sources.nginx.collection_interval
      };
      doc.service.pipelines.metrics.receivers.push("nginx");
    }
    if (visualObj.sources.otlp.enabled) {
      doc.receivers.otlp = {
        protocols: {
          grpc: { endpoint: visualObj.sources.otlp.grpc_endpoint },
          http: { endpoint: visualObj.sources.otlp.http_endpoint }
        }
      };
      doc.service.pipelines.metrics.receivers.push("otlp");
    }

    // Processors
    if (visualObj.batchProcessor) {
      doc.processors.batch = {
        timeout: "10s",
        send_batch_size: 1024
      };
      doc.service.pipelines.metrics.processors.push("batch");
    }

    // Exporters
    if (visualObj.destinations.prometheus.enabled) {
      doc.exporters.prometheus = {
        endpoint: visualObj.destinations.prometheus.endpoint,
        namespace: visualObj.destinations.prometheus.namespace
      };
      doc.service.pipelines.metrics.exporters.push("prometheus");
    }
    if (visualObj.destinations.kafka.enabled) {
      const brokers = visualObj.destinations.kafka.brokers.split(',').map(b => b.trim()).filter(Boolean);
      doc.exporters.kafka = {
        protocol_version: "2.0.0",
        brokers: brokers,
        metrics: {
          topic: visualObj.destinations.kafka.topic,
          encoding: visualObj.destinations.kafka.encoding
        }
      };
      doc.service.pipelines.metrics.exporters.push("kafka");
    }
    if (visualObj.destinations.otlp.enabled) {
      doc.exporters.otlp = {
        endpoint: visualObj.destinations.otlp.endpoint
      };
      doc.service.pipelines.metrics.exporters.push("otlp");
    }
    if (visualObj.destinations.debug.enabled) {
      doc.exporters.debug = {
        verbosity: visualObj.destinations.debug.verbosity
      };
      doc.service.pipelines.metrics.exporters.push("debug");
    }

    // Clean up empty objects
    if (Object.keys(doc.receivers).length === 0) delete doc.receivers;
    if (Object.keys(doc.processors).length === 0) delete doc.processors;
    if (Object.keys(doc.exporters).length === 0) delete doc.exporters;

    return yaml.dump(doc, { noRefs: true });
  };

  const handleToggleMode = (newMode) => {
    if (newMode === 'visual') {
      const parsed = parseYamlToVisual(configInput);
      if (parsed) {
        setVisualConfig(parsed);
        setConfigMode('visual');
      } else {
        showFeedback('error', 'Unable to parse raw YAML into Visual Designer structure. Ensure the YAML is valid and matches supported OpenTelemetry components.');
      }
    } else {
      setConfigMode('raw');
    }
  };

  const handleUpdateSourceField = (sourceName, field, value) => {
    setVisualConfig(prev => {
      const next = {
        ...prev,
        sources: {
          ...prev.sources,
          [sourceName]: {
            ...prev.sources[sourceName],
            [field]: value
          }
        }
      };
      setConfigInput(generateYamlFromVisual(next));
      return next;
    });
  };

  const handleUpdateDestinationField = (destName, field, value) => {
    setVisualConfig(prev => {
      const next = {
        ...prev,
        destinations: {
          ...prev.destinations,
          [destName]: {
            ...prev.destinations[destName],
            [field]: value
          }
        }
      };
      setConfigInput(generateYamlFromVisual(next));
      return next;
    });
  };

  const handleToggleSource = (sourceName) => {
    setVisualConfig(prev => {
      const next = {
        ...prev,
        sources: {
          ...prev.sources,
          [sourceName]: {
            ...prev.sources[sourceName],
            enabled: !prev.sources[sourceName].enabled
          }
        }
      };
      setConfigInput(generateYamlFromVisual(next));
      return next;
    });
  };

  const handleToggleDestination = (destName) => {
    setVisualConfig(prev => {
      const next = {
        ...prev,
        destinations: {
          ...prev.destinations,
          [destName]: {
            ...prev.destinations[destName],
            enabled: !prev.destinations[destName].enabled
          }
        }
      };
      setConfigInput(generateYamlFromVisual(next));
      return next;
    });
  };

  const handleToggleProcessor = () => {
    setVisualConfig(prev => {
      const next = {
        ...prev,
        batchProcessor: !prev.batchProcessor
      };
      setConfigInput(generateYamlFromVisual(next));
      return next;
    });
  };

  // Helpers
  const formatTime = (unixSeconds) => {
    if (!unixSeconds) return '--:--:--';
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const getAuthHeaders = () => {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const authFetch = async (url, options = {}) => {
    const headers = {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, { ...options, headers });
  };

  const fetchFleets = async () => {
    if (!token) return;
    try {
      const res = await authFetch('/api/fleets');
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setFleets(data.fleets || []);
      
      if (selectedFleet) {
        const updated = (data.fleets || []).find(f => f.name === selectedFleet.name);
        if (updated) {
          setSelectedFleet(updated);
        }
      }
    } catch (err) {
      console.error('Error fetching fleets:', err);
    }
  };

  const fetchFleetTelemetry = async (fleetName) => {
    if (!token || !fleetName) return;
    try {
      const res = await authFetch(`/api/fleets/${fleetName}/telemetry`);
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setFleetTelemetry(data);
    } catch (err) {
      console.error('Error fetching fleet telemetry:', err);
    }
  };

  const fetchConfigurations = async () => {
    if (!token) return;
    try {
      const res = await authFetch('/api/configurations');
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setConfigurations(data.configurations || []);
      
      if (selectedConfig) {
        const updated = (data.configurations || []).find(c => c.name === selectedConfig.name);
        if (updated) {
          setSelectedConfig(updated);
        }
      }
    } catch (err) {
      console.error('Error fetching configurations:', err);
    }
  };

  const fetchAuditLogs = async () => {
    if (!token) return;
    try {
      setAuditLoading(true);
      const queryParams = new URLSearchParams();
      if (auditFilterUser) queryParams.append('username', auditFilterUser);
      if (auditFilterAction) queryParams.append('action', auditFilterAction);
      if (auditFilterTarget) queryParams.append('target', auditFilterTarget);
      queryParams.append('limit', auditLimit.toString());
      queryParams.append('offset', auditOffset.toString());

      const res = await authFetch(`/api/audit?${queryParams.toString()}`);
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setAuditLogs(data.logs || []);
      setAuditTotal(data.total || 0);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  const fetchConfigVersions = async (configName) => {
    if (!token || !configName) return;
    try {
      const res = await authFetch(`/api/configurations/${configName}/versions`);
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setConfigVersions(data.revisions || []);
      
      const revs = data.revisions || [];
      if (revs.length > 0) {
        setCompareVersionA(revs[revs.length - 1].version);
        if (revs.length > 1) {
          setCompareVersionB(revs[revs.length - 2].version);
        } else {
          setCompareVersionB(revs[0].version);
        }
      }
    } catch (err) {
      console.error('Error fetching config versions:', err);
    }
  };

  // Parsing and editing metrics dynamically in OTel YAML
  const parseMetricsFromYaml = (yamlStr) => {
    const result = {
      cpuTime: true,
      cpuUtil: true,
      memUsage: true,
      load1m: true,
      load5m: true,
      load15m: true,
      fsUsage: true,
      fsUtil: true,
      fsInodes: true,
    };
    if (!yamlStr) return result;
    try {
      const doc = yaml.load(yamlStr);
      const scrapers = doc?.receivers?.hostmetrics?.scrapers || {};
      
      if (scrapers.cpu?.metrics) {
        if (scrapers.cpu.metrics['system.cpu.time']?.enabled === false) result.cpuTime = false;
        if (scrapers.cpu.metrics['system.cpu.utilization']?.enabled === false) result.cpuUtil = false;
      }
      if (scrapers.memory?.metrics) {
        if (scrapers.memory.metrics['system.memory.usage']?.enabled === false) result.memUsage = false;
      }
      if (scrapers.load?.metrics) {
        if (scrapers.load.metrics['system.cpu.load_average.1m']?.enabled === false) result.load1m = false;
        if (scrapers.load.metrics['system.cpu.load_average.5m']?.enabled === false) result.load5m = false;
        if (scrapers.load.metrics['system.cpu.load_average.15m']?.enabled === false) result.load15m = false;
      }
      if (scrapers.filesystem?.metrics) {
        if (scrapers.filesystem.metrics['system.filesystem.usage']?.enabled === false) result.fsUsage = false;
        if (scrapers.filesystem.metrics['system.filesystem.utilization']?.enabled === false) result.fsUtil = false;
        if (scrapers.filesystem.metrics['system.filesystem.inodes.usage']?.enabled === false) result.fsInodes = false;
      }
    } catch (e) {
      // safe fallback
    }
    return result;
  };

  const updateYamlMetrics = (yamlStr, key, value) => {
    try {
      const doc = yaml.load(yamlStr) || {};
      
      if (!doc.receivers) doc.receivers = {};
      if (!doc.receivers.hostmetrics) doc.receivers.hostmetrics = {};
      if (!doc.receivers.hostmetrics.scrapers) doc.receivers.hostmetrics.scrapers = {};
      const scrapers = doc.receivers.hostmetrics.scrapers;
      
      const setMetricEnabled = (scraperName, metricName, enabled) => {
        if (!scrapers[scraperName]) scrapers[scraperName] = {};
        if (!scrapers[scraperName].metrics) scrapers[scraperName].metrics = {};
        scrapers[scraperName].metrics[metricName] = { enabled };
      };

      switch (key) {
        case 'cpuTime':
          setMetricEnabled('cpu', 'system.cpu.time', value);
          break;
        case 'cpuUtil':
          setMetricEnabled('cpu', 'system.cpu.utilization', value);
          break;
        case 'memUsage':
          setMetricEnabled('memory', 'system.memory.usage', value);
          break;
        case 'load1m':
          setMetricEnabled('load', 'system.cpu.load_average.1m', value);
          break;
        case 'load5m':
          setMetricEnabled('load', 'system.cpu.load_average.5m', value);
          break;
        case 'load15m':
          setMetricEnabled('load', 'system.cpu.load_average.15m', value);
          break;
        case 'fsUsage':
          setMetricEnabled('filesystem', 'system.filesystem.usage', value);
          break;
        case 'fsUtil':
          setMetricEnabled('filesystem', 'system.filesystem.utilization', value);
          break;
        case 'fsInodes':
          setMetricEnabled('filesystem', 'system.filesystem.inodes.usage', value);
          break;
        default:
          break;
      }
      
      return yaml.dump(doc, { defaultFlowStyle: false });
    } catch (e) {
      console.error('Failed to update OTel metrics in YAML:', e);
      return yamlStr;
    }
  };

  // YAML Diff calculation helper
  const getSplitDiff = (textA, textB) => {
    if (!textA || !textB) return [];
    const linesA = textA.split('\n');
    const linesB = textB.split('\n');
    
    const maxLength = Math.max(linesA.length, linesB.length);
    const diffRows = [];
    
    for (let i = 0; i < maxLength; i++) {
      const lineA = linesA[i] !== undefined ? linesA[i] : null;
      const lineB = linesB[i] !== undefined ? linesB[i] : null;
      
      let typeA = 'normal';
      let typeB = 'normal';
      
      if (lineA !== lineB) {
        if (lineA === null) {
          typeB = 'added';
        } else if (lineB === null) {
          typeA = 'deleted';
        } else {
          typeA = 'modified-del';
          typeB = 'modified-add';
        }
      }
      
      diffRows.push({
        numA: lineA !== null ? i + 1 : '',
        contentA: lineA !== null ? lineA : '',
        typeA,
        numB: lineB !== null ? i + 1 : '',
        contentB: lineB !== null ? lineB : '',
        typeB
      });
    }
    
    return diffRows;
  };

  // Fleet & Config Tab Sync hooks
  useEffect(() => {
    if (!token) return;
    if (activeTab === 'fleets') {
      fetchFleets();
      fetchConfigurations();
      const interval = setInterval(() => {
        fetchFleets();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, token]);

  useEffect(() => {
    if (selectedFleet) {
      fetchFleetTelemetry(selectedFleet.name);
      const interval = setInterval(() => {
        fetchFleetTelemetry(selectedFleet.name);
      }, 3000);
      return () => clearInterval(interval);
    } else {
      setFleetTelemetry(null);
    }
  }, [selectedFleet, token]);

  useEffect(() => {
    if (!token) return;
    if (activeTab === 'configurations') {
      fetchConfigurations();
      fetchFleets();
      const interval = setInterval(() => {
        fetchConfigurations();
      }, 6000);
      return () => clearInterval(interval);
    }
  }, [activeTab, token]);

  useEffect(() => {
    if (!token) return;
    if (activeTab === 'audit') {
      fetchAuditLogs();
      const interval = setInterval(() => {
        fetchAuditLogs();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, token, auditFilterUser, auditFilterAction, auditFilterTarget, auditLimit, auditOffset]);

  // Fetch SSO/Keycloak config on mount
  useEffect(() => {
    const checkSSOConfig = async () => {
      try {
        const res = await fetch('/api/auth/sso/config');
        if (res.ok) {
          const data = await res.json();
          setSsoConfig(data);
        }
      } catch (err) {
        console.warn("Failed to retrieve SSO auth configuration:", err);
      }
    };
    checkSSOConfig();
  }, []);

  // Parse OIDC token redirect hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      if (accessToken) {
        try {
          const payloadBase64 = accessToken.split(".")[1];
          // Replace base64 URL safe characters
          const normalizedBase64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
          const payloadJson = JSON.parse(window.atob(normalizedBase64));
          
          const ssoUser = payloadJson.preferred_username || payloadJson.sub || "sso_user";
          const realmRoles = payloadJson.realm_access?.roles || [];
          const clientRoles = payloadJson.resource_access?.["aiops-portal"]?.roles || [];
          const allRoles = [...realmRoles, ...clientRoles];
          const ssoRole = allRoles.includes("admin") ? "admin" : "user";
          
          setToken(accessToken);
          setRole(ssoRole);
          setUsername(ssoUser);
          localStorage.setItem('aiops_token', accessToken);
          localStorage.setItem('aiops_role', ssoRole);
          localStorage.setItem('aiops_username', ssoUser);
          
          // Clear hash in browser address bar without reload
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
          console.error("Failed to parse SSO JWT token payload:", e);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (selectedConfig) {
      fetchConfigVersions(selectedConfig.name);
      if (selectedConfig.name !== prevConfigName) {
        setDraftConfigYaml(selectedConfig.latest_config);
        setPrevConfigName(selectedConfig.name);
      }
      setConfigChangeDesc('Updates configuration metrics and settings');
    } else {
      setConfigVersions([]);
      setDraftConfigYaml('');
      setPrevConfigName('');
    }
  }, [selectedConfig, prevConfigName]);

  // Sign in / Sign up methods
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      // 1. Try Keycloak SSO direct login via ROPC if enabled and reachable
      if (ssoConfig && ssoConfig.enabled) {
        try {
          const bodyParams = new URLSearchParams();
          bodyParams.append('grant_type', 'password');
          bodyParams.append('client_id', ssoConfig.client_id);
          bodyParams.append('username', authUsername);
          bodyParams.append('password', authPassword);
          bodyParams.append('scope', 'openid');

          const ssoRes = await fetch(`${ssoConfig.url}/realms/${ssoConfig.realm}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: bodyParams.toString()
          });

          if (ssoRes.ok) {
            const data = await ssoRes.json();
            const accessToken = data.access_token;
            
            const payloadBase64 = accessToken.split(".")[1];
            const normalizedBase64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
            const payloadJson = JSON.parse(window.atob(normalizedBase64));
            
            const ssoUser = payloadJson.preferred_username || payloadJson.sub || "sso_user";
            const realmRoles = payloadJson.realm_access?.roles || [];
            const clientRoles = payloadJson.resource_access?.[ssoConfig.client_id]?.roles || [];
            const allRoles = [...realmRoles, ...clientRoles];
            const ssoRole = allRoles.includes("admin") ? "admin" : "user";

            setToken(accessToken);
            setRole(ssoRole);
            setUsername(ssoUser);
            localStorage.setItem('aiops_token', accessToken);
            localStorage.setItem('aiops_role', ssoRole);
            localStorage.setItem('aiops_username', ssoUser);
            setAuthUsername('');
            setAuthPassword('');
            return;
          }
        } catch (ssoErr) {
          console.warn("Keycloak ROPC direct login failed/offline, falling back to local auth:", ssoErr);
        }
      }

      // 2. Fallback: Local database login
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword })
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setRole(data.role);
        setUsername(data.username);
        localStorage.setItem('aiops_token', data.token);
        localStorage.setItem('aiops_role', data.role);
        localStorage.setItem('aiops_username', data.username);
        setAuthUsername('');
        setAuthPassword('');
      } else {
        setAuthError(data.detail || 'Login failed. Please verify credentials.');
      }
    } catch (err) {
      setAuthError('Network connection failed during authentication.');
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword, role: authRole })
      });
      const data = await res.json();
      if (res.ok) {
        setAuthTab('login');
        setAuthError('Registration completed. Please sign in now.');
        setAuthUsername('');
        setAuthPassword('');
      } else {
        setAuthError(data.detail || 'Signup failed.');
      }
    } catch (err) {
      setAuthError('Network connection failed during signup.');
    }
  };

  const handleDockerSSO = async () => {
    setAuthError('');
    try {
      const res = await fetch('/api/auth/docker', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setRole(data.role);
        setUsername(data.username);
        localStorage.setItem('aiops_token', data.token);
        localStorage.setItem('aiops_role', data.role);
        localStorage.setItem('aiops_username', data.username);
      } else {
        setAuthError(data.detail || 'Docker IDP SSO failed');
      }
    } catch (err) {
      setAuthError('Network error connecting to Docker SSO');
    }
  };

  const handleKeycloakSSO = () => {
    if (!ssoConfig) return;
    const keycloakAuthUrl = `${ssoConfig.url}/realms/${ssoConfig.realm}/protocol/openid-connect/auth?client_id=${ssoConfig.client_id}&response_type=token&redirect_uri=${encodeURIComponent(window.location.origin)}&scope=openid`;
    window.location.href = keycloakAuthUrl;
  };

  const handleLogout = () => {
    setToken('');
    setRole('');
    setUsername('');
    localStorage.removeItem('aiops_token');
    localStorage.removeItem('aiops_role');
    localStorage.removeItem('aiops_username');
    setOpampAgents([]);
    setSelectedAgent('');
    setAgentDetails(null);
    setLoadedAgentId('');
  };

  // Real-time YAML structural parsing validator
  useEffect(() => {
    if (!configInput.trim()) {
      setYamlValidationError('');
      return;
    }
    try {
      const parsed = yaml.load(configInput);
      if (parsed && typeof parsed === 'object') {
        setYamlValidationError('');
      } else {
        setYamlValidationError('Configuration must evaluate to a key-value YAML structure.');
      }
    } catch (err) {
      setYamlValidationError(err.message || 'Invalid YAML format');
    }
  }, [configInput]);

  // Poll dashboard metrics & alerts
  useEffect(() => {
    if (!token) return;

    const fetchMetrics = async () => {
      try {
        const res = await authFetch('/api/metrics/live');
        if (res.status === 401) { handleLogout(); return; }
        const data = await res.json();
        setMetrics(data || []);
        setIsConnected(true);
      } catch (err) {
        setIsConnected(false);
      }
    };

    const fetchAlerts = async () => {
      try {
        const [resAM, resML, resRCA, resSim] = await Promise.all([
          authFetch('/api/alerts/deterministic'),
          authFetch('/api/alerts/ml'),
          authFetch('/api/alerts/correlated'),
          authFetch('/api/simulator/status')
        ]);

        if (resAM.status === 401) { handleLogout(); return; }

        const amData = await resAM.json();
        const mlData = await resML.json();
        const rcaData = await resRCA.json();
        const simData = await resSim.json();

        setNetcoolAlerts(amData || []);
        setMlAnomalies(mlData || []);
        setRcaCorrelations(rcaData || []);
        setSimStatus(simData.status || 'normal');
      } catch (err) {
        console.error('Error polling alert endpoints:', err);
      }
    };

    fetchMetrics();
    fetchAlerts();

    const metricsInterval = setInterval(fetchMetrics, 1500);
    const alertsInterval = setInterval(fetchAlerts, 3000);

    return () => {
      clearInterval(metricsInterval);
      clearInterval(alertsInterval);
    };
  }, [token]);

  const selectedAgentRef = React.useRef(selectedAgent);
  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);

  // Poll agent list
  const fetchOpampAgents = async () => {
    if (!token) return;
    try {
      const res = await authFetch('/api/opamp/agents');
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      const agents = data.agents || [];
      setOpampAgents(agents);

      // Auto select first agent if none selected
      if (agents.length > 0 && !selectedAgentRef.current) {
        setSelectedAgent(agents[0].id);
      }
    } catch (err) {
      console.error("Error fetching agent list:", err);
    }
  };

  const fetchAgentDetails = async (agentId) => {
    if (!token || !agentId) return;
    try {
      const res = await authFetch(`/api/opamp/agent/${agentId}`);
      if (res.status === 401) { handleLogout(); return; }
      const data = await res.json();
      setAgentDetails(data);

      // Fix background overwrite poll: Only update config textarea if agentId is new,
      // preventing overwriting user drafts in-between 2.5s polls.
      if (agentId !== loadedAgentId) {
        const customConf = data.custom_config || '';
        setConfigInput(customConf);
        const parsed = parseYamlToVisual(customConf);
        if (parsed) {
          setVisualConfig(parsed);
        }
        setLoadedAgentId(agentId);
      }
    } catch (err) {
      console.error("Error fetching agent details:", err);
    }
  };

  useEffect(() => {
    if (!token) return;
    fetchOpampAgents();
    const interval = setInterval(fetchOpampAgents, 5000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (selectedAgent && token) {
      fetchAgentDetails(selectedAgent);
      const interval = setInterval(() => fetchAgentDetails(selectedAgent), 2500);
      return () => clearInterval(interval);
    } else {
      setAgentDetails(null);
      setLoadedAgentId('');
    }
  }, [selectedAgent, token, loadedAgentId]);

  const showFeedback = (type, text) => {
    setOpampFeedback({ type, text });
    setTimeout(() => setOpampFeedback({ type: '', text: '' }), 4500);
  };

  // Agent Operations
  const handleSaveConfig = async () => {
    if (!selectedAgent || role !== 'admin') return;
    setOpampLoading(true);
    try {
      const res = await authFetch(`/api/opamp/agent/${selectedAgent}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configInput })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'Custom overrides successfully applied and validated.');
        // Set loadedAgentId to empty so the next poll retrieves the newly saved config from the backend
        setLoadedAgentId('');
        fetchAgentDetails(selectedAgent);
      } else {
        showFeedback('error', data.detail || 'Failed to save config overrides.');
      }
    } catch (err) {
      showFeedback('error', 'Network error committing configuration changes.');
    } finally {
      setOpampLoading(false);
    }
  };

  const handleRotateCert = async () => {
    if (!selectedAgent || role !== 'admin') return;
    setOpampLoading(true);
    try {
      const res = await authFetch(`/api/opamp/agent/${selectedAgent}/rotate_cert`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'Client key rotation command queued successfully.');
        fetchAgentDetails(selectedAgent);
      } else {
        showFeedback('error', data.detail || 'Failed to trigger key rotation.');
      }
    } catch (err) {
      showFeedback('error', 'Network connection error offering certificate.');
    } finally {
      setOpampLoading(false);
    }
  };

  const handleConnectionSettings = async () => {
    if (!selectedAgent || role !== 'admin') return;
    setOpampLoading(true);
    try {
      const res = await authFetch(`/api/opamp/agent/${selectedAgent}/connection_settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tls_min: tlsMin, proxy_url: proxyUrl })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'TLS security credentials successfully updated.');
        fetchAgentDetails(selectedAgent);
      } else {
        showFeedback('error', data.detail || 'Failed to adjust connection profile.');
      }
    } catch (err) {
      showFeedback('error', 'Network error deploying connection options.');
    } finally {
      setOpampLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedAgent || role !== 'admin') return;
    setOpampLoading(true);
    try {
      const res = await authFetch(`/api/opamp/agent/${selectedAgent}/custom_message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: msgCapability, type: msgType, data: msgData })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', 'Message dispatched successfully to agent socket.');
        setMsgData('');
        fetchAgentDetails(selectedAgent);
      } else {
        showFeedback('error', data.detail || 'Message dispatch failed.');
      }
    } catch (err) {
      showFeedback('error', 'Network error delivering custom command payload.');
    } finally {
      setOpampLoading(false);
    }
  };

  // Visual OTel Component Injector UI logic
  const handleInjectComponent = () => {
    if (role !== 'admin') return;
    try {
      const parsedConfig = yaml.load(configInput) || {};
      if (parsedConfig && typeof parsedConfig !== 'object') {
        showFeedback('error', 'Input config must be a YAML mapping object.');
        return;
      }

      const parsedInjData = yaml.load(injCompConfig) || {};

      if (!parsedConfig[injCompType]) {
        parsedConfig[injCompType] = {};
      }

      const finalCompName = injCompName.trim() || `${injCompPreset}_custom`;
      parsedConfig[injCompType][finalCompName] = parsedInjData;

      // Ensure metrics pipeline structure exists
      if (!parsedConfig.service) parsedConfig.service = {};
      if (!parsedConfig.service.pipelines) parsedConfig.service.pipelines = {};
      if (!parsedConfig.service.pipelines.metrics) {
        parsedConfig.service.pipelines.metrics = {
          receivers: ['hostmetrics'],
          processors: [],
          exporters: ['otlp']
        };
      }

      // Add to appropriate array
      const targetPlKey = injCompType === 'receivers' ? 'receivers' : (injCompType === 'processors' ? 'processors' : 'exporters');
      if (!parsedConfig.service.pipelines.metrics[targetPlKey]) {
        parsedConfig.service.pipelines.metrics[targetPlKey] = [];
      }
      if (!parsedConfig.service.pipelines.metrics[targetPlKey].includes(finalCompName)) {
        parsedConfig.service.pipelines.metrics[targetPlKey].push(finalCompName);
      }

      const dumped = yaml.dump(parsedConfig, { noRefs: true });
      setConfigInput(dumped);
      setInjCompName('');
      showFeedback('success', `Injected component ${finalCompName} into receivers list and pipelines.`);
    } catch (e) {
      showFeedback('error', `Failed to inject component: ${e.message}`);
    }
  };

  // Agent Fleet Move Group & Bulk updates
  const handleMoveAgentGroup = async (agentId, newGroup) => {
    if (role !== 'admin') return;
    try {
      const res = await authFetch(`/api/opamp/agent/${agentId}/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: [newGroup] })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `Moved agent to group: ${newGroup}`);
        fetchOpampAgents();
        fetchAgentDetails(agentId);
      } else {
        showFeedback('error', data.detail || 'Group change failed.');
      }
    } catch (e) {
      showFeedback('error', 'Network error during group change.');
    }
  };

  const handleMoveAgentEnvironment = async (agentId, newEnv) => {
    if (role !== 'admin') return;
    try {
      const res = await authFetch(`/api/opamp/agent/${agentId}/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: newEnv })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `Deployment phase shifted to ${newEnv.toUpperCase()}.`);
        fetchOpampAgents();
        fetchAgentDetails(agentId);
      } else {
        showFeedback('error', data.detail || 'Failed to update deployment environment.');
      }
    } catch (e) {
      showFeedback('error', 'Network error changing environment settings.');
    }
  };

  const handleMoveAgentOS = async (agentId, newOS) => {
    if (role !== 'admin') return;
    try {
      const res = await authFetch(`/api/opamp/agent/${agentId}/os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os: newOS })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `OS type mapping updated to ${newOS.toUpperCase()}.`);
        fetchOpampAgents();
        fetchAgentDetails(agentId);
      } else {
        showFeedback('error', data.detail || 'Failed to update OS type.');
      }
    } catch (e) {
      showFeedback('error', 'Network error changing OS settings.');
    }
  };

  const handleBulkMoveGroup = async () => {
    if (selectedAgents.length === 0 || role !== 'admin') return;
    setOpampLoading(true);
    try {
      const res = await authFetch('/api/opamp/groups/bulk_apply_template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_ids: selectedAgents, group: bulkGroup })
      });
      const data = await res.json();
      if (res.ok) {
        showFeedback('success', `Applied template ${bulkGroup} to ${selectedAgents.length} virtual agents.`);
        setSelectedAgents([]);
        fetchOpampAgents();
        if (selectedAgent && selectedAgents.includes(selectedAgent)) {
          fetchAgentDetails(selectedAgent);
        }
      } else {
        showFeedback('error', data.detail || 'Failed to update configurations in bulk.');
      }
    } catch (e) {
      showFeedback('error', 'Network error applying bulk profiles.');
    } finally {
      setOpampLoading(false);
    }
  };

  // Chaos controls
  const triggerSimulation = async (type) => {
    try {
      await authFetch(`/api/simulator/${type}`, { method: 'POST' });
      const res = await authFetch('/api/simulator/status');
      const data = await res.json();
      setSimStatus(data.status);
    } catch (err) {
      console.error(err);
    }
  };

  const stopSimulation = async () => {
    try {
      await authFetch('/api/simulator/stop', { method: 'POST' });
      setSimStatus('normal');
    } catch (err) {
      console.error(err);
    }
  };

  // Status Indicators
  const hasCritical = netcoolAlerts.some(a => a.labels?.severity === 'critical') || mlAnomalies.some(a => a.severity === 'critical');
  const hasWarning = netcoolAlerts.length > 0 || mlAnomalies.length > 0;

  let statusClass = 'green';
  let statusText = 'System Normal';
  if (hasCritical) {
    statusClass = 'red';
    statusText = 'Critical Alert Active';
  } else if (hasWarning) {
    statusClass = 'amber';
    statusText = 'System Warnings';
  }

  // Chart configs helper
  const createChartData = (label, dataKey, expectedKey, actualColor, expectedColor) => {
    const labels = metrics.map(m => formatTime(m.timestamp));
    const actualData = metrics.map(m => m[dataKey] || 0.0);
    const expectedData = metrics.map(m => m.expected ? (m.expected[expectedKey] || 0.0) : 0.0);

    return {
      labels,
      datasets: [
        {
          label: `Actual ${label}`,
          data: actualData,
          borderColor: actualColor,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          fill: false,
        },
        {
          label: `Expected Normal`,
          data: expectedData,
          borderColor: expectedColor,
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.35,
          fill: false,
        }
      ]
    };
  };

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        titleFont: { family: 'Outfit', size: 11 },
        bodyFont: { family: 'Outfit', size: 11 }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { display: false } },
      y: {
        grid: { color: 'rgba(255, 255, 255, 0.03)' },
        ticks: { color: '#5B636E', font: { family: 'Outfit', size: 9 } }
      }
    }
  };

  // Fleet selector logic
  const filteredAgents = opampAgents.filter((agent) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term || agent.id.toLowerCase().includes(term) || (agent.name && agent.name.toLowerCase().includes(term));
    const matchesGroup = groupFilter === 'All' || agent.group === groupFilter;
    return matchesSearch && matchesGroup;
  });

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedAgents(filteredAgents.map(a => a.id));
    } else {
      setSelectedAgents([]);
    }
  };

  const handleSelectAgentCheckbox = (agentId) => {
    setSelectedAgents(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    );
  };

  const renderFleetsTab = () => {
    const availableAgents = opampAgents.filter(a => !selectedFleet?.agent_ids?.includes(a.id));

    const handleAssignAgents = async () => {
      if (!selectedFleet || agentsToAssign.length === 0) return;
      try {
        setOpampLoading(true);
        const res = await authFetch(`/api/fleets/${selectedFleet.name}/assign_agents`, {
          method: 'POST',
          body: JSON.stringify({ agent_ids: agentsToAssign })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Agents assigned successfully.');
          setAgentsToAssign([]);
          setShowAddAgentsModal(false);
          await fetchFleets();
          await fetchOpampAgents();
        } else {
          showFeedback('error', data.detail || 'Failed to assign agents.');
        }
      } catch (err) {
        showFeedback('error', 'Network error assigning agents.');
      } finally {
        setOpampLoading(false);
      }
    };

    const handleAssignConfigToFleet = async (configName) => {
      if (!selectedFleet) return;
      try {
        setOpampLoading(true);
        const res = await authFetch(`/api/fleets/${selectedFleet.name}/assign_config`, {
          method: 'POST',
          body: JSON.stringify({ config_name: configName })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Config assigned to fleet.');
          await fetchFleets();
        } else {
          showFeedback('error', data.detail || 'Failed to assign config.');
        }
      } catch (err) {
        showFeedback('error', 'Network error assigning config.');
      } finally {
        setOpampLoading(false);
      }
    };

    const handleCreateFleet = async (name, desc, cfg) => {
      try {
        setOpampLoading(true);
        const res = await authFetch('/api/fleets', {
          method: 'POST',
          body: JSON.stringify({ name, description: desc, config_name: cfg })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Fleet created.');
          await fetchFleets();
        } else {
          showFeedback('error', data.detail || 'Failed to create fleet.');
        }
      } catch (err) {
        showFeedback('error', 'Network error creating fleet.');
      } finally {
        setOpampLoading(false);
      }
    };

    const handleDeleteFleet = async (fleetName) => {
      if (fleetName === 'Default') {
        showFeedback('error', 'Cannot delete Default fleet.');
        return;
      }
      if (!window.confirm(`Are you sure you want to delete fleet '${fleetName}'?`)) return;
      try {
        setOpampLoading(true);
        const res = await authFetch(`/api/fleets/${fleetName}`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Fleet deleted.');
          setSelectedFleet(null);
          await fetchFleets();
        } else {
          showFeedback('error', data.detail || 'Failed to delete fleet.');
        }
      } catch (err) {
        showFeedback('error', 'Network error deleting fleet.');
      } finally {
        setOpampLoading(false);
      }
    };

    return (
      <div className="layout-grid">
        {/* Left Column: Fleets List */}
        <div className="perplexity-card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2><Network size={16} className="brand-icon" /> Fleets Manager</h2>
            {role === 'admin' && (
              <button className="action-btn" onClick={() => {
                const name = prompt("Enter new fleet name:");
                if (name) handleCreateFleet(name, "Telemetry fleet group", "Default");
              }} style={{ fontSize: '0.65rem', padding: '4px 8px' }}>
                <Plus size={12} /> Create Fleet
              </button>
            )}
          </div>
          
          <div className="agent-list-scroll" style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {fleets.map((fleet) => {
              const isSelected = selectedFleet?.name === fleet.name;
              return (
                <div
                  key={fleet.name}
                  className={`agent-row-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedFleet(fleet)}
                  style={{ cursor: 'pointer', padding: '12px', marginBottom: '8px', border: '1px solid var(--border-color)', borderRadius: '6px', background: isSelected ? 'rgba(32, 203, 194, 0.05)' : 'rgba(255,255,255,0.01)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: '700', color: isSelected ? 'var(--perplexity-mint)' : 'inherit' }}>
                      {fleet.name}
                    </h3>
                    <span className="card-badge">
                      {fleet.agent_ids?.length || 0} agents
                    </span>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {fleet.description}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    <span>Config: <code>{fleet.config_name}</code></span>
                    {role === 'admin' && fleet.name !== 'Default' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFleet(fleet.name);
                        }}
                        style={{ background: 'none', border: 'none', color: 'var(--alert-red)', cursor: 'pointer', padding: 0 }}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Fleet Details & Telemetry */}
        <div className="alerts-col">
          {selectedFleet ? (
            <>
              {/* Telemetry Overview & Stats Card */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2>{selectedFleet.name} Telemetry Flow Overview</h2>
                  <span className="card-badge mint">Live Streams</span>
                </div>

                {fleetTelemetry ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                      <div className="chart-wrapper" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Metrics Flow</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--perplexity-mint)', marginTop: '4px' }}>
                          {(fleetTelemetry.telemetry.metrics_bytes_per_hour / (1024 * 1024)).toFixed(2)} MB/h
                        </div>
                      </div>
                      <div className="chart-wrapper" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Logs Flow</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#60a5fa', marginTop: '4px' }}>
                          {(fleetTelemetry.telemetry.logs_bytes_per_hour / 1024).toFixed(1)} KB/h
                        </div>
                      </div>
                      <div className="chart-wrapper" style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Traces Flow</div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#a78bfa', marginTop: '4px' }}>
                          {fleetTelemetry.telemetry.traces_bytes_per_hour > 0 
                            ? (fleetTelemetry.telemetry.traces_bytes_per_hour / (1024 * 1024)).toFixed(1) + ' MB/h'
                            : '0 B/h'
                          }
                        </div>
                      </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '12px' }}>
                      <h4 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>Agent Summary</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', textAlign: 'center', fontSize: '0.7rem' }}>
                        <div>
                          <div style={{ color: 'var(--perplexity-mint)', fontWeight: 'bold', fontSize: '1rem' }}>{fleetTelemetry.status.connected}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Connected</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--alert-gold)', fontWeight: 'bold', fontSize: '1rem' }}>{fleetTelemetry.status.warning}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Warning</div>
                        </div>
                        <div>
                          <div style={{ color: 'var(--alert-red)', fontWeight: 'bold', fontSize: '1rem' }}>{fleetTelemetry.status.offline}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Offline</div>
                        </div>
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '1rem' }}>{fleetTelemetry.status.total}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>Total</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <RefreshCw className="loading-spinner" size={24} />
                    <p>Loading telemetry rates...</p>
                  </div>
                )}
              </div>

              {/* Config & Agent Management */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2>Configuration Inheritance</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Assigned Config Profile:</span>
                    {role === 'admin' ? (
                      <select
                        className="inject-select"
                        value={selectedFleet.config_name}
                        onChange={(e) => handleAssignConfigToFleet(e.target.value)}
                        style={{ width: '180px', padding: '4px', background: '#090a0c', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                      >
                        {configurations.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="card-badge"><code>{selectedFleet.config_name}</code></span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    All agents assigned to this fleet automatically inherit the metrics, processors, and exporter definitions defined in the config profile.
                  </p>
                </div>
              </div>

              {/* Member Agents Grid */}
              <div className="perplexity-card">
                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2>Member Agents ({selectedFleet.agent_ids?.length || 0})</h2>
                  {role === 'admin' && (
                    <button className="action-btn" onClick={() => setShowAddAgentsModal(true)} style={{ fontSize: '0.65rem', padding: '4px 8px' }}>
                      <Plus size={12} /> Assign Agents
                    </button>
                  )}
                </div>

                <div className="alert-feed" style={{ maxHeight: '250px', overflowY: 'auto' }}>
                  {selectedFleet.agent_ids?.length > 0 ? (
                    opampAgents.filter(a => selectedFleet.agent_ids.includes(a.id)).map(agent => (
                      <div key={agent.id} className="alert-row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', fontSize: '0.75rem' }}>{agent.name}</span>
                          <span className={`status-badge ${agent.status.toLowerCase()}`}>{agent.status}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          <span>OS: {agent.os}</span>
                          <span>IP: {agent.ip}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state" style={{ padding: '20px 0' }}>
                      <Terminal size={24} className="empty-icon text-muted" />
                      <p style={{ fontSize: '0.75rem' }}>No agents assigned to this fleet.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="perplexity-card" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="empty-state">
                <Network size={36} className="empty-icon text-muted" />
                <p>Select a fleet from the list to view telemetry and manage nodes.</p>
              </div>
            </div>
          )}
        </div>

        {/* Assign Agents Modal */}
        {showAddAgentsModal && (
          <div className="modal-backdrop" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="perplexity-card modal-content" style={{ width: '450px', background: '#0d0e12', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '20px' }}>
              <div className="card-title">
                <h2>Assign Agents to {selectedFleet?.name}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '12px 0' }}>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Select one or more agents to move them into the <strong>{selectedFleet?.name}</strong> fleet. They will inherit config <strong>{selectedFleet?.config_name}</strong>.
                </p>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px', background: '#090a0c' }}>
                  {availableAgents.length > 0 ? (
                    availableAgents.map(a => {
                      const isChecked = agentsToAssign.includes(a.id);
                      return (
                        <div
                          key={a.id}
                          onClick={() => {
                            setAgentsToAssign(prev =>
                              prev.includes(a.id) ? prev.filter(id => id !== a.id) : [...prev, a.id]
                            );
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                        >
                          {isChecked ? <CheckSquare size={14} className="text-purple-400" /> : <Square size={14} />}
                          <span style={{ fontSize: '0.75rem' }}>{a.name} ({a.os})</span>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      All active agents are already in this fleet.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button className="action-btn" onClick={() => { setShowAddAgentsModal(false); setAgentsToAssign([]); }} style={{ border: '1px solid var(--border-color)', background: 'transparent' }}>
                  Cancel
                </button>
                <button className="action-btn primary" onClick={handleAssignAgents} disabled={agentsToAssign.length === 0} style={{ background: 'var(--perplexity-mint)', color: 'black', fontWeight: 'bold' }}>
                  Move Agents
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderConfigurationsTab = () => {
    const activeMetrics = parseMetricsFromYaml(draftConfigYaml);

    const handleToggleMetricCheckbox = (metricKey, val) => {
      const nextYaml = updateYamlMetrics(draftConfigYaml, metricKey, val);
      setDraftConfigYaml(nextYaml);
    };

    const handleSaveConfigVersion = async () => {
      if (!selectedConfig) return;
      try {
        setOpampLoading(true);
        const res = await authFetch('/api/configurations', {
          method: 'POST',
          body: JSON.stringify({
            name: selectedConfig.name,
            description: selectedConfig.description,
            platform: selectedConfig.platform,
            config: draftConfigYaml,
            change_description: configChangeDesc || 'Updated configuration parameters'
          })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Config version rolled out.');
          setPrevConfigName('');
          await fetchConfigurations();
          await fetchConfigVersions(selectedConfig.name);
        } else {
          showFeedback('error', data.detail || 'Failed to save config version.');
        }
      } catch (err) {
        showFeedback('error', 'Network error saving configuration.');
      } finally {
        setOpampLoading(false);
      }
    };

    const handleRollbackConfig = async (ver) => {
      if (!selectedConfig) return;
      if (!window.confirm(`Are you sure you want to rollback ${selectedConfig.name} to Version ${ver}?`)) return;
      try {
        setOpampLoading(true);
        const res = await authFetch(`/api/configurations/${selectedConfig.name}/rollback`, {
          method: 'POST',
          body: JSON.stringify({ version: ver })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('success', data.message || 'Configuration rolled back.');
          setPrevConfigName('');
          await fetchConfigurations();
          await fetchConfigVersions(selectedConfig.name);
        } else {
          showFeedback('error', data.detail || 'Failed to rollback.');
        }
      } catch (err) {
        showFeedback('error', 'Network error during rollback.');
      } finally {
        setOpampLoading(false);
      }
    };

    const filteredConfigs = configurations.filter(c =>
      c.name.toLowerCase().includes(configsFilter.toLowerCase()) ||
      c.description.toLowerCase().includes(configsFilter.toLowerCase())
    );

    const versionAData = configVersions.find(r => r.version === compareVersionA);
    const versionBData = configVersions.find(r => r.version === compareVersionB);
    const diffRows = versionAData && versionBData ? getSplitDiff(versionAData.config, versionBData.config) : [];

    return (
      <div className="layout-grid">
        {/* Left Column: Configurations Profiles List */}
        <div className="perplexity-card">
          <div className="card-title">
            <h2><Settings size={16} className="brand-icon" /> Configurations Library</h2>
          </div>
          
          <div style={{ margin: '8px 0 12px 0' }}>
            <input
              type="text"
              className="search-bar-input"
              placeholder="Search configurations..."
              value={configsFilter}
              onChange={(e) => setConfigsFilter(e.target.value)}
              style={{ width: '100%', fontSize: '0.75rem', padding: '6px', background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white' }}
            />
          </div>

          <div className="agent-list-scroll" style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {filteredConfigs.map((config) => {
              const isSelected = selectedConfig?.name === config.name;
              return (
                <div
                  key={config.name}
                  className={`agent-row-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedConfig(config)}
                  style={{ cursor: 'pointer', padding: '12px', marginBottom: '8px', border: '1px solid var(--border-color)', borderRadius: '6px', background: isSelected ? 'rgba(32, 203, 194, 0.05)' : 'rgba(255,255,255,0.01)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: '700', color: isSelected ? 'var(--perplexity-mint)' : 'inherit' }}>
                      {config.name}
                    </h3>
                    <span className="card-badge mint">
                      v{config.version}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    {config.description}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    <span>Platform: <strong>{config.platform}</strong></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Configuration Details, Visual Pipeline and Versioning */}
        <div className="alerts-col">
          {selectedConfig ? (
            <>
              {/* Config details */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2>{selectedConfig.name} Profile Settings</h2>
                  <span className="card-badge">Platform: {selectedConfig.platform}</span>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {selectedConfig.description}
                </p>
              </div>

              {/* Visual Pipeline checklist */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2>Visual Telemetry Pipeline (Sources & Metrics)</h2>
                </div>
                
                {/* Source Node Visual Mapping */}
                <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', borderRadius: '6px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    <div style={{ textAlign: 'center' }}>
                      <HardDrive size={20} className="text-purple-400" />
                      <div style={{ fontWeight: 'bold', marginTop: '4px' }}>Sources</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>hostmetrics</div>
                    </div>
                    <div>&gt;&gt;</div>
                    <div style={{ textAlign: 'center' }}>
                      <Cpu size={20} className="text-purple-400" />
                      <div style={{ fontWeight: 'bold', marginTop: '4px' }}>Processors</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>batch (10s)</div>
                    </div>
                    <div>&gt;&gt;</div>
                    <div style={{ textAlign: 'center' }}>
                      <Network size={20} className="text-purple-400" />
                      <div style={{ fontWeight: 'bold', marginTop: '4px' }}>Destinations</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>prometheus, kafka</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.75rem' }}>
                  {/* CPU Metrics Checklist */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--perplexity-mint)' }}>
                      CPU Metrics
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.cpuTime}
                          onChange={(e) => handleToggleMetricCheckbox('cpuTime', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.cpu.time
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.cpuUtil}
                          onChange={(e) => handleToggleMetricCheckbox('cpuUtil', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.cpu.utilization
                      </label>
                    </div>
                  </div>

                  {/* Load Metrics Checklist */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--perplexity-mint)' }}>
                      Load Metrics
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.load1m}
                          onChange={(e) => handleToggleMetricCheckbox('load1m', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.cpu.load_average.1m
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.load5m}
                          onChange={(e) => handleToggleMetricCheckbox('load5m', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.cpu.load_average.5m
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.load15m}
                          onChange={(e) => handleToggleMetricCheckbox('load15m', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.cpu.load_average.15m
                      </label>
                    </div>
                  </div>

                  {/* Memory Metrics Checklist */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--perplexity-mint)' }}>
                      Memory Metrics
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.memUsage}
                          onChange={(e) => handleToggleMetricCheckbox('memUsage', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.memory.usage
                      </label>
                    </div>
                  </div>

                  {/* Filesystem Metrics Checklist */}
                  <div style={{ background: 'rgba(255,255,255,0.01)', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ fontWeight: 'bold', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--perplexity-mint)' }}>
                      Filesystem Metrics
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.fsUsage}
                          onChange={(e) => handleToggleMetricCheckbox('fsUsage', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.filesystem.usage
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.fsUtil}
                          onChange={(e) => handleToggleMetricCheckbox('fsUtil', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.filesystem.utilization
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={activeMetrics.fsInodes}
                          onChange={(e) => handleToggleMetricCheckbox('fsInodes', e.target.checked)}
                          disabled={role !== 'admin'}
                        />
                        system.filesystem.inodes.usage
                      </label>
                    </div>
                  </div>
                </div>

                {/* Edit Change Description and Save */}
                {role === 'admin' && (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                      type="text"
                      className="search-bar-input"
                      placeholder="Version change description (e.g. Disabled cpu.time)"
                      value={configChangeDesc}
                      onChange={(e) => setConfigChangeDesc(e.target.value)}
                      style={{ fontSize: '0.75rem', padding: '6px', background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white' }}
                    />
                    <button className="login-btn-primary" onClick={handleSaveConfigVersion} style={{ width: '100%' }}>
                      Rollout Config Version (v{selectedConfig.version + 1})
                    </button>
                  </div>
                )}
              </div>

              {/* Version diff view */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2>Version History Comparison</h2>
                </div>
                
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px', fontSize: '0.75rem' }}>
                  <span>Compare Version</span>
                  <select
                    className="inject-select"
                    value={compareVersionB || ''}
                    onChange={(e) => setCompareVersionB(Number(e.target.value))}
                    style={{ padding: '2px 6px', background: '#090a0c', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                  >
                    {configVersions.map(r => (
                      <option key={r.version} value={r.version}>v{r.version} ({r.description})</option>
                    ))}
                  </select>
                  <span>with Version</span>
                  <select
                    className="inject-select"
                    value={compareVersionA || ''}
                    onChange={(e) => setCompareVersionA(Number(e.target.value))}
                    style={{ padding: '2px 6px', background: '#090a0c', color: 'white', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                  >
                    {configVersions.map(r => (
                      <option key={r.version} value={r.version}>v{r.version} (Live)</option>
                    ))}
                  </select>
                </div>

                {diffRows.length > 0 ? (
                  <div className="diff-container" style={{ height: '600px', maxHeight: '600px' }}>
                    {/* Column A (Left: Version B / Old Version) */}
                    <div className="diff-pane">
                      <div style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                        Version {compareVersionB} config:
                      </div>
                      {diffRows.map((row, idx) => (
                        <div key={`left-${idx}`} className={`diff-line ${row.typeB === 'added' ? 'added' : row.typeB === 'deleted' ? 'deleted' : row.typeB === 'modified-add' ? 'modified-add' : row.typeB === 'modified-del' ? 'modified-del' : ''}`}>
                          <span className="diff-num">{row.numB}</span>
                          <span className="diff-content">{row.contentB}</span>
                        </div>
                      ))}
                    </div>
                    {/* Column B (Right: Version A / New Version) */}
                    <div className="diff-pane">
                      <div style={{ fontSize: '0.65rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                        Version {compareVersionA} config:
                      </div>
                      {diffRows.map((row, idx) => (
                        <div key={`right-${idx}`} className={`diff-line ${row.typeA === 'added' ? 'added' : row.typeA === 'deleted' ? 'deleted' : row.typeA === 'modified-add' ? 'modified-add' : row.typeA === 'modified-del' ? 'modified-del' : ''}`}>
                          <span className="diff-num">{row.numA}</span>
                          <span className="diff-content">{row.contentA}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    No version comparison selected or data unavailable.
                  </div>
                )}

                {role === 'admin' && compareVersionB && compareVersionB !== selectedConfig.version && (
                  <div style={{ marginTop: '12px' }}>
                    <button
                      className="action-btn"
                      onClick={() => handleRollbackConfig(compareVersionB)}
                      style={{ width: '100%', border: '1px solid var(--alert-gold)', background: 'rgba(245,158,11,0.05)', color: 'var(--alert-gold)' }}
                    >
                      Rollback to Version {compareVersionB}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="perplexity-card" style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="empty-state">
                <Settings size={36} className="empty-icon text-muted" />
                <p>Select a configuration from the list to toggle metrics and compare histories.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderAuditTab = () => {
    const formatTime = (ts) => {
      if (!ts) return '--:--:--';
      const date = new Date(ts * 1000);
      return date.toLocaleString();
    };

    const getActionBadgeColor = (action) => {
      const act = action.toUpperCase();
      if (act.includes('LOGIN') || act.includes('SIGNUP')) return 'rgba(32, 203, 194, 0.1)'; // Mint/cyan
      if (act.includes('CREATE') || act.includes('SAVE') || act.includes('APPLY') || act.includes('ROLLBACK')) return 'rgba(16, 185, 129, 0.1)'; // Green
      if (act.includes('DELETE') || act.includes('STRESS') || act.includes('ROTATE')) return 'rgba(239, 68, 68, 0.1)'; // Red/Pink
      return 'rgba(245, 158, 11, 0.1)'; // Gold/Orange
    };

    const getActionBadgeTextColor = (action) => {
      const act = action.toUpperCase();
      if (act.includes('LOGIN') || act.includes('SIGNUP')) return 'var(--perplexity-mint)';
      if (act.includes('CREATE') || act.includes('SAVE') || act.includes('APPLY') || act.includes('ROLLBACK')) return '#10b981'; // Green
      if (act.includes('DELETE') || act.includes('STRESS') || act.includes('ROTATE')) return '#ef4444'; // Red
      return 'var(--alert-gold)';
    };

    const handleClearFilters = () => {
      setAuditFilterUser('');
      setAuditFilterAction('');
      setAuditFilterTarget('');
      setAuditOffset(0);
    };

    const handlePrevPage = () => {
      if (auditOffset >= auditLimit) {
        setAuditOffset(auditOffset - auditLimit);
      }
    };

    const handleNextPage = () => {
      if (auditOffset + auditLimit < auditTotal) {
        setAuditOffset(auditOffset + auditLimit);
      }
    };

    return (
      <div className="layout-grid-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div className="perplexity-card" style={{ marginBottom: '0' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2><ShieldCheck size={18} className="brand-icon" style={{ color: 'var(--perplexity-mint)' }} /> Security Audit Trail</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="action-btn"
                onClick={fetchAuditLogs}
                disabled={auditLoading}
                style={{ padding: '6px 12px', fontSize: '0.75rem' }}
              >
                <RefreshCw size={12} className={auditLoading ? 'animate-spin' : ''} /> Refresh Logs
              </button>
            </div>
          </div>
          
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            System-wide record of all administrative changes, credentials management, agent configurations, and telemetry chaos runs.
          </p>

          {/* Filter Bar */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr)) 120px', 
            gap: '12px', 
            background: 'rgba(9, 10, 12, 0.5)', 
            padding: '16px', 
            borderRadius: '8px', 
            border: '1px solid var(--border-color)',
            marginBottom: '20px',
            alignItems: 'end'
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>Operator Username</label>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: '8px', top: '10px', color: 'var(--text-muted)' }} />
                <input 
                  type="text"
                  className="search-bar-input"
                  placeholder="Filter by operator..."
                  value={auditFilterUser}
                  onChange={(e) => { setAuditFilterUser(e.target.value); setAuditOffset(0); }}
                  style={{ width: '100%', fontSize: '0.75rem', padding: '6px 6px 6px 28px', background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>Action Category</label>
              <select
                value={auditFilterAction}
                onChange={(e) => { setAuditFilterAction(e.target.value); setAuditOffset(0); }}
                style={{ width: '100%', fontSize: '0.75rem', padding: '6px', background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', height: '31px' }}
              >
                <option value="">All Actions</option>
                <option value="LOGIN">User Logins</option>
                <option value="SIGNUP">User Signups</option>
                <option value="UPDATE_AGENT">Agent Updates</option>
                <option value="UPDATE_AGENT_STATUS">Agent Status Changes</option>
                <option value="UPDATE_GROUP_TEMPLATE">Group Template Rollouts</option>
                <option value="BULK_APPLY_TEMPLATE">Bulk Group Transfers</option>
                <option value="ROTATE_AGENT_CERT">mTLS Cert Rotations</option>
                <option value="SET_CONNECTION_SETTINGS">Connection Override Changes</option>
                <option value="SEND_CUSTOM_MESSAGE">Custom Agent Msg Trigger</option>
                <option value="CREATE_FLEET">Fleet Creations</option>
                <option value="DELETE_FLEET">Fleet Deletions</option>
                <option value="SAVE_CONFIG">Config Library Saves</option>
                <option value="ROLLBACK_CONFIG">Config Rollbacks</option>
                <option value="START_CHAOS_STRESS">Stress Tests Initiated</option>
                <option value="STOP_CHAOS_STRESS">Stress Tests Stopped</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 'bold' }}>Target Object ID</label>
              <div style={{ position: 'relative' }}>
                <Search size={12} style={{ position: 'absolute', left: '8px', top: '10px', color: 'var(--text-muted)' }} />
                <input 
                  type="text"
                  className="search-bar-input"
                  placeholder="Filter by target..."
                  value={auditFilterTarget}
                  onChange={(e) => { setAuditFilterTarget(e.target.value); setAuditOffset(0); }}
                  style={{ width: '100%', fontSize: '0.75rem', padding: '6px 6px 6px 28px', background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white' }}
                />
              </div>
            </div>

            <div>
              <button
                className="action-btn"
                onClick={handleClearFilters}
                style={{ width: '100%', padding: '7px', fontSize: '0.75rem', height: '31px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Audit Logs Table List */}
          {auditLoading && auditLogs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
              <div className="animate-spin" style={{ width: '24px', height: '24px', border: '2px solid var(--perplexity-mint)', borderTopColor: 'transparent', borderRadius: '50%' }}></div>
              <p style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Loading security logs...</p>
            </div>
          ) : auditLogs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
              <ShieldCheck size={36} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>No audit events found matching filters.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: '800px' }}>
                {/* Table Header Row */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: '170px 100px 180px 180px 120px 1fr 50px', 
                  padding: '12px 16px', 
                  background: 'rgba(255,255,255,0.02)', 
                  borderBottom: '1px solid var(--border-color)', 
                  fontSize: '0.7rem', 
                  fontWeight: 'bold', 
                  textTransform: 'uppercase', 
                  color: 'var(--text-muted)' 
                }}>
                  <div>Timestamp</div>
                  <div>Operator</div>
                  <div>Action</div>
                  <div>Target</div>
                  <div>IP Address</div>
                  <div>Details Summary</div>
                  <div style={{ textAlign: 'right' }}>Payload</div>
                </div>

                {/* Table Body Rows */}
                {auditLogs.map((log) => {
                  const isExpanded = expandedAuditId === log.id;
                  let parsedDetails = null;
                  try {
                    if (log.details && (log.details.startsWith('{') || log.details.startsWith('['))) {
                      parsedDetails = JSON.parse(log.details);
                    }
                  } catch (e) {}

                  return (
                    <div key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: '170px 100px 180px 180px 120px 1fr 50px', 
                        padding: '12px 16px', 
                        fontSize: '0.75rem', 
                        alignItems: 'center',
                        background: isExpanded ? 'rgba(255,255,255,0.01)' : 'transparent',
                        transition: 'background 0.2s'
                      }}>
                        <div style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{formatTime(log.timestamp)}</div>
                        <div style={{ fontWeight: '600' }}>{log.username}</div>
                        <div>
                          <span style={{ 
                            padding: '2px 8px', 
                            borderRadius: '4px', 
                            fontSize: '0.65rem', 
                            fontWeight: '700',
                            fontFamily: 'monospace',
                            background: getActionBadgeColor(log.action),
                            color: getActionBadgeTextColor(log.action),
                            border: `1px solid ${getActionBadgeColor(log.action).replace('0.1', '0.2')}`
                          }}>
                            {log.action}
                          </span>
                        </div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.target}>
                          {log.target || '--'}
                        </div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.ip_address || 'unknown'}</div>
                        <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.details}>
                          {log.details && log.details.length > 80 && !parsedDetails ? `${log.details.substring(0, 80)}...` : log.details || '--'}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => setExpandedAuditId(isExpanded ? null : log.id)}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              color: 'var(--text-muted)', 
                              cursor: 'pointer',
                              padding: '4px' 
                            }}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded Section showing Details payload */}
                      {isExpanded && (
                        <div style={{ 
                          padding: '16px', 
                          background: 'rgba(9, 10, 12, 0.8)', 
                          borderTop: '1px dashed var(--border-color)', 
                          fontSize: '0.75rem',
                          fontFamily: 'monospace'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <strong style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Log Details Payload</strong>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>ID: {log.id}</span>
                          </div>
                          {parsedDetails ? (
                            <pre style={{ 
                              margin: 0, 
                              padding: '12px', 
                              background: '#040506', 
                              borderRadius: '4px', 
                              border: '1px solid var(--border-color)', 
                              color: 'var(--perplexity-mint)',
                              overflowX: 'auto',
                              fontSize: '0.7rem'
                            }}>
                              {JSON.stringify(parsedDetails, null, 2)}
                            </pre>
                          ) : (
                            <div style={{ 
                              padding: '12px', 
                              background: '#040506', 
                              borderRadius: '4px', 
                              border: '1px solid var(--border-color)', 
                              color: 'var(--text-secondary)',
                              whiteSpace: 'pre-wrap',
                              fontSize: '0.7rem'
                            }}>
                              {log.details || 'No detailed parameters recorded.'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pagination Footer */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginTop: '20px', 
            paddingTop: '16px', 
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)'
          }}>
            <div>
              <span>Show </span>
              <select
                value={auditLimit}
                onChange={(e) => { setAuditLimit(parseInt(e.target.value)); setAuditOffset(0); }}
                style={{ background: '#090a0c', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'white', padding: '2px 4px', fontSize: '0.75rem' }}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <span> entries</span>
            </div>

            <div>
              Showing {auditTotal === 0 ? 0 : auditOffset + 1} to {Math.min(auditOffset + auditLimit, auditTotal)} of {auditTotal} entries
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="action-btn"
                disabled={auditOffset === 0 || auditLoading}
                onClick={handlePrevPage}
                style={{ padding: '4px 12px', fontSize: '0.75rem', opacity: auditOffset === 0 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <button
                className="action-btn"
                disabled={auditOffset + auditLimit >= auditTotal || auditLoading}
                onClick={handleNextPage}
                style={{ padding: '4px 12px', fontSize: '0.75rem', opacity: auditOffset + auditLimit >= auditTotal ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render workspace panels
  const renderOpAmpWorkspace = () => {
    const center = { x: 400, y: 240 };
    const radius = 155;
    const nodes = filteredAgents.map((agent, index) => {
      const total = filteredAgents.length;
      const angle = total > 1 ? (index * 2 * Math.PI) / total : 0;
      const x = total > 1 ? center.x + radius * Math.cos(angle) : center.x;
      const y = total > 1 ? center.y + radius * Math.sin(angle) : center.y - 120;
      return { ...agent, x, y };
    });

    const renderTopologyMap = () => {
      return (
        <div className="topology-container" style={{ margin: '8px 0' }}>
          <svg viewBox="0 0 800 480" width="100%" height="100%" style={{ background: '#090a0c', borderRadius: '6px' }}>
            <defs>
              <radialGradient id="server-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="var(--perplexity-mint)" stopOpacity="0.15" />
                <stop offset="100%" stopColor="var(--perplexity-mint)" stopOpacity="0" />
              </radialGradient>
              <filter id="glow-effect" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Connection Lines */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedAgent;
              let strokeColor = 'rgba(255, 255, 255, 0.08)';
              if (isSelected) {
                strokeColor = 'var(--perplexity-mint)';
              } else if (node.status === 'Warning') {
                strokeColor = 'rgba(245, 158, 11, 0.2)';
              } else if (node.status === 'Offline') {
                strokeColor = 'rgba(239, 68, 68, 0.1)';
              } else {
                strokeColor = 'rgba(32, 203, 194, 0.2)';
              }

              return (
                <g key={`line-${node.id}`}>
                  <line
                    x1={node.x}
                    y1={node.y}
                    x2={center.x}
                    y2={center.y}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? "2" : "1.2"}
                  />
                  {node.status !== 'Offline' && (
                    <line
                      x1={node.x}
                      y1={node.y}
                      x2={center.x}
                      y2={center.y}
                      stroke={node.status === 'Warning' ? 'var(--alert-gold)' : 'var(--perplexity-mint)'}
                      strokeWidth={isSelected ? "2" : "1"}
                      opacity={isSelected ? 0.9 : 0.5}
                      className={`telemetry-line ${node.status.toLowerCase()}`}
                    />
                  )}
                </g>
              );
            })}

            {/* Pulsing Ring */}
            <circle
              cx={center.x}
              cy={center.y}
              r="45"
              fill="none"
              stroke="var(--perplexity-mint)"
              strokeWidth="1"
              opacity="0.3"
            >
              <animate attributeName="r" values="35;60;35" dur="4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="4s" repeatCount="indefinite" />
            </circle>

            {/* Central Server Glow Area */}
            <circle cx={center.x} cy={center.y} r="80" fill="url(#server-glow)" />

            {/* Central Node */}
            <g transform={`translate(${center.x}, ${center.y})`} style={{ cursor: 'default' }}>
              <circle r="32" fill="#131518" stroke="var(--perplexity-mint)" strokeWidth="2.5" filter="url(#glow-effect)" />
              <circle r="15" fill="none" stroke="var(--perplexity-mint)" strokeWidth="1.5" opacity="0.8" />
              <rect x="-8" y="-8" width="16" height="4" rx="1" fill="var(--perplexity-mint)" />
              <rect x="-8" y="-1" width="16" height="4" rx="1" fill="var(--perplexity-mint)" />
              <rect x="-8" y="6" width="16" height="4" rx="1" fill="var(--perplexity-mint)" />
              <circle cx="12" cy="12" r="3" fill="var(--alert-green)" />
              <text y="50" textAnchor="middle" fill="var(--perplexity-mint)" fontSize="11" fontWeight="700" letterSpacing="0.5px">
                OPAMP SERVER
              </text>
              <text y="62" textAnchor="middle" fill="var(--text-muted)" fontSize="9">
                Control Proxy (8000)
              </text>
            </g>

            {/* Agent Nodes */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedAgent;
              let nodeStrokeColor = 'rgba(255, 255, 255, 0.2)';
              if (node.status === 'Healthy') {
                nodeStrokeColor = 'var(--alert-green)';
              } else if (node.status === 'Warning') {
                nodeStrokeColor = 'var(--alert-gold)';
              } else if (node.status === 'Offline') {
                nodeStrokeColor = 'var(--alert-red)';
              }

              let osLabel = 'L';
              if (node.os === 'windows') osLabel = 'W';
              else if (node.os === 'mac') osLabel = 'M';

              return (
                <g
                  key={`node-${node.id}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  className={`topology-node ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedAgent(node.id)}
                  onMouseEnter={() => setHoveredAgent(node)}
                  onMouseLeave={() => setHoveredAgent(null)}
                >
                  {/* Invisible catcher circle for hover stability */}
                  <circle r="26" fill="transparent" style={{ pointerEvents: 'all' }} />

                  {node.status !== 'Offline' && (
                    <circle
                      r="20"
                      fill="none"
                      stroke={nodeStrokeColor}
                      strokeWidth="1"
                      opacity="0.6"
                    >
                      <animate attributeName="r" values="18;26;18" dur="2.5s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0;0.7" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle
                    r="18"
                    fill="#131518"
                    stroke={isSelected ? 'var(--perplexity-mint)' : nodeStrokeColor}
                    strokeWidth={isSelected ? "3" : "2"}
                  />
                  <text
                    textAnchor="middle"
                    dy=".3em"
                    fill={isSelected ? 'var(--perplexity-mint)' : 'var(--text-primary)'}
                    fontSize="10"
                    fontWeight="bold"
                    fontFamily="JetBrains Mono"
                  >
                    {osLabel}
                  </text>
                  {isSelected && (
                    <circle r="22" fill="none" stroke="var(--perplexity-mint)" strokeWidth="1" strokeDasharray="3 3" />
                  )}
                  <text
                    y="32"
                    textAnchor="middle"
                    fill={isSelected ? '#fff' : 'var(--text-secondary)'}
                    fontSize="9.5"
                    fontWeight={isSelected ? '700' : '500'}
                  >
                    {node.name || `${node.id.substring(0, 8)}`}
                  </text>
                  <text
                    y="42"
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    fontSize="8"
                    fontFamily="JetBrains Mono"
                  >
                    {node.group}
                  </text>
                </g>
              );
            })}

            {nodes.length === 0 && (
              <text x={center.x} y={center.y - 100} textAnchor="middle" fill="var(--text-muted)" fontSize="12">
                No nodes match search filters.
              </text>
            )}
          </svg>

          {/* Floating Tooltip HUD Card */}
          {hoveredAgent && (
            <div className="topology-tooltip-card">
              <div className="tooltip-title">
                <span>{hoveredAgent.name || 'Agent Detail'}</span>
                <span className={`card-badge ${hoveredAgent.status === 'Healthy' ? 'mint' : (hoveredAgent.status === 'Warning' ? 'gold' : 'red')}`}>
                  {hoveredAgent.status}
                </span>
              </div>
              <table className="tooltip-table">
                <tbody>
                  <tr>
                    <td>ID</td>
                    <td>{hoveredAgent.id.substring(0, 12)}...</td>
                  </tr>
                  <tr>
                    <td>Host OS</td>
                    <td style={{ textTransform: 'capitalize' }}>{hoveredAgent.os}</td>
                  </tr>
                  <tr>
                    <td>IP Address</td>
                    <td>{hoveredAgent.ip}</td>
                  </tr>
                  <tr>
                    <td>Deployment</td>
                    <td style={{ textTransform: 'uppercase' }}>{hoveredAgent.deployment_type}</td>
                  </tr>
                  <tr>
                    <td>Environment</td>
                    <td style={{ textTransform: 'uppercase' }}>{hoveredAgent.environment}</td>
                  </tr>
                  <tr>
                    <td>Group</td>
                    <td>{hoveredAgent.groups ? hoveredAgent.groups.join(', ') : (hoveredAgent.group || 'Default')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="opamp-workspace" style={viewMode === 'topology' ? { display: 'flex', flexDirection: 'column', gap: '24px' } : {}}>
        {/* Left Side: Fleet List */}
        <div className="perplexity-card" style={viewMode === 'topology' ? { gap: '12px', gridColumn: '1 / -1' } : { gap: '12px' }}>
          <div className="card-title" style={{ marginBottom: '2px' }}>
            <h2><Server size={16} className="brand-icon" /> Fleet Control Board</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                List
              </button>
              <button
                className={`view-toggle-btn ${viewMode === 'topology' ? 'active' : ''}`}
                onClick={() => setViewMode('topology')}
              >
                Topology
              </button>
              <span className="card-badge mint">{opampAgents.length} Configured</span>
            </div>
          </div>

          {/* Sidebar Search & Group Badges */}
          <div className="fleet-controls-container">
            <div className="fleet-search-wrapper">
              <Search size={14} className="fleet-search-icon" />
              <input
                type="text"
                placeholder="Search agent ID or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="fleet-group-filters">
              {['All', 'Default', 'Database-Nodes', 'Web-Servers'].map((g) => (
                <span
                  key={g}
                  className={`fleet-group-badge ${groupFilter === g ? 'active' : ''}`}
                  onClick={() => setGroupFilter(g)}
                >
                  {g}
                </span>
              ))}
            </div>
          </div>

          {viewMode === 'topology' ? (
            <>
              {renderTopologyMap()}

              {/* Quick Operations HUD Panel */}
              {selectedAgent && (
                <div className="quick-ops-hud" style={{ margin: '12px 0 4px 0' }}>
                  <div className="quick-ops-title">
                    <Zap size={14} className="brand-icon" />
                    <span>Quick Operations Hub: <strong>{opampAgents.find(a => a.id === selectedAgent)?.name || selectedAgent.substring(0, 8)}</strong></span>
                  </div>
                  <div className="quick-ops-buttons">
                    <button
                      className="ops-btn"
                      onClick={() => handleMoveAgentEnvironment(selectedAgent, opampAgents.find(a => a.id === selectedAgent)?.environment === 'prod' ? 'dev' : 'prod')}
                      disabled={role !== 'admin'}
                    >
                      Toggle Env ({opampAgents.find(a => a.id === selectedAgent)?.environment === 'prod' ? 'PROD -> DEV' : 'DEV -> PROD'})
                    </button>

                    <button
                      className="ops-btn alert"
                      onClick={async () => {
                        if (role !== 'admin') return;
                        try {
                          await authFetch(`/api/opamp/agent/${selectedAgent}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'Offline' })
                          });
                          fetchOpampAgents();
                        } catch (e) { console.error(e); }
                      }}
                      disabled={role !== 'admin'}
                    >
                      Simulate OFFLINE
                    </button>

                    <button
                      className="ops-btn gold"
                      onClick={async () => {
                        if (role !== 'admin') return;
                        try {
                          await authFetch(`/api/opamp/agent/${selectedAgent}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'Warning' })
                          });
                          fetchOpampAgents();
                        } catch (e) { console.error(e); }
                      }}
                      disabled={role !== 'admin'}
                    >
                      Simulate WARNING
                    </button>

                    <button
                      className="ops-btn"
                      onClick={async () => {
                        if (role !== 'admin') return;
                        try {
                          await authFetch(`/api/opamp/agent/${selectedAgent}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: 'Healthy' })
                          });
                          fetchOpampAgents();
                        } catch (e) { console.error(e); }
                      }}
                      disabled={role !== 'admin'}
                    >
                      Simulate HEALTHY
                    </button>

                    <button
                      className="ops-btn"
                      onClick={handleRotateCert}
                      disabled={role !== 'admin'}
                    >
                      Rotate Cert
                    </button>

                    <button
                      className="ops-btn"
                      onClick={() => {
                        const el = document.querySelector('.config-layout');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      Configure Override
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Bulk Actions Panel */}
              {role === 'admin' && selectedAgents.length > 0 && (
                <div className="bulk-actions-panel">
                  <span className="bulk-actions-info">{selectedAgents.length} Checked</span>
                  <div className="bulk-actions-btns">
                    <select
                      className="form-input"
                      style={{ width: '120px', padding: '4px 6px', fontSize: '0.7rem' }}
                      value={bulkGroup}
                      onChange={(e) => setBulkGroup(e.target.value)}
                    >
                      <option value="Default">Default</option>
                      <option value="Database-Nodes">Database-Nodes</option>
                      <option value="Web-Servers">Web-Servers</option>
                    </select>
                    <button
                      className="action-btn mint"
                      style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                      onClick={handleBulkMoveGroup}
                      disabled={opampLoading}
                    >
                      Apply Template
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  className="bulk-select-input"
                  checked={filteredAgents.length > 0 && selectedAgents.length === filteredAgents.length}
                  onChange={handleSelectAll}
                />
                <span>Select All Filtered</span>
              </div>

              <div className="agent-list-container" style={{ maxHeight: '600px', overflowY: 'auto' }}>
                {filteredAgents.length > 0 ? (
                  filteredAgents.map((agent) => {
                    const agentId = agent.id;
                    const isActive = agentId === selectedAgent;
                    const isChecked = selectedAgents.includes(agentId);

                    let statusBadgeColor = 'mint';
                    if (agent.status === 'Warning') statusBadgeColor = 'gold';
                    else if (agent.status === 'Offline') statusBadgeColor = 'red';

                    return (
                      <div
                        key={agentId}
                        className={`agent-list-item ${isActive ? 'active' : ''}`}
                        style={{ padding: '10px 12px' }}
                      >
                        <div className="agent-item-checkbox-wrapper">
                          <input
                            type="checkbox"
                            className="bulk-select-input"
                            checked={isChecked}
                            onChange={() => handleSelectAgentCheckbox(agentId)}
                          />
                          <div
                            onClick={() => setSelectedAgent(agentId)}
                            style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px' }}
                          >
                            <div className="agent-list-item-id" style={{ maxWidth: '160px', fontWeight: '500' }}>
                              {agent.name || agentId}
                            </div>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>
                              ID: {agentId.substring(0, 8)}... ({agent.group})
                            </span>
                          </div>
                        </div>

                        <span
                          className={`card-badge ${statusBadgeColor}`}
                          style={{ fontSize: '0.6rem', padding: '2px 6px', cursor: 'pointer' }}
                          onClick={() => setSelectedAgent(agentId)}
                        >
                          {agent.status || 'Active'}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <Server size={24} className="empty-icon text-muted" />
                    <p>No agents matched filter query.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Side: Details and controls */}
        {selectedAgent && agentDetails ? (
          <div className="agent-details-workspace" style={viewMode === 'topology' ? { gridColumn: '1 / -1' } : {}}>
            {/* Status Banner */}
            {opampFeedback.text && (
              <div
                className="perplexity-card"
                style={{
                  padding: '12px 16px',
                  borderLeft: `3px solid ${opampFeedback.type === 'success' ? 'var(--alert-green)' : 'var(--alert-red)'}`,
                  background: opampFeedback.type === 'success' ? 'var(--alert-green-dim)' : 'var(--alert-red-dim)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                {opampFeedback.type === 'success' ? <CheckCircle size={16} className="text-green-500" /> : <AlertTriangle size={16} className="text-red-500" />}
                <span style={{ fontSize: '0.8rem', fontWeight: '500' }}>{opampFeedback.text}</span>
              </div>
            )}

            {/* Header */}
            <div className="perplexity-card" style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span className="card-badge" style={{ alignSelf: 'flex-start' }}>Agent Profile details</span>
                <h2 style={{ fontSize: '1.1rem', fontFamily: 'JetBrains Mono', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {agentDetails.details.Name || selectedAgent}
                </h2>
              </div>

              <div className="action-bar">
                {/* Certificate rotate */}
                <button
                  className="action-btn mint"
                  onClick={handleRotateCert}
                  disabled={opampLoading || role !== 'admin'}
                  title={role !== 'admin' ? "Requires Administrator role" : ""}
                >
                  <Key size={14} /> {role !== 'admin' && <Lock size={10} style={{ marginRight: '2px' }} />} {agentDetails.client_cert?.status ? 'Accept & Offer Cert' : 'Rotate Client Cert'}
                </button>

                {/* External links */}
                <a href="http://localhost:9090" target="_blank" rel="noopener noreferrer" className="action-btn">
                  <Activity size={14} /> Prometheus <ExternalLink size={12} />
                </a>
                <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer" className="action-btn">
                  <Cpu size={14} /> Grafana <ExternalLink size={12} />
                </a>
                <a href="http://localhost:9093" target="_blank" rel="noopener noreferrer" className="action-btn">
                  <AlertTriangle size={14} /> Alertmanager <ExternalLink size={12} />
                </a>
                <a href="http://localhost:4321" target="_blank" rel="noopener noreferrer" className="action-btn">
                  <Server size={14} /> Go Server <ExternalLink size={12} />
                </a>
              </div>
            </div>

            {/* Group Selector & Details */}
            <div className="perplexity-card">
              <div className="card-title">
                <h2><Settings size={16} className="brand-icon" /> Properties & Configurations</h2>
                {role === 'admin' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Group:</span>
                    <select
                      className="form-input"
                      style={{ width: '130px', padding: '4px 6px' }}
                      value={agentDetails.details.Group || 'Default'}
                      onChange={(e) => handleMoveAgentGroup(selectedAgent, e.target.value)}
                    >
                      <option value="Default">Default</option>
                      <option value="Database-Nodes">Database-Nodes</option>
                      <option value="Web-Servers">Web-Servers</option>
                    </select>
                  </div>
                ) : (
                  <span className="card-badge gold"><Lock size={10} className="inline mr-1" /> Read-Only view</span>
                )}
              </div>
              <div className="agent-details-grid">
                <div>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px', fontWeight: '600' }}>Identity Mapping</h3>
                  <table className="detail-table">
                    <tbody>
                      <tr>
                        <td>Instance ID</td>
                        <td>{agentDetails.details["Instance ID"] || selectedAgent}</td>
                      </tr>
                      <tr>
                        <td>Host OS</td>
                        <td>
                          {role === 'admin' && agentDetails.details.Type.includes('Virtual') ? (
                            <select
                              className="form-input"
                              style={{ width: '100px', padding: '2px 4px', fontSize: '0.75rem' }}
                              value={agentDetails.details.OS || 'linux'}
                              onChange={(e) => handleMoveAgentOS(selectedAgent, e.target.value)}
                            >
                              <option value="linux">Linux</option>
                              <option value="windows">Windows</option>
                              <option value="mac">macOS</option>
                            </select>
                          ) : (
                            <span style={{ textTransform: 'capitalize' }}>{agentDetails.details.OS || 'linux'}</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td>IP Address</td>
                        <td>{agentDetails.details["IP"] || '127.0.0.1'}</td>
                      </tr>
                      <tr>
                        <td>Group template</td>
                        <td>{agentDetails.details["Group"] || 'Default'}</td>
                      </tr>
                      <tr>
                        <td>Deployment type</td>
                        <td>{agentDetails.details["Type"] || 'Physical Agent'}</td>
                      </tr>
                      <tr>
                        <td>Deploy Phase</td>
                        <td>
                          {role === 'admin' ? (
                            <select
                              className="form-input"
                              style={{ width: '100px', padding: '2px 4px', fontSize: '0.75rem' }}
                              value={agentDetails.details.Environment || 'dev'}
                              onChange={(e) => handleMoveAgentEnvironment(selectedAgent, e.target.value)}
                            >
                              <option value="dev">DEV</option>
                              <option value="uat">UAT</option>
                              <option value="prod">PROD</option>
                            </select>
                          ) : (
                            <span className={`card-badge ${agentDetails.details.Environment === 'prod' ? 'red' : (agentDetails.details.Environment === 'uat' ? 'gold' : 'mint')}`}>
                              {agentDetails.details.Environment ? agentDetails.details.Environment.toUpperCase() : 'DEV'}
                            </span>
                          )}
                        </td>
                      </tr>
                      {agentDetails.health_error && (
                        <tr>
                          <td>Health Error</td>
                          <td style={{ color: 'var(--alert-red)' }}>{agentDetails.health_error}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px', fontWeight: '600' }}>Otel Resource Attributes</h3>
                  <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    <table className="detail-table">
                      <tbody>
                        {Object.entries(agentDetails.attributes).map(([k, v]) => (
                          <tr key={k}>
                            <td>{k}</td>
                            <td>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Remote Config Workspace (Compare Inherited Group with Custom overrides) */}
            <div className="perplexity-card">
              <div className="card-title">
                <h2><HardDrive size={16} className="brand-icon" /> Configuration Inheritance Manager</h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    className={`view-toggle-btn ${configMode === 'visual' ? 'active' : ''}`}
                    onClick={() => handleToggleMode('visual')}
                  >
                    Visual Configurator
                  </button>
                  <button
                    className={`view-toggle-btn ${configMode === 'raw' ? 'active' : ''}`}
                    onClick={() => handleToggleMode('raw')}
                  >
                    Raw YAML Editor
                  </button>
                </div>
                {agentDetails.config_error && (
                  <span className="card-badge red">Runtime Error: {agentDetails.config_error}</span>
                )}
              </div>

              {agentDetails.config_error && (() => {
                const diag = getDiagnosticInfo(agentDetails.config_error);
                if (!diag) return null;
                return (
                  <div className={`diagnostics-alert ${diag.severity}`} style={{
                    padding: '16px',
                    margin: '12px 16px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '0.75rem',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: '700', marginBottom: '8px', color: '#f87171' }}>
                      <AlertTriangle size={16} />
                      <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Diagnostics: {diag.title}</span>
                    </div>
                    <p style={{ margin: '0 0 12px 0', color: 'var(--text-secondary)', fontSize: '0.72rem', lineHeight: '1.4' }}>
                      <strong>Possible Cause:</strong> {diag.cause}
                    </p>
                    <div style={{ fontWeight: '600', marginBottom: '6px', color: 'var(--text-primary)', fontSize: '0.72rem' }}>Actionable Troubleshooting Steps:</div>
                    <ul style={{ margin: '0', paddingLeft: '16px', color: 'var(--text-secondary)', lineHeight: '1.5', fontSize: '0.7rem' }}>
                      {diag.fix.map((f, i) => (
                        <li key={i} style={{ marginBottom: '6px' }}>{f}</li>
                      ))}
                    </ul>
                  </div>
                );
              })()}

              {configMode === 'visual' ? (
                <div className="visual-pipeline-builder">
                  {/* Column 1: Sources */}
                  <div className="pipeline-column">
                    <div className="pipeline-column-header">
                      <h3>Sources</h3>
                      <span className="pipeline-sub">Data Ingestion</span>
                    </div>
                    
                    {/* Hostmetrics Source Card */}
                    <div className={`pipeline-card ${visualConfig.sources.hostmetrics.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.sources.hostmetrics.enabled}
                            onChange={() => handleToggleSource('hostmetrics')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Host Metrics</span>
                        </label>
                        <span className="pipeline-badge">hostmetrics</span>
                      </div>
                      {visualConfig.sources.hostmetrics.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Interval</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.hostmetrics.collection_interval}
                              onChange={(e) => handleUpdateSourceField('hostmetrics', 'collection_interval', e.target.value)}
                              placeholder="e.g. 10s"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="scrapers-list mt-1">
                            <label className="section-label">Metrics Scrapers</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginTop: '4px' }}>
                              {['cpu', 'memory', 'disk', 'network', 'processes'].map(scraper => (
                                <label key={scraper} className="checkbox-option text-xs" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <input
                                    type="checkbox"
                                    checked={visualConfig.sources.hostmetrics[scraper]}
                                    onChange={(e) => handleUpdateSourceField('hostmetrics', scraper, e.target.checked)}
                                    disabled={role !== 'admin'}
                                  />
                                  <span style={{ textTransform: 'capitalize' }}>{scraper}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* PostgreSQL Source Card */}
                    <div className={`pipeline-card ${visualConfig.sources.postgresql.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.sources.postgresql.enabled}
                            onChange={() => handleToggleSource('postgresql')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">PostgreSQL DB</span>
                        </label>
                        <span className="pipeline-badge">postgresql</span>
                      </div>
                      {visualConfig.sources.postgresql.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Endpoint</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.postgresql.endpoint}
                              onChange={(e) => handleUpdateSourceField('postgresql', 'endpoint', e.target.value)}
                              placeholder="localhost:5432"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Username</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.postgresql.username}
                              onChange={(e) => handleUpdateSourceField('postgresql', 'username', e.target.value)}
                              placeholder="postgres"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Password</label>
                            <input
                              type="password"
                              className="form-input text-xs"
                              value={visualConfig.sources.postgresql.password}
                              onChange={(e) => handleUpdateSourceField('postgresql', 'password', e.target.value)}
                              placeholder="••••••••"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Interval</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.postgresql.collection_interval}
                              onChange={(e) => handleUpdateSourceField('postgresql', 'collection_interval', e.target.value)}
                              placeholder="10s"
                              disabled={role !== 'admin'}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Nginx Source Card */}
                    <div className={`pipeline-card ${visualConfig.sources.nginx.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.sources.nginx.enabled}
                            onChange={() => handleToggleSource('nginx')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Nginx Status</span>
                        </label>
                        <span className="pipeline-badge">nginx</span>
                      </div>
                      {visualConfig.sources.nginx.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Status URL</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.nginx.endpoint}
                              onChange={(e) => handleUpdateSourceField('nginx', 'endpoint', e.target.value)}
                              placeholder="http://localhost:80/status"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Interval</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.nginx.collection_interval}
                              onChange={(e) => handleUpdateSourceField('nginx', 'collection_interval', e.target.value)}
                              placeholder="5s"
                              disabled={role !== 'admin'}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* OTLP Ingestion Source Card */}
                    <div className={`pipeline-card ${visualConfig.sources.otlp.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.sources.otlp.enabled}
                            onChange={() => handleToggleSource('otlp')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">OTLP Ingest</span>
                        </label>
                        <span className="pipeline-badge">otlp</span>
                      </div>
                      {visualConfig.sources.otlp.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>gRPC Bind Address</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.otlp.grpc_endpoint}
                              onChange={(e) => handleUpdateSourceField('otlp', 'grpc_endpoint', e.target.value)}
                              placeholder="0.0.0.0:4317"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>HTTP Bind Address</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.sources.otlp.http_endpoint}
                              onChange={(e) => handleUpdateSourceField('otlp', 'http_endpoint', e.target.value)}
                              placeholder="0.0.0.0:4318"
                              disabled={role !== 'admin'}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Column 2: Processors (Connecting bridge) */}
                  <div className="pipeline-column middle-column">
                    <div className="pipeline-column-header">
                      <h3>Processors</h3>
                      <span className="pipeline-sub">Transforms</span>
                    </div>
                    
                    <div className="pipeline-arrow-flow-top"></div>
                    
                    {/* Batch Processor Card */}
                    <div className={`pipeline-card ${visualConfig.batchProcessor ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.batchProcessor}
                            onChange={handleToggleProcessor}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Batching</span>
                        </label>
                        <span className="pipeline-badge">batch</span>
                      </div>
                      {visualConfig.batchProcessor && (
                        <div className="card-expanded-fields text-xs text-muted" style={{ padding: '8px 10px', color: 'var(--text-muted)' }}>
                          Buffers and bundles metrics together for optimal socket throughput.
                        </div>
                      )}
                    </div>
                    
                    <div className="pipeline-arrow-flow-bottom"></div>
                  </div>

                  {/* Column 3: Destinations */}
                  <div className="pipeline-column">
                    <div className="pipeline-column-header">
                      <h3>Destinations</h3>
                      <span className="pipeline-sub">Exporters</span>
                    </div>
                    
                    {/* Prometheus Destination Card */}
                    <div className={`pipeline-card ${visualConfig.destinations.prometheus.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.destinations.prometheus.enabled}
                            onChange={() => handleToggleDestination('prometheus')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Prometheus</span>
                        </label>
                        <span className="pipeline-badge">prometheus</span>
                      </div>
                      {visualConfig.destinations.prometheus.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Scrape Endpoint</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.destinations.prometheus.endpoint}
                              onChange={(e) => handleUpdateDestinationField('prometheus', 'endpoint', e.target.value)}
                              placeholder="0.0.0.0:8889"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Namespace prefix</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.destinations.prometheus.namespace}
                              onChange={(e) => handleUpdateDestinationField('prometheus', 'namespace', e.target.value)}
                              placeholder="otelcol"
                              disabled={role !== 'admin'}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Kafka Destination Card */}
                    <div className={`pipeline-card ${visualConfig.destinations.kafka.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.destinations.kafka.enabled}
                            onChange={() => handleToggleDestination('kafka')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Kafka Broker</span>
                        </label>
                        <span className="pipeline-badge">kafka</span>
                      </div>
                      {visualConfig.destinations.kafka.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Brokers (comma list)</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.destinations.kafka.brokers}
                              onChange={(e) => handleUpdateDestinationField('kafka', 'brokers', e.target.value)}
                              placeholder="kafka:9092"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Topic</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.destinations.kafka.topic}
                              onChange={(e) => handleUpdateDestinationField('kafka', 'topic', e.target.value)}
                              placeholder="raw-metrics"
                              disabled={role !== 'admin'}
                            />
                          </div>
                          <div className="field-group">
                            <label>Encoding</label>
                            <select
                              className="form-input text-xs"
                              value={visualConfig.destinations.kafka.encoding}
                              onChange={(e) => handleUpdateDestinationField('kafka', 'encoding', e.target.value)}
                              disabled={role !== 'admin'}
                            >
                              <option value="otlp_json">OTLP JSON</option>
                              <option value="otlp_proto">OTLP Protobuf</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* OTLP Gateway Destination Card */}
                    <div className={`pipeline-card ${visualConfig.destinations.otlp.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.destinations.otlp.enabled}
                            onChange={() => handleToggleDestination('otlp')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">OTLP Exporter</span>
                        </label>
                        <span className="pipeline-badge">otlp</span>
                      </div>
                      {visualConfig.destinations.otlp.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Gateway Endpoint</label>
                            <input
                              type="text"
                              className="form-input text-xs"
                              value={visualConfig.destinations.otlp.endpoint}
                              onChange={(e) => handleUpdateDestinationField('otlp', 'endpoint', e.target.value)}
                              placeholder="localhost:4317"
                              disabled={role !== 'admin'}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Debug Destination Card */}
                    <div className={`pipeline-card ${visualConfig.destinations.debug.enabled ? 'enabled' : ''}`}>
                      <div className="card-header-row">
                        <label className="toggle-container">
                          <input
                            type="checkbox"
                            checked={visualConfig.destinations.debug.enabled}
                            onChange={() => handleToggleDestination('debug')}
                            disabled={role !== 'admin'}
                          />
                          <span className="toggle-label font-bold">Console Debug</span>
                        </label>
                        <span className="pipeline-badge">debug</span>
                      </div>
                      {visualConfig.destinations.debug.enabled && (
                        <div className="card-expanded-fields">
                          <div className="field-group">
                            <label>Log Verbosity</label>
                            <select
                              className="form-input text-xs"
                              value={visualConfig.destinations.debug.verbosity}
                              onChange={(e) => handleUpdateDestinationField('debug', 'verbosity', e.target.value)}
                              disabled={role !== 'admin'}
                            >
                              <option value="detailed">Detailed</option>
                              <option value="normal">Normal</option>
                              <option value="basic">Basic</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="config-layout">
                  {/* Left panel: Group Config */}
                  <div className="config-pane">
                    <h3>Group Inherited Template (Base config)</h3>
                    <pre className="config-pre" style={{ height: '300px', opacity: 0.85 }}><code>{agentDetails.group_config || '# No base group configuration'}</code></pre>
                  </div>

                  {/* Right panel: Custom Config Override */}
                  <div className="config-pane">
                    <div className="config-header-row">
                      <h3>Custom overrides (Instance level)</h3>
                      {yamlValidationError ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--alert-red)', fontWeight: '600' }}>{yamlValidationError}</span>
                      ) : (
                        role !== 'admin' && <span style={{ fontSize: '0.7rem', color: 'var(--alert-gold)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Lock size={10} /> Locked</span>
                      )}
                    </div>
                    <textarea
                      className="config-textarea"
                      style={{ height: '300px' }}
                      value={configInput}
                      onChange={(e) => setConfigInput(e.target.value)}
                      placeholder="# Define local yaml overrides here..."
                      readOnly={role !== 'admin'}
                    />
                  </div>
                </div>
              )}

              {/* Dynamic OTel Visual Component Injector Form */}
              {role === 'admin' ? (
                <div className="injector-container">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--perplexity-mint)' }}>Visual Component Injector</h4>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Injects elements into YAML block</span>
                  </div>
                  <div className="injector-grid">
                    <div className="form-row">
                      <label>Component Pipeline Section</label>
                      <select
                        className="form-input"
                        value={injCompType}
                        onChange={(e) => setInjCompType(e.target.value)}
                      >
                        <option value="receivers">receivers (Ingestion)</option>
                        <option value="processors">processors (Transformation)</option>
                        <option value="exporters">exporters (Destination)</option>
                      </select>
                    </div>

                    <div className="form-row">
                      <label>Preset Element</label>
                      <select
                        className="form-input"
                        value={injCompPreset}
                        onChange={(e) => {
                          setInjCompPreset(e.target.value);
                          setInjCompConfig(COMPONENT_PRESETS[e.target.value] || '');
                        }}
                      >
                        <option value="postgresql">PostgreSQL Metrics Database</option>
                        <option value="nginx">Nginx Telemetry Status</option>
                        <option value="hostmetrics">HostMetrics Resource Scraper</option>
                        <option value="prometheus">Prometheus Custom Scraper</option>
                        <option value="otlp">OTLP Gateway Endpoint</option>
                        <option value="kafka">Kafka Broker Exporter</option>
                      </select>
                    </div>

                    <div className="form-row">
                      <label>Custom Name/Identifier</label>
                      <input
                        type="text"
                        className="form-input"
                        value={injCompName}
                        onChange={(e) => setInjCompName(e.target.value)}
                        placeholder={`e.g. ${injCompPreset}_custom`}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label>YAML Settings Configuration</label>
                    <textarea
                      className="form-input"
                      style={{ fontFamily: 'JetBrains Mono', fontSize: '0.7rem', height: '80px', resize: 'vertical' }}
                      value={injCompConfig}
                      onChange={(e) => setInjCompConfig(e.target.value)}
                    />
                  </div>

                  <button className="injector-btn" onClick={handleInjectComponent}>
                    <Zap size={12} /> Inject Component into Config overrides
                  </button>
                </div>
              ) : null}

              {/* Merge output preview & Save button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Merged Final Configuration (Effective OTel output)</h3>
                <pre className="config-pre" style={{ height: '180px', opacity: 0.85 }}><code>{agentDetails.effective_config || '# Merged configuration output'}</code></pre>

                {role === 'admin' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      className="action-btn mint"
                      onClick={handleSaveConfig}
                      disabled={opampLoading || !!yamlValidationError}
                    >
                      {opampLoading ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />} Apply & Push Effective Config
                    </button>
                  </div>
                ) : (
                  <div style={{ padding: '8px 12px', background: 'rgba(245, 158, 11, 0.04)', border: '1px dashed var(--alert-gold)', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--alert-gold)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Lock size={12} /> Only administrators are authorized to commit YAML overrides to the telemetry pipeline.
                  </div>
                )}
              </div>
            </div>

            {/* Cert & TLS Settings */}
            <div className="form-grid">
              {/* TLS Connection Settings */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2><ShieldCheck size={16} className="brand-icon" /> TLS Connection & Cryptography</h2>
                  {agentDetails.cert_error && (
                    <span className="card-badge red">Cert Error</span>
                  )}
                </div>

                {agentDetails.client_cert?.status ? (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '6px', fontSize: '0.75rem', marginBottom: '8px', borderLeft: '3px solid var(--alert-red)' }}>
                    <p style={{ color: 'var(--alert-red)', fontWeight: '600' }}>{agentDetails.client_cert.status}</p>
                  </div>
                ) : (
                  <div style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '6px', fontSize: '0.75rem', marginBottom: '8px' }}>
                    <p style={{ fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '4px' }}>Active Trust Certificate Details:</p>
                    <table className="detail-table">
                      <tbody>
                        <tr>
                          <td style={{ padding: '3px 0' }}>Subject CN</td>
                          <td style={{ padding: '3px 0' }}>{agentDetails.client_cert.Subject || agentDetails.client_cert.subject}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '3px 0' }}>Valid until</td>
                          <td style={{ padding: '3px 0' }}>{agentDetails.client_cert["Not Valid After"] || 'CN=AIOps Mock Certificate authority'}</td>
                        </tr>
                        <tr>
                          <td style={{ padding: '3px 0' }}>Issuer</td>
                          <td style={{ padding: '3px 0' }}>{agentDetails.client_cert.Issuer || agentDetails.client_cert.issuer}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                <div className={`form-group ${role !== 'admin' ? 'read-only-mask' : ''}`} style={{ flexGrow: 1, position: 'relative' }}>
                  {role !== 'admin' && (
                    <div className="locked-badge"><Lock size={10} /> Locked</div>
                  )}
                  <div className="form-row">
                    <label>Minimum TLS version</label>
                    <div className="radio-group">
                      {['TLSv1.0', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'].map((v) => (
                        <label key={v} className="radio-option">
                          <input
                            type="radio"
                            name="tls_min_option"
                            value={v}
                            checked={tlsMin === v}
                            onChange={(e) => setTlsMin(e.target.value)}
                            disabled={role !== 'admin'}
                          />
                          {v}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="form-row">
                    <label htmlFor="proxy_url">Secure HTTP Proxy server URL</label>
                    <input
                      type="text"
                      id="proxy_url"
                      className="form-input"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder="http://my-proxy:8888"
                      disabled={role !== 'admin'}
                    />
                  </div>

                  {role === 'admin' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button
                        className="action-btn"
                        onClick={handleConnectionSettings}
                        disabled={opampLoading}
                      >
                        Apply TLS settings
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Custom Command Broker */}
              <div className="perplexity-card">
                <div className="card-title">
                  <h2><MessageSquare size={16} className="brand-icon" /> Custom Command Broker</h2>
                </div>

                <div className={`form-group ${role !== 'admin' ? 'read-only-mask' : ''}`} style={{ marginBottom: '10px', position: 'relative' }}>
                  {role !== 'admin' && (
                    <div className="locked-badge"><Lock size={10} /> Locked</div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div className="form-row">
                      <label>Capability header</label>
                      <input
                        type="text"
                        className="form-input"
                        value={msgCapability}
                        onChange={(e) => setMsgCapability(e.target.value)}
                        disabled={role !== 'admin'}
                      />
                    </div>
                    <div className="form-row">
                      <label>Message type identifier</label>
                      <input
                        type="text"
                        className="form-input"
                        value={msgType}
                        onChange={(e) => setMsgType(e.target.value)}
                        disabled={role !== 'admin'}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <label>Payload arguments (Raw data)</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        className="form-input"
                        value={msgData}
                        onChange={(e) => setMsgData(e.target.value)}
                        placeholder="e.g. { 'command': 'restart' }"
                        disabled={role !== 'admin'}
                      />
                      {role === 'admin' && (
                        <button
                          className="action-btn mint"
                          onClick={handleSendMessage}
                          disabled={opampLoading}
                        >
                          <Send size={12} /> Dispatch
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexGrow: 1 }}>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>
                    Command socket audit trail
                  </h3>
                  <div className="messages-log">
                    {agentDetails.custom_messages.length > 0 ? (
                      agentDetails.custom_messages.join('\n')
                    ) : (
                      'Audit log is empty. No custom messages received.'
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="perplexity-card" style={viewMode === 'topology' ? { gridColumn: '1 / -1', justifyContent: 'center', alignItems: 'center', padding: '60px 20px', minHeight: '350px' } : { justifyContent: 'center', alignItems: 'center', padding: '60px 20px', minHeight: '350px' }}>
            <Server size={48} className="empty-icon text-muted" style={{ opacity: 0.15, marginBottom: '16px' }} />
            <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: '600' }}>No Agent profile selected</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Choose a simulated or physical agent ID from the fleet manager sidebar to view real-time logs and parameters.</p>
          </div>
        )}
      </div>
    );
  };

  // Login component injection check
  if (!token) {
    return (
      <div className="login-wrapper">
        <div className="login-card">
          <div className="login-header">
            <Brain className="brand-icon" size={42} />
            <h1>AIOps Management Portal</h1>
            <p>Role-Based Configuration & Fleet Control</p>
          </div>

          <div className="login-tabs">
            <button
              className={`login-tab-btn ${authTab === 'login' ? 'active' : ''}`}
              onClick={() => { setAuthTab('login'); setAuthError(''); }}
            >
              Sign In
            </button>
            <button
              className={`login-tab-btn ${authTab === 'signup' ? 'active' : ''}`}
              onClick={() => { setAuthTab('signup'); setAuthError(''); }}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div
              style={{
                padding: '10px 12px',
                background: authError.includes('successful') || authError.includes('completed') ? 'var(--alert-green-dim)' : 'var(--alert-red-dim)',
                borderLeft: `3px solid ${authError.includes('successful') || authError.includes('completed') ? 'var(--alert-green)' : 'var(--alert-red)'}`,
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: '500'
              }}
            >
              {authError}
            </div>
          )}

          <form className="login-form" onSubmit={authTab === 'login' ? handleLogin : handleSignup}>
            <div className="form-row">
              <label htmlFor="auth_username">Username</label>
              <input
                type="text"
                id="auth_username"
                className="form-input"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder="e.g. admin"
                required
              />
            </div>

            <div className="form-row">
              <label htmlFor="auth_password">Password</label>
              <input
                type="password"
                id="auth_password"
                className="form-input"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {authTab === 'signup' && (
              <div className="form-row">
                <label>Assigned Role</label>
                <div className="radio-group">
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="signup_role"
                      value="user"
                      checked={authRole === 'user'}
                      onChange={() => setAuthRole('user')}
                    />
                    Read-Only (User)
                  </label>
                  <label className="radio-option">
                    <input
                      type="radio"
                      name="signup_role"
                      value="admin"
                      checked={authRole === 'admin'}
                      onChange={() => setAuthRole('admin')}
                    />
                    Full Access (Admin)
                  </label>
                </div>
              </div>
            )}

            <button type="submit" className="login-btn-primary">
              <ShieldCheck size={16} /> {authTab === 'login' ? 'Authenticate' : 'Register Account'}
            </button>
          </form>

          <div className="divider-container">or continue with</div>

          <button className="login-btn-docker" onClick={handleDockerSSO}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style={{ marginRight: '4px' }}>
              <path d="M13.983 11.078h2.119c.102 0 .186-.083.186-.185V8.99c0-.103-.084-.186-.186-.186h-2.119c-.103 0-.186.083-.186.186v1.901c-.001.103.083.187.186.187zm-2.86-.002h2.119c.102 0 .186-.083.186-.186V8.99c0-.102-.084-.186-.186-.186h-2.119c-.103 0-.186.083-.186.186v1.901c0 .103.083.186.186.186zm-2.862 0h2.119c.102 0 .186-.083.186-.186V8.99c0-.102-.084-.186-.186-.186H8.261c-.103 0-.186.083-.186.186v1.901c0 .103.083.186.186.186zm-2.86 0h2.119c.103 0 .186-.083.186-.186V8.99c0-.102-.084-.186-.186-.186H5.401c-.103 0-.186.083-.186.186v1.901c0 .103.083.186.186.186zm2.86-2.868H11.1c.102 0 .186-.083.186-.186V6.12c0-.102-.084-.186-.186-.186H8.261c-.103 0-.186.083-.186.186v1.901c0 .103.083.187.186.187zm2.86 0h2.119c.102 0 .186-.083.186-.186V6.12c0-.102-.084-.186-.186-.186h-2.119c-.103 0-.186.083-.186.186v1.901c-.001.103.083.187.186.187zm-8.58 2.868h2.119c.103 0 .186-.083.186-.186V8.99c0-.102-.084-.186-.186-.186H2.541c-.103 0-.186.083-.186.186v1.901c0 .103.083.186.186.186zm2.86-2.868h2.119c.103 0 .186-.083.186-.186V6.12c0-.102-.084-.186-.186-.186H5.401c-.103 0-.186.083-.186.186v1.901c0 .103.083.187.186.187zm2.86-2.868h2.119c.102 0 .186-.083.186-.186V3.256c0-.103-.084-.186-.186-.186H8.261c-.103 0-.186.083-.186.186v1.901c0 .103.083.186.186.186zm12.178 7.34c-.181-.112-.522-.303-.88-.303h-2.025v2.091c0 .102-.083.186-.186.186h-2.119c-.102 0-.186-.083-.186-.186v-2.09h-2.119c-.102 0-.186-.083-.186-.186v-2.09h-2.119c-.103 0-.186-.083-.186-.186v-2.09H3.645c-.08-.188-.22-.387-.516-.387-.232 0-.415.18-.485.385l-.232.73c-.06.18-.122.34-.176.47-.6 1.49-.31 3.1.28 4.41.97 2.16 3.14 3.37 5.8 3.37 8.02 0 10.39-2.49 10.99-4.88.24-.96.04-1.92-.12-2.321z" />
            </svg>
            Sign In with Docker IDP
          </button>

          {ssoConfig && ssoConfig.enabled && (
            <button 
              type="button"
              className="login-btn-primary" 
              onClick={handleKeycloakSSO}
              style={{ 
                marginTop: '12px', 
                background: 'rgba(32, 203, 194, 0.1)', 
                border: '1px solid rgba(32, 203, 194, 0.3)', 
                color: 'var(--perplexity-mint)' 
              }}
            >
              <Key size={16} style={{ marginRight: '8px' }} /> Sign In with Keycloak SSO
            </button>
          )}

          <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Credentials: admin/admin123 (Admin) | user/user123 (User)
          </div>
        </div>
      </div>
    );
  }

  // Dashboard Stats
  const latestMetric = metrics[metrics.length - 1] || {};

  return (
    <div className="app-layout">
      {/* Left Navigation Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brain className="brand-icon" size={32} />
          <div className="brand-title">
            <h1>AIOps Portal</h1>
            <p>OTel Fleet Controller</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`sidebar-nav-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <Activity size={16} /> Analytics Dashboard
          </button>
          <button
            className={`sidebar-nav-btn ${activeTab === 'opamp' ? 'active' : ''}`}
            onClick={() => setActiveTab('opamp')}
          >
            <Server size={16} /> Agent Manager
          </button>
          <button
            className={`sidebar-nav-btn ${activeTab === 'fleets' ? 'active' : ''}`}
            onClick={() => setActiveTab('fleets')}
          >
            <Network size={16} /> Fleets Manager
          </button>
          <button
            className={`sidebar-nav-btn ${activeTab === 'configurations' ? 'active' : ''}`}
            onClick={() => setActiveTab('configurations')}
          >
            <Settings size={16} /> Configurations Library
          </button>
          <button
            className={`sidebar-nav-btn ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <ShieldCheck size={16} /> Audit Trail
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <span className="user-role-badge">
              Role: <strong>{role.toUpperCase()}</strong>
            </span>
            <span className="user-name">{username}</span>
          </div>
          <button className="sign-out-btn" onClick={handleLogout}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-panel">
        <header className="main-header">
          <div className="header-status">
            <div className="status-capsule">
              <span className={`status-dot ${statusClass}`}></span>
              <span>{statusText}</span>
            </div>

            <span className="card-badge">
              <Server size={12} className="inline mr-1" /> API: {isConnected ? 'Online' : 'Offline'}
            </span>
            <span className="card-badge">
              <Activity size={12} className="inline mr-1" /> Kafka: Connected
            </span>
          </div>
        </header>

        <main className="main-content">
          {activeTab === 'analytics' && (
            <div className="layout-grid-container">
              <div className="layout-grid">
                {/* Left Column: Telemetry Charts */}
                <div className="perplexity-card">
                  <div className="card-title">
                    <h2><Activity size={16} className="brand-icon" /> Live Multimetric Telemetry (ML Bounds)</h2>
                    <span className="card-badge mint">Isolation Forest Online</span>
                  </div>

                  <div className="telemetry-grid">
                    {/* CPU Chart */}
                    <div className="chart-wrapper">
                      <div className="chart-info">
                        <span className="chart-name">CPU Load (1m Avg)</span>
                        <span className="chart-val">{latestMetric.cpu ? latestMetric.cpu.toFixed(2) : '0.00'}</span>
                      </div>
                      <div className="chart-container-inner">
                        <Line
                          options={commonOptions}
                          data={createChartData('CPU', 'cpu', 'cpu', '#20CBC2', '#5B636E')}
                        />
                      </div>
                    </div>

                    {/* Memory Chart */}
                    <div className="chart-wrapper">
                      <div className="chart-info">
                        <span className="chart-name">Memory Utilization</span>
                        <span className="chart-val">{latestMetric.memory ? latestMetric.memory.toFixed(1) + '%' : '0.0%'}</span>
                      </div>
                      <div className="chart-container-inner">
                        <Line
                          options={commonOptions}
                          data={createChartData('Memory', 'memory', 'memory', '#20CBC2', '#5B636E')}
                        />
                      </div>
                    </div>

                    {/* Disk IO Chart */}
                    <div className="chart-wrapper">
                      <div className="chart-info">
                        <span className="chart-name">Disk Write Activity</span>
                        <span className="chart-val">{latestMetric.disk_write ? latestMetric.disk_write.toFixed(1) + ' MB/s' : '0.0 MB/s'}</span>
                      </div>
                      <div className="chart-container-inner">
                        <Line
                          options={commonOptions}
                          data={createChartData('Disk Write', 'disk_write', 'disk_write', '#a78bfa', '#5B636E')}
                        />
                      </div>
                    </div>

                    {/* Network Chart */}
                    <div className="chart-wrapper">
                      <div className="chart-info">
                        <span className="chart-name">Network Sent Traffic</span>
                        <span className="chart-val">{latestMetric.net_sent ? latestMetric.net_sent.toFixed(1) + ' MB/s' : '0.0 MB/s'}</span>
                      </div>
                      <div className="chart-container-inner">
                        <Line
                          options={commonOptions}
                          data={createChartData('Net Sent', 'net_sent', 'net_sent', '#a78bfa', '#5B636E')}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Alert Feeds */}
                <div className="alerts-col">
                  {/* Netcool Alerts */}
                  <div className="perplexity-card">
                    <div className="card-title">
                      <h2><Server size={16} className="text-red-500" /> Netcool Alarms (Static Rules)</h2>
                      <span className={`card-badge ${netcoolAlerts.length > 0 ? 'red' : ''}`}>
                        {netcoolAlerts.length} Active
                      </span>
                    </div>

                    <div className="alert-feed">
                      {netcoolAlerts.length > 0 ? (
                        netcoolAlerts.map((alert, idx) => {
                          const alertName = alert.labels?.alertname || 'MetricAlert';
                          const severity = alert.labels?.severity || 'warning';
                          const desc = alert.annotations?.description || alert.annotations?.summary || 'Threshold breached.';
                          const startsAt = alert.startsAt ? new Date(alert.startsAt).toLocaleTimeString() : '';
                          return (
                            <div key={idx} className={`alert-row ${severity}`}>
                              <div className="alert-top">
                                <span className={`alert-label ${severity === 'critical' ? 'red' : 'gold'}`}>
                                  <AlertTriangle size={12} className="inline mr-1" /> {alertName}
                                </span>
                                <span className="alert-time">{startsAt}</span>
                              </div>
                              <p className="alert-body">{desc}</p>
                              <div className="alert-footer">
                                <span><Terminal size={10} /> Node: {alert.labels?.instance || 'hostmetrics'}</span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="empty-state">
                          <CheckCircle size={24} className="empty-icon text-green-500" />
                          <p>No rule violations active in Alertmanager.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ML Anomalies (Kafka Alerting with Tallies) */}
                  <div className="perplexity-card">
                    <div className="card-title">
                      <h2><Zap size={16} className="text-purple-400" /> AIOps ML Anomaly Engine (Kafka)</h2>
                      <span className={`card-badge ${mlAnomalies.length > 0 ? 'mint' : ''}`}>
                        {mlAnomalies.length} Active
                      </span>
                    </div>

                    <div className="alert-feed">
                      {mlAnomalies.length > 0 ? (
                        mlAnomalies.slice(-5).reverse().map((anom, idx) => (
                          <div key={anom.id || idx} className={`alert-row ${anom.severity}`}>
                            <div className="alert-top">
                              <span className="alert-label mint" style={{ display: 'flex', alignItems: 'center' }}>
                                <Activity size={12} className="inline mr-1" /> {anom.anomaly_type}
                                {anom.tally_count && anom.tally_count > 1 && (
                                  <span className="tally-count-badge">✕ {anom.tally_count}</span>
                                )}
                              </span>
                              <span className="alert-time">{formatTime(anom.timestamp)}</span>
                            </div>
                            <p className="alert-body">{anom.description}</p>
                            {anom.correlated_event && (
                              <div className="correlated-event-banner" style={{
                                marginTop: '8px',
                                marginBottom: '8px',
                                padding: '6px 8px',
                                backgroundColor: 'rgba(235, 94, 40, 0.1)',
                                border: '1px solid rgba(235, 94, 40, 0.25)',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                color: '#eb5e28',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                lineHeight: '1.4'
                              }}>
                                <Settings size={12} style={{ flexShrink: 0 }} />
                                <span>
                                  Correlated: <strong>{anom.correlated_event.action}</strong> ({anom.correlated_event.target}) 
                                  detected {anom.correlated_event.time_diff_minutes}m prior by {anom.correlated_event.author}.
                                </span>
                              </div>
                            )}
                            <div className="alert-footer">
                              <span><Brain size={10} /> Deviation Z-score: {anom.z_score ? anom.z_score.toFixed(1) : '0.0'} dev</span>
                              <span>Expected: {anom.expected ? anom.expected.toFixed(1) : '0.0'}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-state">
                          <Search size={24} className="empty-icon text-purple-400" />
                          <p>No diurnal baseline departures detected.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Architecture Console */}
              <div className="perplexity-card" style={{ marginTop: '24px' }}>
                <div className="card-title">
                  <h2><Brain size={16} className="brand-icon" /> Kafka Alerting & Event Tallying Architecture</h2>
                  <span className="card-badge mint">Active Pipeline Console</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '20px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <div>
                    <p style={{ lineHeight: '1.5', marginBottom: '12px' }}>
                      The portal implements a production-grade, asynchronous event stream pattern. Standard diurnal telemetry metrics (like CPU and process load) are parsed from OpenTelemetry collectors and evaluated continuously:
                    </p>
                    <ul style={{ paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <li>
                        <strong>Source Anomaly Loop (`ml_consumer.py`)</strong>: An unsupervised Isolation Forest model runs PCA diagnostics. If standard deviations from the diurnal hour average exceed 3.0, a raw anomaly event is serialized to JSON and published to the <code>ml-alerts</code> Kafka topic.
                      </li>
                      <li>
                        <strong>Backend Aggregator Loop (`app.py`)</strong>: A background thread listens on <code>ml-alerts</code> on broker port <code>localhost:9094</code>.
                      </li>
                      <li>
                        <strong>Tallying & Suppression</strong>: To prevent alert spamming, consecutive metrics events within a 30s window are grouped. Triggers are tallied contiguously. If triggers exceed 10 within a 2-minute window, the engine escalates the alert severity to <code>critical</code>.
                      </li>
                    </ul>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <h4 style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--perplexity-mint)', textTransform: 'uppercase' }}>Pipeline Map</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'JetBrains Mono', fontSize: '0.7rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                        <span>Raw Metrics Ingestion:</span>
                        <span style={{ color: 'var(--perplexity-mint)' }}>OTel HTTP/gRPC</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                        <span>Anomaly Producer:</span>
                        <span style={{ color: 'var(--perplexity-mint)' }}>Kafka (ml-alerts)</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                        <span>Suppression Window:</span>
                        <span style={{ color: 'var(--alert-gold)' }}>30s Sliding</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dashed var(--border-color)', paddingBottom: '4px' }}>
                        <span>Escalation Rule:</span>
                        <span style={{ color: 'var(--alert-red)' }}>triggers &ge; 10 in 120s</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Disk Log Sink:</span>
                        <span>anomalies_log.json</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Grid */}
              <div className="footer-grid" style={{ marginTop: '24px' }}>
                {/* RCA Console */}
                <div className="perplexity-card">
                  <div className="card-title">
                    <h2><Search size={16} className="brand-icon" /> Automated Root Cause Diagnostics (RCA)</h2>
                    <span className="card-badge">Correlator Active</span>
                  </div>

                  <div className="rca-container">
                    {rcaCorrelations.length > 0 ? (
                      rcaCorrelations.map((corr, idx) => (
                        <div key={idx} className="rca-block">
                          <div className="rca-title-row">
                            <span className="rca-name"><AlertTriangle size={14} className="inline mr-1" /> {corr.alert_name}</span>
                            <div className="rca-score-wrapper">
                              <span className="rca-score-val">{corr.correlation_score.toFixed(0)}%</span>
                              <span className="rca-score-sub">RCA Confidence</span>
                            </div>
                          </div>

                          <div className="rca-detail">
                            <span className="rca-lbl">Primary Driver:</span>
                            <span className="rca-val">{corr.possible_cause}</span>
                          </div>

                          <div className="rca-detail">
                            <span className="rca-lbl">Dynamic Explanation:</span>
                            <p className="rca-desc">{corr.explanation}</p>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state">
                        <CheckCircle size={28} className="empty-icon" />
                        <p>No alert correlations pending diagnostic mapping.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Simulator Board */}
                <div className="perplexity-card">
                  <div className="card-title">
                    <h2><Skull size={16} className="brand-icon" /> Chaos Simulator Control Panel</h2>
                    <span className={`card-badge ${simStatus !== 'normal' ? 'red' : ''}`}>
                      {simStatus === 'normal' ? 'Idle' : `Injecting: ${simStatus.toUpperCase()}`}
                    </span>
                  </div>

                  <div className="sim-body">
                    <p className="sim-txt">
                      Stress metrics to trigger the unsupervised Isolation Forest. Check baseline visual boundaries to confirm dynamic alerts.
                    </p>

                    <div className="sim-btns">
                      <button
                        className="sim-btn"
                        disabled={simStatus !== 'normal'}
                        onClick={() => triggerSimulation('cpu')}
                      >
                        <Cpu size={14} /> CPU / Processes Spike
                      </button>
                      <button
                        className="sim-btn"
                        disabled={simStatus !== 'normal'}
                        onClick={() => triggerSimulation('memory')}
                      >
                        <Activity size={14} /> Memory Leak Simulation
                      </button>
                      <button
                        className="sim-btn"
                        disabled={simStatus !== 'normal'}
                        onClick={() => triggerSimulation('disk')}
                      >
                        <HardDrive size={14} /> High Disk I/O Simulation
                      </button>
                      <button
                        className="sim-btn"
                        disabled={simStatus !== 'normal'}
                        onClick={() => triggerSimulation('network')}
                      >
                        <Network size={14} /> Network Traffic Simulation
                      </button>
                      <button
                        className="sim-btn danger"
                        disabled={simStatus === 'normal'}
                        onClick={stopSimulation}
                      >
                        <StopCircle size={14} /> Stop Chaos Injection
                      </button>
                    </div>

                    <div className="sim-tracker">
                      <div className={`tracker-node ${simStatus !== 'normal' ? 'active' : ''}`}>
                        <div className="tracker-indicator"></div>
                        <span>1. Chaos Active</span>
                      </div>
                      <div className="tracker-arrow">&gt;&gt;</div>
                      <div className={`tracker-node ${metrics.length > 0 ? 'active' : ''}`}>
                        <div className="tracker-indicator"></div>
                        <span>2. OTel Metric Ingest</span>
                      </div>
                      <div className="tracker-arrow">&gt;&gt;</div>
                      <div className={`tracker-node ${metrics.length > 0 ? 'active' : ''}`}>
                        <div className="tracker-indicator"></div>
                        <span>3. Kafka Streams</span>
                      </div>
                      <div className="tracker-arrow">&gt;&gt;</div>
                      <div className={`tracker-node ${mlAnomalies.length > 0 ? 'active' : ''}`}>
                        <div className="tracker-indicator"></div>
                        <span>4. Isolation Forest</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'opamp' && renderOpAmpWorkspace()}
          {activeTab === 'fleets' && renderFleetsTab()}
          {activeTab === 'configurations' && renderConfigurationsTab()}
          {activeTab === 'audit' && renderAuditTab()}
        </main>

        <footer className="app-footer">
          <p>AIOps Analytics Portal &copy; 2026 | Perplexity Design Standard | Unsupervised ML System</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
