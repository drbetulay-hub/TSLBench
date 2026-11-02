import { useState, useEffect, useRef } from 'react'
import { 
  Play, Settings, Terminal, CheckCircle2, XCircle, Loader2, Activity, FileText, 
  Layers, Cpu, Clock, Sparkles, ChevronDown, ChevronUp, Info, BarChart3, HelpCircle,
  Upload, Download, Square
} from 'lucide-react'

const VIEW_ONLY = true
const API = import.meta.env.VITE_API_URL ?? ''

/** Per-question SAR from ordered sources and the row's gold article list. */
function statuteArticleRecall(sources, goldList) {
  const gold = goldList || []
  if (!gold.length) return 0
  const retrieved = new Set(sources || [])
  const hits = gold.filter((a) => retrieved.has(a)).length
  return hits / gold.length
}

// CSS Design Colors aligned with EvaluatorTab
const C = {
  bg: 'var(--eval-bg)', 
  surface: 'var(--eval-surface)', 
  elevated: 'var(--eval-elevated)', 
  card: 'var(--eval-card)',
  border: 'var(--eval-border)', 
  borderMd: 'var(--eval-border-md)',
  text1: 'var(--eval-text1)', 
  text2: 'var(--eval-text2)', 
  text3: 'var(--eval-text3)',
  green: 'var(--eval-green)', 
  greenBg: 'var(--eval-green-bg)', 
  greenBdr: 'var(--eval-green-bdr)',
  amber: 'var(--eval-amber)', 
  amberBg: 'var(--eval-amber-bg)', 
  amberBdr: 'var(--eval-amber-bdr)',
  red: 'var(--eval-red)', 
  redBg: 'var(--eval-red-bg)', 
  redBdr: 'var(--eval-red-bdr)',
  blue: 'var(--eval-blue)', 
  blueBg: 'var(--eval-blue-bg)', 
  blueBdr: 'var(--eval-blue-bdr)',
  purple: 'var(--eval-purple)', 
  purpleBg: 'var(--eval-purple-bg)', 
  purpleBdr: 'var(--eval-purple-bdr)',
}

export default function RagBenchmarkTab({ visible = false }) {
  // Input selectors
  const [questionSets, setQuestionSets] = useState([])
  const [selectedSet, setSelectedSet] = useState('')
  const [selectedSetData, setSelectedSetData] = useState(null)
  const [limit, setLimit] = useState(5)
  const [judgeModel, setJudgeModel] = useState('')
  const [customJudgeModel, setCustomJudgeModel] = useState('')
  const [generatorModel, setGeneratorModel] = useState('')
  const [customGeneratorModel, setCustomGeneratorModel] = useState('')
  const [localLlmEnabled, setLocalLlmEnabled] = useState(false)
  const [localLlmUrl, setLocalLlmUrl] = useState('http://localhost:8080/v1')
  const [localLlmModelsList, setLocalLlmModelsList] = useState([])
  const [ragToggles, setRagToggles] = useState({
    BasicRAG: true,
    GraphRAG: true,
    LightRAG: true
  })
  const [metricsToggles, setMetricsToggles] = useState({
    sar_macro: true,
    coverage_full: true,
    hit_rate: true,
    mrr: true,
    map: true,
    ragas_faithfulness: true,
    ragas_answer_relevance: true,
    ragas_factual_correctness: true,
    ragas_context_precision: true,
    ragas_context_recall: true
  })
  const [selectedLanguage, setSelectedLanguage] = useState('tr')
  const [detectedLanguage, setDetectedLanguage] = useState(null)

  // SSE status & streaming
  const [isRunning, setIsRunning] = useState(false)
  const [activeRunId, setActiveRunId] = useState(null)
  const [isStopping, setIsStopping] = useState(false)
  const [logs, setLogs] = useState([])
  const [currentProgress, setCurrentProgress] = useState(null)
  const [activeViewTab, setActiveViewTab] = useState('metrics') // metrics | comparison | logs
  const [expandedQuestionId, setExpandedQuestionId] = useState(null)
  const [hoveredDataPoint, setHoveredDataPoint] = useState(null)
  const [expandedJudgeDetails, setExpandedJudgeDetails] = useState({})

  const toggleJudgeDetails = (qId, pipeline) => {
    const key = `${qId}-${pipeline}`
    setExpandedJudgeDetails(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const isJudgeDetailsExpanded = (qId, pipeline) => {
    return !!expandedJudgeDetails[`${qId}-${pipeline}`]
  }

  // Compiled benchmark results
  const [resultsData, setResultsData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [runsHistory, setRunsHistory] = useState([])
  const [selectedRunTimestamp, setSelectedRunTimestamp] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  const logsEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const barChartSvgRef = useRef(null)
  const ragasChartSvgRef = useRef(null)
  const scatterPlotSvgRef = useRef(null)
  const radarChartSvgRef = useRef(null)
  const latencyChartSvgRef = useRef(null)
  const questionTypeChartSvgRef = useRef(null)

  // Load bundled results (view-only) or full benchmark UI
  useEffect(() => {
    if (VIEW_ONLY) {
      loadBundledResults()
      return
    }

    fetchHistory()
    fetchRunsHistory()
  }, [])

  const loadBundledResults = async () => {
    setLoadingHistory(true)
    setErrorMsg('')
    try {
      const res = await fetch(`${API}/api/results?_=${Date.now()}`)
      if (!res.ok) throw new Error('Results not available')
      const data = await res.json()
      setResultsData(data)
      setSelectedRunTimestamp(data.run_id || data.timestamp || 'tslbench200')
      setRagToggles({
        BasicRAG: data.results?.some(r => r.basic_rag) ?? true,
        GraphRAG: data.results?.some(r => r.graph_rag) ?? true,
        LightRAG: data.results?.some(r => r.light_rag) ?? true,
      })
    } catch (err) {
      console.error(err)
      setErrorMsg('Failed to load TSLBench200 benchmark results.')
    } finally {
      setLoadingHistory(false)
    }
  }

  // Auto-scroll logs terminal
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result)
        let normalizedData = null

        if (Array.isArray(parsed)) {
          const lawIdsSet = new Set()
          parsed.forEach(q => {
            if (q.source_law_no) lawIdsSet.add(Number(q.source_law_no))
            else if (q.kaynak_kanun_no) lawIdsSet.add(Number(q.kaynak_kanun_no))
            else if (q.relevant_article_list) {
              q.relevant_article_list.forEach(a => {
                const match = String(a).match(/^(\d+)-/)
                if (match) lawIdsSet.add(Number(match[1]))
              })
            }
          })

          normalizedData = {
            filename: file.name,
            questions: parsed.map((q, idx) => ({
              id: q.id !== undefined ? q.id : idx,
              question: q.question || q.soru || '',
              answer: q.answer || q.cevap || '',
              context: q.context || '',
              relevant_article_list: q.relevant_article_list || q.relevant_madde_list || [],
              question_type: q.question_type || q.soru_tipi || 'single-hop',
              difficulty: q.difficulty || 'medium'
            })),
            law_ids: Array.from(lawIdsSet).filter(id => !isNaN(id)),
            question_count: parsed.length
          }
        } else if (parsed && typeof parsed === 'object') {
          const qs = parsed.questions || parsed.sorular || []
          normalizedData = {
            filename: file.name,
            questions: qs.map((q, idx) => ({
              id: q.id !== undefined ? q.id : idx,
              question: q.question || q.soru || '',
              answer: q.answer || q.cevap || '',
              context: q.context || '',
              relevant_article_list: q.relevant_article_list || q.relevant_madde_list || [],
              question_type: q.question_type || q.soru_tipi || 'single-hop',
              difficulty: q.difficulty || 'medium'
            })),
            law_ids: parsed.law_ids || parsed.kanun_ids || [],
            question_count: qs.length,
            difficulty: parsed.difficulty || ''
          }
        }

        if (normalizedData && normalizedData.questions.length > 0) {
          setSelectedSet(file.name)
          setSelectedSetData(normalizedData)
          setLimit(Math.min(5, normalizedData.questions.length))
          setErrorMsg('')

          // Auto-detect language from uploaded file metadata or context clues
          const fileLang = parsed.language || parsed.dil;
          let autoLang = 'tr';
          if (fileLang) {
            autoLang = fileLang === 'en' ? 'en' : 'tr';
          } else {
            const firstQ = normalizedData.questions[0]?.question || '';
            const isEn = /\b(the|of|what|under|shall|according|article|law|this|that|to)\b/i.test(firstQ)
            autoLang = isEn ? 'en' : 'tr';
          }
          setDetectedLanguage(autoLang)
          setSelectedLanguage(autoLang)
        } else {
          setErrorMsg('Uploaded JSON file does not contain valid questions or data.')
        }
      } catch (err) {
        console.error(err)
        setErrorMsg('Failed to parse JSON file. Please upload a valid JSON file.')
      }
    }
    reader.readAsText(file)
  }

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API}/api/questions/history`)
      if (res.ok) {
        const data = await res.json()
        setQuestionSets(data)
      }
    } catch (err) {
      console.error('Failed to load questions history', err)
      setErrorMsg('Failed to load question set history.')
    }
  }

  const fetchRunsHistory = async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`${API}/api/rag-eval/runs?_=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        setRunsHistory(data)
        
        // Find if there is an active run
        const activeRun = data.find(r => r.is_active)
        if (activeRun && !isRunning) {
          setActiveRunId(activeRun.timestamp)
          setSelectedRunTimestamp(activeRun.timestamp)
          setIsRunning(true)
          setActiveViewTab('logs')
          await loadRunDetailsForActive(activeRun.timestamp, activeRun)
        } else if (data.length > 0 && !selectedRunTimestamp) {
          loadRunDetails(data[0].timestamp)
        }
      }
    } catch (err) {
      console.error('Failed to load runs history', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const reconnectToActiveStream = async (runId) => {
    try {
      const response = await fetch(`${API}/api/rag-eval/runs/${runId}/stream`)
      if (!response.ok) {
        throw new Error(`Failed to reconnect to stream (HTTP ${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          const eventMatch = line.match(/^event:\s*(\w+)/)
          const dataMatch = line.match(/data:\s*(.+)$/m)

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1]
            const rawData = dataMatch[1]
            try {
              const payload = JSON.parse(rawData)
              handleSseEvent(eventType, payload)
            } catch (err) {
              console.error('Error parsing SSE json', err)
            }
          }
        }
      }
    } catch (err) {
      console.error('Active stream connection error', err)
      // Check if it is still active by reloading history
      fetchRunsHistory()
    }
  }

  const loadRunDetailsForActive = async (timestamp, runInfo) => {
    try {
      setSelectedRunTimestamp(timestamp)
      const res = await fetch(`${API}/api/rag-eval/runs/${timestamp}?_=${Date.now()}`)
      let currentResultCount = 0
      if (res.ok) {
        const data = await res.json()
        setResultsData(data)
        if (data.results && data.results.length > 0) {
          currentResultCount = data.results.length
          setCurrentProgress({
            status: 'Running (Reconnected)',
            index: Math.max(0, currentResultCount - 1),
            question: data.results[data.results.length - 1]?.question || 'Evaluating...'
          })
        } else {
          setCurrentProgress({
            status: 'Initializing...',
            index: 0,
            question: 'Evaluating...'
          })
        }
      }
      
      const logsRes = await fetch(`${API}/api/rag-eval/runs/${timestamp}/logs?_=${Date.now()}`)
      if (logsRes.ok) {
        const logsData = await logsRes.json()
        setLogs(logsData)
      } else {
        setLogs([])
      }

      // Sync settings parameters from the active run parameters!
      if (runInfo && runInfo.parameters) {
        const p = runInfo.parameters
        if (p.limit !== undefined) setLimit(p.limit)
        if (p.language) setSelectedLanguage(p.language)
        if (p.rag_toggles) {
          setRagToggles({
            BasicRAG: !!p.rag_toggles.BasicRAG,
            GraphRAG: !!p.rag_toggles.GraphRAG,
            LightRAG: !!p.rag_toggles.LightRAG
          })
        }
        if (p.metrics_toggles) {
          setMetricsToggles({
            sar_macro: p.metrics_toggles.sar_macro !== false,
            coverage_full: p.metrics_toggles.coverage_full !== false,
            hit_rate: p.metrics_toggles.hit_rate !== false,
            mrr: p.metrics_toggles.mrr !== false,
            map: p.metrics_toggles.map !== false,
            ragas_faithfulness: p.metrics_toggles.ragas_faithfulness !== false,
            ragas_answer_relevance: p.metrics_toggles.ragas_answer_relevance !== false,
            ragas_factual_correctness: p.metrics_toggles.ragas_factual_correctness !== false,
            ragas_context_precision: p.metrics_toggles.ragas_context_precision !== false,
            ragas_context_recall: p.metrics_toggles.ragas_context_recall !== false
          })
        }
        
        // Match models configurations
        const savedLocalEnabled = localStorage.getItem('localLlmEnabled') === 'true'
        const savedLocalUrl = localStorage.getItem('localLlmUrl') || 'http://localhost:8080/v1'
        let loadedLocalModels = []
        const savedLocalModels = localStorage.getItem('localLlmModelsList')
        if (savedLocalModels) {
          try { loadedLocalModels = JSON.parse(savedLocalModels) } catch (_) {}
        }
        const allEvalModels = getEvaluatorModels(savedLocalEnabled, loadedLocalModels, savedLocalUrl)
        
        if (p.judge_model) {
          const isPredefined = allEvalModels.some(m => m.id === p.judge_model && m.id !== 'custom')
          if (isPredefined) {
            setJudgeModel(p.judge_model)
            setCustomJudgeModel('')
          } else {
            setJudgeModel('custom')
            setCustomJudgeModel(p.judge_model)
          }
        }
        if (p.generator_model) {
          const isGenPredefined = allEvalModels.some(m => m.id === p.generator_model && m.id !== 'custom')
          if (isGenPredefined) {
            setGeneratorModel(p.generator_model)
            setCustomGeneratorModel('')
          } else {
            setGeneratorModel('custom')
            setCustomGeneratorModel(p.generator_model)
          }
        }

        // Get run dataset to sync selectedSet
        try {
          const datasetRes = await fetch(`${API}/api/rag-eval/runs/${timestamp}/dataset?_=${Date.now()}`)
          if (datasetRes.ok) {
            const datasetJson = await datasetRes.json()
            setSelectedSet(`run_${timestamp}_dataset.json`)
            setSelectedSetData({
              filename: `run_${timestamp}_dataset.json`,
              questions: datasetJson,
              law_ids: p.law_ids || [],
              question_count: datasetJson.length
            })
          }
        } catch (e) {
          console.error("Failed to load dataset for active run:", e)
        }
      }

      reconnectToActiveStream(timestamp)
    } catch (err) {
      console.error(`Failed to load details for active run ${timestamp}`, err)
    }
  }

  const loadRunDetails = async (timestamp) => {
    try {
      setSelectedRunTimestamp(timestamp)
      const res = await fetch(`${API}/api/rag-eval/runs/${timestamp}?_=${Date.now()}`)
      if (res.ok) {
        const data = await res.json()
        setResultsData(data)
        if (activeViewTab === 'logs') {
          setActiveViewTab('metrics')
        }
      }
      
      const logsRes = await fetch(`${API}/api/rag-eval/runs/${timestamp}/logs?_=${Date.now()}`)
      if (logsRes.ok) {
        const logsData = await logsRes.json()
        setLogs(logsData)
      } else {
        setLogs([])
      }
    } catch (err) {
      console.error(`Failed to load details for run ${timestamp}`, err)
      setErrorMsg(`Failed to load details for run ${timestamp}.`)
    }
  }

  const handleSelectRun = async (run) => {
    // 1. Load details (results and logs)
    await loadRunDetails(run.timestamp)

    // 2. Set all settings parameters from run.parameters
    if (run.parameters) {
      const p = run.parameters

      // a. Set Limit
      if (p.limit !== undefined) {
        setLimit(p.limit)
      }

      // b. Set Language
      if (p.language) {
        setSelectedLanguage(p.language)
      }

      // c. Set RAG Toggles
      if (p.rag_toggles) {
        setRagToggles({
          BasicRAG: !!p.rag_toggles.BasicRAG,
          GraphRAG: !!p.rag_toggles.GraphRAG,
          LightRAG: !!p.rag_toggles.LightRAG
        })
      }

      // d. Set Metrics Toggles
      if (p.metrics_toggles) {
        setMetricsToggles({
          sar_macro: p.metrics_toggles.sar_macro !== false,
          coverage_full: p.metrics_toggles.coverage_full !== false,
          hit_rate: p.metrics_toggles.hit_rate !== false,
          mrr: p.metrics_toggles.mrr !== false,
          map: p.metrics_toggles.map !== false,
          ragas_faithfulness: p.metrics_toggles.ragas_faithfulness !== false,
          ragas_answer_relevance: p.metrics_toggles.ragas_answer_relevance !== false,
          ragas_factual_correctness: p.metrics_toggles.ragas_factual_correctness !== false,
          ragas_context_precision: p.metrics_toggles.ragas_context_precision !== false,
          ragas_context_recall: p.metrics_toggles.ragas_context_recall !== false
        })
      }

      // We need to resolve predefined models or select 'custom'
      const savedLocalEnabled = localStorage.getItem('localLlmEnabled') === 'true'
      const savedLocalUrl = localStorage.getItem('localLlmUrl') || 'http://localhost:8080/v1'
      let loadedLocalModels = []
      const savedLocalModels = localStorage.getItem('localLlmModelsList')
      if (savedLocalModels) {
        try {
          loadedLocalModels = JSON.parse(savedLocalModels)
        } catch (_) {}
      }
      const allEvalModels = getEvaluatorModels(savedLocalEnabled, loadedLocalModels, savedLocalUrl)

      // e. Set Judge Model
      if (p.judge_model) {
        const isPredefined = allEvalModels.some(m => m.id === p.judge_model && m.id !== 'custom')
        if (isPredefined) {
          setJudgeModel(p.judge_model)
          setCustomJudgeModel('')
          localStorage.setItem('evaluatorModel', p.judge_model)
        } else {
          setJudgeModel('custom')
          setCustomJudgeModel(p.judge_model)
          localStorage.setItem('evaluatorModel', p.judge_model)
        }
      }

      // f. Set Generator Model
      if (p.generator_model) {
        const isGenPredefined = allEvalModels.some(m => m.id === p.generator_model && m.id !== 'custom')
        if (isGenPredefined) {
          setGeneratorModel(p.generator_model)
          setCustomGeneratorModel('')
          localStorage.setItem('generatorModel', p.generator_model)
        } else {
          setGeneratorModel('custom')
          setCustomGeneratorModel(p.generator_model)
          localStorage.setItem('generatorModel', p.generator_model)
        }
      }

      // g. Fetch run's dataset from backend and load it
      try {
        const datasetRes = await fetch(`${API}/api/rag-eval/runs/${run.timestamp}/dataset?_=${Date.now()}`)
        if (datasetRes.ok) {
          const datasetJson = await datasetRes.json()
          if (datasetJson && Array.isArray(datasetJson)) {
            setSelectedSet(`run_${run.timestamp}_dataset.json`)
            setSelectedSetData({
              filename: `run_${run.timestamp}_dataset.json`,
              questions: datasetJson,
              law_ids: p.law_ids || [],
              question_count: datasetJson.length
            })
          }
        }
      } catch (err) {
        console.error('Failed to load dataset for selected run', err)
      }
    }
  }

  const handleDeleteRun = async (e, timestamp) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this benchmark run? This cannot be undone.')) {
      return
    }
    try {
      const res = await fetch(`${API}/api/rag-eval/runs/${timestamp}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        const listRes = await fetch(`${API}/api/rag-eval/runs`)
        if (listRes.ok) {
          const data = await listRes.json()
          setRunsHistory(data)
          
          if (selectedRunTimestamp === timestamp) {
            if (data.length > 0) {
              loadRunDetails(data[0].timestamp)
            } else {
              setSelectedRunTimestamp(null)
              setResultsData(null)
              setLogs([])
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete run', err)
    }
  }

  const handleSelectSet = async (filename) => {
    setSelectedSet(filename)
    try {
      const res = await fetch(`${API}/api/questions/history/${filename}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedSetData(data)
        // Set default limit to min of 5 or dataset length
        const len = data.questions ? data.questions.length : 0
        setLimit(Math.min(5, len))

        // Auto-detect language from selected history set
        const fileLang = data.language || data.dil;
        let autoLang = 'tr';
        if (fileLang) {
          autoLang = fileLang === 'en' ? 'en' : 'tr';
        } else {
          const firstQ = data.questions && data.questions[0] ? (data.questions[0].question || data.questions[0].soru || '') : ''
          const isEn = /\b(the|of|what|under|shall|according|article|law|this|that|to)\b/i.test(firstQ)
          autoLang = isEn ? 'en' : 'tr';
        }
        setDetectedLanguage(autoLang)
        setSelectedLanguage(autoLang)
      }
    } catch (err) {
      console.error('Failed to load dataset details', err)
    }
  }

  const handleResetToNewRun = () => {
    setSelectedRunTimestamp(null)
    setResultsData(null)
    setLogs([])
    setCurrentProgress(null)
  }

  // Handle benchmark execution
  const startBenchmark = async () => {
    if (!selectedSetData || !selectedSetData.questions || selectedSetData.questions.length === 0) {
      setErrorMsg('Please select a valid question set.')
      return
    }
    
    const activePipelines = Object.entries(ragToggles).filter(([_, v]) => v).map(([k]) => k)
    if (activePipelines.length === 0) {
      setErrorMsg('At least one RAG pipeline must be selected.')
      return
    }

    const finalJudgeModel = judgeModel === 'custom' ? customJudgeModel.trim() : judgeModel
    if (!finalJudgeModel) {
      setErrorMsg('Please select a valid judge model.')
      return
    }

    const finalGeneratorModel = generatorModel === 'custom' ? customGeneratorModel.trim() : generatorModel
    if (!finalGeneratorModel) {
      setErrorMsg('Please select a valid generator model.')
      return
    }

    setErrorMsg('')
    setIsRunning(true)
    setIsStopping(false)
    setActiveRunId(null)
    setResultsData(null)
    setSelectedRunTimestamp(null)
    setLogs([])
    setCurrentProgress(null)
    setActiveViewTab('logs') // Switch view to logs terminal during runs

    const requestBody = {
      dataset_questions: selectedSetData.questions,
      law_ids: selectedSetData.law_ids || [],
      generator_model: finalGeneratorModel,
      judge_model: finalJudgeModel,
      rag_toggles: ragToggles,
      metrics_toggles: metricsToggles,
      limit: parseInt(limit),
      local_llm_url: localStorage.getItem('localLlmUrl') || 'http://localhost:8080/v1',
      local_llm_timeout: parseInt(localStorage.getItem('localLlmTimeout') || '600'),
      language: selectedLanguage
    }

    try {
      // Connect to SSE stream
      const response = await fetch(`${API}/api/rag-eval/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        throw new Error(`Failed to start benchmark (HTTP ${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          // Parse SSE format: event: name \n data: json
          const eventMatch = line.match(/^event:\s*(\w+)/)
          const dataMatch = line.match(/data:\s*(.+)$/m)

          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1]
            const rawData = dataMatch[1]
            try {
              const payload = JSON.parse(rawData)
              handleSseEvent(eventType, payload)
            } catch (err) {
              console.error('Error parsing SSE json', err)
            }
          }
        }
      }
    } catch (err) {
      console.error('Benchmark running error', err)
      setLogs(prev => [...prev, { type: 'error', text: `ERROR: ${err.message}` }])
      setIsRunning(false)
      setIsStopping(false)
      setActiveRunId(null)
    }
  }

  const stopBenchmark = async () => {
    if (!activeRunId) return
    setIsStopping(true)
    try {
      const res = await fetch(`${API}/api/rag-eval/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ run_id: activeRunId })
      })
      if (res.ok) {
        setLogs(prev => [...prev, { type: 'info', time: new Date().toLocaleTimeString(), text: '🛑 Cancellation requested. Waiting for current question to finish...' }])
      }
    } catch (err) {
      console.error('Error requesting cancellation', err)
      setLogs(prev => [...prev, { type: 'error', time: new Date().toLocaleTimeString(), text: `Failed to request cancellation: ${err.message}` }])
      setIsStopping(false)
    }
  }

  const getMatchingIncompleteRun = () => {
    if (!selectedSetData || !selectedSetData.questions) return null;
    
    const activePipelines = Object.entries(ragToggles).filter(([_, v]) => v).map(([k]) => k)
    if (activePipelines.length === 0) return null;

    const finalJudgeModel = judgeModel === 'custom' ? customJudgeModel.trim() : judgeModel
    if (!finalJudgeModel) return null;

    const finalGeneratorModel = generatorModel === 'custom' ? customGeneratorModel.trim() : generatorModel
    if (!finalGeneratorModel) return null;

    const activeLawIds = selectedSetData.law_ids || [];
    const activeLimit = parseInt(limit);
    const activeDatasetSize = selectedSetData.questions.length;

    return runsHistory.find(run => {
      if (run.completed) return false;
      const p = run.parameters;
      if (!p) return false;

      // Match law IDs (sorted)
      const normActiveLaws = [...activeLawIds].map(String).sort().join(',');
      const normRunLaws = [...(p.law_ids || [])].map(String).sort().join(',');
      if (normActiveLaws !== normRunLaws) {
        console.log(`[Resume Check] Mismatch law IDs for run ${run.timestamp}: active='${normActiveLaws}' vs run='${normRunLaws}'`);
        return false;
      }

      // Match models (case-insensitive to be robust)
      if (p.judge_model?.toLowerCase() !== finalJudgeModel?.toLowerCase()) {
        console.log(`[Resume Check] Mismatch judge_model for run ${run.timestamp}: active='${finalJudgeModel}' vs run='${p.judge_model}'`);
        return false;
      }
      if (p.generator_model?.toLowerCase() !== finalGeneratorModel?.toLowerCase()) {
        console.log(`[Resume Check] Mismatch generator_model for run ${run.timestamp}: active='${finalGeneratorModel}' vs run='${p.generator_model}'`);
        return false;
      }

      // Match limit
      if (p.limit !== activeLimit) {
        console.log(`[Resume Check] Mismatch limit for run ${run.timestamp}: active=${activeLimit} vs run=${p.limit}`);
        return false;
      }

      // Match language
      if (p.language !== selectedLanguage) {
        console.log(`[Resume Check] Mismatch language for run ${run.timestamp}: active='${selectedLanguage}' vs run='${p.language}'`);
        return false;
      }

      // Match dataset size
      const expectedSize = p.dataset_size;
      const expectedActualSize = p.actual_questions_count;
      
      if (activeDatasetSize !== expectedSize && activeDatasetSize !== expectedActualSize) {
        console.log(`[Resume Check] Mismatch dataset_size for run ${run.timestamp}: active=${activeDatasetSize} vs expected=${expectedSize} or ${expectedActualSize}`);
        return false;
      }

      // Match RAG toggles
      if (p.rag_toggles) {
        if (!!p.rag_toggles.BasicRAG !== !!ragToggles.BasicRAG) {
          console.log(`[Resume Check] Mismatch BasicRAG for run ${run.timestamp}: active=${!!ragToggles.BasicRAG} vs run=${!!p.rag_toggles.BasicRAG}`);
          return false;
        }
        if (!!p.rag_toggles.GraphRAG !== !!ragToggles.GraphRAG) {
          console.log(`[Resume Check] Mismatch GraphRAG for run ${run.timestamp}: active=${!!ragToggles.GraphRAG} vs run=${!!p.rag_toggles.GraphRAG}`);
          return false;
        }
        if (!!p.rag_toggles.LightRAG !== !!ragToggles.LightRAG) {
          console.log(`[Resume Check] Mismatch LightRAG for run ${run.timestamp}: active=${!!ragToggles.LightRAG} vs run=${!!p.rag_toggles.LightRAG}`);
          return false;
        }
      }

      // Match metrics toggles
      if (p.metrics_toggles) {
        if (!!p.metrics_toggles.sar_macro !== !!metricsToggles.sar_macro ||
            !!p.metrics_toggles.ragas_faithfulness !== !!metricsToggles.ragas_faithfulness ||
            !!p.metrics_toggles.ragas_answer_relevance !== !!metricsToggles.ragas_answer_relevance ||
            !!p.metrics_toggles.ragas_factual_correctness !== !!metricsToggles.ragas_factual_correctness ||
            !!p.metrics_toggles.ragas_context_precision !== !!metricsToggles.ragas_context_precision ||
            !!p.metrics_toggles.ragas_context_recall !== !!metricsToggles.ragas_context_recall) {
          console.log(`[Resume Check] Mismatch metrics toggles for run ${run.timestamp}`);
          return false;
        }
      }

      console.log(`[Resume Check] Match found! Incomplete run ${run.timestamp} is a match.`);
      return true;
    });
  }

  const handleSseEvent = (type, payload) => {
    const timestamp = new Date().toLocaleTimeString()

    if (type === 'run_id') {
      setActiveRunId(payload.run_id)
    } else if (type === 'status') {
      setLogs(prev => [...prev, { type: 'info', time: timestamp, text: payload.message }])
    } else if (type === 'progress') {
      setCurrentProgress(payload)
      setLogs(prev => [
        ...prev, 
        { type: 'progress', time: timestamp, text: `${payload.status} | Question: "${payload.question}"` }
      ])
    } else if (type === 'error') {
      setLogs(prev => [...prev, { type: 'error', time: timestamp, text: `Error encountered: ${payload.message}` }])
      setIsRunning(false)
      setIsStopping(false)
      setActiveRunId(null)
    } else if (type === 'done') {
      const isCancelled = payload.status === 'cancelled'
      if (isCancelled) {
        setLogs(prev => [...prev, { type: 'info', time: timestamp, text: '🛑 RAG Benchmark run cancelled and stopped gracefully. Progress saved.' }])
      } else {
        setLogs(prev => [...prev, { type: 'success', time: timestamp, text: '✓ RAG Benchmark evaluation completed successfully!' }])
      }
      setResultsData(payload)
      setIsRunning(false)
      setIsStopping(false)
      setActiveRunId(null)
      setActiveViewTab('metrics') // Automatically switch to metrics tab when done
      if (payload && payload.run_id) {
        setSelectedRunTimestamp(payload.run_id)
      }
      fetchRunsHistory()
    }
  }

  const getComputedThemeColor = (varName, fallback) => {
    const val = window.getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return val || fallback;
  };

  const EXPORT_DPI = 300
  const SCREEN_DPI = 96
  const EXPORT_SCALE = EXPORT_DPI / SCREEN_DPI

  const makePngCrcTable = () => {
    const table = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      table[i] = c >>> 0
    }
    return table
  }
  const PNG_CRC_TABLE = makePngCrcTable()

  const pngCrc32 = (bytes) => {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = PNG_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const embedPngDpi = async (blob, dpi = EXPORT_DPI) => {
    const ppm = Math.round(dpi / 0.0254)
    const src = new Uint8Array(await blob.arrayBuffer())
    if (src[0] !== 0x89) return blob
    const ihdrEnd = 33
    const type = Uint8Array.from([0x70, 0x48, 0x59, 0x73])
    const data = new Uint8Array(9)
    new DataView(data.buffer).setUint32(0, ppm, false)
    new DataView(data.buffer).setUint32(4, ppm, false)
    data[8] = 1
    const crcInput = new Uint8Array([...type, ...data])
    const crc = pngCrc32(crcInput)
    const chunk = new Uint8Array(21)
    new DataView(chunk.buffer).setUint32(0, 9, false)
    chunk.set(type, 4)
    chunk.set(data, 8)
    new DataView(chunk.buffer).setUint32(17, crc, false)
    const out = new Uint8Array(src.length + chunk.length)
    out.set(src.subarray(0, ihdrEnd))
    out.set(chunk, ihdrEnd)
    out.set(src.subarray(ihdrEnd), ihdrEnd + chunk.length)
    return new Blob([out], { type: 'image/png' })
  }

  const resolveSvgStyles = (originalSvg, backgroundOption) => {
    const viewBoxAttr = originalSvg.getAttribute('viewBox') || '0 0 800 300'
    const [, , originalWidth, originalHeight] = viewBoxAttr.split(' ').map(Number)

    const clone = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    clone.setAttribute('viewBox', `0 0 ${originalWidth} ${originalHeight}`)
    clone.setAttribute('width', Math.round(originalWidth * EXPORT_SCALE))
    clone.setAttribute('height', Math.round(originalHeight * EXPORT_SCALE))

    if (backgroundOption === 'white') {
      clone.style.backgroundColor = '#ffffff'
    } else {
      clone.style.backgroundColor = 'transparent'
    }

    for (let i = 0; i < originalSvg.attributes.length; i++) {
      const attr = originalSvg.attributes[i]
      if (attr.name !== 'viewBox' && attr.name !== 'width' && attr.name !== 'height') {
        clone.setAttribute(attr.name, attr.value)
      }
    }

    for (let i = 0; i < originalSvg.childNodes.length; i++) {
      const childClone = originalSvg.childNodes[i].cloneNode(true)
      clone.appendChild(childClone)
    }

    const elements = clone.querySelectorAll('*')
    const originalElements = originalSvg.querySelectorAll('*')

    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i]
      const origElem = originalElements[i]
      if (!origElem) continue

      const computedStyle = window.getComputedStyle(origElem)

      const fill = computedStyle.getPropertyValue('fill')
      const stroke = computedStyle.getPropertyValue('stroke')
      const fillOpacity = computedStyle.getPropertyValue('fill-opacity')
      const strokeOpacity = computedStyle.getPropertyValue('stroke-opacity')

      if (fill && fill !== 'none') {
        elem.setAttribute('fill', fill)
      }
      if (stroke && stroke !== 'none') {
        elem.setAttribute('stroke', stroke)
      }
      if (fillOpacity) elem.setAttribute('fill-opacity', fillOpacity)
      if (strokeOpacity) elem.setAttribute('stroke-opacity', strokeOpacity)

      if (origElem.tagName === 'text') {
        const fontSize = computedStyle.getPropertyValue('font-size')
        const fontWeight = computedStyle.getPropertyValue('font-weight')
        const textAnchor = computedStyle.getPropertyValue('text-anchor')
        const fontFamily = computedStyle.getPropertyValue('font-family') || 'Inter, sans-serif'

        if (fontSize) elem.setAttribute('font-size', fontSize)
        if (fontWeight) elem.setAttribute('font-weight', fontWeight)
        if (textAnchor) elem.setAttribute('text-anchor', textAnchor)
        elem.setAttribute('font-family', fontFamily)

        const origFill = origElem.getAttribute('fill') || ''
        const isChartLabel = !origFill || origFill.includes('var(--eval-text') || origFill === '#000000'
        if (isChartLabel) {
          elem.setAttribute('fill', '#000000')
        } else if (backgroundOption !== 'white' && origFill.includes('var(')) {
          elem.setAttribute('fill', computedStyle.getPropertyValue('fill') || '#000000')
        }
      }

      if (backgroundOption === 'white') {
        const origStroke = origElem.getAttribute('stroke')
        if (origStroke && origStroke.includes('var(--eval-border')) {
          elem.setAttribute('stroke', '#cbd5e1')
        }
      } else {
        const origStroke = origElem.getAttribute('stroke')
        if (origStroke && origStroke.includes('var(')) {
          elem.setAttribute('stroke', computedStyle.getPropertyValue('stroke') || '#334155')
        }
      }
    }

    return clone
  }

  const downloadResultsJson = () => {
    if (!resultsData) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(resultsData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `rag_benchmark_results_${resultsData.timestamp || 'export'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const downloadChart = (chartType, format, background) => {
    const refMap = {
      bar: barChartSvgRef,
      ragas: ragasChartSvgRef,
      scatter: scatterPlotSvgRef,
      radar: radarChartSvgRef,
      latency: latencyChartSvgRef,
      qtype: questionTypeChartSvgRef,
    }
    const svgEl = refMap[chartType]?.current;
    if (!svgEl) return;

    const clonedSvg = resolveSvgStyles(svgEl, background);
    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clonedSvg);
    
    if (!svgString.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
      svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    
    const filename = `rag_benchmark_${chartType}_${background}_bg`;

    if (format === 'svg') {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (format === 'png') {
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      
      img.onload = () => {
        const viewBox = clonedSvg.getAttribute('viewBox') || '0 0 800 375';
        const [, , w, h] = viewBox.split(' ').map(Number);
        
        const scale = EXPORT_SCALE
        const canvasWidth = Math.round(w * scale)
        const canvasHeight = Math.round(h * scale)
        
        const canvas = document.createElement('canvas')
        canvas.width = canvasWidth
        canvas.height = canvasHeight
        
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          if (background === 'white') {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvasWidth, canvasHeight)
          } else {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight)
          }
          
          ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight)
          
          canvas.toBlob(async (pngBlob) => {
            if (pngBlob) {
              const dpiBlob = await embedPngDpi(pngBlob, EXPORT_DPI)
              const pngUrl = URL.createObjectURL(dpiBlob)
              const link = document.createElement('a');
              link.href = pngUrl;
              link.download = `${filename}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(pngUrl);
            }
            URL.revokeObjectURL(url);
          }, 'image/png');
        } else {
          URL.revokeObjectURL(url);
        }
      };
      
      img.onerror = (e) => {
        console.error('Failed to load SVG for PNG conversion', e);
        URL.revokeObjectURL(url);
      };
      
      img.src = url;
    }
  };

  // Calculate Average metrics for active pipelines (uses computed_metrics from backend)
  const computeAverages = () => {
    if (!resultsData || !resultsData.results || resultsData.results.length === 0) return null

    const pipelines = ['basic_rag', 'graph_rag', 'light_rag']
    const activePipelines = pipelines.filter(p => {
      if (p === 'basic_rag' && !ragToggles.BasicRAG) return false;
      if (p === 'graph_rag' && !ragToggles.GraphRAG) return false;
      if (p === 'light_rag' && !ragToggles.LightRAG) return false;
      // Check if this pipeline exists and has results
      return resultsData.results.some(r => r[p] !== null)
    })

    // Use pre-computed TSLBench metrics from backend if available
    const computed = resultsData.computed_metrics?.systems || {}
    
    const averages = {}
    activePipelines.forEach(p => {
      if (computed[p]) {
        // Use backend computed metrics
        averages[p] = {
          // Retrieval metrics
          sar_macro: computed[p].sar_macro || 0,
          sar_micro: computed[p].sar_micro || 0,
          recall_at_3: computed[p].recall_at_3 || 0,
          recall_at_5: computed[p].recall_at_5 || 0,
          coverage_full: computed[p].coverage_full || 0,
          coverage_at_3: computed[p].coverage_at_3 || 0,
          coverage_at_5: computed[p].coverage_at_5 || 0,
          hit_rate: computed[p].hit_rate || 0,
          mrr: computed[p].mrr || 0,
          map: computed[p].map || 0,
          avg_retrieved: computed[p].avg_retrieved || 0,
          // RAGAS metrics
          ragas_faithfulness: computed[p].ragas_faithfulness || 0,
          ragas_answer_relevance: computed[p].ragas_answer_relevance || 0,
          ragas_factual_correctness: computed[p].ragas_factual_correctness || 0,
          ragas_context_precision: computed[p].ragas_context_precision || 0,
          ragas_context_recall: computed[p].ragas_context_recall || 0,
          // Judge details
          claim_support_rate: computed[p].claim_support_rate || 0,
          ctx_chunk_precision: computed[p].ctx_chunk_precision || 0,
          factual_f1: computed[p].factual_f1 || 0,
          ctx_recall_attributed: computed[p].ctx_recall_attributed || 0,
          avg_answer_claims: computed[p].avg_answer_claims || 0,
          // Latency
          latency_mean: computed[p].latency_mean || 0,
          latency_median: computed[p].latency_median || 0,
          latency_p90: computed[p].latency_p90 || 0,
          latency_p95: computed[p].latency_p95 || 0,
          latency_max: computed[p].latency_max || 0,
          count: computed[p].count || 0
        }
      } else {
        // Fallback: compute from results
        let count = 0
        let totalLatency = 0
        let ragas = { faith: 0, rel: 0, corr: 0, prec: 0, rec: 0 }

        resultsData.results.forEach(r => {
          const item = r[p]
          if (item) {
            count++
            totalLatency += item.latency || 0
            const rs = item.ragas_scores || {}
            ragas.faith += rs.faithfulness || 0
            ragas.rel += rs.answer_relevance || 0
            ragas.corr += rs.factual_correctness || 0
            ragas.prec += rs.context_precision || 0
            ragas.rec += rs.context_recall || 0
          }
        })

        if (count > 0) {
          averages[p] = {
            ragas_faithfulness: ragas.faith / count,
            ragas_answer_relevance: ragas.rel / count,
            ragas_factual_correctness: ragas.corr / count,
            ragas_context_precision: ragas.prec / count,
            ragas_context_recall: ragas.rec / count,
            latency_mean: totalLatency / count,
            count: count
          }
        }
      }
    })

    return averages
  }

  const averages = computeAverages()

  // Pre-compiled list of metrics to render (TSLBench paper metrics)
  const metricsConfig = [
    // Retrieval metrics
    { key: 'sar_macro', label: 'SAR', desc: 'Statute Article Recall — unweighted macro mean over all questions', category: 'retrieval', format: 'percent' },
    { key: 'coverage_full', label: 'Coverage', desc: 'Fraction of questions where all gold articles are retrieved', category: 'retrieval', format: 'percent' },
    { key: 'hit_rate', label: 'Hit Rate', desc: 'Fraction of questions with at least one gold article retrieved', category: 'retrieval', format: 'percent' },
    { key: 'mrr', label: 'MRR', desc: 'Mean Reciprocal Rank of first gold article', category: 'retrieval', format: 'percent' },
    { key: 'map', label: 'MAP', desc: 'Mean Average Precision', category: 'retrieval', format: 'percent' },
    // RAGAS answer quality metrics
    { key: 'ragas_faithfulness', label: 'Faithfulness', desc: 'Attribution of the answer to the retrieved context', category: 'ragas', format: 'score' },
    { key: 'ragas_answer_relevance', label: 'Answer Relevance', desc: 'Relevance of the generated answer to the query', category: 'ragas', format: 'score' },
    { key: 'ragas_factual_correctness', label: 'Factual Correctness', desc: 'Factual similarity to the ground truth answer', category: 'ragas', format: 'score' },
    { key: 'ragas_context_precision', label: 'Context Precision', desc: 'Precision of the retrieved context chunks', category: 'ragas', format: 'score' },
    { key: 'ragas_context_recall', label: 'Context Recall', desc: 'Recall of the retrieved context chunks', category: 'ragas', format: 'score' },
  ]

  const formatMetricValue = (value, format = 'percent') => {
    if (value === undefined || value === null || Number.isNaN(value)) return '-'
    if (format === 'score') return value.toFixed(3)
    return `${(value * 100).toFixed(1)}%`
  }

  const PIPE_COLORS = { basic_rag: C.blue, graph_rag: C.purple, light_rag: C.green }
  const PIPE_LABELS = { basic_rag: 'BasicRAG', graph_rag: 'GraphRAG', light_rag: 'LightRAG' }
  const CHART_TEXT = '#000000'
  const CHART_FONT = { tick: 14, axis: 15, legend: 14, metric: 14, small: 12 }
  const CHART_FILL = { blue: '#2563eb', purple: '#7c3aed', amber: '#ea580c', green: '#059669' }

  const getActivePipes = () => (averages ? Object.keys(averages) : [])

  const getBenchmarkQuestionCount = (data) => {
    if (!data) return 0
    return Math.max(data.questions_count ?? 0, data.results?.length ?? 0)
  }

  const renderSvgLegend = (items, chartWidth, isScatter = false, topY = 4, rightInset = 12) => {
    if (!items?.length) return null
    const iconSize = 12
    const iconW = 16
    const charW = 7.8
    const itemSpacing = 16
    const itemWidths = items.map(item => iconW + item.label.length * charW)
    const totalW = itemWidths.reduce((a, b) => a + b, 0) + itemSpacing * Math.max(0, items.length - 1)
    let x = Math.max(4, chartWidth - rightInset - totalW)

    return (
      <g className="chart-legend">
        {items.map((item, idx) => {
          const itemX = x
          x += itemWidths[idx] + itemSpacing
          return (
            <g key={item.key || item.label}>
              <rect x={itemX} y={topY} width={iconSize} height={iconSize} rx={isScatter ? 5 : 2} fill={item.color} />
              <text x={itemX + iconW - 2} y={topY + iconSize - 1} fill={CHART_TEXT} fontSize={CHART_FONT.legend} fontFamily="Inter, sans-serif">{item.label}</text>
            </g>
          )
        })}
      </g>
    )
  }

  const renderSvgLegendVertical = (items, chartWidth, chartHeight, rightInset = 10, bottomInset = 8) => {
    if (!items?.length) return null
    const iconSize = 12
    const iconW = 16
    const rowH = 18
    const charW = 7.8
    const maxLabelW = Math.max(...items.map(item => item.label.length * charW))
    const blockW = iconW + maxLabelW
    const blockH = items.length * rowH
    const x = chartWidth - rightInset - blockW
    const startY = chartHeight - bottomInset - blockH

    return (
      <g className="chart-legend">
        {items.map((item, idx) => {
          const y = startY + idx * rowH
          return (
            <g key={item.key || item.label}>
              <rect x={x} y={y} width={iconSize} height={iconSize} rx={2} fill={item.color} />
              <text x={x + iconW - 2} y={y + iconSize - 1} fill={CHART_TEXT} fontSize={CHART_FONT.legend} fontFamily="Inter, sans-serif">{item.label}</text>
            </g>
          )
        })}
      </g>
    )
  }

  const renderExportDropdown = (chartType) => (
    <div className="relative group shrink-0">
      <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary/80 border border-border text-[11px] font-semibold text-muted-foreground hover:text-white transition-colors cursor-pointer">
        <Download className="w-3.5 h-3.5" /> Export
      </button>
      <div className="absolute right-0 mt-1 hidden group-hover:block bg-elevated border border-border rounded-xl shadow-xl z-30 w-48 overflow-hidden py-1">
        <button onClick={() => downloadChart(chartType, 'svg', 'transparent')} className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">SVG — Transparent</button>
        <button onClick={() => downloadChart(chartType, 'svg', 'white')} className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">SVG — White BG</button>
        <button onClick={() => downloadChart(chartType, 'png', 'transparent')} className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer border-t border-border/40">PNG — 300 DPI, Transparent</button>
        <button onClick={() => downloadChart(chartType, 'png', 'white')} className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">PNG — 300 DPI, White BG</button>
      </div>
    </div>
  )

  const renderChartShell = ({ title, subtitle, exportType, children }) => (
    <div className="relative bg-secondary/20 p-5 rounded-2xl border border-border/80">
      {exportType && (
        <div className="absolute top-4 right-4 z-10">
          {renderExportDropdown(exportType)}
        </div>
      )}

      <div className="text-center mb-2 px-10">
        <h4 className="text-sm font-semibold text-white leading-snug">{title}</h4>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed mx-auto max-w-lg">{subtitle}</p>
        )}
      </div>

      <div className="overflow-x-auto">{children}</div>
    </div>
  )

  const renderHorizontalBarChart = (activeMetrics, title, subtitle, svgRef, exportType) => {
    if (!averages || activeMetrics.length === 0) return null

    const activePipes = getActivePipes()
    const width = 800
    const rowH = 36
    const longestLabelChars = Math.max(...activeMetrics.map(m => m.label.length), 0)
    const paddingLeft = Math.max(64, Math.ceil(longestLabelChars * 7.0) + 12)
    const paddingRight = 20
    const paddingTop = 32
    const paddingBottom = 38
    const height = paddingTop + activeMetrics.length * rowH + paddingBottom
    const graphWidth = width - paddingLeft - paddingRight
    const barGroupHeight = rowH * 0.72
    const singleBarHeight = barGroupHeight / Math.max(1, activePipes.length)
    const legendItems = activePipes.map(p => ({ key: p, label: PIPE_LABELS[p], color: PIPE_COLORS[p] }))

    return renderChartShell({
      title,
      subtitle,
      exportType,
      children: (
        <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[640px] h-auto select-none">
          {renderSvgLegend(legendItems, width, false, 4, 16)}
          {[0, 0.25, 0.5, 0.75, 1.0].map(val => {
            const x = paddingLeft + val * graphWidth
            return (
              <g key={val}>
                <line x1={x} y1={paddingTop} x2={x} y2={height - paddingBottom} stroke="var(--eval-border-md)" strokeDasharray="4 4" />
                <text x={x} y={height - paddingBottom + 16} fill={CHART_TEXT} fontSize={CHART_FONT.tick} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="middle">{val.toFixed(2)}</text>
              </g>
            )
          })}
          {activeMetrics.map((metric, mIdx) => {
            const yOffset = paddingTop + mIdx * rowH
            const labelY = yOffset + rowH / 2
            return (
              <g key={metric.key}>
                <text x={paddingLeft - 6} y={labelY + 4} fill={CHART_TEXT} fontSize={CHART_FONT.metric} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="end">{metric.label}</text>
                {activePipes.map((pipe, pIdx) => {
                  const val = averages[pipe]?.[metric.key] || 0
                  const barWidth = val * graphWidth
                  const barY = yOffset + (rowH - barGroupHeight) / 2 + pIdx * singleBarHeight
                  return (
                    <g key={pipe} className="group">
                      <rect x={paddingLeft} y={barY} width={Math.max(2, barWidth)} height={singleBarHeight - 2} fill={PIPE_COLORS[pipe]} rx="2" className="transition-all duration-200 hover:brightness-125" />
                      <text x={paddingLeft + barWidth + 5} y={barY + singleBarHeight / 2 + 3} fill={PIPE_COLORS[pipe]} fontSize="9" fontWeight="600" className="opacity-0 group-hover:opacity-100 transition-opacity">{val.toFixed(3)}</text>
                    </g>
                  )
                })}
                {mIdx < activeMetrics.length - 1 && (
                  <line x1={paddingLeft} y1={yOffset + rowH} x2={width - paddingRight} y2={yOffset + rowH} stroke="var(--eval-border)" />
                )}
              </g>
            )
          })}
          <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="var(--eval-border-md)" />
          <text
            x={paddingLeft + graphWidth / 2}
            y={height - 4}
            fill={CHART_TEXT}
            fontSize={CHART_FONT.axis}
            fontWeight="400"
            fontFamily="Inter, sans-serif"
            textAnchor="middle"
          >
            Average Score (0.0 to 1.0)
          </text>
        </svg>
      )
    })
  }

  const renderRetrievalBarChart = () => {
    const metrics = metricsConfig.filter(m => m.category === 'retrieval' && metricsToggles[m.key])
    return renderHorizontalBarChart(
      metrics,
      'Retrieval Performance',
      'Article-level retrieval metrics (SAR, Coverage, Hit Rate, MRR, MAP)',
      barChartSvgRef,
      'bar'
    )
  }

  const renderRagasBarChart = () => {
    const metrics = metricsConfig.filter(m => m.category === 'ragas' && metricsToggles[m.key])
    return renderHorizontalBarChart(
      metrics,
      'Answer Quality (RAGAS)',
      'RAGAS scores from 0.0 (lowest) to 1.0 (highest)',
      ragasChartSvgRef,
      'ragas'
    )
  }

  const renderRadarChart = () => {
    if (!averages) return null
    const activePipes = getActivePipes()
    const axes = [
      { key: 'sar_macro', label: 'SAR' },
      { key: 'coverage_full', label: 'Coverage' },
      { key: 'hit_rate', label: 'Hit Rate' },
      { key: 'ragas_faithfulness', label: 'Faithfulness' },
      { key: 'ragas_factual_correctness', label: 'Factual' },
      { key: 'ragas_context_recall', label: 'Ctx Recall' },
    ]
    const width = 480
    const padTop = 16
    const padBottom = 12
    const padLeft = 28
    const padRight = 72
    const height = 275
    const plotW = width - padLeft - padRight
    const cx = padLeft + plotW / 2
    const plotH = height - padTop - padBottom
    const cy = padTop + plotH / 2
    const maxR = Math.min(plotW / 2 - 4, plotH / 2 - 6)
    const legendItems = activePipes.map(p => ({ key: p, label: PIPE_LABELS[p], color: PIPE_COLORS[p] }))

    const axisPoint = (i, val = 1) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / axes.length
      return { x: cx + Math.cos(angle) * maxR * val, y: cy + Math.sin(angle) * maxR * val, angle }
    }

    return renderChartShell({
      title: 'Model Comparison Radar',
      subtitle: 'Six key metrics normalized to 0–1 scale',
      exportType: 'radar',
      children: (
        <svg ref={radarChartSvgRef} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[400px] h-auto mx-auto select-none">
          {renderSvgLegendVertical(legendItems, width, height, 8, 6)}
          {[0.25, 0.5, 0.75, 1.0].map(level => (
            <polygon
              key={level}
              points={axes.map((_, i) => { const p = axisPoint(i, level); return `${p.x},${p.y}` }).join(' ')}
              fill="none"
              stroke="var(--eval-border-md)"
              strokeDasharray="3 3"
            />
          ))}
          {axes.map((axis, i) => {
            const p = axisPoint(i, 1)
            const labelP = axisPoint(i, 1.10)
            return (
              <g key={axis.key}>
                <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="var(--eval-border-md)" />
                <text x={labelP.x} y={labelP.y + 4} fill={CHART_TEXT} fontSize={CHART_FONT.axis} fontWeight="500" textAnchor="middle">{axis.label}</text>
              </g>
            )
          })}
          {activePipes.map(pipe => {
            const points = axes.map((axis, i) => {
              const val = averages[pipe]?.[axis.key] || 0
              const p = axisPoint(i, val)
              return `${p.x},${p.y}`
            }).join(' ')
            return (
              <g key={pipe}>
                <polygon points={points} fill={PIPE_COLORS[pipe]} fillOpacity="0.12" stroke={PIPE_COLORS[pipe]} strokeWidth="2" />
                {axes.map((axis, i) => {
                  const val = averages[pipe]?.[axis.key] || 0
                  const p = axisPoint(i, val)
                  return <circle key={axis.key} cx={p.x} cy={p.y} r="4" fill={PIPE_COLORS[pipe]} />
                })}
              </g>
            )
          })}
        </svg>
      )
    })
  }

  const renderLatencyChart = () => {
    if (!averages) return null
    const activePipes = getActivePipes()
    const stats = [
      { key: 'latency_mean', label: 'Mean' },
      { key: 'latency_median', label: 'Median' },
      { key: 'latency_p90', label: 'P90' },
    ]
    const width = 640
    const height = 258
    const paddingLeft = 58
    const paddingRight = 14
    const paddingTop = 32
    const paddingBottom = 40
    const graphWidth = width - paddingLeft - paddingRight
    const graphHeight = height - paddingTop - paddingBottom
    const maxVal = Math.max(...activePipes.flatMap(p => stats.map(s => averages[p]?.[s.key] || 0)), 1) * 1.1
    const groupWidth = graphWidth / activePipes.length
    const barWidth = Math.min(28, groupWidth / (stats.length + 1))
    const statColors = [CHART_FILL.blue, CHART_FILL.purple, CHART_FILL.amber]
    const legendItems = stats.map((s, i) => ({ key: s.key, label: s.label, color: statColors[i] }))

    return renderChartShell({
      title: 'Latency Distribution',
      subtitle: 'Mean, median and P90 response times (seconds)',
      exportType: 'latency',
      children: (
        <svg ref={latencyChartSvgRef} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[480px] h-auto select-none">
          {renderSvgLegend(legendItems, width, false, 4, 14)}
          {[0, 0.25, 0.5, 0.75, 1.0].map(ratio => {
            const val = ratio * maxVal
            const y = height - paddingBottom - ratio * graphHeight
            return (
              <g key={ratio}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="var(--eval-border-md)" strokeDasharray="4 4" />
                <text x={paddingLeft - 8} y={y + 4} fill={CHART_TEXT} fontSize={CHART_FONT.tick} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="end">{val.toFixed(0)}</text>
              </g>
            )
          })}
          {activePipes.map((pipe, pIdx) => {
            const groupX = paddingLeft + pIdx * groupWidth + groupWidth / 2
            return (
              <g key={pipe}>
                <text x={groupX} y={height - paddingBottom + 20} fill={CHART_TEXT} fontSize={CHART_FONT.axis} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="middle">{PIPE_LABELS[pipe]}</text>
                {stats.map((stat, sIdx) => {
                  const val = averages[pipe]?.[stat.key] || 0
                  const barH = (val / maxVal) * graphHeight
                  const x = groupX - (stats.length * barWidth) / 2 + sIdx * barWidth
                  const y = height - paddingBottom - barH
                  return (
                    <g key={stat.key}>
                      <rect x={x} y={y} width={barWidth - 4} height={barH} fill={statColors[sIdx]} rx="2" />
                    </g>
                  )
                })}
              </g>
            )
          })}
          <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="var(--eval-border-md)" />
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} stroke="var(--eval-border-md)" />
          <text
            x={16}
            y={paddingTop + graphHeight / 2}
            fill={CHART_TEXT}
            fontSize={CHART_FONT.axis}
            fontWeight="400"
            fontFamily="Inter, sans-serif"
            textAnchor="middle"
            transform={`rotate(-90, 16, ${paddingTop + graphHeight / 2})`}
          >
            Response Time (s)
          </text>
        </svg>
      )
    })
  }

  const renderQuestionTypeChart = () => {
    const byType = resultsData?.computed_metrics?.by_type
    if (!byType) return null

    const activePipes = getActivePipes().filter(p => byType[p])
    if (activePipes.length === 0) return null

    const width = 640
    const height = 258
    const paddingLeft = 58
    const paddingRight = 14
    const paddingTop = 32
    const paddingBottom = 40
    const graphWidth = width - paddingLeft - paddingRight
    const graphHeight = height - paddingTop - paddingBottom
    const maxVal = Math.max(...activePipes.flatMap(p => [
      byType[p]?.single_hop?.sar || 0,
      byType[p]?.multi_hop?.sar || 0,
    ]), 0.01) * 1.05
    const groupWidth = graphWidth / activePipes.length
    const barWidth = Math.min(32, groupWidth / 3)
    const legendItems = [
      { key: 'single', label: 'Single-hop SAR', color: CHART_FILL.blue },
      { key: 'multi', label: 'Multi-hop SAR', color: CHART_FILL.amber },
    ]

    return renderChartShell({
      title: 'SAR by Question Type',
      subtitle: 'Statute Article Recall split by single-hop vs multi-hop questions',
      exportType: 'qtype',
      children: (
        <svg ref={questionTypeChartSvgRef} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[480px] h-auto select-none">
          {renderSvgLegend(legendItems, width, false, 4, 14)}
          {[0, 0.25, 0.5, 0.75, 1.0].map(ratio => {
            const val = ratio * maxVal
            const y = height - paddingBottom - ratio * graphHeight
            return (
              <g key={ratio}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="var(--eval-border-md)" strokeDasharray="4 4" />
                <text x={paddingLeft - 8} y={y + 4} fill={CHART_TEXT} fontSize={CHART_FONT.tick} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="end">{(val * 100).toFixed(0)}</text>
              </g>
            )
          })}
          {activePipes.map((pipe, pIdx) => {
            const groupX = paddingLeft + pIdx * groupWidth + groupWidth / 2
            const singleVal = byType[pipe]?.single_hop?.sar || 0
            const multiVal = byType[pipe]?.multi_hop?.sar || 0
            const bars = [
              { val: singleVal, label: 'Single', color: CHART_FILL.blue },
              { val: multiVal, label: 'Multi', color: CHART_FILL.amber },
            ]
            return (
              <g key={pipe}>
                <text x={groupX} y={height - paddingBottom + 20} fill={CHART_TEXT} fontSize={CHART_FONT.axis} fontWeight="400" fontFamily="Inter, sans-serif" textAnchor="middle">{PIPE_LABELS[pipe]}</text>
                {bars.map((bar, bIdx) => {
                  const barH = (bar.val / maxVal) * graphHeight
                  const x = groupX - barWidth + bIdx * (barWidth + 6)
                  const y = height - paddingBottom - barH
                  return (
                    <g key={bar.label}>
                      <rect x={x} y={y} width={barWidth} height={barH} fill={bar.color} rx="2" />
                    </g>
                  )
                })}
              </g>
            )
          })}
          <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height - paddingBottom} stroke="var(--eval-border-md)" />
          <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} stroke="var(--eval-border-md)" />
          <text
            x={14}
            y={paddingTop + graphHeight / 2}
            fill={CHART_TEXT}
            fontSize={CHART_FONT.axis}
            fontWeight="400"
            fontFamily="Inter, sans-serif"
            textAnchor="middle"
            transform={`rotate(-90, 14, ${paddingTop + graphHeight / 2})`}
          >
            Statute Article Recall (%)
          </text>
        </svg>
      )
    })
  }

  // Render SVG scatter plot of latency vs response length
  const renderScatterPlot = () => {
    if (!resultsData || !resultsData.results) return null

    const width = 800
    const height = 264
    const paddingLeft = 66
    const paddingRight = 24
    const paddingTop = 22
    const paddingBottom = 46

    const graphWidth = width - paddingLeft - paddingRight
    const graphHeight = height - paddingTop - paddingBottom

    // Step 1: Collect datapoints
    const points = []
    let maxLatency = 2.0 // min default ceiling
    let maxLen = 500

    resultsData.results.forEach(r => {
      ['basic_rag', 'graph_rag', 'light_rag'].forEach(pipe => {
        if (pipe === 'basic_rag' && !ragToggles.BasicRAG) return;
        if (pipe === 'graph_rag' && !ragToggles.GraphRAG) return;
        if (pipe === 'light_rag' && !ragToggles.LightRAG) return;
        const item = r[pipe]
        if (item) {
          const lat = item.latency || 0
          const len = (item.answer || '').length
          
          if (lat > maxLatency) maxLatency = lat
          if (len > maxLen) maxLen = len

          points.push({
            qId: r.question_id,
            question: r.question,
            pipeline: pipe,
            latency: lat,
            length: len,
            sar: statuteArticleRecall(item.sources, r.relevant_article_list)
          })
        }
      })
    })

    // Pad maximums slightly to look pretty
    maxLatency = Math.ceil(maxLatency * 1.1)
    maxLen = Math.ceil(maxLen * 1.1)

    const scatterLegend = ['basic_rag', 'graph_rag', 'light_rag']
      .filter(p => points.some(pt => pt.pipeline === p))
      .map(p => ({ key: p, label: PIPE_LABELS[p], color: PIPE_COLORS[p] }))

    return renderChartShell({
      title: 'Latency vs. Answer Length',
      subtitle: 'Scatter plot of response time (seconds) vs. generated answer character count',
      exportType: 'scatter',
      children: (
        <div className="relative">
          <svg ref={scatterPlotSvgRef} viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[640px] h-auto select-none">
            {renderSvgLegend(scatterLegend, width, true, 4, 16)}
            {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
              const val = ratio * maxLatency
              const y = height - paddingBottom - ratio * graphHeight
              return (
                <g key={ratio}>
                  <line 
                    x1={paddingLeft} 
                    y1={y} 
                    x2={width - paddingRight} 
                    y2={y} 
                    stroke="var(--eval-border-md)" 
                    strokeDasharray="4 4" 
                  />
                  <text 
                    x={paddingLeft - 10} 
                    y={y + 4} 
                    fill={CHART_TEXT} 
                    fontSize={CHART_FONT.tick}
                    fontWeight="400"
                    fontFamily="Inter, sans-serif"
                    textAnchor="end"
                  >
                    {val.toFixed(1)}
                  </text>
                </g>
              )
            })}

            {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => {
              const val = Math.round(ratio * maxLen)
              const x = paddingLeft + ratio * graphWidth
              return (
                <g key={ratio}>
                  <line 
                    x1={x} 
                    y1={paddingTop} 
                    x2={x} 
                    y2={height - paddingBottom} 
                    stroke="var(--eval-border-md)" 
                    strokeDasharray="4 4" 
                  />
                  <text 
                    x={x} 
                    y={height - paddingBottom + 17} 
                    fill={CHART_TEXT} 
                    fontSize={CHART_FONT.tick}
                    fontWeight="400"
                    fontFamily="Inter, sans-serif"
                    textAnchor="middle"
                  >
                    {val}
                  </text>
                </g>
              )
            })}

            {/* Render Circles */}
            {points.map((pt, idx) => {
              const x = paddingLeft + (pt.length / maxLen) * graphWidth
              const y = height - paddingBottom - (pt.latency / maxLatency) * graphHeight
              
              const isHovered = hoveredDataPoint && hoveredDataPoint.idx === idx

              return (
                <g key={idx}>
                  {/* Subtle hover focus ring */}
                  {isHovered && (
                    <circle 
                      cx={x} 
                      cy={y} 
                      r="12" 
                      fill="transparent" 
                      stroke={PIPE_COLORS[pt.pipeline]} 
                      strokeWidth="1.5"
                      strokeDasharray="2 2"
                    />
                  )}
                  {/* Actual dot */}
                  <circle 
                    cx={x} 
                    cy={y} 
                    r={isHovered ? "7" : "5"} 
                    fill={PIPE_COLORS[pt.pipeline]} 
                    className="cursor-pointer transition-all duration-150 hover:brightness-125"
                    onMouseEnter={() => setHoveredDataPoint({ ...pt, idx, x, y })}
                    onMouseLeave={() => setHoveredDataPoint(null)}
                  />
                </g>
              )
            })}

            {/* Axis Lines */}
            <line 
              x1={paddingLeft} 
              y1={height - paddingBottom} 
              x2={width - paddingRight} 
              y2={height - paddingBottom} 
              stroke="var(--eval-border-md)" 
            />
            <line 
              x1={paddingLeft} 
              y1={paddingTop} 
              x2={paddingLeft} 
              y2={height - paddingBottom} 
              stroke="var(--eval-border-md)" 
            />
            <text
              x={16}
              y={paddingTop + graphHeight / 2}
              fill={CHART_TEXT}
              fontSize={CHART_FONT.axis}
              fontWeight="400"
              fontFamily="Inter, sans-serif"
              textAnchor="middle"
              transform={`rotate(-90, 16, ${paddingTop + graphHeight / 2})`}
            >
              Response Time (s)
            </text>
            <text
              x={paddingLeft + graphWidth / 2}
              y={height - 6}
              fill={CHART_TEXT}
              fontSize={CHART_FONT.axis}
              fontWeight="400"
              fontFamily="Inter, sans-serif"
              textAnchor="middle"
            >
              Character Count
            </text>
          </svg>

          {/* Floating Tooltip */}
          {hoveredDataPoint && (
            <div 
              className="absolute pointer-events-none glass-card p-3 rounded-xl border border-border shadow-xl z-20 text-[10px] w-60"
              style={(() => {
                const xPercent = (hoveredDataPoint.x / width) * 100;
                const yPercent = (hoveredDataPoint.y / height) * 100;
                
                let translateX = '-50%';
                let leftVal = `${xPercent}%`;
                
                // Shift tooltip if too close to the left or right boundary
                if (xPercent < 20) {
                  translateX = '0%';
                  leftVal = `calc(${xPercent}% + 8px)`;
                } else if (xPercent > 80) {
                  translateX = '-100%';
                  leftVal = `calc(${xPercent}% - 8px)`;
                }
                
                let translateY = '-100%';
                let topVal = `calc(${yPercent}% - 12px)`;
                
                // Show tooltip below the dot if it is too close to the top edge
                if (yPercent < 30) {
                  translateY = '0%';
                  topVal = `calc(${yPercent}% + 12px)`;
                }
                
                return {
                  left: leftVal,
                  top: topVal,
                  transform: `translate(${translateX}, ${translateY})`
                };
              })()}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-semibold" style={{ color: PIPE_COLORS[hoveredDataPoint.pipeline] }}>
                  {PIPE_LABELS[hoveredDataPoint.pipeline]}
                </span>
                <span className="text-muted-foreground">Q#{hoveredDataPoint.qId}</span>
              </div>
              <p className="text-white truncate mb-1.5 font-medium">"{hoveredDataPoint.question}"</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground border-t border-white/5 pt-1.5">
                <div>Gecikme: <span className="text-white font-semibold">{hoveredDataPoint.latency.toFixed(2)}s</span></div>
                <div>Boyut: <span className="text-white font-semibold">{hoveredDataPoint.length} kr.</span></div>
                <div>SAR: <span className="text-white font-semibold">{(hoveredDataPoint.sar * 100).toFixed(0)}%</span></div>
              </div>
            </div>
          )}
        </div>
      )
    })
  }

  const dynamicEvalModels = []

  const groupModelsByProvider = (modelsList) => {
    return modelsList.reduce((acc, model) => {
      const p = model.provider || 'Others';
      if (!acc[p]) acc[p] = [];
      acc[p].push(model);
      return acc;
    }, {});
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background text-foreground animate-fade-in p-6 overflow-y-auto">
      
      {/* Header Dashboard Banner */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-border/60 pb-5 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Activity className="w-5 h-5 animate-pulse" />
            </span>
            <h2 className="text-xl font-bold text-white tracking-tight">TSLBench — RAG Benchmark Results</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Statute Article Recall and RAGAS metrics on the TSLBench200 dataset (BasicRAG, GraphRAG, LightRAG).
          </p>
        </div>

        {!VIEW_ONLY && (
        <div className="flex items-center gap-2">
          {generatorModel && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>Generator: <strong className="text-white">{generatorModel === 'custom' ? customGeneratorModel : generatorModel}</strong></span>
            </div>
          )}
          {judgeModel && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>Judge: <strong className="text-white">{judgeModel === 'custom' ? customJudgeModel : judgeModel}</strong></span>
            </div>
          )}
        </div>
        )}
      </div>

      {!VIEW_ONLY && (
      <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[260px_1fr_1fr_1fr_1fr_1fr] gap-5 mb-6">
        
        {/* Dropdown Models Select */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col gap-3 w-full">
          {/* Select Generator Model */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" /> Select Generator Model
            </label>
            <select 
              value={generatorModel}
              onChange={(e) => {
                setGeneratorModel(e.target.value)
                localStorage.setItem('generatorModel', e.target.value)
              }}
              disabled={isRunning || selectedRunTimestamp !== null}
              className="w-full bg-secondary/80 border border-border focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
            >
              {Object.entries(groupModelsByProvider(dynamicEvalModels)).map(([provider, models]) => (
                <optgroup key={provider} label={provider} className="bg-secondary text-slate-400 font-bold">
                  {models.map(m => (
                    <option key={m.id} value={m.id} className="bg-secondary text-slate-200 font-semibold">{m.name}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Custom Options" className="bg-secondary text-slate-400 font-bold">
                <option value="custom" className="bg-secondary text-slate-200 font-semibold">Specify Custom Model...</option>
              </optgroup>
            </select>
            {generatorModel === 'custom' && (
              <input 
                type="text"
                value={customGeneratorModel}
                onChange={(e) => {
                  setCustomGeneratorModel(e.target.value)
                  localStorage.setItem('generatorModel', e.target.value)
                }}
                disabled={isRunning || selectedRunTimestamp !== null}
                placeholder="e.g., gemma-2-9b-it"
                className="mt-1 bg-secondary/40 border border-border rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500/50 transition-colors"
              />
            )}
          </div>

          <div className="h-px bg-border/40" />

          {/* Select Judge Model */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" /> Select Judge Model
            </label>
            <select 
              value={judgeModel}
              onChange={(e) => {
                setJudgeModel(e.target.value)
                localStorage.setItem('evaluatorModel', e.target.value)
              }}
              disabled={isRunning || selectedRunTimestamp !== null}
              className="w-full bg-secondary/80 border border-border focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
            >
              {Object.entries(groupModelsByProvider(dynamicEvalModels)).map(([provider, models]) => (
                <optgroup key={provider} label={provider} className="bg-secondary text-slate-400 font-bold">
                  {models.map(m => (
                    <option key={m.id} value={m.id} className="bg-secondary text-slate-200 font-semibold">{m.name}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Custom Options" className="bg-secondary text-slate-400 font-bold">
                <option value="custom" className="bg-secondary text-slate-200 font-semibold">Specify Custom Model...</option>
              </optgroup>
            </select>
            {judgeModel === 'custom' && (
              <input 
                type="text"
                value={customJudgeModel}
                onChange={(e) => {
                  setCustomJudgeModel(e.target.value)
                  localStorage.setItem('evaluatorModel', e.target.value)
                }}
                disabled={isRunning || selectedRunTimestamp !== null}
                placeholder="e.g., gemma-2-9b-it"
                className="mt-1 bg-secondary/40 border border-border rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-indigo-500/50 transition-colors"
              />
            )}
          </div>
        </div>

        {/* JSON File Upload Card */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col gap-2 lg:col-span-1">
          <label className="text-xs font-semibold text-indigo-300 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-indigo-400" /> Load Question Set
            </div>
            {selectedSetData && (
              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                Loaded
              </span>
            )}
          </label>
          <div className="flex flex-col gap-2.5">
            <input 
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={handleFileUpload}
              disabled={isRunning || selectedRunTimestamp !== null}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning || selectedRunTimestamp !== null}
              className="w-full bg-secondary/80 border border-border border-dashed hover:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-white flex items-center justify-center gap-2 cursor-pointer transition-all duration-200"
            >
              <Upload className="w-4 h-4 text-indigo-400" />
              <span className="truncate max-w-[150px]">
                {selectedSetData ? selectedSetData.filename : 'Select JSON File'}
              </span>
            </button>
            {questionSets.length > 0 && (
              <select 
                value={questionSets.some(set => set.filename === selectedSet) ? selectedSet : ''}
                onChange={(e) => handleSelectSet(e.target.value)}
                disabled={isRunning || selectedRunTimestamp !== null}
                className="w-full bg-secondary/80 border border-border focus:border-indigo-500/50 rounded-xl px-2.5 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
              >
                <option value="" disabled className="bg-secondary text-slate-400 font-bold">History...</option>
                {questionSets.map(set => (
                  <option key={set.filename} value={set.filename} className="bg-secondary text-slate-200 font-semibold">
                    {set.filename} ({set.question_count || set.count} Q)
                  </option>
                ))}
              </select>
            )}
          </div>
          {selectedSetData && (
            <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
              <span className="px-1.5 py-0.5 rounded bg-white/5">Total Questions: <strong className="text-white">{selectedSetData.questions?.length || 0}</strong></span>
              {selectedSetData.law_ids?.length > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-white/5">Laws: <strong className="text-white">{selectedSetData.law_ids?.join(', ')}</strong></span>
              )}
            </div>
          )}
        </div>

        {/* Question Limit & Evaluation Language Box */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col gap-3.5 justify-center lg:col-span-1">
          {/* Question Limit Section */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-indigo-300">Question Limit</span>
              <span className="text-white bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">{limit}</span>
            </div>
            <input 
              type="range"
              min="1"
              max={selectedSetData?.questions?.length || 10}
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              disabled={isRunning || !selectedSetData || selectedRunTimestamp !== null}
              className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <span className="text-[10px] text-muted-foreground self-end">Max Limit: {selectedSetData?.questions?.length || 0}</span>
          </div>

          {/* Divider */}
          <div className="h-px bg-border/40" />

          {/* Evaluation Language Section */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5 whitespace-nowrap">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Evaluation Language
              </label>
              {selectedSetData && detectedLanguage && (
                <span className="text-[9px] text-muted-foreground">
                  Det: <strong className="text-indigo-400 uppercase">{detectedLanguage}</strong>
                </span>
              )}
            </div>
            <select 
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={isRunning || selectedRunTimestamp !== null}
              className="w-full bg-secondary/80 border border-border focus:border-indigo-500/50 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer transition-colors"
            >
              <option value="tr" className="bg-secondary text-slate-200 font-semibold">Turkish (TR)</option>
              <option value="en" className="bg-secondary text-slate-200 font-semibold">English (EN)</option>
            </select>
          </div>
        </div>

        {/* Checkboxes for Pipelines */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col gap-2">
          <label className="text-xs font-semibold text-indigo-300">Active RAG Pipelines</label>
          <div className="flex flex-wrap gap-2.5 mt-1">
            {['BasicRAG', 'GraphRAG', 'LightRAG'].map(rag => (
              <label 
                key={rag} 
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all ${
                  isRunning || selectedRunTimestamp !== null ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                } ${
                  ragToggles[rag] 
                    ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300 font-medium shadow-md shadow-indigo-500/5' 
                    : 'bg-transparent border-border text-muted-foreground hover:bg-secondary/20'
                }`}
              >
                <input 
                  type="checkbox"
                  checked={ragToggles[rag]}
                  onChange={() => setRagToggles(prev => ({ ...prev, [rag]: !prev[rag] }))}
                  disabled={isRunning || selectedRunTimestamp !== null}
                  className="hidden"
                />
                <span className={`w-1.5 h-1.5 rounded-full ${
                  ragToggles[rag]
                    ? rag === 'BasicRAG' ? 'bg-blue-400' : rag === 'GraphRAG' ? 'bg-purple-400' : 'bg-emerald-400'
                    : 'bg-muted-foreground/30'
                }`} />
                {rag}
              </label>
            ))}
          </div>
        </div>

        {/* Checkboxes for Metrics */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col gap-2">
          <label className="text-xs font-semibold text-indigo-300">RAGAS Metrics</label>
          <div className="flex flex-col gap-2 mt-1">
            {[
              { key: 'sar_macro', label: 'SAR' },
              { key: 'coverage_full', label: 'Coverage' },
              { key: 'hit_rate', label: 'Hit Rate' },
              { key: 'mrr', label: 'MRR' },
              { key: 'map', label: 'MAP' },
              { key: 'ragas_faithfulness', label: 'Faithfulness' },
              { key: 'ragas_answer_relevance', label: 'Answer Relevance' },
              { key: 'ragas_factual_correctness', label: 'Factual Correctness' },
              { key: 'ragas_context_precision', label: 'Context Precision' },
              { key: 'ragas_context_recall', label: 'Context Recall' }
            ].map(m => (
              <label 
                key={m.key} 
                className={`flex items-center gap-2 text-xs select-none transition-all ${
                  isRunning || selectedRunTimestamp !== null 
                    ? 'cursor-not-allowed opacity-60 text-muted-foreground/60' 
                    : 'text-muted-foreground hover:text-slate-200 cursor-pointer'
                }`}
              >
                <input 
                  type="checkbox"
                  checked={metricsToggles[m.key]}
                  onChange={() => {
                    setMetricsToggles(prev => {
                      const next = { ...prev, [m.key]: !prev[m.key] }
                      // Ensure at least one metric is checked
                      if (Object.values(next).every(v => !v)) {
                        return prev
                      }
                      return next
                    })
                  }}
                  disabled={isRunning || selectedRunTimestamp !== null}
                  className="rounded border-border text-indigo-500 bg-secondary/30 focus:ring-indigo-500/20"
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Action Button Block */}
        <div className="glass-card p-4.5 rounded-2xl flex flex-col justify-center gap-2.5">
          <label className="text-xs font-semibold text-indigo-300">Actions</label>
          {isRunning ? (
            <button
              onClick={stopBenchmark}
              disabled={isStopping || !activeRunId}
              className={`w-full py-3.5 px-5 rounded-2xl font-semibold text-xs tracking-wide flex items-center justify-center gap-2 transition-all duration-200 shadow-lg ${
                isStopping || !activeRunId
                  ? 'bg-secondary/40 text-muted-foreground border border-border cursor-not-allowed'
                  : 'bg-gradient-to-br from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white-force shadow-red-500/20 hover:shadow-red-500/30 hover:scale-[1.01] active:scale-[0.99]'
              }`}
            >
              {isStopping ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  <span>Stopping gracefully...</span>
                </>
              ) : (
                <>
                  <Square className="w-4 h-4 text-white-force fill-white-force" />
                  <span>Stop Benchmark</span>
                </>
              )}
            </button>
          ) : (
            <div className="flex flex-col gap-2.5 w-full">
              {selectedRunTimestamp !== null ? (
                <>
                  {getMatchingIncompleteRun() ? (
                    <button
                      onClick={startBenchmark}
                      className="w-full py-3 px-4 rounded-xl font-semibold text-xs tracking-wide flex items-center justify-center gap-2 transition-all duration-200 shadow-lg bg-gradient-to-br from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white-force shadow-emerald-500/20 hover:shadow-emerald-500/30 hover:scale-[1.01] active:scale-[0.99]"
                    >
                      <Play className="w-4 h-4 text-white-force fill-white-force" />
                      <span>Resume Benchmark</span>
                    </button>
                  ) : (
                    <div className="w-full py-2.5 px-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-center font-bold text-xs flex items-center justify-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Run Completed</span>
                    </div>
                  )}
                  
                  <button
                    onClick={handleResetToNewRun}
                    className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs tracking-wide flex items-center justify-center gap-2 transition-all duration-200 border border-indigo-500/35 hover:border-indigo-500/70 hover:bg-indigo-500/10 text-indigo-300 hover:text-indigo-200 hover:scale-[1.01] active:scale-[0.99]"
                  >
                    <span>Configure New Run</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={startBenchmark}
                  disabled={!selectedSetData}
                  className={`w-full py-3.5 px-5 rounded-2xl font-semibold text-xs tracking-wide flex items-center justify-center gap-2 transition-all duration-200 shadow-lg ${
                    !selectedSetData
                      ? 'bg-secondary/40 text-muted-foreground border border-border cursor-not-allowed'
                      : 'bg-gradient-to-br from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white-force shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:scale-[1.01] active:scale-[0.99]'
                  }`}
                >
                  <Play className="w-4 h-4 text-white-force fill-white-force" />
                  <span>Start Benchmark</span>
                </button>
              )}
            </div>
          )}
        </div>

      </div>
      )}

      {errorMsg && (
        <div className="flex-shrink-0 mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2.5">
          <XCircle className="w-4 h-4" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Progress update widget */}
      {!VIEW_ONLY && isRunning && currentProgress && (
        <div className="flex-shrink-0 glass-card p-4 rounded-2xl border border-indigo-500/20 mb-6 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-indigo-400 font-semibold flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {currentProgress.status}
            </span>
            <span className="text-muted-foreground font-medium">Question {currentProgress.index + 1} / {limit}</span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${((currentProgress.index + 1) / limit) * 100}%` }}
            />
          </div>
          {currentProgress.question && (
            <p className="text-[11px] text-muted-foreground italic truncate">Query: "{currentProgress.question}"</p>
          )}
        </div>
      )}

      {/* Results panel container */}
      {(resultsData || (!VIEW_ONLY && (isRunning || logs.length > 0 || runsHistory.length > 0))) && (
        <div className="flex-1 flex flex-row min-h-[620px] max-h-[850px] glass-card rounded-2xl border border-border/80 overflow-hidden">
          
          {!VIEW_ONLY && (
          <div className="w-[280px] flex-shrink-0 border-r border-border/60 bg-secondary/5 flex flex-col min-h-0">
            <div className="flex-shrink-0 p-4 border-b border-border/60 flex justify-between items-center bg-secondary/10">
              <span className="text-[11px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                Runs & Experiments
              </span>
              <button 
                onClick={fetchRunsHistory}
                disabled={loadingHistory}
                className="p-1 rounded hover:bg-white/5 text-muted-foreground hover:text-white transition-colors duration-150"
                title="Refresh History"
              >
                <Loader2 className={`w-3.5 h-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {runsHistory.length === 0 ? (
                <div className="text-[11px] text-muted-foreground/60 italic p-4 text-center">
                  No past benchmark runs found.
                </div>
              ) : (
                runsHistory.map((run) => {
                  const isActive = selectedRunTimestamp === run.timestamp;
                  let formattedTime = run.timestamp;
                  if (run.timestamp && run.timestamp.length === 15) {
                    const yr = run.timestamp.substring(0, 4);
                    const mo = run.timestamp.substring(4, 6);
                    const dy = run.timestamp.substring(6, 8);
                    const hr = run.timestamp.substring(9, 11);
                    const mn = run.timestamp.substring(11, 13);
                    const sc = run.timestamp.substring(13, 15);
                    formattedTime = `${dy}/${mo}/${yr} ${hr}:${mn}:${sc}`;
                  }
                  
                  const isRunRunning = isRunning && !run.has_results && run.timestamp === runsHistory[0].timestamp;
                  
                  return (
                    <div 
                      key={run.timestamp}
                      onClick={() => !isRunRunning && handleSelectRun(run)}
                      className={`p-3 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
                        isActive 
                          ? 'bg-indigo-500/10 border-indigo-500/50 shadow-md shadow-indigo-500/5'
                          : 'bg-white/5 border-border/40 hover:bg-white/10 hover:border-border'
                      } ${isRunRunning ? 'cursor-not-allowed opacity-75' : ''}`}
                    >
                      <div className="flex justify-between items-start gap-1.5">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[10px] font-bold text-white tracking-wide truncate">
                            {formattedTime}
                          </span>
                          <span className="text-[9px] text-muted-foreground font-semibold uppercase truncate">
                            {run.parameters?.judge_model ? run.parameters.judge_model.replace('openrouter:', '') : 'No Judge'}
                          </span>
                          <div className="mt-1 flex items-center gap-1.5">
                            {run.completed ? (
                              <span className="text-[8.5px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                                Completed
                              </span>
                            ) : (
                              <span className="text-[8.5px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                                Incomplete
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {isRunRunning ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" title="Running" />
                          ) : isActive ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Active" />
                          ) : null}
                          <button 
                            onClick={(e) => handleDeleteRun(e, run.timestamp)}
                            disabled={isRunRunning}
                            className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
                            title="Delete Run"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      
                      {run.has_results && run.summary_metrics && Object.keys(run.summary_metrics).length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-white/5 pt-2 text-[9px] text-muted-foreground">
                          {Object.entries(run.summary_metrics).map(([pipe, metrics]) => {
                            const pipeLabel = pipe === 'basic_rag' ? 'Basic' : pipe === 'graph_rag' ? 'Graph' : 'Light';
                            const color = pipe === 'basic_rag' ? 'text-blue-400' : pipe === 'graph_rag' ? 'text-purple-400' : 'text-emerald-400';
                            const sar = ((metrics.sar || 0) * 100).toFixed(0);
                            const faith = ((metrics.faithfulness || 0) * 100).toFixed(0);
                            
                            return (
                              <div key={pipe} className="flex justify-between items-center">
                                <span className={`font-bold ${color}`}>{pipeLabel}:</span>
                                <span>SAR: {sar}% | Faith: {faith}%</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      
                      {isRunRunning && (
                        <div className="flex items-center gap-1 border-t border-white/5 pt-2 text-[9px] text-indigo-400">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>Evaluating...</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          )}
          
          {/* RIGHT COLUMN: Results Details & Tabs */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            
            {/* View Tab Selectors */}
            <div className="flex-shrink-0 flex items-center justify-between border-b border-border/60 bg-secondary/10 px-5">
            <div className="flex">
              <button
                onClick={() => setActiveViewTab('metrics')}
                disabled={!resultsData}
                className={`px-4 py-3.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeViewTab === 'metrics'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5'
                } ${!resultsData ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                <BarChart3 className="w-4 h-4" />
                Performance Metrics
              </button>
              <button
                onClick={() => setActiveViewTab('comparison')}
                disabled={!resultsData}
                className={`px-4 py-3.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeViewTab === 'comparison'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5'
                } ${!resultsData ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                <Layers className="w-4 h-4" />
                Comparison Matrix
              </button>
              {!VIEW_ONLY && (
              <button
                onClick={() => setActiveViewTab('logs')}
                className={`px-4 py-3.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 ${
                  activeViewTab === 'logs'
                    ? 'border-indigo-500 text-white'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5'
                }`}
              >
                <Terminal className="w-4 h-4" />
                Live Logs
                {isRunning && <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />}
              </button>
              )}
            </div>
            
            {resultsData && (
              <button
                onClick={downloadResultsJson}
                className="px-3.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 flex items-center gap-2 transition-all duration-200"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span>Export Detailed JSON</span>
              </button>
            )}
          </div>

          {/* Tab Contents */}
          <div className="flex-1 min-h-0 overflow-y-auto p-6">
            
            {VIEW_ONLY && loadingHistory && !resultsData && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4 my-10">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <p className="text-xs text-muted-foreground">Loading TSLBench200 results…</p>
              </div>
            )}

            {!VIEW_ONLY && !resultsData && !isRunning && logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4 my-10">
                <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Layers className="w-8 h-8" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-sm font-bold text-white mb-1.5">No Run Selected</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Select an evaluation run from the history sidebar on the left to inspect metrics, comparison matrix, and logs, or start a new benchmark run above.
                  </p>
                </div>
              </div>
            )}
            
            {/* TAB: METRICS */}
            {activeViewTab === 'metrics' && resultsData && (
              <div className="space-y-6">
                
                {/* Averages Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {averages && Object.entries(averages).map(([pipe, avg]) => {
                    const label = pipe === 'basic_rag' ? 'BasicRAG' : pipe === 'graph_rag' ? 'GraphRAG' : 'LightRAG'
                    const color = pipe === 'basic_rag' ? 'text-blue-400' : pipe === 'graph_rag' ? 'text-purple-400' : 'text-emerald-400'
                    const bColor = pipe === 'basic_rag' ? 'border-blue-500/10' : pipe === 'graph_rag' ? 'border-purple-500/10' : 'border-emerald-500/10'
                    const gColor = pipe === 'basic_rag' ? 'bg-blue-500/5' : pipe === 'graph_rag' ? 'bg-purple-500/5' : 'bg-emerald-500/5'

                    return (
                      <div key={pipe} className={`p-4 rounded-xl border ${bColor} ${gColor} flex flex-col gap-3.5`}>
                        <div className="flex justify-between items-center">
                          <span className={`text-xs font-bold tracking-wide uppercase ${color}`}>{label}</span>
                          <span className="text-[10px] text-muted-foreground font-medium">N={getBenchmarkQuestionCount(resultsData)} Questions</span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-2">
                          {metricsConfig.filter(m => metricsToggles[m.key]).map(m => {
                            const scoreVal = avg[m.key]
                            return (
                              <div key={m.key}>
                                <span className="text-[10px] text-muted-foreground block">{m.label}</span>
                                <span className="text-base font-bold text-white">
                                  {formatMetricValue(scoreVal, m.format)}
                                </span>
                              </div>
                            )
                          })}
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Avg Latency</span>
                            <span className="text-base font-bold text-white flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 opacity-60" /> {(avg.latency_mean ?? 0).toFixed(2)}s
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* SVG Visual Charts */}
                <div className="space-y-6">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {renderRetrievalBarChart()}
                    {renderRagasBarChart()}
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {renderRadarChart()}
                    {renderLatencyChart()}
                  </div>
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {renderQuestionTypeChart()}
                    {renderScatterPlot()}
                  </div>
                </div>

              </div>
            )}

            {/* TAB: COMPARISON MATRIX */}
            {activeViewTab === 'comparison' && resultsData && (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                  <div className="flex flex-col gap-0.5">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Question-Based Response and Score Matrix</h4>
                    <span className="text-[10px] text-muted-foreground">Click on a row to review the detailed response and context comparison.</span>
                  </div>
                  <button
                    onClick={downloadResultsJson}
                    className="px-3.5 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 flex items-center gap-2 transition-all duration-200"
                  >
                    <Download className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Download Detailed JSON</span>
                  </button>
                </div>

                <div className="border border-border/80 rounded-xl overflow-hidden">
                  {resultsData.results.map((r, rIdx) => {
                    const isExpanded = expandedQuestionId === r.question_id
                    
                    return (
                      <div key={r.question_id} className={`border-b border-border/40 last:border-0 ${isExpanded ? 'bg-secondary/10' : ''}`}>
                        
                        {/* Question Row Header */}
                        <div 
                          onClick={() => setExpandedQuestionId(isExpanded ? null : r.question_id)}
                          className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-3 cursor-pointer hover:bg-secondary/20 transition-all select-none"
                        >
                          <div className="flex-1 min-w-0 pr-4">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                Question #{rIdx + 1}
                              </span>
                              <span className="text-[9px] text-muted-foreground font-semibold uppercase">{r.question_type}</span>
                            </div>
                            <h5 className="text-xs font-semibold text-white truncate">"{r.question}"</h5>
                          </div>

                          {/* Quick Performance Indicators */}
                          <div className="flex items-center gap-3 flex-shrink-0 text-[10px]">
                            {['basic_rag', 'graph_rag', 'light_rag'].map(pipe => {
                              if (pipe === 'basic_rag' && !ragToggles.BasicRAG) return null;
                              if (pipe === 'graph_rag' && !ragToggles.GraphRAG) return null;
                              if (pipe === 'light_rag' && !ragToggles.LightRAG) return null;
                              const item = r[pipe]
                              if (!item) return null
                              const label = pipe === 'basic_rag' ? 'Basic' : pipe === 'graph_rag' ? 'Graph' : 'Light'
                              const color = pipe === 'basic_rag' ? 'border-blue-500/20 text-blue-400 bg-blue-500/5' : pipe === 'graph_rag' ? 'border-purple-500/20 text-purple-400 bg-purple-500/5' : 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5'
                                return (
                                  <div key={pipe} className={`px-2 py-1 rounded border flex flex-col items-center gap-0.5 ${color}`}>
                                    <span className="font-semibold text-[8px] uppercase tracking-wide">{label}</span>
                                    {metricsToggles.sar_macro ? (
                                      <span>SAR: {(statuteArticleRecall(item.sources, r.relevant_article_list) * 100).toFixed(0)}%</span>
                                    ) : (
                                      <span>{item.latency.toFixed(1)}s</span>
                                    )}
                                  </div>
                                )
                            })}
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground ml-1" />}
                          </div>
                        </div>

                        {/* Question Detailed Content (Expanded Panel) */}
                        {isExpanded && (
                          <div className="p-5 border-t border-border/40 bg-secondary/5 space-y-5 text-xs">
                            
                            {/* Question Details */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-secondary/20 p-4 rounded-xl border border-border/40">
                              <div>
                                <span className="font-bold text-white block mb-1">Question Text</span>
                                <p className="text-[var(--eval-text2)] italic leading-relaxed">"{r.question}"</p>
                              </div>
                              <div>
                                <span className="font-bold text-white block mb-1">Ground Truth Answer</span>
                                <p className="text-[var(--eval-text1)] whitespace-pre-line leading-relaxed">{r.ground_truth_answer}</p>
                              </div>
                            </div>

                            {/* Side-by-side RAG comparison columns */}
                            <div className={`grid grid-cols-1 gap-5 ${
                               Object.values(ragToggles).filter(Boolean).length === 3 ? 'lg:grid-cols-3' : 
                               Object.values(ragToggles).filter(Boolean).length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-1'
                             }`}>
                              {['basic_rag', 'graph_rag', 'light_rag'].map(pipe => {
                                if (pipe === 'basic_rag' && !ragToggles.BasicRAG) return null;
                                if (pipe === 'graph_rag' && !ragToggles.GraphRAG) return null;
                                if (pipe === 'light_rag' && !ragToggles.LightRAG) return null;
                                const item = r[pipe]
                                if (!item) return (
                                  <div key={pipe} className="p-4 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground italic text-xs">
                                    {pipe === 'basic_rag' ? 'BasicRAG' : pipe === 'graph_rag' ? 'GraphRAG' : 'LightRAG'} is inactive.
                                  </div>
                                )

                                const label = pipe === 'basic_rag' ? 'BasicRAG' : pipe === 'graph_rag' ? 'GraphRAG' : 'LightRAG'
                                const colorClass = pipe === 'basic_rag' ? 'text-blue-400 bg-blue-500/5 border-blue-500/10' : pipe === 'graph_rag' ? 'text-purple-400 bg-purple-500/5 border-purple-500/10' : 'text-emerald-400 bg-emerald-500/5 border-emerald-500/10'
                                const ragas = item.ragas_scores || {}

                                return (
                                  <div key={pipe} className="bg-secondary/15 border border-border/60 rounded-xl overflow-hidden flex flex-col">
                                    <div className={`p-3 border-b border-border/60 flex justify-between items-center ${colorClass}`}>
                                      <span className="font-bold uppercase tracking-wider text-[10px]">{label}</span>
                                      <span className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                                        <Clock className="w-3 h-3" /> {item.latency}s
                                      </span>
                                    </div>

                                    <div className="p-4 flex-1 flex flex-col gap-4">
                                      {/* Generated answer */}
                                      <div>
                                        <span className="text-[10px] font-bold text-white block mb-1 uppercase tracking-wider opacity-85">RAG Response</span>
                                        <div className="bg-secondary/30 p-3 rounded-lg border border-border/30 max-h-48 overflow-y-auto text-[var(--eval-text1)] leading-relaxed whitespace-pre-line text-[11px]">
                                          {item.answer}
                                        </div>
                                      </div>

                                      {/* Retrieved sources */}
                                      <div>
                                        <span className="text-[10px] font-bold text-white block mb-1 uppercase tracking-wider opacity-85">Retrieved Sources</span>
                                        <div className="flex flex-wrap gap-1.5">
                                          {item.sources && item.sources.length > 0 ? (
                                            item.sources.map(src => {
                                              const isMatch = (r.relevant_article_list || []).includes(src)
                                              return (
                                                <span 
                                                  key={src} 
                                                  className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                                                    isMatch 
                                                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                                                      : 'bg-white/5 border-white/5 text-muted-foreground'
                                                  }`}
                                                >
                                                  {src}
                                                </span>
                                              )
                                            })
                                          ) : (
                                            <span className="text-[10px] text-muted-foreground italic">No sources found</span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Ragas metric details */}
                                      <div className="border-t border-border/40 pt-3.5">
                                        <span className="text-[10px] font-bold text-white block mb-2 uppercase tracking-wider opacity-85">Ragas Scores</span>
                                         <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-[10px] text-muted-foreground">
                                           {metricsConfig.filter(m => metricsToggles[m.key]).map(m => {
                                             const isRetrievalMetric = m.category === 'retrieval'
                                             const scoreVal = isRetrievalMetric 
                                               ? (m.key === 'sar_macro' ? statuteArticleRecall(item.sources, r.relevant_article_list) : (averages[selectedPipeline]?.[m.key] || 0))
                                               : ragas[m.key.replace('ragas_', '')]
                                             const displayVal = scoreVal !== undefined 
                                               ? (isRetrievalMetric ? `${(scoreVal * 100).toFixed(0)}%` : scoreVal.toFixed(2)) 
                                               : '-'
                                             return (
                                               <div key={m.key} className="flex justify-between items-center">
                                                 <span>{m.label}:</span>
                                                 <span className="text-white font-bold">{displayVal}</span>
                                               </div>
                                             )
                                           })}
                                         </div>

                                        {/* Turkish Judge Details Panel */}
                                        {item.judge_details && Object.keys(item.judge_details).length > 0 && !item.judge_details.error && (
                                          <div className="border-t border-border/40 pt-3 mt-3">
                                            <button 
                                              onClick={() => toggleJudgeDetails(r.question_id, pipe)}
                                              className="flex items-center justify-between w-full text-indigo-400 hover:text-indigo-300 font-semibold text-[9px] uppercase tracking-wider transition-colors duration-150"
                                            >
                                              <span>Judge Evaluation Details</span>
                                              {isJudgeDetailsExpanded(r.question_id, pipe) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                            </button>
                                            
                                            {isJudgeDetailsExpanded(r.question_id, pipe) && (
                                              <div className="mt-2.5 space-y-3.5 max-h-60 overflow-y-auto pr-1 text-[10px] text-muted-foreground bg-secondary/15 p-2.5 rounded-lg border border-border/30">
                                                {/* Faithfulness Details */}
                                                {item.judge_details.faithfulness && item.judge_details.faithfulness.length > 0 && (
                                                  <div>
                                                    <div className="font-bold text-white mb-1.5 border-b border-white/5 pb-0.5 uppercase tracking-wider text-[9px] opacity-80">Faithfulness Details</div>
                                                    <div className="space-y-1.5">
                                                      {item.judge_details.faithfulness.map((st, sidx) => (
                                                        <div key={sidx} className="p-2 rounded bg-white/5 border border-white/5">
                                                          <div className="flex justify-between items-start gap-2 mb-1">
                                                            <span className="font-semibold text-white leading-snug">"{st.statement}"</span>
                                                            <span className={`px-1 rounded text-[8px] font-bold whitespace-nowrap ${st.verdict === 1 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                                                              {st.verdict === 1 ? 'Faithful' : 'Unfaithful'}
                                                            </span>
                                                          </div>
                                                          <p className="text-[9px] text-muted-foreground leading-relaxed"><span className="text-white/60 font-medium">Reasoning:</span> {st.reason}</p>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                                
                                                {/* Answer Relevance Details */}
                                                {item.judge_details.answer_relevance && item.judge_details.answer_relevance.length > 0 && (
                                                  <div>
                                                    <div className="font-bold text-white mb-1.5 border-b border-white/5 pb-0.5 uppercase tracking-wider text-[9px] opacity-80 mt-1">Answer Relevance Details</div>
                                                    <p className="text-[9px] mb-1.5 text-muted-foreground leading-relaxed">Questions generated based on the answer to measure similarity:</p>
                                                    <ul className="space-y-1 pl-1 border-l border-white/5">
                                                      {item.judge_details.answer_relevance.map((qText, qidx) => (
                                                        <li key={qidx} className="italic text-muted-foreground pl-1.5 relative before:content-['•'] before:absolute before:left-0 before:text-indigo-400">"{qText}"</li>
                                                      ))}
                                                    </ul>
                                                  </div>
                                                )}

                                                {/* Factual Correctness Details */}
                                                {item.judge_details.factual_correctness && !item.judge_details.factual_correctness.skipped && (
                                                  <div>
                                                    <div className="font-bold text-white mb-1.5 border-b border-white/5 pb-0.5 uppercase tracking-wider text-[9px] opacity-80 mt-1">Factual Correctness Details</div>
                                                    <div className="grid grid-cols-2 gap-2 mb-2 p-1.5 bg-white/5 rounded border border-white/5 text-[9px]">
                                                      <div>Precision (P): <span className="text-emerald-400 font-bold">{(item.judge_details.factual_correctness.precision * 100).toFixed(0)}%</span></div>
                                                      <div>Recall (R): <span className="text-emerald-400 font-bold">{(item.judge_details.factual_correctness.recall * 100).toFixed(0)}%</span></div>
                                                    </div>
                                                    {/* response_claims */}
                                                    {item.judge_details.factual_correctness.response_claims && item.judge_details.factual_correctness.response_claims.length > 0 && (
                                                      <div className="space-y-1.5">
                                                        <div className="text-white/70 font-semibold text-[9px] mb-1">RAG Response Claim Verification:</div>
                                                        {item.judge_details.factual_correctness.response_claims.map((cl, cidx) => (
                                                          <div key={cidx} className="p-1.5 rounded bg-white/5 border border-white/5">
                                                            <div className="flex justify-between items-start gap-1">
                                                              <span className="text-white font-medium leading-tight">"{cl.claim}"</span>
                                                              <span className={cl.verdict === 1 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                                                {cl.verdict === 1 ? '✓' : '✗'}
                                                              </span>
                                                            </div>
                                                            {cl.reason && <p className="text-[9px] text-muted-foreground mt-1"><span className="text-white/60">Verdict:</span> {cl.reason}</p>}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}

                                                {/* Context Precision Details */}
                                                {item.judge_details.context_precision && item.judge_details.context_precision.length > 0 && (
                                                  <div>
                                                    <div className="font-bold text-white mb-1.5 border-b border-white/5 pb-0.5 uppercase tracking-wider text-[9px] opacity-80 mt-1">Context Precision Details</div>
                                                    <div className="space-y-1.5">
                                                      {item.judge_details.context_precision.map((cp, cpidx) => (
                                                        <div key={cpidx} className="p-2 rounded bg-white/5 border border-white/5">
                                                          <div className="flex justify-between items-center mb-1">
                                                            <span className="font-semibold text-white">Context Chunk #{cp.chunk_idx + 1}</span>
                                                            <span className={`px-1 rounded text-[8px] font-bold ${cp.verdict === 1 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                                                              {cp.verdict === 1 ? 'Relevant' : 'Irrelevant'}
                                                            </span>
                                                          </div>
                                                          <p className="text-[9px] text-muted-foreground leading-relaxed"><span className="text-white/60">Reasoning:</span> {cp.reason}</p>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}

                                                {/* Context Recall Details */}
                                                {item.judge_details.context_recall && item.judge_details.context_recall.length > 0 && (
                                                  <div>
                                                    <div className="font-bold text-white mb-1.5 border-b border-white/5 pb-0.5 uppercase tracking-wider text-[9px] opacity-80 mt-1">Context Recall Details</div>
                                                    <div className="space-y-1.5">
                                                      {item.judge_details.context_recall.map((cr, cridx) => (
                                                        <div key={cridx} className="p-2 rounded bg-white/5 border border-white/5">
                                                          <div className="flex justify-between items-start gap-2 mb-1">
                                                            <span className="font-semibold text-white leading-snug">Ground Truth Statement: "{cr.statement}"</span>
                                                            <span className={`px-1 rounded text-[8px] font-bold whitespace-nowrap ${cr.attributed === 1 ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'}`}>
                                                              {cr.attributed === 1 ? 'Attributed' : 'Missing'}
                                                            </span>
                                                          </div>
                                                          <p className="text-[9px] text-muted-foreground leading-relaxed"><span className="text-white/60">Reasoning:</span> {cr.reason}</p>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>

                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* TAB: LIVE LOGS */}
            {activeViewTab === 'logs' && (
              <div className="flex flex-col h-[400px]">
                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4.5 h-4.5 text-indigo-400" />
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Evaluation Console (SSE Stream)</h4>
                  </div>
                  {isRunning && (
                    <span className="flex items-center gap-1.5 text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 font-semibold animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" /> LIVE CONNECTION ACTIVE
                    </span>
                  )}
                </div>

                {/* Terminal screen */}
                <div className="flex-1 terminal-console rounded-xl border border-border/80 p-4 font-mono text-[10.5px] leading-relaxed overflow-y-auto shadow-inner transition-colors duration-200">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground/60 italic flex items-center justify-center h-full gap-2">
                      <Info className="w-4 h-4" /> Live server log stream will be displayed here when the benchmark starts.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {logs.map((log, idx) => {
                        let colorClass = 'terminal-info'
                        let prefix = '[INFO]'
                        
                        if (log.type === 'error') {
                          colorClass = 'text-red-400 font-bold'
                          prefix = '[ERROR]'
                        } else if (log.type === 'success') {
                          colorClass = 'text-emerald-400 font-bold'
                          prefix = '[DONE]'
                        } else if (log.type === 'progress') {
                          colorClass = 'text-cyan-400'
                          prefix = '[STEP]'
                        }

                        return (
                          <div key={idx} className={`${colorClass} terminal-line flex items-start gap-2 py-0.5 px-1 rounded transition-colors duration-150`}>
                            <span className="terminal-time text-[9px] flex-shrink-0 select-none mt-0.5">{log.time || '--:--:--'}</span>
                            <span className="terminal-prefix font-bold flex-shrink-0 select-none">{prefix}</span>
                            <span className="whitespace-pre-wrap">{log.text}</span>
                          </div>
                        )
                      })}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Results Summary footer info */}
          {resultsData && (
            <div className="flex-shrink-0 border-t border-border/60 bg-secondary/15 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between text-[10px] text-muted-foreground gap-3">
              <div>
                Report Time: <strong className="text-white">{resultsData.timestamp}</strong>
              </div>
              <div className="flex gap-4 font-semibold">
                <span>Status: <strong className={resultsData.completed ? "text-emerald-400" : "text-amber-400"}>{resultsData.completed ? "Completed" : "Incomplete (Can Resume)"}</strong></span>
                <span>Questions: <strong className="text-white">{resultsData.questions_count} items</strong></span>
                {resultsData.generator_model && (
                  <span>Generator LLM: <strong className="text-white">{resultsData.generator_model}</strong></span>
                )}
                <span>Judge LLM: <strong className="text-white">{resultsData.judge_model}</strong></span>
                <span>Laws: <strong className="text-white">law_{resultsData.law_ids?.join(', ')}</strong></span>
              </div>
            </div>
          )}
          
          </div>
        </div>
      )}

    </div>
  )
}
