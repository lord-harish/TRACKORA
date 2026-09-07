import React, { useEffect, useMemo, useState } from "react";
import {
    MapContainer,
    TileLayer,
    GeoJSON,
    CircleMarker,
    Popup,
    useMap,
} from "react-leaflet";
import { collection, onSnapshot } from "firebase/firestore";
import "leaflet/dist/leaflet.css";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { taskBelongsTo } from "../services/workerScope";

const MAP_CENTER = [9.35, 78.0];
const DEFAULT_ZOOM = 8;

/* =========================
   PRIORITY MAPPINGS
   Critical = red (#dc2626)
   High = orange (#ea580c)
   Medium = yellow (#eab308)
   Normal = green (#16a34a)
========================= */

function getPriorityColor(score) {
    const value = Number(score ?? 0);
    if (value >= 81) return "#dc2626";
    if (value >= 61) return "#ea580c";
    if (value >= 31) return "#eab308";
    return "#16a34a";
}

function getPriorityName(score) {
    const value = Number(score ?? 0);
    if (value >= 81) return "Critical";
    if (value >= 61) return "High";
    if (value >= 31) return "Medium";
    return "Normal";
}

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
    if (lat === undefined && Array.isArray(task.coordinates) && task.coordinates.length >= 2) {
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

/* =========================
   MAP AUTO RESIZER
   Fixes Leaflet container size issues
========================= */

function MapAutoResizer() {
    const map = useMap();
    useEffect(() => {
        const invalidate = () => {
            try {
                map.invalidateSize();
            } catch (err) {
                // Ignore during unmount
            }
        };

        invalidate();
        const t1 = setTimeout(invalidate, 150);
        const t2 = setTimeout(invalidate, 400);
        const t3 = setTimeout(invalidate, 1000);

        const container = map.getContainer();
        let ro = null;
        if (container && typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(() => {
                invalidate();
            });
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

/* =========================
   RESET MAP BUTTON
========================= */

function ResetMapButton() {
    const map = useMap();

    function resetMap() {
        map.setView(MAP_CENTER, DEFAULT_ZOOM);
    }

    return (
        <button
            type="button"
            onClick={resetMap}
            style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                zIndex: 1000,
                background: "var(--surface, #ffffff)",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "8px",
                padding: "6px 12px",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "12px",
                color: "var(--text, #111827)",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
            }}
        >
            Reset View
        </button>
    );
}

/* =========================
   STAT
========================= */

function Stat({ label, value, color }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
            <span
                style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: color,
                    display: "inline-block",
                }}
            />
            <span style={{ color: "var(--muted, #6b7280)", fontSize: "12.5px" }}>
                {label}
            </span>
            <strong style={{ color: "var(--text, #111827)", fontSize: "13px" }}>
                {value}
            </strong>
        </div>
    );
}

/* =========================
   LEGEND
========================= */

function LegendItem({ color, label, range }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "6px",
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
            <span style={{ color: "var(--text, #111827)", fontWeight: 500 }}>
                {label}
            </span>
            <span style={{ color: "var(--muted, #6b7280)", marginLeft: "auto" }}>
                {range}
            </span>
        </div>
    );
}

/* =========================
   MAIN GIS COMPONENT (Worker Scoped)
========================= */

export default function RailwayGIS({
    tasks: propTasks,
    title = "My Assigned Railway Maintenance GIS",
    subtitle = "Live Map of Maintenance Tasks Assigned to You",
    role = "worker",
}) {
    const { user, profile } = useAuth() || {};
    const [railwayData, setRailwayData] = useState(null);
    const [firestoreTasks, setFirestoreTasks] = useState([]);
    const [geoJsonError, setGeoJsonError] = useState(false);

    const [priorityFilter, setPriorityFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");

    const [selectedTask, setSelectedTask] = useState(null);

    /* =========================
       1. LOAD RAILWAY GEOJSON
    ========================= */

    useEffect(() => {
        fetch("/data/south-tamil-nadu-railways.geojson")
            .then((response) => {
                if (!response.ok) {
                    throw new Error("south-tamil-nadu-railways.geojson not found");
                }
                return response.json();
            })
            .then((data) => {
                setRailwayData(data);
            })
            .catch((error) => {
                console.warn("Railway GIS GeoJSON load warning:", error);
                setGeoJsonError(true);
            });
    }, []);

    /* =========================
       2. LOAD FIRESTORE DATA (If not passed via props)
    ========================= */

    useEffect(() => {
        if (Array.isArray(propTasks)) {
            return;
        }

        if (!db) {
            console.warn("Firestore db instance is unavailable.");
            return;
        }

        try {
            const unsubscribe = onSnapshot(
                collection(db, "maintenance_tasks"),
                (snapshot) => {
                    const tasks = snapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    setFirestoreTasks(tasks);
                },
                (error) => {
                    console.error("Firestore Railway GIS error:", error);
                }
            );

            return () => unsubscribe();
        } catch (err) {
            console.error("Could not subscribe to maintenance_tasks:", err);
        }
    }, [propTasks]);

    // Respect worker scope if tasks are loaded directly from Firestore
    const workerTasks = useMemo(() => {
        if (Array.isArray(propTasks)) {
            return propTasks;
        }
        if (!user && !profile) {
            return firestoreTasks;
        }
        return firestoreTasks.filter((t) => taskBelongsTo(t, user, profile));
    }, [propTasks, firestoreTasks, user, profile]);

    /* =========================
       3. FILTER DATA
    ========================= */

    const availableStatuses = useMemo(() => {
        const set = new Set();
        workerTasks.forEach((t) => {
            const st = t.status || t.task_status;
            if (st) set.add(String(st).trim());
        });
        return Array.from(set).sort();
    }, [workerTasks]);

    const filteredTasks = useMemo(() => {
        return workerTasks.filter((task) => {
            const score = Number(task.priority_score ?? task.score ?? 0);
            const priority = getPriorityName(score).toLowerCase();
            const status = String(task.status || task.task_status || "").trim().toLowerCase();

            const priorityOK =
                priorityFilter === "all" || priority === priorityFilter.toLowerCase();
            const statusOK =
                statusFilter === "all" || status === statusFilter.toLowerCase();

            return priorityOK && statusOK;
        });
    }, [workerTasks, priorityFilter, statusFilter]);

    /* =========================
       4. SEPARATE VALID COORDS VS MISSING
    ========================= */

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

    /* =========================
       5. STATISTICS
    ========================= */

    const statistics = useMemo(() => {
        let critical = 0;
        let high = 0;
        let medium = 0;
        let normal = 0;

        workerTasks.forEach((task) => {
            const score = Number(task.priority_score ?? task.score ?? 0);
            if (score >= 81) critical++;
            else if (score >= 61) high++;
            else if (score >= 31) medium++;
            else normal++;
        });

        return {
            total: workerTasks.length,
            critical,
            high,
            medium,
            normal,
        };
    }, [workerTasks]);

    /* =========================
       6. RAILWAY TRACK STYLE
    ========================= */

    function railwayStyle(feature) {
        const score = Number(
            feature?.properties?.maintenance_score ?? 0
        );

        return {
            color: score > 0 ? getPriorityColor(score) : "#2563eb",
            weight: 3.5,
            opacity: 0.85,
        };
    }

    /* =========================
       7. RENDER
    ========================= */

    return (
        <div
            className="railway-gis-section"
            style={{
                width: "100%",
                background: "var(--surface, #ffffff)",
                borderRadius: "var(--radius, 14px)",
                border: "1px solid var(--border, #e4e7ec)",
                boxShadow: "var(--shadow, 0 1px 3px rgba(16, 24, 40, 0.07))",
                overflow: "hidden",
                position: "relative",
                isolation: "isolate",
                fontFamily: "var(--font, 'Inter', system-ui, sans-serif)",
                marginTop: "16px",
            }}
        >
            {/* HEADER */}
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
                        }}
                    >
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
                            title="These maintenance tasks exist in Firestore for you but lack numeric latitude/longitude coordinates"
                            style={{
                                fontSize: "11.5px",
                                color: "#b54708",
                                background: "#fef0c7",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontWeight: 500,
                            }}
                        >
                            {missingCoordsCount} task(s) missing coordinates in database
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
                            }}
                        />
                        <span>Worker Scoped Data ({workerTasks.length} tasks)</span>
                    </div>
                </div>
            </div>

            {/* FILTERS BAR */}
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
            </div>

            {/* STATISTICS ROW */}
            <div
                style={{
                    background: "var(--surface, #ffffff)",
                    padding: "10px 20px",
                    display: "flex",
                    gap: "20px",
                    flexWrap: "wrap",
                    borderBottom: "1px solid var(--border-soft, #edf0f4)",
                }}
            >
                <Stat label="My Assigned Tasks" value={statistics.total} color="#374151" />
                <Stat label="Critical" value={statistics.critical} color="#dc2626" />
                <Stat label="High" value={statistics.high} color="#ea580c" />
                <Stat label="Medium" value={statistics.medium} color="#eab308" />
                <Stat label="Normal" value={statistics.normal} color="#16a34a" />
            </div>

            {/* MAP VIEWPORT */}
            <div
                style={{
                    position: "relative",
                    height: "520px",
                    width: "100%",
                }}
            >
                <MapContainer
                    center={MAP_CENTER}
                    zoom={DEFAULT_ZOOM}
                    scrollWheelZoom={true}
                    style={{
                        width: "100%",
                        height: "100%",
                    }}
                >
                    <MapAutoResizer />

                    {/* BASE OPENSTREETMAP */}
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    {/* OPENRAILWAYMAP TILES */}
                    <TileLayer
                        attribution='<a href="https://www.openrailwaymap.org">OpenRailwayMap</a>'
                        url="https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"
                        opacity={0.8}
                    />

                    {/* SOUTH TAMIL NADU RAILWAY GEOJSON TRACK GEOMETRY */}
                    {railwayData && (
                        <GeoJSON
                            data={railwayData}
                            style={railwayStyle}
                            onEachFeature={(feature, layer) => {
                                layer.on({
                                    click: () => {
                                        const p = feature.properties || {};
                                        const section = p.section || p.name || p["@id"] || "Tamil Nadu Rail Line";
                                        const score = Number(p.maintenance_score ?? 0);
                                        const priority = getPriorityName(score);
                                        const gauge = p.gauge ? `${p.gauge} mm` : "Standard/Broad";
                                        const electrified = p.electrified || "Standard";

                                        const popupHtml =
                                            "<div style='font-family: Inter, sans-serif; font-size: 12px; line-height: 1.5; min-width: 170px;'>" +
                                            "<strong style='font-size: 13px; color: #111827; display: block; margin-bottom: 6px;'>Railway Track Geometry</strong>" +
                                            "<div><b>Section:</b> " + section + "</div>" +
                                            "<div><b>Gauge:</b> " + gauge + "</div>" +
                                            "<div><b>Electrification:</b> " + electrified + "</div>" +
                                            (score > 0 ? "<div><b>Maintenance Score:</b> " + score + " (" + priority + ")</div>" : "") +
                                            "</div>";

                                        layer.bindPopup(popupHtml).openPopup();
                                    },
                                });
                            }}
                        />
                    )}

                    {/* WORKER'S MAINTENANCE LOCATIONS FROM FIRESTORE */}
                    {validTasks.map((task) => {
                        const score = Number(task.priority_score ?? task.score ?? 0);
                        const priority = getPriorityName(score);
                        const color = getPriorityColor(score);
                        const coords = task._coords;

                        return (
                            <CircleMarker
                                key={task.id}
                                center={coords}
                                radius={score >= 81 ? 12 : score >= 61 ? 10 : 8}
                                pathOptions={{
                                    color: color,
                                    fillColor: color,
                                    fillOpacity: 0.8,
                                    weight: 2.5,
                                }}
                                eventHandlers={{
                                    click: () => {
                                        setSelectedTask(task);
                                    },
                                }}
                            >
                                <Popup>
                                    <div
                                        style={{
                                            minWidth: "210px",
                                            fontFamily: "var(--font, 'Inter', sans-serif)",
                                            fontSize: "12.5px",
                                            lineHeight: "1.5",
                                        }}
                                    >
                                        <h4
                                            style={{
                                                margin: "0 0 8px",
                                                fontSize: "14px",
                                                color: "var(--text, #111827)",
                                                borderBottom: "1px solid #e5e7eb",
                                                paddingBottom: "4px",
                                            }}
                                        >
                                            My Assigned Task
                                        </h4>

                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Task ID:</strong> {task.task_id || task.id}
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Asset:</strong> {task.asset_id || "Field missing in Firestore"}
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Section:</strong> {task.section || "Field missing in Firestore"}
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Chainage (KM):</strong>{" "}
                                            {task.km_from ?? "—"} to {task.km_to ?? "—"}
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Priority:</strong>{" "}
                                            <span style={{ color: color, fontWeight: 700 }}>
                                                {priority} ({score})
                                            </span>
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Status:</strong> {task.status || "Field missing in Firestore"}
                                        </p>
                                        <p style={{ margin: "3px 0" }}>
                                            <strong>Department:</strong> {task.department || "Field missing in Firestore"}
                                        </p>
                                    </div>
                                </Popup>
                            </CircleMarker>
                        );
                    })}

                    <ResetMapButton />
                </MapContainer>

                {/* INTERACTIVE LEGEND */}
                <div
                    style={{
                        position: "absolute",
                        bottom: "16px",
                        right: "16px",
                        zIndex: 1000,
                        background: "var(--surface, #ffffff)",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--border, #e5e7eb)",
                        boxShadow: "0 3px 12px rgba(0, 0, 0, 0.12)",
                        fontSize: "12px",
                        minWidth: "165px",
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
                        Maintenance Priority
                    </strong>

                    <LegendItem color="#dc2626" label="Critical" range="81–100" />
                    <LegendItem color="#ea580c" label="High" range="61–80" />
                    <LegendItem color="#eab308" label="Medium" range="31–60" />
                    <LegendItem color="#16a34a" label="Normal" range="0–30" />
                </div>

                {/* SELECTED TASK DETAILS DRAWER */}
                {selectedTask && (
                    <div
                        style={{
                            position: "absolute",
                            top: "14px",
                            right: "14px",
                            zIndex: 1100,
                            width: "300px",
                            maxWidth: "calc(100% - 28px)",
                            maxHeight: "calc(100% - 28px)",
                            overflowY: "auto",
                            background: "var(--surface, #ffffff)",
                            borderRadius: "12px",
                            padding: "16px",
                            border: "1px solid var(--border, #e5e7eb)",
                            boxShadow: "0 8px 24px rgba(16, 24, 40, 0.15)",
                            fontSize: "12.5px",
                            lineHeight: "1.5",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setSelectedTask(null)}
                            style={{
                                float: "right",
                                border: "none",
                                background: "transparent",
                                fontSize: "18px",
                                cursor: "pointer",
                                color: "var(--muted, #6b7280)",
                                padding: "0 4px",
                                lineHeight: "1",
                            }}
                        >
                            ✕
                        </button>

                        <h4
                            style={{
                                margin: "0 0 10px",
                                fontSize: "14px",
                                fontWeight: 700,
                                color: "var(--text, #111827)",
                            }}
                        >
                            My Maintenance Task
                        </h4>

                        <div style={{ display: "grid", gap: "6px" }}>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Task ID:</b>{" "}
                                <span>{selectedTask.task_id || selectedTask.id}</span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Asset:</b>{" "}
                                <span>{selectedTask.asset_id || "Field missing in Firestore"}</span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Section:</b>{" "}
                                <span>{selectedTask.section || "Field missing in Firestore"}</span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Chainage:</b>{" "}
                                <span>
                                    {selectedTask.km_from ?? "—"} to {selectedTask.km_to ?? "—"} KM
                                </span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Priority:</b>{" "}
                                <span
                                    style={{
                                        color: getPriorityColor(
                                            selectedTask.priority_score ?? selectedTask.score
                                        ),
                                        fontWeight: 700,
                                    }}
                                >
                                    {getPriorityName(
                                        selectedTask.priority_score ?? selectedTask.score
                                    )}{" "}
                                    ({selectedTask.priority_score ?? selectedTask.score ?? 0})
                                </span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Status:</b>{" "}
                                <span>{selectedTask.status || "Field missing in Firestore"}</span>
                            </div>
                            <div>
                                <b style={{ color: "var(--muted, #6b7280)" }}>Department:</b>{" "}
                                <span>{selectedTask.department || "Field missing in Firestore"}</span>
                            </div>
                            {selectedTask.description && (
                                <div>
                                    <b style={{ color: "var(--muted, #6b7280)" }}>Description:</b>{" "}
                                    <span>{selectedTask.description}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const selectStyle = {
    padding: "6px 12px",
    border: "1px solid var(--border, #d1d5db)",
    borderRadius: "7px",
    background: "var(--surface, #ffffff)",
    color: "var(--text, #374151)",
    fontSize: "12.5px",
    outline: "none",
};