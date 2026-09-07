import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDurationMin, normStatus, pick } from '../utils/format.js'
import { API_BASE, backendHealth, isBackendConfigured, runPipeline } from '../services/aiService.js'

// AI Recommendations — DISPLAY ONLY. This page never computes scores.
//   Module1 RF (module1_rf_model.joblib)      -> priority_score, risk_level on tasks
//   Module2 XGBRanker (module2_xgb_ranker.joblib) -> ranked candidate_windows
//   Module3 CP-SAT                              -> final block_plans
// The chain runs in the Python backend (ML_pipeline/) and persists results
// to Firestore. Staff trigger it via "Run pipeline" (needs FastAPI backend).

const MODELS = [
  { n: '1', name: 'Random Forest', artifact: 'ML_pipeline/module1_rf_model.joblib', out: 'priority_score + risk_level → maintenance_tasks' },
  { n: '2', name: 'XGBoost XGBRanker', artifact: 'ML_pipeline/module2_xgb_ranker.joblib', out: 'xgb_score / rank / recommendation → candidate_windows' },
  { n: '3', name: 'OR-Tools CP-SAT', artifact: 'ML_pipeline/CP-SAT algorithm', out: 'optimized schedule → block_plans' },
]

export default function AIRecommendations() {
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const windows = useCollection('candidate_windows', { max: 1000 })
  const blocks = useCollection('block_plans', { max: 200 })
  const assets = useCollection('assets', { max: 500 })
  const corridors = useCollection('corridor_blocks', { max: 200 })
  const [selTask, setSelTask] = useState('')
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState(null)
  const [health, setHealth] = useState(null) // null=checking, {ok,...}

  useEffect(() => {
    let alive = true
    if (!isBackendConfigured) return
    backendHealth().then((h) => {
      if (alive) setHealth(h)
    })
    return () => {
      alive = false
    }
  }, [])

  const prioritized = useMemo(() => {
    if (tasks.unavailable) return []
    return tasks.rows
      .filter((t) => pick(t, 'priority_score', 'priorityScore') != null || pick(t, 'risk_level', 'riskLevel'))
      .sort((a, b) => (Number(pick(b, 'priority_score', 'priorityScore')) || 0) - (Number(pick(a, 'priority_score', 'priorityScore')) || 0))
  }, [tasks])

  const windowsByTask = useMemo(() => {
    const m = {}
    if (!windows.unavailable) {
      windows.rows.forEach((w) => {
        const t = pick(w, 'task_id', 'taskId')
        if (!t) return
        const k = String(t)
        if (!m[k]) m[k] = []
        m[k].push(w)
      })
      Object.values(m).forEach((l) => l.sort((a, b) =>
        (Number(pick(a, 'xgb_rank', 'xgbRank')) || 999) - (Number(pick(b, 'xgb_rank', 'xgbRank')) || 999)))
    }
    return m
  }, [windows])

  const focusTaskId = selTask || (prioritized[0] ? String(pick(prioritized[0], 'task_id', 'taskId') || prioritized[0].id) : '')
  const focusWindows = focusTaskId ? (windowsByTask[focusTaskId] || []) : []
  const focusTask = prioritized.find((t) => String(pick(t, 'task_id', 'taskId') || t.id) === focusTaskId)

  const trigger = async () => {
    setRunMsg(null)
    setRunning(true)
    try {
      // 1. Gather all task IDs already included in existing non-cancelled block plans
      const plannedTaskIds = new Set()
      blocks.rows.forEach((b) => {
        const s = normStatus(pick(b, 'status', 'approval_status'))
        if (['cancelled', 'canceled', 'rejected'].includes(s)) return
        const raw = pick(b, 'tasks', 'tasks_included', 'task_ids', 'task_list', 'task_id')
        if (Array.isArray(raw)) {
          raw.forEach((x) => {
            const id = typeof x === 'object' ? pick(x, 'task_id', 'id') : x
            if (id) plannedTaskIds.add(String(id).trim())
          })
        } else if (raw) {
          plannedTaskIds.add(String(raw).trim())
        }
      })

      // 2. Filter tasks: only open/unscheduled tasks that are NOT already in a block plan
      const BLOCKED = new Set(['scheduled', 'assigned', 'in_progress', 'inprogress', 'progress', 'completed', 'complete', 'done', 'cancelled', 'canceled', 'rejected'])
      const candidateTasks = tasks.rows.filter((t) => {
        const tid = String(pick(t, 'task_id', 'taskId') || t.id).trim()
        if (!tid) return false
        if (plannedTaskIds.has(tid)) return false
        if (t.block_plan_id || t.plan_id) return false
        const st = normStatus(pick(t, 'status', 'task_status', 'state'))
        if (BLOCKED.has(st)) return false
        return true
      })

      const uniqueIds = Array.from(new Set(candidateTasks.map((t) => String(pick(t, 'task_id', 'taskId') || t.id).trim()))).slice(0, 50)

      if (candidateTasks.length === 0) {
        setRunMsg({
          ok: true,
          text: 'All open tasks have already been planned or scheduled into block plans. No duplicate tasks were pushed to the ML pipeline.',
        })
        return
      }

      const clientContext = {
        tasks: tasks.rows,
        assets: assets.rows,
        corridor_blocks: corridors.rows,
        candidate_windows: windows.rows,
        block_plans: blocks.rows,
      }
      const res = await runPipeline(uniqueIds, clientContext)
      const n = res?.modules?.module1?.tasks_scored ?? uniqueIds.length
      const skippedCount = res?.skipped?.length ?? 0
      setRunMsg({
        ok: true,
        text: `Pipeline run ${res?.run_id || ''} completed: scored ${n} unique task(s), ranked ${res?.modules?.module2?.windows_ranked ?? 0} window(s), created ${res?.modules?.module3?.plans?.length ?? 0} plan(s).` + (skippedCount ? ` (${skippedCount} already-planned/duplicate tasks safely skipped)` : ''),
      })
    } catch (e) {
      setRunMsg({ ok: false, text: e.message })
    } finally {
      setRunning(false)
    }
  }

  const backendDown = isBackendConfigured && health && !health.ok

  return (
    <div>
      <div className="page-head">
        <div><h2>AI Recommendations</h2><p>Backend pipeline results only — the portal never invents scores.</p></div>
        <button className="btn btn-primary" disabled={running || !isBackendConfigured || backendDown} onClick={trigger} title={!isBackendConfigured ? 'Set VITE_API_BASE_URL to enable' : backendDown ? 'Backend unreachable — start it first' : 'Run RF → XGBRanker → CP-SAT on the backend'}>
          {running ? 'Running...' : 'Run pipeline'}
        </button>
      </div>

      {!isBackendConfigured && (
        <div className="alert alert-warn">
          AI backend not connected (<span className="mono">VITE_API_BASE_URL</span> empty). This page shows results already stored in Firestore; “Run pipeline” is disabled until the FastAPI server is deployed.
        </div>
      )}
      {isBackendConfigured && health === null && (
        <div className="alert alert-info">Checking AI backend at <span className="mono">{API_BASE}</span>…</div>
      )}
      {isBackendConfigured && health && !health.ok && (
        <div className="alert alert-err">
          AI backend unreachable at <span className="mono">{API_BASE}</span> ({health.reason || 'connection failed'}).
          Start it with: <span className="mono">cd backend</span> then <span className="mono">.\.venv\Scripts\python -m uvicorn main:app --port 8000</span>.
          Stored Firestore results below are still shown.
        </div>
      )}
      {isBackendConfigured && health && health.ok && (
        <div className="alert alert-ok">
          AI backend connected — models loaded ({health.firestore || 'ready'}).
        </div>
      )}
      {runMsg && <div className={`alert ${runMsg.ok ? 'alert-ok' : 'alert-err'}`}>{runMsg.text}</div>}

      <div className="grid cols-3">
        {MODELS.map((m) => (
          <Card
            key={m.n}
            title={`Module ${m.n} · ${m.name}`}
            sub={m.artifact}
            right={
              m.n === '1' ? <Badge value={tasks.unavailable ? 'no data' : `${prioritized.length} scored`} />
              : m.n === '2' ? <Badge value={windows.unavailable ? 'no data' : `${windows.rows.length} windows`} />
              : <Badge value={blocks.unavailable ? 'no data' : `${blocks.rows.length} plans`} />
            }
          >
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{m.out}</p>
          </Card>
        ))}
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Prioritized tasks (Module 1 output)" sub={tasks.unavailable ? 'Data unavailable in database' : 'priority_score + risk_level from maintenance_tasks'}>
          {tasks.loading ? <Loading rows={4} /> : tasks.unavailable ? <Unavailable collection="maintenance_tasks" /> : prioritized.length === 0 ? (
            <EmptyState title="No scored tasks yet" hint="No priority_score / risk_level fields in the database. Run Module 1 in the backend." />
          ) : (
            <div className="table-wrap" style={{ boxShadow: 'none' }}>
              <table className="tbl">
                <thead><tr><th>Task</th><th>Score</th><th>Risk</th><th></th></tr></thead>
                <tbody>
                  {prioritized.slice(0, 12).map((t) => {
                    const tid = String(pick(t, 'task_id', 'taskId') || t.id)
                    return (
                      <tr key={t.id} style={tid === focusTaskId ? { background: '#eaf0f7' } : undefined}>
                        <td className="id">{tid}</td>
                        <td><b>{pick(t, 'priority_score', 'priorityScore') ?? '—'}</b></td>
                        <td><Badge value={pick(t, 'risk_level', 'riskLevel')} /></td>
                        <td><button className="btn btn-sm" onClick={() => setSelTask(tid)}>Windows</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={focusTaskId ? `Ranked windows · ${focusTaskId}` : 'Ranked windows (Module 2 output)'}
          sub={windows.unavailable ? 'Data unavailable in database' : 'xgb_score / rank / recommendation from candidate_windows'}
        >
          {windows.loading ? <Loading rows={4} /> : windows.unavailable ? <Unavailable collection="candidate_windows" /> : !focusTask ? (
            <EmptyState title="Select a task" hint="Choose a prioritized task to see its ranked candidate windows." />
          ) : focusWindows.length === 0 ? (
            <EmptyState title="No ranked windows" hint={`No candidate_windows for ${focusTaskId} in the database yet.`} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="muted" style={{ fontSize: 12 }}>Task score <b>{pick(focusTask, 'priority_score', 'priorityScore') ?? '—'}</b></span>
                <Badge value={pick(focusTask, 'risk_level', 'riskLevel')} />
                <span className="muted" style={{ fontSize: 12 }}>{pick(focusTask, 'section', 'location') || ''}</span>
              </div>
              {focusWindows.map((w) => (
                <div key={w.id} className="card" style={{ padding: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b className="mono" style={{ fontSize: 12 }}>{pick(w, 'window_id', 'windowId') || w.id}</b>
                    <Badge value={pick(w, 'recommendation', 'xgb_rank') || `rank ${pick(w, 'xgb_rank', 'xgbRank') || '—'}`} />
                  </div>
                  <dl className="kv" style={{ margin: '8px 0 0' }}>
                    <dt>Ranking score</dt><dd><b>{pick(w, 'xgb_score', 'xgbScore') ?? '—'}</b> (rank {pick(w, 'xgb_rank', 'xgbRank') ?? '—'})</dd>
                    <dt>Window</dt><dd>{fmtDate(pick(w, 'start_time', 'startTime'))} → {fmtDate(pick(w, 'end_time', 'endTime'))} ({fmtDurationMin(pick(w, 'duration_min', 'durationMin'))})</dd>
                    <dt>Section</dt><dd>{pick(w, 'section', 'location') || '—'} · Block {pick(w, 'block_id', 'blockId') || '—'}</dd>
                    <dt>Asset impact</dt><dd>{pick(w, 'expected_asset_impact', 'expectedAssetImpact') ?? '—'}</dd>
                    <dt>Train impact</dt><dd>{pick(w, 'train_conflict_score', 'trainConflictScore', 'train_impact') ?? '—'}</dd>
                    <dt>Weather</dt><dd>{pick(w, 'weather_suitability', 'weatherSuitability') ?? '—'}</dd>
                    <dt>Why recommended</dt><dd>{pick(w, 'reason', 'explanation', 'notes') || 'Reason stored by backend when available.'}</dd>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 14 }}>
        <Card title="Optimized block plans (Module 3 · CP-SAT output)" sub={blocks.unavailable ? 'Data unavailable in database' : 'Final constraint-based schedule from block_plans'}>
          {blocks.loading ? <Loading rows={3} /> : blocks.unavailable ? <Unavailable collection="block_plans" /> : blocks.rows.length === 0 ? (
            <EmptyState title="No optimized plans yet" hint="CP-SAT results will appear here once the backend writes block_plans." />
          ) : (
            <div className="table-wrap" style={{ boxShadow: 'none' }}>
              <table className="tbl">
                <thead><tr><th>Plan</th><th>Section</th><th>Window</th><th>Score</th><th>Status</th></tr></thead>
                <tbody>
                  {blocks.rows.slice(0, 10).map((b) => (
                    <tr key={b.id}>
                      <td className="id">{pick(b, 'plan_id') || b.id}</td>
                      <td>{pick(b, 'section', 'location') || '—'}</td>
                      <td className="muted">{fmtDate(pick(b, 'start_time', 'startTime'))} → {fmtDate(pick(b, 'end_time', 'endTime'))}</td>
                      <td><b>{pick(b, 'optimization_score', 'optimizationScore') ?? '—'}</b></td>
                      <td><Badge value={pick(b, 'status', 'approval_status')} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
