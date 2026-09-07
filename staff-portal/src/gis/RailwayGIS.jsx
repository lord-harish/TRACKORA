import React, { useEffect, useMemo, useState } from "react";
import {
    MapContainer,
    TileLayer,
    GeoJSON,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import HeatmapLayer from "./HeatmapLayer.jsx";

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

const MAP_CENTER = [9.35, 78.0];
const DEFAULT_ZOOM = 8;

/* ═══════════════════════════════════════════
   PRIORITY HELPERS
   ═══════════════════════════════════════════ */

function getPriorityColor(score) {
    const v = Number(score ?? 0);
    if (v >= 81) return "#dc2626";
    if (v >= 61) return "#ea580c";
    if (v >= 31) return "#eab308";
    return "#16a34a";
}

function getPriorityName(score) {
    const v = Number(score ?? 0);
    if (v >= 81) return "Critical";
    if (v >= 61) return "High";
    if (v >= 31) return "Medium";
    return "Normal";
}

function getRiskBadgeStyle(risk) {
    const r = String(risk ?? "").trim().toLowerCase();
    if (["critical", "very_high"].includes(r))
        return { bg: "#fef2f2", fg: "#991b1b", border: "#fecaca" };
    if (["high"].includes(r))
        return { bg: "#fff7ed", fg: "#9a3412", border: "#fed7aa" };
    if (["medium", "moderate"].includes(r))
        return { bg: "#fefce8", fg: "#854d0e", border: "#fef08a" };
    if (["low", "normal"].includes(r))
        return { bg: "#f0fdf4", fg: "#166534", border: "#bbf7d0" };
    return { bg: "#f9fafb", fg: "#374151", border: "#e5e7eb" };
}

/* ═══════════════════════════════════════════
   COORDINATE EXTRACTION
   Handles multiple Firestore document shapes
   ═══════════════════════════════════════════ */

function getTaskCoordinates(task) {
    if (!task) return null;
    let lat = task.latitude ?? task.lat;
    let lng = task.longitude ?? task.lng ?? task.lon;

    if (lat === undefined && task.location && typeof task.location === "object") {
        lat = task.location.latitude ?? task.location.lat;
        lng = task.location.longitude ?? task.location.lng ?? task.location.lon;
    }
    if (lat === undefined && task.geo && typeof task.geo === "object") {
        lat = task.geo.latitude ?? task.geo.lat;
        lng = task.geo.longitude ?? task.geo.lng;
    }
    if (
        lat === undefined &&
        Array.isArray(task.coordinates) &&
        task.coordinates.length >= 2
    ) {
        const [c0, c1] = task.coordinates;
        if (c0 >= 70 && c1 <= 15) {
            lng = c0;
            lat = c1;
        } else {
            lat = c0;
            lng = c1;
        }
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    if (
        Number.isFinite(numLat) &&
        Number.isFinite(numLng) &&
        numLat >= -90 &&
        numLat <= 90 &&
        numLng >= -180 &&
        numLng <= 180
    ) {
        return [numLat, numLng];
    }
    return null;
}

/* ═══════════════════════════════════════════
   COMPLETION STATUS HELPERS
   ═══════════════════════════════════════════ */

function isTaskCompleted(task) {
    if (!task) return false;
    const status = String(task.status || task.task_status || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "_");
    const completionStatus = String(task.completion_status || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "_");
    const completed = task.completed;

    if (
        ["completed", "complete", "done", "closed", "resolved"].includes(status)
    )
        return true;
    if (
        ["completed", "complete", "done", "verified"].includes(completionStatus)
    )
        return true;
    if (completed === true || completed === "true" || completed === 1)
        return true;

    return false;
}

function getCompletionLabel(task) {
    if (!task) return null;
    const cs = task.completion_status;
    if (cs) return String(cs).replace(/_/g, " ");
    if (isTaskCompleted(task)) return "Completed";
    return null;
}

/* ═══════════════════════════════════════════
   MAP UTILITIES
   ═══════════════════════════════════════════ */

function MapAutoResizer() {
    const map = useMap();
    useEffect(() => {
        const invalidate = () => {
            try {
                map.invalidateSize();
            } catch (_) {
                /* ignore during unmount */
            }
        };
        invalidate();
        const t1 = setTimeout(invalidate, 150);
        const t2 = setTimeout(invalidate, 400);
        const t3 = setTimeout(invalidate, 1000);

        const container = map.getContainer();
        let ro = null;
        if (container && typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(invalidate);
            ro.observe(container);
        }
        window.addEventListener("resize", invalidate);

        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
            if (ro) ro.disconnect();
            window.removeEventListener("resize", invalidate);
        };
    }, [map]);
    return null;
}

function ResetMapButton() {
    const map = useMap();
    return (
        <button
            type="button"
            onClick={() => map.setView(MAP_CENTER, DEFAULT_ZOOM)}
            style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                zIndex: 1000,
                background: "var(--surface, #ffffff)",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "8px",
                padding: "6px 14px",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "12px",
                color: "var(--text, #111827)",
                boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
                transition: "all 0.15s ease",
            }}
        >
            ↻ Reset View
        </button>
    );
}

/* ═══════════════════════════════════════════
   STAT PILL
   ═══════════════════════════════════════════ */

function Stat({ label, value, color, active, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 14px",
                borderRadius: "8px",
                border: active
                    ? `1.5px solid ${color}`
                    : "1.5px solid transparent",
                background: active ? `${color}10` : "transparent",
                cursor: onClick ? "pointer" : "default",
                transition: "all 0.15s ease",
            }}
        >
            <span
                style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: color,
                    display: "inline-block",
                    boxShadow: `0 0 6px ${color}40`,
                }}
            />
            <span
                style={{
                    color: "var(--muted, #6b7280)",
                    fontSize: "12px",
                    whiteSpace: "nowrap",
                }}
            >
                {label}
            </span>
            <strong
                style={{
                    color: "var(--text, #111827)",
                    fontSize: "14px",
                    fontWeight: 700,
                }}
            >
                {value}
            </strong>
        </button>
    );
}

/* ═══════════════════════════════════════════
   TOGGLE SWITCH
   ═══════════════════════════════════════════ */

function ToggleGroup({ options, value, onChange }) {
    return (
        <div
            style={{
                display: "inline-flex",
                background: "var(--surface-2, #f1f5f9)",
                borderRadius: "8px",
                padding: "3px",
                gap: "2px",
            }}
        >
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    style={{
                        padding: "5px 14px",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: value === opt.value ? 600 : 400,
                        cursor: "pointer",
                        background:
                            value === opt.value
                                ? "var(--surface, #ffffff)"
                                : "transparent",
                        color:
                            value === opt.value
                                ? "var(--text, #111827)"
                                : "var(--muted, #9ca3af)",
                        boxShadow:
                            value === opt.value
                                ? "0 1px 3px rgba(0,0,0,0.08)"
                                : "none",
                        transition: "all 0.15s ease",
                    }}
                >
                    {opt.icon && (
                        <span style={{ marginRight: "5px" }}>{opt.icon}</span>
                    )}
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

/* ═══════════════════════════════════════════
   LEGEND
   ═══════════════════════════════════════════ */

function LegendItem({ color, label, range }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "5px",
            }}
        >
            <span
                style={{
                    width: "22px",
                    height: "6px",
                    background: color,
                    borderRadius: "4px",
                    display: "inline-block",
                }}
            />
            <span
                style={{
                    color: "var(--text, #111827)",
                    fontWeight: 500,
                    fontSize: "11.5px",
                }}
            >
                {label}
            </span>
            <span
                style={{
                    color: "var(--muted, #6b7280)",
                    marginLeft: "auto",
                    fontSize: "11px",
                }}
            >
                {range}
            </span>
        </div>
    );
}

function HeatGradientBar() {
    return (
        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-soft, #edf0f4)" }}>
            <div
                style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--text, #111827)",
                    marginBottom: "5px",
                }}
            >
                Heatmap Intensity
            </div>
            <div
                style={{
                    height: "8px",
                    borderRadius: "4px",
                    background:
                        "linear-gradient(to right, #16a34a, #a3e635, #eab308, #ea580c, #dc2626)",
                }}
            />
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "10px",
                    color: "var(--muted, #6b7280)",
                    marginTop: "3px",
                }}
            >
                <span>Low</span>
                <span>High</span>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════
   SELECT STYLE
   ═══════════════════════════════════════════ */

const selectStyle = {
    padding: "6px 12px",
    border: "1px solid var(--border, #d1d5db)",
    borderRadius: "7px",
    background: "var(--surface, #ffffff)",
    color: "var(--text, #374151)",
    fontSize: "12.5px",
    outline: "none",
    cursor: "pointer",
    transition: "border-color 0.15s ease",
};

/* ═══════════════════════════════════════════
   MAIN GIS COMPONENT
   ═══════════════════════════════════════════ */

export default function RailwayGIS({
    tasks: propTasks,
    title = "Railway Operational GIS Monitoring",
    subtitle = "Staff Monitoring — Maintenance Tasks & Corridor Geometry across South Tamil Nadu",
}) {
    const [railwayData, setRailwayData] = useState(null);
    const [geoJsonError, setGeoJsonError] = useState(false);

    const [priorityFilter, setPriorityFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [departmentFilter, setDepartmentFilter] = useState("all");
    const [hideCompleted, setHideCompleted] = useState(false);

    const [viewMode, setViewMode] = useState("heatmap"); // "heatmap" | "markers" | "both"
    const [selectedTask, setSelectedTask] = useState(null);

    /* ═══════════════════════════════════════
       1. LOAD RAILWAY GEOJSON
       ═══════════════════════════════════════ */

    useEffect(() => {
        fetch("/data/south-tamil-nadu-railways.geojson")
            .then((response) => {
                if (!response.ok)
                    throw new Error("south-tamil-nadu-railways.geojson not found");
                return response.json();
            })
            .then(setRailwayData)
            .catch((error) => {
                console.warn("Railway GIS GeoJSON load warning:", error);
                setGeoJsonError(true);
            });
    }, []);

    /* ═══════════════════════════════════════
       2. DATA SOURCE
       Uses propTasks from Dashboard's useCollection('maintenance_tasks').
       No duplicate internal listener — the Dashboard already provides
       real-time Firestore data via onSnapshot.
       ═══════════════════════════════════════ */

    const allTasks = useMemo(() => {
        return Array.isArray(propTasks) ? propTasks : [];
    }, [propTasks]);

    /* ═══════════════════════════════════════
       3. EXTRACT DEPARTMENTS & STATUSES
       ═══════════════════════════════════════ */

    const availableDepartments = useMemo(() => {
        const set = new Set();
        allTasks.forEach((t) => {
            const dept = t.department || t.dept;
            if (dept) set.add(String(dept).trim());
        });
        return Array.from(set).sort();
    }, [allTasks]);

    const availableStatuses = useMemo(() => {
        const set = new Set();
        allTasks.forEach((t) => {
            const st = t.status || t.task_status;
            if (st) set.add(String(st).trim());
        });
        return Array.from(set).sort();
    }, [allTasks]);

    /* ═══════════════════════════════════════
       4. FILTER DATA
       ═══════════════════════════════════════ */

    const filteredTasks = useMemo(() => {
        return allTasks.filter((task) => {
            // Completed filter
            if (hideCompleted && isTaskCompleted(task)) return false;

            const score = Number(task.priority_score ?? 0);
            const priority = getPriorityName(score).toLowerCase();
            const status = String(task.status || task.task_status || "")
                .trim()
                .toLowerCase();
            const dept = String(task.department || task.dept || "")
                .trim()
                .toLowerCase();

            const priorityOK =
                priorityFilter === "all" ||
                priority === priorityFilter.toLowerCase();
            const statusOK =
                statusFilter === "all" ||
                status === statusFilter.toLowerCase();
            const deptOK =
                departmentFilter === "all" ||
                dept === departmentFilter.toLowerCase();

            return priorityOK && statusOK && deptOK;
        });
    }, [allTasks, priorityFilter, statusFilter, departmentFilter, hideCompleted]);

    /* ═══════════════════════════════════════
       5. SEPARATE VALID COORDS VS MISSING
       ═══════════════════════════════════════ */

    const { validTasks, missingCoordsCount } = useMemo(() => {
        let missing = 0;
        const valid = [];
        filteredTasks.forEach((task) => {
            const coords = getTaskCoordinates(task);
            if (coords) {
                valid.push({ ...task, _coords: coords });
            } else {
                missing++;
            }
        });
        return { validTasks: valid, missingCoordsCount: missing };
    }, [filteredTasks]);

    /* ═══════════════════════════════════════
       6. HEATMAP POINTS — [lat, lng, intensity]
       ═══════════════════════════════════════ */

    const heatmapPoints = useMemo(() => {
        return validTasks.map((task) => {
            const score = Number(task.priority_score ?? 0);
            // Normalize to 0-1 range for leaflet.heat, with a minimum so even
            // low-priority tasks register on the heatmap
            const intensity = Math.max(score, 10);
            return [task._coords[0], task._coords[1], intensity];
        });
    }, [validTasks]);

    /* ═══════════════════════════════════════
       7. STATISTICS
       ═══════════════════════════════════════ */

    const statistics = useMemo(() => {
        let critical = 0,
            high = 0,
            medium = 0,
            normal = 0,
            completedCount = 0;

        allTasks.forEach((task) => {
            const score = Number(task.priority_score ?? 0);
            if (score >= 81) critical++;
            else if (score >= 61) high++;
            else if (score >= 31) medium++;
            else normal++;

            if (isTaskCompleted(task)) completedCount++;
        });

        return {
            total: allTasks.length,
            critical,
            high,
            medium,
            normal,
            completed: completedCount,
            mapped: validTasks.length,
        };
    }, [allTasks, validTasks]);

    /* ═══════════════════════════════════════
       8. RAILWAY TRACK STYLE
       ═══════════════════════════════════════ */

    function railwayStyle(feature) {
        const score = Number(feature?.properties?.maintenance_score ?? 0);
        return {
            color: score > 0 ? getPriorityColor(score) : "#2563eb",
            weight: 3.5,
            opacity: 0.85,
        };
    }

    /* ═══════════════════════════════════════
       9. RENDER
       ═══════════════════════════════════════ */

    return (
        <div
            className="railway-gis-section"
            style={{
                width: "100%",
                background: "var(--surface, #ffffff)",
                borderRadius: "var(--radius, 14px)",
                border: "1px solid var(--border, #e4e7ec)",
                boxShadow: "var(--shadow, 0 2px 8px rgba(16, 24, 40, 0.07))",
                overflow: "hidden",
                position: "relative",
                isolation: "isolate",
                fontFamily: "var(--font, 'Inter', system-ui, sans-serif)",
                marginTop: "16px",
            }}
        >
            {/* ── HEADER ── */}
            <div
                style={{
                    background: "var(--surface, #ffffff)",
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--border-soft, #edf0f4)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                }}
            >
                <div>
                    <h3
                        style={{
                            margin: 0,
                            color: "var(--text, #111827)",
                            fontSize: "16px",
                            fontWeight: 700,
                            letterSpacing: "-0.2px",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                        }}
                    >
                        <span style={{ fontSize: "18px" }}>🗺️</span>
                        {title}
                    </h3>
                    <p
                        style={{
                            margin: "4px 0 0",
                            color: "var(--muted, #6b7280)",
                            fontSize: "12.5px",
                        }}
                    >
                        {subtitle}
                    </p>
                </div>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        flexWrap: "wrap",
                    }}
                >
                    {missingCoordsCount > 0 && (
                        <span
                            title="These tasks exist in Firestore but lack valid lat/lng coordinates"
                            style={{
                                fontSize: "11.5px",
                                color: "#b54708",
                                background: "#fef0c7",
                                padding: "3px 10px",
                                borderRadius: "6px",
                                fontWeight: 500,
                            }}
                        >
                            ⚠ {missingCoordsCount} task(s) missing coordinates
                        </span>
                    )}

                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            color: "var(--muted, #6b7280)",
                        }}
                    >
                        <span
                            style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: "#16a34a",
                                animation: "pulse 2s infinite",
                            }}
                        />
                        <span>
                            Live · {statistics.mapped} mapped / {allTasks.length} total
                        </span>
                    </div>
                </div>
            </div>

            {/* ── CONTROLS BAR ── */}
            <div
                style={{
                    background: "var(--surface-2, #f8fafc)",
                    padding: "10px 20px",
                    display: "flex",
                    gap: "10px",
                    flexWrap: "wrap",
                    alignItems: "center",
                    borderBottom: "1px solid var(--border-soft, #edf0f4)",
                }}
            >
                {/* View mode toggle */}
                <ToggleGroup
                    options={[
                        { value: "heatmap", label: "Heatmap", icon: "🔥" },
                        { value: "markers", label: "Markers", icon: "📍" },
                        { value: "both", label: "Both", icon: "🔥📍" },
                    ]}
                    value={viewMode}
                    onChange={setViewMode}
                />

                <div
                    style={{
                        width: "1px",
                        height: "24px",
                        background: "var(--border, #d1d5db)",
                    }}
                />

                {/* Filters */}
                <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    style={selectStyle}
                >
                    <option value="all">All Priorities</option>
                    <option value="critical">Critical (81–100)</option>
                    <option value="high">High (61–80)</option>
                    <option value="medium">Medium (31–60)</option>
                    <option value="normal">Normal (0–30)</option>
                </select>

                <select
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                    style={selectStyle}
                >
                    <option value="all">All Departments</option>
                    {availableDepartments.map((dept) => (
                        <option key={dept} value={dept}>
                            {dept}
                        </option>
                    ))}
                    {availableDepartments.length === 0 && (
                        <>
                            <option value="engineering">Engineering</option>
                            <option value="s_and_t">S&T</option>
                            <option value="traction">Traction</option>
                        </>
                    )}
                </select>

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={selectStyle}
                >
                    <option value="all">All Statuses</option>
                    {availableStatuses.map((st) => (
                        <option key={st} value={st}>
                            {st.replace(/_/g, " ")}
                        </option>
                    ))}
                    {availableStatuses.length === 0 && (
                        <>
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="pending">Pending</option>
                            <option value="completed">Completed</option>
                        </>
                    )}
                </select>

                {/* Hide completed toggle */}
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "12px",
                        color: "var(--text, #374151)",
                        cursor: "pointer",
                        marginLeft: "auto",
                        userSelect: "none",
                    }}
                >
                    <input
                        type="checkbox"
                        checked={hideCompleted}
                        onChange={(e) => setHideCompleted(e.target.checked)}
                        style={{ accentColor: "#16a34a", cursor: "pointer" }}
                    />
                    Hide completed
                    {statistics.completed > 0 && (
                        <span
                            style={{
                                fontSize: "11px",
                                color: "var(--muted, #9ca3af)",
                            }}
                        >
                            ({statistics.completed})
                        </span>
                    )}
                </label>
            </div>

            {/* ── STATISTICS ROW ── */}
            <div
                style={{
                    background: "var(--surface, #ffffff)",
                    padding: "8px 16px",
                    display: "flex",
                    gap: "6px",
                    flexWrap: "wrap",
                    borderBottom: "1px solid var(--border-soft, #edf0f4)",
                    alignItems: "center",
                }}
            >
                <Stat
                    label="Total"
                    value={statistics.total}
                    color="#374151"
                    active={priorityFilter === "all"}
                    onClick={() => setPriorityFilter("all")}
                />
                <Stat
                    label="Critical"
                    value={statistics.critical}
                    color="#dc2626"
                    active={priorityFilter === "critical"}
                    onClick={() =>
                        setPriorityFilter(
                            priorityFilter === "critical" ? "all" : "critical"
                        )
                    }
                />
                <Stat
                    label="High"
                    value={statistics.high}
                    color="#ea580c"
                    active={priorityFilter === "high"}
                    onClick={() =>
                        setPriorityFilter(
                            priorityFilter === "high" ? "all" : "high"
                        )
                    }
                />
                <Stat
                    label="Medium"
                    value={statistics.medium}
                    color="#eab308"
                    active={priorityFilter === "medium"}
                    onClick={() =>
                        setPriorityFilter(
                            priorityFilter === "medium" ? "all" : "medium"
                        )
                    }
                />
                <Stat
                    label="Normal"
                    value={statistics.normal}
                    color="#16a34a"
                    active={priorityFilter === "normal"}
                    onClick={() =>
                        setPriorityFilter(
                            priorityFilter === "normal" ? "all" : "normal"
                        )
                    }
                />

                <div
                    style={{
                        marginLeft: "auto",
                        fontSize: "12px",
                        color: "var(--muted, #9ca3af)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                    }}
                >
                    <span
                        style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "2px",
                            background: "#16a34a",
                            display: "inline-block",
                        }}
                    />
                    {statistics.completed} completed
                </div>
            </div>

            {/* ── MAP VIEWPORT ── */}
            <div style={{ position: "relative", height: "560px", width: "100%" }}>
                {/* GeoJSON error overlay */}
                {geoJsonError && (
                    <div
                        style={{
                            position: "absolute",
                            top: "50px",
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 1050,
                            background: "#fef2f2",
                            border: "1px solid #fecaca",
                            borderRadius: "8px",
                            padding: "8px 16px",
                            fontSize: "12.5px",
                            color: "#991b1b",
                            fontWeight: 500,
                            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                    >
                        ⚠ Railway track data unavailable — could not load
                        south-tamil-nadu-railways.geojson
                    </div>
                )}

                <MapContainer
                    center={MAP_CENTER}
                    zoom={DEFAULT_ZOOM}
                    scrollWheelZoom={true}
                    style={{ width: "100%", height: "100%" }}
                >
                    <MapAutoResizer />

                    {/* BASE TILES */}
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* OPENRAILWAYMAP OVERLAY */}
                    <TileLayer
                        attribution='<a href="https://www.openrailwaymap.org">OpenRailwayMap</a>'
                        url="https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
                        opacity={0.8}
                    />

                    {/* SOUTH TAMIL NADU RAILWAY GEOJSON TRACK */}
                    {railwayData && (
                        <GeoJSON
                            key={railwayData.features?.length ?? "rg"}
                            data={railwayData}
                            style={railwayStyle}
                            onEachFeature={(feature, layer) => {
                                layer.on({
                                    click: () => {
                                        const p = feature.properties || {};
                                        const section =
                                            p.section ||
                                            p.name ||
                                            p["@id"] ||
                                            "Tamil Nadu Rail Line";
                                        const score = Number(
                                            p.maintenance_score ?? 0
                                        );
                                        const priority = getPriorityName(score);
                                        const gauge = p.gauge
                                            ? `${p.gauge} mm`
                                            : "Standard/Broad";
                                        const electrified =
                                            p.electrified || "Standard";

                                        const html =
                                            "<div style='font-family:Inter,sans-serif;font-size:12px;line-height:1.5;min-width:180px'>" +
                                            "<strong style='font-size:13px;color:#111827;display:block;margin-bottom:6px'>🛤️ Railway Track Geometry</strong>" +
                                            "<div><b>Section:</b> " +
                                            section +
                                            "</div>" +
                                            "<div><b>Gauge:</b> " +
                                            gauge +
                                            "</div>" +
                                            "<div><b>Electrification:</b> " +
                                            electrified +
                                            "</div>" +
                                            (score > 0
                                                ? "<div><b>Maintenance Score:</b> " +
                                                  score +
                                                  " (" +
                                                  priority +
                                                  ")</div>"
                                                : "") +
                                            "</div>";

                                        layer.bindPopup(html).openPopup();
                                    },
                                });
                            }}
                        />
                    )}

                    {/* ── HEATMAP LAYER ── */}
                    {(viewMode === "heatmap" || viewMode === "both") &&
                        heatmapPoints.length > 0 && (
                            <HeatmapLayer points={heatmapPoints} />
                        )}

                    {/* ── CIRCLE MARKERS ── */}
                    {(viewMode === "markers" || viewMode === "both") &&
                        validTasks.map((task) => {
                            const score = Number(task.priority_score ?? 0);
                            const priority = getPriorityName(score);
                            const color = getPriorityColor(score);
                            const coords = task._coords;
                            const completed = isTaskCompleted(task);
                            const riskLevel =
                                task.risk_level || task.riskLevel || null;
                            const riskStyle = getRiskBadgeStyle(riskLevel);
                            const completionLabel = getCompletionLabel(task);

                            return (
                                <CircleMarker
                                    key={task.id}
                                    center={coords}
                                    radius={
                                        score >= 81
                                            ? 12
                                            : score >= 61
                                              ? 10
                                              : 8
                                    }
                                    pathOptions={{
                                        color: completed ? "#9ca3af" : color,
                                        fillColor: completed
                                            ? "#d1d5db"
                                            : color,
                                        fillOpacity: completed ? 0.35 : 0.8,
                                        weight: completed ? 1.5 : 2.5,
                                        dashArray: completed ? "4 4" : null,
                                    }}
                                    eventHandlers={{
                                        click: () => setSelectedTask(task),
                                    }}
                                >
                                    <Popup>
                                        <div
                                            style={{
                                                minWidth: "230px",
                                                fontFamily:
                                                    "var(--font, 'Inter', sans-serif)",
                                                fontSize: "12.5px",
                                                lineHeight: "1.55",
                                            }}
                                        >
                                            <h4
                                                style={{
                                                    margin: "0 0 8px",
                                                    fontSize: "14px",
                                                    color: "var(--text, #111827)",
                                                    borderBottom:
                                                        "1px solid #e5e7eb",
                                                    paddingBottom: "6px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent:
                                                        "space-between",
                                                }}
                                            >
                                                <span>
                                                    {completed ? "✅" : "🔧"}{" "}
                                                    Maintenance
                                                </span>
                                                {completionLabel && (
                                                    <span
                                                        style={{
                                                            fontSize: "10.5px",
                                                            background:
                                                                "#f0fdf4",
                                                            color: "#166534",
                                                            padding:
                                                                "2px 8px",
                                                            borderRadius:
                                                                "4px",
                                                            fontWeight: 500,
                                                        }}
                                                    >
                                                        {completionLabel}
                                                    </span>
                                                )}
                                            </h4>

                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Task ID:</strong>{" "}
                                                {task.task_id || task.id}
                                            </p>
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Asset:</strong>{" "}
                                                {task.asset_id ||
                                                    "—"}
                                            </p>
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Section:</strong>{" "}
                                                {task.section ||
                                                    "—"}
                                            </p>
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Chainage (KM):</strong>{" "}
                                                {task.km_from ?? "—"} to{" "}
                                                {task.km_to ?? "—"}
                                            </p>
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Priority:</strong>{" "}
                                                <span
                                                    style={{
                                                        color: color,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    {priority} ({score})
                                                </span>
                                            </p>
                                            {riskLevel && (
                                                <p style={{ margin: "3px 0" }}>
                                                    <strong>
                                                        Risk Level:
                                                    </strong>{" "}
                                                    <span
                                                        style={{
                                                            background:
                                                                riskStyle.bg,
                                                            color: riskStyle.fg,
                                                            border: `1px solid ${riskStyle.border}`,
                                                            padding:
                                                                "1px 8px",
                                                            borderRadius:
                                                                "4px",
                                                            fontSize:
                                                                "11.5px",
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {String(riskLevel).replace(/_/g, " ")}
                                                    </span>
                                                </p>
                                            )}
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Status:</strong>{" "}
                                                {task.status ||
                                                    task.task_status ||
                                                    "—"}
                                            </p>
                                            <p style={{ margin: "3px 0" }}>
                                                <strong>Department:</strong>{" "}
                                                {task.department ||
                                                    task.dept ||
                                                    "—"}
                                            </p>
                                        </div>
                                    </Popup>
                                </CircleMarker>
                            );
                        })}

                    <ResetMapButton />
                </MapContainer>

                {/* ── INTERACTIVE LEGEND ── */}
                <div
                    style={{
                        position: "absolute",
                        bottom: "16px",
                        right: "16px",
                        zIndex: 1000,
                        background: "var(--surface, #ffffffee)",
                        backdropFilter: "blur(8px)",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--border, #e5e7eb)",
                        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
                        fontSize: "12px",
                        minWidth: "170px",
                    }}
                >
                    <strong
                        style={{
                            display: "block",
                            marginBottom: "8px",
                            fontSize: "12px",
                            color: "var(--text, #111827)",
                        }}
                    >
                        Priority Scale
                    </strong>
                    <LegendItem
                        color="#dc2626"
                        label="Critical"
                        range="81–100"
                    />
                    <LegendItem
                        color="#ea580c"
                        label="High"
                        range="61–80"
                    />
                    <LegendItem
                        color="#eab308"
                        label="Medium"
                        range="31–60"
                    />
                    <LegendItem
                        color="#16a34a"
                        label="Normal"
                        range="0–30"
                    />

                    {(viewMode === "heatmap" || viewMode === "both") && (
                        <HeatGradientBar />
                    )}

                    {(viewMode === "markers" || viewMode === "both") && (
                        <div
                            style={{
                                marginTop: "8px",
                                paddingTop: "8px",
                                borderTop:
                                    "1px solid var(--border-soft, #edf0f4)",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}
                        >
                            <span
                                style={{
                                    width: "14px",
                                    height: "14px",
                                    borderRadius: "50%",
                                    border: "2px dashed #9ca3af",
                                    display: "inline-block",
                                }}
                            />
                            <span
                                style={{
                                    fontSize: "11px",
                                    color: "var(--muted, #6b7280)",
                                }}
                            >
                                Completed task
                            </span>
                        </div>
                    )}
                </div>

                {/* ── SELECTED TASK DETAIL DRAWER ── */}
                {selectedTask && (
                    <SelectedTaskDrawer
                        task={selectedTask}
                        onClose={() => setSelectedTask(null)}
                    />
                )}
            </div>

            {/* Pulse animation for the live indicator */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.4; }
                }
            `}</style>
        </div>
    );
}

/* ═══════════════════════════════════════════
   SELECTED TASK DETAIL DRAWER
   ═══════════════════════════════════════════ */

function SelectedTaskDrawer({ task, onClose }) {
    const score = Number(task.priority_score ?? 0);
    const priority = getPriorityName(score);
    const color = getPriorityColor(score);
    const riskLevel = task.risk_level || task.riskLevel || null;
    const riskStyle = getRiskBadgeStyle(riskLevel);
    const completed = isTaskCompleted(task);
    const completionLabel = getCompletionLabel(task);

    const rows = [
        { label: "Task ID", value: task.task_id || task.id },
        { label: "Asset", value: task.asset_id || "—" },
        { label: "Section", value: task.section || "—" },
        {
            label: "Chainage",
            value: `${task.km_from ?? "—"} → ${task.km_to ?? "—"} KM`,
        },
        {
            label: "Priority",
            value: (
                <span style={{ color, fontWeight: 700 }}>
                    {priority} ({score})
                </span>
            ),
        },
        riskLevel
            ? {
                  label: "Risk Level",
                  value: (
                      <span
                          style={{
                              background: riskStyle.bg,
                              color: riskStyle.fg,
                              border: `1px solid ${riskStyle.border}`,
                              padding: "2px 10px",
                              borderRadius: "5px",
                              fontSize: "11.5px",
                              fontWeight: 600,
                          }}
                      >
                          {String(riskLevel).replace(/_/g, " ")}
                      </span>
                  ),
              }
            : null,
        {
            label: "Status",
            value: task.status || task.task_status || "—",
        },
        completionLabel
            ? {
                  label: "Completion",
                  value: (
                      <span
                          style={{
                              background: "#f0fdf4",
                              color: "#166534",
                              padding: "2px 10px",
                              borderRadius: "5px",
                              fontSize: "11.5px",
                              fontWeight: 600,
                          }}
                      >
                          ✅ {completionLabel}
                      </span>
                  ),
              }
            : null,
        {
            label: "Department",
            value: task.department || task.dept || "—",
        },
        task.description ? { label: "Notes", value: task.description } : null,
    ].filter(Boolean);

    return (
        <div
            style={{
                position: "absolute",
                top: "14px",
                right: "14px",
                zIndex: 1100,
                width: "310px",
                maxWidth: "calc(100% - 28px)",
                maxHeight: "calc(100% - 28px)",
                overflowY: "auto",
                background: "var(--surface, #ffffffee)",
                backdropFilter: "blur(12px)",
                borderRadius: "12px",
                padding: "16px",
                border: "1px solid var(--border, #e5e7eb)",
                boxShadow: "0 8px 32px rgba(16, 24, 40, 0.18)",
                fontSize: "12.5px",
                lineHeight: "1.5",
            }}
        >
            <button
                type="button"
                onClick={onClose}
                style={{
                    float: "right",
                    border: "none",
                    background: "var(--surface-2, #f1f5f9)",
                    borderRadius: "6px",
                    width: "26px",
                    height: "26px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    cursor: "pointer",
                    color: "var(--muted, #6b7280)",
                    transition: "all 0.15s ease",
                }}
            >
                ✕
            </button>

            <h4
                style={{
                    margin: "0 0 12px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "var(--text, #111827)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                }}
            >
                {completed ? "✅" : "🔧"} Maintenance Task
            </h4>

            <div style={{ display: "grid", gap: "8px" }}>
                {rows.map((row, i) => (
                    <div
                        key={i}
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "baseline",
                            gap: "12px",
                            paddingBottom:
                                i < rows.length - 1 ? "6px" : "0",
                            borderBottom:
                                i < rows.length - 1
                                    ? "1px solid var(--border-soft, #f3f4f6)"
                                    : "none",
                        }}
                    >
                        <span
                            style={{
                                color: "var(--muted, #6b7280)",
                                fontSize: "12px",
                                whiteSpace: "nowrap",
                                fontWeight: 500,
                            }}
                        >
                            {row.label}
                        </span>
                        <span
                            style={{
                                textAlign: "right",
                                fontSize: "12.5px",
                                color: "var(--text, #111827)",
                                wordBreak: "break-word",
                            }}
                        >
                            {row.value}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}