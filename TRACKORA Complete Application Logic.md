# TRACKORA — Complete Application Logic

## 1. Master Application Flow

TRACKORA is a role-based railway maintenance and block-planning system connecting the frontend, backend, Firestore database, machine-learning models, and optimization engine.

```text
USER
 │
 ▼
Firebase Authentication
 │
 ▼
Role Verification
 │
 ├───────────────┬────────────────┐
 ▼               ▼                ▼
ADMIN           STAFF            WORKER
 │               │                │
 └───────────────┼────────────────┘
                 ▼
          React Frontend
                 │
                 ▼
            FastAPI Backend
                 │
        ┌────────┴────────┐
        ▼                 ▼
     Firestore        ML / Solver
        │                 │
        │        ┌────────┼─────────┐
        │        ▼        ▼         ▼
        │   Random Forest XGBRanker CP-SAT
        │        │        │         │
        │        └────────┼─────────┘
        │                 ▼
        │          Optimized Plan
        │                 │
        └─────────────────┘
                 │
                 ▼
          Firestore Update
                 │
                 ▼
          Real-time Dashboard
                 │
                 ▼
              USER
```

The ML and optimization pipeline follows the sequence **Random Forest → XGBRanker → CP-SAT**, where prioritization is followed by candidate-window ranking and then final constraint-based scheduling. 

---

# 2. User Logic

TRACKORA contains three primary user roles:

- **Admin**
- **Staff**
- **Worker**

Each role has a separate login/dashboard experience and different permissions.

---

## 2.1 Admin Logic

The Admin has the highest level of system visibility and approval responsibility.

```text
Admin Login
   ↓
Firebase Authentication
   ↓
Verify Identity
   ↓
Verify role = admin
   ↓
Admin Dashboard
```

### Admin Responsibilities

Admin can:

- View complete system information
- View railway assets
- View maintenance tasks
- View train movements
- View block plans
- Review AI recommendations
- Approve or reject generated block plans
- View reports and analytics
- Manage users where permitted
- View audit logs
- Monitor overall system activity

Admin has the broadest operational visibility in the TRACKORA architecture.

---

## 2.2 Staff Logic

Staff is responsible for maintenance planning and operational coordination.

```text
Staff Login
   ↓
Firebase Authentication
   ↓
Verify Identity
   ↓
Verify role = staff
   ↓
Staff Dashboard
```

### Staff Responsibilities

Staff can:

- Create maintenance requests
- View maintenance tasks
- View asset information
- View AI recommendations
- Generate/review block plans
- Assign work to workers
- Monitor task progress
- View the railway calendar
- View relevant train/block information
- Update operational information according to permissions

The Staff Portal is primarily focused on maintenance coordination and planning.

---

## 2.3 Worker Logic

Worker is focused on executing assigned maintenance activities.

```text
Worker Login
   ↓
Firebase Authentication
   ↓
Verify Identity
   ↓
Verify role = worker
   ↓
Worker Dashboard
```

### Worker Responsibilities

Worker can:

- View assigned maintenance tasks
- View assigned block schedules
- View work location
- View maintenance instructions
- View assigned start/end times
- Start work
- Update task status
- Mark work as completed
- Add relevant remarks/progress information

Worker should not receive unrestricted access to the entire Firestore database.

The Worker Portal should query only the records relevant to the authenticated worker.

---

# 3. Authentication Logic

TRACKORA uses two related concepts:

### Firebase Authentication

Firebase Authentication answers:

> **Who is this user?**

The authentication flow is:

```text
Email + Password
       ↓
Firebase Authentication
       ↓
Successful Login
       ↓
Firebase UID
```

### Firestore `users`

The Firestore `users` collection answers:

> **What role does this user have?**

```text
Firebase UID
     ↓
users/{UID}
     ↓
role
     ↓
admin / staff / worker
```

Therefore, the complete authentication and authorization flow is:

```text
Login
 ↓
Firebase Authentication
 ↓
Authentication Successful?
 ├── NO → Show Login Error
 │
 └── YES
       ↓
    Get Firebase UID
       ↓
    Read users/{UID}
       ↓
    Retrieve role
       ↓
 ┌─────┼─────┐
 ▼     ▼     ▼
Admin Staff Worker
```

The backend should also validate authentication and authorization for protected operations rather than relying only on frontend role checks.

---

# 4. Firestore as the Central Database

Firestore acts as the central operational data store for TRACKORA.

The current database structure contains:

```text
Firestore
│
├── users
├── assets
│
├── maintenance_tasks
├── train_movements
├── goods_forecasts
├── corridor_blocks
├── weather
├── candidate_windows
├── block_plans
├── plan_versions
├── work_assignments
├── status_updates
└── audit_logs
```

The operational seeding structure creates the 11 operational collections while preserving the existing `users` and `assets` data. 

---

# 5. `users` Collection

## Purpose

Stores application user profiles and roles.

```text
users/{userId}
```

Conceptual structure:

```text
users
 └── USER001
      ├── name
      ├── email
      ├── role
      ├── department
      └── status
```

## Database Connection

```text
Firebase Authentication
        ↓
       UID
        ↓
users/{UID}
        ↓
      role
```

## Used By

- Authentication
- Authorization
- Admin Portal
- Staff Portal
- Worker Portal
- Backend

The user role determines which portal and operations the user can access.

---

# 6. `assets` Collection

## Purpose

Stores railway infrastructure and asset information.

Example fields:

```text
asset_id
asset_type
department
section
km_from
km_to
criticality
condition
status
last_inspection
updated_at
```

The existing asset data includes railway assets such as tracks, signals, and OHE equipment. 

## Database Connection

```text
assets
   │
   └────────► maintenance_tasks.asset_id
```

Example:

```text
assets/TRK-1001
       ↑
       │
maintenance_tasks/TASK001
```

## Used By

- Admin Portal
- Staff Portal
- Maintenance system
- Random Forest
- Analytics
- GIS/map components

Asset condition and criticality contribute to maintenance prioritization.

---

# 7. `maintenance_tasks` Collection

This is one of the central operational collections in TRACKORA.

## Purpose

Stores maintenance requirements generated from maintenance sources or created by Staff.

Example fields:

```text
task_id
source_system
department
asset_id
asset_type
section
km_from
km_to
defect_type
severity
criticality
urgency
overdue_days
safety_impact
train_impact
maintenance_duration_min
block_required
status
created_at
updated_at
```

These fields support the prioritization factors used by the maintenance-prioritization model.

## Database Connections

```text
assets
   ↓
maintenance_tasks
```

and:

```text
maintenance_tasks
   ↓
candidate_windows
```

and:

```text
maintenance_tasks
   ↓
work_assignments
```

and:

```text
maintenance_tasks
   ↓
status_updates
```

and:

```text
maintenance_tasks
   ↓
audit_logs
```

## Used By

- Staff
- Admin
- Worker
- Random Forest
- Candidate-window generation
- CP-SAT
- Worker assignment
- Progress tracking
- Audit system

---

# 8. Random Forest Connection

The Random Forest model is responsible for maintenance-task prioritization.

The prioritization logic considers factors such as:

- Asset criticality
- Defect severity
- Urgency
- Overdue duration
- Safety impact
- Train impact
- Availability impact

The project architecture describes Random Forest as the task/request prioritization stage.

## Flow

```text
maintenance_tasks
       +
assets
       ↓
Data Processing
       ↓
Feature Engineering
       ↓
Random Forest
       ↓
Priority Score
       ↓
Risk Level
```

Conceptual output:

```text
TASK001
priority_score = 92
risk_level = critical
```

The output is then used by the scheduling pipeline.

### Deduplication & Pipeline Idempotency Rule

A maintenance task must **never be pushed into the ML pipeline multiple times**:
1. **Input Deduplication**: Multiple occurrences of the same `task_id` in a single run or input payload are deduplicated before feature extraction and inference.
2. **Exclusion of Scheduled / Planned Tasks**:
   - Tasks already scheduled in any active or proposed `block_plans` (`tasks_included` or `task_ids`) are strictly excluded from subsequent ML pipeline runs.
   - Tasks with assigned status (`scheduled`, `assigned`, `in_progress`, `completed`) or with an existing `block_plan_id` / `plan_id` are ineligible for re-scheduling.
3. **Status Transition on Optimization**: Once selected by CP-SAT into an approved or proposed block plan, tasks transition to `status: "scheduled"` and store the referencing `block_plan_id`, ensuring pipeline idempotency.

---

# 9. `train_movements` Collection

## Purpose

Stores train movement and schedule information.

Example fields:

```text
train_id
train_number
train_type
section
direction
entry_time
exit_time
priority
expected_delay_impact
status
updated_at
```

## Database Connection

```text
train_movements
       │
       ├──────────────► candidate_windows
       │
       └──────────────► CP-SAT
```

Train movement information is used to determine whether a maintenance window creates operational conflicts.

---

# 10. `goods_forecasts` Collection

## Purpose

Stores predicted goods-train movement information.

Example fields:

```text
forecast_id
section
forecast_date
start_time
end_time
probability
expected_train_count
confidence
updated_at
```

## Database Connection

```text
goods_forecasts
       ↓
Candidate Window Generation
       ↓
candidate_windows
       ↓
XGBRanker
       ↓
CP-SAT
```

Goods-train probability can influence how suitable a particular maintenance window is.

---

# 11. `corridor_blocks` Collection

## Purpose

Stores available railway corridor/block periods.

Example:

```text
block_id
section
start_time
end_time
duration_min
available
existing_block
max_duration_min
restrictions
updated_at
```

Example conceptual document:

```text
BLK003
section = CBE-SLM
start = 22:00
end = 00:00
duration = 120 minutes
available = true
```

## Database Connection

```text
corridor_blocks
       ↓
Candidate Window Generation
       ↓
candidate_windows
       ↓
XGBRanker
       ↓
CP-SAT
```

This prevents the system from scheduling maintenance outside available block periods.

---

# 12. `weather` Collection

## Purpose

Stores weather conditions relevant to maintenance scheduling.

Example fields:

```text
weather_id
section
forecast_time
rainfall_mm
visibility_km
wind_speed_kmh
condition
maintenance_suitable
updated_at
```

## Database Connection

```text
weather
   ↓
Candidate Window Evaluation
   ↓
candidate_windows
   ↓
XGBRanker
   ↓
CP-SAT
```

Example:

```text
22:00
condition = light_rain
maintenance_suitable = true
```

A weather condition unsuitable for maintenance should influence candidate-window selection.

---

# 13. Candidate Window Generation

Candidate windows connect the maintenance requirements with operational constraints.

The system combines:

```text
maintenance_tasks
       +
train_movements
       +
goods_forecasts
       +
corridor_blocks
       +
weather
```

to generate possible maintenance windows.

```text
Maintenance Task
       ↓
Find Available Blocks
       ↓
Check Train Movements
       ↓
Check Goods Forecast
       ↓
Check Weather
       ↓
Generate Candidate Windows
```

---

# 14. `candidate_windows` Collection

## Purpose

Stores possible maintenance windows before final optimization.

Example fields:

```text
window_id
task_id
section
block_id
start_time
end_time
duration_min
train_conflict_score
goods_train_probability
corridor_availability
weather_suitability
compatible_task_count
xgb_score
xgb_rank
status
generated_at
```

Example:

```text
candidate_windows/CW001

task_id = TASK001
block_id = BLK003

start = 22:00
end = 00:00

train_conflict_score = 0.10
goods_train_probability = 0.65
corridor_availability = 1.0
weather_suitability = 0.90
compatible_task_count = 3
```

## Database Connections

```text
maintenance_tasks
       ↓
candidate_windows
       ↑
       │
train_movements
goods_forecasts
corridor_blocks
weather
```

This is the bridge between task prioritization and schedule optimization.

---

# 15. XGBRanker Connection

XGBRanker is responsible for ranking candidate maintenance windows.

It does **not** directly produce the final schedule.

Instead:

```text
Candidate Window A → Rank 1
Candidate Window B → Rank 2
Candidate Window C → Rank 3
```

## Flow

```text
candidate_windows
       ↓
Feature Preparation
       ↓
XGBRanker
       ↓
xgb_score
       ↓
xgb_rank
       ↓
Ranked Candidate Windows
```

The ranked candidates are passed to CP-SAT for final scheduling.

---

# 16. XGBRanker → CP-SAT Connection

The complete relationship is:

```text
Random Forest
      ↓
Prioritized Maintenance Tasks
      ↓
Candidate Window Generation
      ↓
XGBRanker
      ↓
Ranked Candidate Windows
      ↓
CP-SAT
      ↓
Final Feasible Block Plan
```

XGBRanker determines which candidate windows are more promising.

CP-SAT determines which combination of those candidates can actually be scheduled while respecting hard constraints.

---

# 17. CP-SAT Connection

CP-SAT is responsible for final schedule optimization.

## Inputs

CP-SAT receives information from:

```text
maintenance_tasks
candidate_windows
train_movements
goods_forecasts
corridor_blocks
weather
```

along with scheduling/resource constraints.

## Conceptual Flow

```text
Maintenance Requirements
        +
Ranked Candidate Windows
        +
Operational Constraints
        ↓
      CP-SAT
        ↓
Feasible / Optimized Schedule
```

## Important Constraints

The solver should ensure conditions such as:

```text
NO TRAIN CONFLICT
NO UNSAFE OVERLAP
DURATION MUST FIT
CORRIDOR MUST BE AVAILABLE
WEATHER MUST BE ACCEPTABLE
RESOURCE MUST BE AVAILABLE
```

The project architecture defines CP-SAT as the constraint-based optimization stage following candidate-window ranking. 

---

# 18. `block_plans` Collection

## Purpose

Stores the final schedule produced by the optimization engine.

Example fields:

```text
plan_id
section
block_start
block_end
duration_min
task_ids
window_ids
optimization_status
asset_availability_gain
block_utilization
train_impact
objective_score
status
created_at
updated_at
```

Example:

```text
PLAN001

section = CBE-SLM
block_start = 22:00
block_end = 00:00
duration_min = 120

task_ids:
    TASK001
    TASK002

window_ids:
    CW001
    CW003

optimization_status = feasible
block_utilization = 0.92
asset_availability_gain = 0.18
objective_score = 0.91

status = pending_approval
```

## Database Connection

```text
CP-SAT
   ↓
block_plans
   ↓
Admin / Staff
```

This is the primary collection representing generated maintenance schedules.

---

# 19. Admin Approval Flow

A generated block plan should move through an approval lifecycle.

```text
CP-SAT
   ↓
block_plans
   ↓
pending_approval
   ↓
Admin Review
   │
   ├── Approve
   │
   └── Reject
```

### Approved

```text
pending_approval
       ↓
approved
       ↓
Work Assignment
```

### Rejected

```text
pending_approval
       ↓
rejected
       ↓
Replanning / Revision
```

Approval actions should also create audit records.

---

# 20. `plan_versions` Collection

## Purpose

Maintains historical versions of block plans.

Example:

```text
PLAN001
 │
 ├── VERSION001
 └── VERSION002
```

Example document:

```text
version_id
plan_id
version
created_by
reason
schedule_snapshot
created_at
```

## Database Connection

```text
block_plans
      ↓
plan_versions
```

Whenever a plan is changed significantly, a new version should be recorded rather than destroying the previous plan state.

This provides:

- Version history
- Change tracking
- Operational traceability
- Rollback capability

---

# 21. `work_assignments` Collection

## Purpose

Connects an approved maintenance plan/task to a worker.

Example:

```text
assignment_id
plan_id
task_id
employee_id
worker_id
department
location
assigned_start
assigned_end
instructions
status
assigned_at
```

## Database Connection

```text
block_plans
     ↓
work_assignments
     ↓
employee_id (e.g. EMP003, EMP004)
```

Example:

```text
PLAN001
   ↓
ASSIGN001
   ↓
TASK001
   ↓
EMP003 (or EMP004)
```

This is the primary connection between Staff planning and Worker execution.

---

# 22. Worker Data Query Logic

A Worker should not load every assignment from Firestore.

The backend/client identifies the authenticated worker profile:

```text
Firebase Authentication
       ↓
currentUser profile
       ↓
employee_id: EMP003 (or EMP004)
```

Then retrieve assignments associated with that worker:

```text
work_assignments
WHERE employee_id == EMP003
```

The Worker Portal can then retrieve the related task and plan:

```text
work_assignments
       │
       ├── task_id ──► maintenance_tasks
       │
       └── plan_id ──► block_plans
```

Therefore:

```text
EMP003 / EMP004
   ↓
work_assignments
   ↓
Assigned Tasks
   ↓
maintenance_tasks
   +
block_plans
```

---

# 23. `status_updates` Collection

## Purpose

Stores operational progress updates generated during maintenance execution.

Example fields:

```text
update_id
task_id
assignment_id
employee_id
worker_id
status
remarks
timestamp
```

Typical lifecycle:

```text
Assigned
   ↓
In Progress
   ↓
Completed
```

## Database Connection

```text
Worker Portal
      ↓
status update
      ↓
FastAPI
      ↓
Firestore
      ↓
status_updates
```

The existing project data demonstrates task status progression through worker updates. 

---

# 24. Status Update → Maintenance Task

When a Worker updates a task status, the latest task state should also be reflected in the corresponding maintenance task.

Conceptually:

```text
Worker
  ↓
status_updates
  ↓
maintenance_tasks.status
```

For example:

```text
Before:

TASK001
status = assigned
```

Worker starts the work:

```text
status_updates
   ↓
status = in_progress
```

The corresponding task becomes:

```text
maintenance_tasks/TASK001
   ↓
status = in_progress
```

When work is completed:

```text
status_updates
   ↓
status = completed
```

and:

```text
maintenance_tasks/TASK001
   ↓
status = completed
```

This keeps the operational state synchronized across portals.

---

# 25. `audit_logs` Collection

## Purpose

Stores important system actions for traceability.

Example fields:

```text
log_id
user_id
action
entity_type
entity_id
old_status
new_status
details
timestamp
```

Typical events include:

```text
CREATE_TASK
GENERATE_PLAN
APPROVE_BLOCK
ASSIGN_WORK
UPDATE_STATUS
COMPLETE_TASK
```

## Database Connection

```text
User / Backend Action
        ↓
audit_logs
```

Examples:

```text
Staff creates task
       ↓
CREATE_TASK
```

```text
System generates plan
       ↓
GENERATE_PLAN
```

```text
Admin approves plan
       ↓
APPROVE_BLOCK
```

```text
Staff assigns worker
       ↓
ASSIGN_WORK
```

```text
Worker changes task status
       ↓
UPDATE_STATUS
```

The seeded project data follows this type of audit lifecycle. 

---

# 26. Complete Firestore Relationship

The complete logical relationship between the collections is:

```text
                         FIRESTORE
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
       ▼                     ▼                     ▼
     users                 assets            Operational Data
       │                     │                     │
       │                     │             ┌───────┼────────┐
       │                     │             ▼       ▼        ▼
       │                     └────────► maintenance  trains   weather
       │                              tasks         │        │
       │                                │           │        │
       │                                └─────┬─────┘        │
       │                                      ▼              │
       │                               candidate_windows ◄───┘
       │                                      │
       │                                      ▼
       │                                  XGBRanker
       │                                      │
       │                                      ▼
       │                                   CP-SAT
       │                                      ▲
       │                                      │
       │                         corridor_blocks
       │                         goods_forecasts
       │                         train_movements
       │                         weather
       │
       ▼
   ROLE CHECK
       │
 ┌─────┼─────┐
 ▼     ▼     ▼
ADMIN STAFF WORKER
       │
       │
       ▼
   block_plans
       │
       ▼
  plan_versions
       │
       ▼
work_assignments
       │
       ▼
 status_updates
       │
       ▼
 maintenance_tasks
       │
       ▼
   audit_logs
```

---

# 27. Portal → Firestore Connections

## Admin Portal

### Reads

```text
users
assets
maintenance_tasks
train_movements
goods_forecasts
corridor_blocks
weather
candidate_windows
block_plans
plan_versions
work_assignments
status_updates
audit_logs
```

### Writes

Depending on permissions:

```text
users
block_plans
plan_versions
audit_logs
```

and other authorized operational records.

Admin provides the broadest system visibility and plan-approval functionality.

---

# 28. Staff Portal

### Reads

```text
assets
maintenance_tasks
candidate_windows
block_plans
work_assignments
status_updates
train_movements
corridor_blocks
weather
```

### Writes

Depending on permissions:

```text
maintenance_tasks
work_assignments
status_updates
audit_logs
```

### Main Staff Workflow

```text
Raise Maintenance Request
          ↓
maintenance_tasks
          ↓
AI Prioritization
          ↓
candidate_windows
          ↓
XGBRanker
          ↓
block_plans
          ↓
Assign Worker
          ↓
work_assignments
```

---

# 29. Worker Portal

### Reads

```text
users
work_assignments
block_plans
maintenance_tasks
status_updates
```

### Writes

Primarily:

```text
status_updates
```

and authorized task-related updates.

### Main Worker Workflow

```text
Worker Login
      ↓
Authentication
      ↓
Role Verification
      ↓
Get Worker UID
      ↓
work_assignments
      ↓
Assigned Tasks
      ↓
maintenance_tasks
      +
block_plans
      ↓
Execute Work
      ↓
status_updates
```

---

# 30. Dashboard Real-Time Logic

The dashboards should use live database information rather than hardcoded frontend values.

The basic flow is:

```text
Firestore
   ↓
FastAPI / Firestore Listener
   ↓
React State
   ↓
Dashboard UI
```

For example, when a Worker changes:

```text
TASK001
assigned → in_progress
```

the new state should propagate through the application.

```text
Worker Portal
      ↓
status_updates
      ↓
Firestore
      ↓
Backend / Listener
      ↓
React State
      ↓
Admin Dashboard
      +
Staff Dashboard
      +
Worker Dashboard
```

This creates the real-time operational behavior expected from TRACKORA.

---

# 31. AI Feedback Loop

TRACKORA can use completed operational data as feedback for future prioritization and model improvement.

The logical loop is:

```text
Worker
   ↓
status_updates
   ↓
maintenance_tasks
   ↓
Task Completed
   ↓
Asset / Operational State
   ↓
Historical Data
   ↓
AI Feedback
   ↓
Future Prioritization
```

The architecture includes a status/completion feedback path toward the AI prioritization stage.

---

# 32. Complete End-to-End System Logic

The complete application can be represented as:

```text
                    ┌─────────────────┐
                    │      USER       │
                    └────────┬────────┘
                             │
                             ▼
                  Firebase Authentication
                             │
                             ▼
                      Role Verification
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
            ADMIN          STAFF          WORKER
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                       React Frontend
                             │
                             ▼
                        FastAPI API
                             │
                             ▼
                         Firestore
                             │
              ┌──────────────┼───────────────┐
              │              │               │
              ▼              ▼               ▼
           Assets        Maintenance      Operations
                             Tasks
                              │
                              ▼
                     Feature Engineering
                              │
                              ▼
                       Random Forest
                              │
                              ▼
                     Priority / Risk Score
                              │
                              ▼
                  Candidate Window Generation
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
          Train Data      Goods Forecast      Weather
              │               │                │
              └───────────────┼────────────────┘
                              ▼
                     Corridor Availability
                              │
                              ▼
                    Candidate Windows
                              │
                              ▼
                         XGBRanker
                              │
                              ▼
                    Ranked Window Candidates
                              │
                              ▼
                           CP-SAT
                              │
                              ▼
                    Optimized Block Plan
                              │
                              ▼
                       block_plans
                              │
                              ▼
                      Admin Approval
                         │          │
                    APPROVE       REJECT
                         │          │
                         ▼          ▼
                  Work Assignment Replanning
                         │
                         ▼
                  work_assignments
                         │
                         ▼
                       WORKER
                         │
                         ▼
                   status_updates
                         │
                         ▼
                 maintenance_tasks
                         │
                         ▼
                    audit_logs
                         │
                         ▼
                 Real-Time Dashboards
                         │
                         ▼
                    AI Feedback Loop
```

---

# 33. Firestore Collection Dependency Map

```text
users
 │
 └── Authentication / Role
        │
        ├── Admin
        ├── Staff
        └── Worker


assets
 │
 └── asset_id
       │
       ▼
maintenance_tasks
 │
 ├── task_id
 │
 ├── asset_id
 │
 └── section
       │
       ▼
candidate_windows
 │
 ├── task_id
 └── block_id
       │
       ▼
block_plans
 │
 ├── task_ids
 └── window_ids
       │
       ▼
plan_versions
 │
 └── plan_id
       │
       ▼
work_assignments
 │
 ├── plan_id
 ├── task_id
 └── employee_id (e.g. EMP003, EMP004)
       │
       ▼
status_updates
 │
 ├── task_id
 ├── assignment_id
 └── employee_id
       │
       ▼
maintenance_tasks.status


train_movements
       │
       ▼
candidate_windows

goods_forecasts
       │
       ▼
candidate_windows

corridor_blocks
       │
       ▼
candidate_windows

weather
       │
       ▼
candidate_windows


All important actions
       │
       ▼
audit_logs
```

---

# 34. Collection Responsibility Summary

| Collection | Main Purpose | Main Connections |
|---|---|---|
| `users` | User identity, role and profile | Firebase Auth → portals |
| `assets` | Railway infrastructure | `maintenance_tasks.asset_id` |
| `maintenance_tasks` | Maintenance requirements | Assets → AI → assignments → status |
| `train_movements` | Train schedules/movements | Candidate windows → CP-SAT |
| `goods_forecasts` | Goods movement predictions | Candidate windows → CP-SAT |
| `corridor_blocks` | Available block periods | Candidate windows → CP-SAT |
| `weather` | Weather conditions | Candidate windows → ranking/optimization |
| `candidate_windows` | Possible maintenance windows | Tasks + operations → XGBRanker |
| `block_plans` | Final optimized plans | CP-SAT → approval → assignments |
| `plan_versions` | Plan history | `block_plans.plan_id` |
| `work_assignments` | Worker/task assignment | Plans + tasks + workers |
| `status_updates` | Work progress | Worker → task status |
| `audit_logs` | System traceability | User/system actions |

---

# 35. Core Data Flow

The most important logical relationship in TRACKORA is:

```text
TASK
 ↓
ASSET
 ↓
PRIORITIZATION
 ↓
CANDIDATE WINDOWS
 ↓
RANKING
 ↓
OPTIMIZATION
 ↓
BLOCK PLAN
 ↓
APPROVAL
 ↓
WORK ASSIGNMENT
 ↓
WORKER EXECUTION
 ↓
STATUS UPDATE
 ↓
TASK COMPLETION
 ↓
AUDIT LOG
 ↓
AI FEEDBACK
```

In database terms:

```text
maintenance_tasks
        ↓
candidate_windows
        ↓
block_plans
        ↓
plan_versions
        ↓
work_assignments
        ↓
status_updates
        ↓
audit_logs
```

while operational inputs feed the scheduling engine:

```text
train_movements ──┐
goods_forecasts ──┤
corridor_blocks ──┼──► candidate_windows ──► XGBRanker ──► CP-SAT
weather ──────────┤
maintenance_tasks ┘
```

---

# 36. TRACKORA in One Sentence

> **User creates or executes maintenance work → Firestore stores the operational data → FastAPI processes it → Random Forest prioritizes maintenance tasks → candidate windows are generated using train, goods, corridor and weather data → XGBRanker ranks the windows → CP-SAT produces the feasible optimized block plan → Admin approves it → Staff assigns workers → Worker executes the task → status updates return to Firestore → dashboards update in real time → completed work contributes to the AI feedback loop.**