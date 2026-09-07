import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

/**
 * React-Leaflet wrapper for L.heatLayer (leaflet.heat).
 *
 * Props:
 *   points  — Array of [lat, lng, intensity] tuples
 *   options — leaflet.heat options (radius, blur, gradient, etc.)
 */
export default function HeatmapLayer({ points = [], options = {} }) {
    const map = useMap();
    const layerRef = useRef(null);

    useEffect(() => {
        if (!map) return;

        // Remove previous layer
        if (layerRef.current) {
            map.removeLayer(layerRef.current);
            layerRef.current = null;
        }

        if (points.length === 0) return;

        const heat = L.heatLayer(points, {
            radius: 28,
            blur: 22,
            maxZoom: 14,
            max: 100,
            minOpacity: 0.35,
            gradient: {
                0.0: "#16a34a",
                0.3: "#a3e635",
                0.5: "#eab308",
                0.7: "#ea580c",
                1.0: "#dc2626",
            },
            ...options,
        });

        heat.addTo(map);
        layerRef.current = heat;

        return () => {
            if (layerRef.current) {
                map.removeLayer(layerRef.current);
                layerRef.current = null;
            }
        };
    }, [map, points, options]);

    return null;
}
