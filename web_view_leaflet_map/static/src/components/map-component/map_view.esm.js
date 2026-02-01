/** @odoo-module **/

import {registry} from "@web/core/registry";
import {useService} from "@web/core/utils/hooks";
import {Layout} from "@web/search/layout";
import {session} from "@web/session";
import {PinList} from "../pin-list/pin_list.esm";

/* global L, console, document, DOMParser, window */

const {Component, useSubEnv, onWillStart, onMounted, onPatched, useRef, useState} = owl;

// Default colors for group markers
const GROUP_COLORS = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#96CEB4",
    "#FFEAA7",
    "#DDA0DD",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E9",
];

/**
 * MapRenderer component for displaying records on a Leaflet map.
 * Supports markers, clustering, popups, routing, and a sidebar pin list.
 */
export class MapRenderer extends Component {
    static template = "web_view_leaflet_map.MapRenderer";
    static components = {PinList};

    /**
     * Initializes the MapRenderer component, setting up services, references, and configuration.
     */
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.mapRef = useRef("mapContainer");

        // Session configuration
        this.leafletTileUrl = session["leaflet.tile_url"];
        this.leafletCopyright = session["leaflet.copyright"];

        // Parse arch attributes
        const archAttrs = this.props.archInfo.arch.attributes;

        this.resModel = this.props.resModel;
        this.defaultZoom = parseInt(archAttrs.default_zoom, 10) || 7;
        this.maxZoom = parseInt(archAttrs.max_zoom, 10) || 19;
        this.zoomSnap = parseInt(archAttrs.zoom_snap, 10) || 1;

        // Field mappings
        this.fieldLatitude = archAttrs.field_latitude?.value;
        this.fieldLongitude = archAttrs.field_longitude?.value;
        this.fieldTitle = archAttrs.field_title?.value;
        this.fieldAddress = archAttrs.field_address?.value;
        this.fieldMarkerIconImage = archAttrs.field_marker_icon_image?.value;

        // Marker icon configuration
        this.markerIconSizeX = parseInt(archAttrs.marker_icon_size_x?.value, 10) || 64;
        this.markerIconSizeY = parseInt(archAttrs.marker_icon_size_y?.value, 10) || 64;
        this.markerPopupAnchorX =
            parseInt(archAttrs.marker_popup_anchor_x?.value, 10) || 0;
        this.markerPopupAnchorY =
            parseInt(archAttrs.marker_popup_anchor_y?.value, 10) || -32;

        // New view options
        this.showPinList = archAttrs.show_pin_list?.value !== "0";
        this.groupBy = archAttrs.group_by?.value;
        this.panelTitle = archAttrs.panel_title?.value || "Locations";
        this.showNumberedMarkers = archAttrs.numbered_markers?.value === "1";
        this.enableRouting = archAttrs.routing?.value === "1";
        this.enableNavigation = archAttrs.enable_navigation?.value !== "0";

        // State
        this.state = useState({
            records: [],
            loading: true,
            selectedRecord: null,
        });

        // Map references
        this.leafletMap = null;
        this.mainLayer = null;
        this.routeLayer = null;
        this.markersById = {};
        this.groupColors = {};

        onWillStart(async () => {
            await this.initDefaultPosition();
            await this.loadRecords();
        });

        onMounted(() => {
            this.initMap();
            this.renderMarkers();
        });

        onPatched(() => {
            if (this.leafletMap) {
                this.renderMarkers();
            }
        });
    }

    /**
     * Validates that coordinates are within valid ranges.
     * @param {Number} lat - Latitude
     * @param {Number} lng - Longitude
     * @returns {Boolean}
     */
    validateCoordinates(lat, lng) {
        try {
            lat = parseFloat(lat);
            lng = parseFloat(lng);
            return (
                !isNaN(lat) &&
                !isNaN(lng) &&
                lat >= -90 &&
                lat <= 90 &&
                lng >= -180 &&
                lng <= 180
            );
        } catch {
            return false;
        }
    }

    /**
     * Loads records from the server based on the provided domain and fields.
     * @returns {Promise<void>}
     */
    async loadRecords() {
        const fields = this.getFields();

        try {
            this.state.loading = true;
            const records = await this.orm.searchRead(
                this.resModel,
                this.props.domain || [],
                fields,
                {
                    limit: this.props.limit || 500,
                    context: this.props.context || {},
                }
            );
            this.state.records = records;
            // Also keep for backward compatibility
            this.records = records;
        } catch (error) {
            console.error("Error loading records:", error);
            this.state.records = [];
            this.records = [];
        } finally {
            this.state.loading = false;
        }
    }

    /**
     * Gathers the required fields for the map view.
     * @returns {string[]}
     */
    getFields() {
        const fields = new Set();

        // Required fields
        fields.add("id");
        fields.add("display_name");
        fields.add("date_localization");

        // Optional fields based on arch attributes
        if (this.fieldLatitude) fields.add(this.fieldLatitude);
        if (this.fieldLongitude) fields.add(this.fieldLongitude);
        if (this.fieldTitle) fields.add(this.fieldTitle);
        if (this.fieldAddress) fields.add(this.fieldAddress);
        if (this.fieldMarkerIconImage) fields.add(this.fieldMarkerIconImage);
        if (this.groupBy) fields.add(this.groupBy);

        return Array.from(fields);
    }

    /**
     * Initializes the default position of the map by calling the server method.
     * @returns {Promise<void>}
     */
    async initDefaultPosition() {
        const result = await this.orm.call(
            "res.users",
            "get_default_leaflet_position",
            [this.props.resModel]
        );
        this.defaultLatLng = L.latLng(result.lat, result.lng);
    }

    /**
     * Initializes the Leaflet map in the container.
     */
    initMap() {
        const mapDiv = this.mapRef.el;
        if (!mapDiv) {
            console.error("Map container not found");
            return;
        }

        this.leafletMap = L.map(mapDiv, {
            zoomSnap: this.zoomSnap,
        }).setView(this.defaultLatLng, this.defaultZoom);

        L.tileLayer(this.leafletTileUrl, {
            maxZoom: this.maxZoom,
            attribution: this.leafletCopyright,
        }).addTo(this.leafletMap);

        // Initialize route layer for polylines
        if (this.enableRouting) {
            this.routeLayer = L.layerGroup().addTo(this.leafletMap);
        }
    }

    /**
     * Gets a color for a group based on its name.
     * @param {String} groupName
     * @returns {String}
     */
    getGroupColor(groupName) {
        if (this.groupColors[groupName]) {
            return this.groupColors[groupName];
        }

        let hash = 0;
        for (let i = 0; i < String(groupName).length; i++) {
            hash = String(groupName).charCodeAt(i) + ((hash << 5) - hash);
        }
        const color = GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
        this.groupColors[groupName] = color;
        return color;
    }

    /**
     * Gets the group name for a record.
     * @param {Object} record
     * @returns {string|null}
     */
    getGroupName(record) {
        if (!this.groupBy) return null;
        const value = record[this.groupBy];
        // Handle Many2one fields (array with [id, name])
        return Array.isArray(value) ? value[1] : value || "Undefined";
    }

    /**
     * Renders the markers on the map based on the loaded records.
     */
    renderMarkers() {
        if (!this.leafletMap) {
            console.warn("Map not initialized yet");
            return;
        }

        if (this.mainLayer) {
            this.leafletMap.removeLayer(this.mainLayer);
        }

        this.mainLayer = L.markerClusterGroup();
        this.markersById = {};

        let markerIndex = 0;
        for (const record of this.state.records) {
            const marker = this.prepareMarker(record, markerIndex);
            if (marker) {
                this.mainLayer.addLayer(marker);
                this.markersById[record.id] = marker;
                markerIndex++;
            }
        }

        const bounds = this.mainLayer.getBounds();
        if (bounds.isValid()) {
            this.leafletMap.fitBounds(bounds.pad(0.1));
        }

        this.leafletMap.addLayer(this.mainLayer);
    }

    /**
     * Prepares a Leaflet marker for the given record.
     * @param {Object} record - The record object containing marker data
     * @param {Number} index - The marker index for numbering
     * @returns {L.Marker|null}
     */
    prepareMarker(record, index) {
        const lat = record[this.fieldLatitude];
        const lng = record[this.fieldLongitude];

        if (!lat || !lng || !this.validateCoordinates(lat, lng)) {
            return null;
        }

        const latlng = L.latLng(lat, lng);
        const markerOptions = this.prepareMarkerOptions(record, index);

        const marker = L.marker(latlng, markerOptions);
        const popup = L.popup().setContent(this.preparePopUpData(record, index));

        marker.bindPopup(popup).on("popupopen", () => {
            const selector = document.querySelector(".o_map_selector");
            if (selector) {
                selector.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this.onClickLeafletPopup(record);
                });
            }
        });

        return marker;
    }

    /**
     * Creates a numbered marker icon using SVG.
     * @param {Number} number - The number to display
     * @param {String} color - The marker color
     * @returns {L.DivIcon}
     */
    createNumberedMarker(number, color = "#007bff") {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 40" width="30" height="40">
                <path d="M15 0C6.716 0 0 6.716 0 15c0 8.284 15 25 15 25s15-16.716 15-25C30 6.716 23.284 0 15 0z" fill="${color}" stroke="#fff" stroke-width="1"/>
                <circle cx="15" cy="15" r="10" fill="#fff"/>
                <text x="15" y="19" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${number}</text>
            </svg>
        `;

        return L.divIcon({
            className: "o_leaflet_numbered_marker",
            html: svg,
            iconSize: [30, 40],
            iconAnchor: [15, 40],
            popupAnchor: [0, -40],
        });
    }

    /**
     * Prepares the Leaflet icon for the marker using the image field.
     * @param {Object} record - The record object containing marker data
     * @returns {L.Icon}
     */
    prepareMarkerIcon(record) {
        const lastUpdate = record.date_localization || new Date().toISOString();
        const unique = lastUpdate.replace(/[^0-9]/g, "");
        const iconUrl = `/web/image?model=${this.resModel}&id=${record.id}&field=${this.fieldMarkerIconImage}&unique=${unique}`;

        return L.icon({
            iconUrl: iconUrl,
            className: "leaflet_marker_icon",
            iconSize: [this.markerIconSizeX, this.markerIconSizeY],
            popupAnchor: [this.markerPopupAnchorX, this.markerPopupAnchorY],
        });
    }

    /**
     * Prepares the options for the leaflet marker.
     * @param {Object} record - The record object containing marker data
     * @param {Number} index - The marker index
     * @returns {Object}
     */
    prepareMarkerOptions(record, index) {
        const title = record[this.fieldTitle] || "";
        const result = {
            title: title,
            alt: title,
            riseOnHover: true,
        };

        // Use numbered markers if enabled
        if (this.showNumberedMarkers) {
            const groupName = this.getGroupName(record);
            const color = groupName ? this.getGroupColor(groupName) : "#007bff";
            result.icon = this.createNumberedMarker(index + 1, color);
        } else if (this.fieldMarkerIconImage) {
            result.icon = this.prepareMarkerIcon(record);
        }

        return result;
    }

    /**
     * Prepares the HTML content for the leaflet popup.
     * @param {Object} record - The record object containing marker data
     * @param {Number} index - The marker index
     * @returns {String}
     */
    preparePopUpData(record, index) {
        const title = record[this.fieldTitle] || record.display_name || "";
        const address = record[this.fieldAddress] || "";
        const lat = record[this.fieldLatitude];
        const lng = record[this.fieldLongitude];

        // Build navigation URL
        const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

        let html = `
            <div class='o_map_popup'>
                <div class='o_map_selector' data-res-id='${record.id}'>
                    ${this.showNumberedMarkers ? `<span class="o_popup_number">${index + 1}.</span> ` : ""}
                    <b>${this.escapeHtml(title)}</b>
                </div>
                ${address ? `<div class="o_popup_address">${this.escapeHtml(address)}</div>` : ""}
        `;

        // Add navigation button if enabled
        if (this.enableNavigation) {
            html += `
                <div class="o_popup_actions mt-2">
                    <a href="${googleMapsUrl}" target="_blank" class="btn btn-sm btn-primary">
                        <i class="fa fa-location-arrow"></i> Navigate
                    </a>
                </div>
            `;
        }

        html += `</div>`;
        return html;
    }

    /**
     * Escapes HTML to prevent XSS.
     * @param {String} text
     * @returns {String}
     */
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Handles click on the leaflet popup to open the record form view.
     * @param {Object} record - The record object containing marker data
     */
    onClickLeafletPopup(record) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: this.resModel,
            res_id: record.id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    /**
     * Centers the map on a specific record and opens its popup.
     * Called from PinList component.
     * @param {Object} record
     */
    onPinClick(record) {
        const lat = record[this.fieldLatitude];
        const lng = record[this.fieldLongitude];

        if (!this.validateCoordinates(lat, lng)) {
            return;
        }

        const marker = this.markersById[record.id];
        if (marker && this.leafletMap) {
            // Center map on the marker
            this.leafletMap.setView(
                [lat, lng],
                Math.max(this.leafletMap.getZoom(), 14)
            );

            // Open the marker popup (may need to unspider if in cluster)
            if (this.mainLayer.hasLayer(marker)) {
                this.mainLayer.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                });
            } else {
                marker.openPopup();
            }
        }
    }

    /**
     * Handles navigation button click from PinList.
     * Opens Google Maps directions in a new tab.
     * @param {Object} record
     */
    onNavigateClick(record) {
        const lat = record[this.fieldLatitude];
        const lng = record[this.fieldLongitude];

        if (this.validateCoordinates(lat, lng)) {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
            window.open(url, "_blank");
        }
    }

    /**
     * Renders a route polyline on the map.
     * @param {Array} coordinates - Array of [lat, lng] coordinates
     * @param {Object} options - Polyline options
     * @returns {L.Polyline}
     */
    renderRoute(coordinates, options = {}) {
        if (!this.routeLayer || !this.leafletMap) {
            return null;
        }

        const defaultOptions = {
            color: "#007bff",
            weight: 5,
            opacity: 0.7,
            smoothFactor: 1,
        };

        const polyline = L.polyline(coordinates, {...defaultOptions, ...options});

        polyline.on("click", () => {
            this.highlightRoute(polyline);
        });

        this.routeLayer.addLayer(polyline);
        return polyline;
    }

    /**
     * Highlights a route polyline.
     * @param {L.Polyline} polyline
     */
    highlightRoute(polyline) {
        // Reset all routes to default style
        if (this.routeLayer) {
            this.routeLayer.eachLayer((layer) => {
                if (layer instanceof L.Polyline) {
                    layer.setStyle({weight: 5, opacity: 0.7});
                }
            });
        }

        // Highlight selected route
        polyline.setStyle({weight: 8, opacity: 1});
        polyline.bringToFront();
    }

    /**
     * Clears all route polylines from the map.
     */
    clearRoutes() {
        if (this.routeLayer) {
            this.routeLayer.clearLayers();
        }
    }
}

/**
 * Controller class for the Map view, setting up the environment configuration.
 */
export class MapController extends Component {
    static template = "web_view_leaflet_map.MapView";
    static components = {Layout, MapRenderer};

    setup() {
        useSubEnv({
            config: {
                ...this.env.config,
            },
        });
    }
}

/**
 * Helper function that normalize the architecture input to ensure it is an HTMLElement.
 * @param {string|HTMLElement} arch
 * @returns {HTMLElement}
 */
function normalizeArch(arch) {
    if (arch && typeof arch !== "string") return arch;
    const xml = String(arch || "");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    return doc.documentElement;
}

/**
 * Definition of the map view for Odoo, including its properties and components.
 */
export const mapView = {
    type: "leaflet_map",
    display_name: "Map",
    icon: "fa fa-map-o",
    multiRecord: true,
    Controller: MapController,
    Renderer: MapRenderer,
    searchMenuTypes: ["filter", "favorite"],

    props: (genericProps) => {
        const archEl = normalizeArch(genericProps.arch);
        return {
            ...genericProps,
            Renderer: MapRenderer,
            archInfo: {
                arch: archEl,
            },
        };
    },
};

registry.category("views").add("leaflet_map", mapView);
