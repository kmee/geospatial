/** @odoo-module **/

import {Component, useState} from "@odoo/owl";

/**
 * PinList component displays a sidebar with a list of map markers.
 * Supports grouping, collapsing, and click-to-center functionality.
 */
export class PinList extends Component {
    static template = "web_view_leaflet_map.PinList";
    static props = {
        records: {type: Array},
        groupBy: {type: String, optional: true},
        groupColors: {type: Object, optional: true},
        panelTitle: {type: String, optional: true},
        onPinClick: {type: Function},
        onNavigateClick: {type: Function, optional: true},
        fieldTitle: {type: String, optional: true},
        fieldAddress: {type: String, optional: true},
        fieldLatitude: {type: String},
        fieldLongitude: {type: String},
    };
    static defaultProps = {
        panelTitle: "Locations",
        groupColors: {},
    };

    setup() {
        this.state = useState({
            collapsed: false,
            collapsedGroups: {},
            searchQuery: "",
        });
    }

    /**
     * Get filtered records based on search query
     */
    get filteredRecords() {
        if (!this.state.searchQuery) {
            return this.props.records;
        }
        const query = this.state.searchQuery.toLowerCase();
        return this.props.records.filter((record) => {
            const title = this.getRecordTitle(record).toLowerCase();
            const address = this.getRecordAddress(record).toLowerCase();
            return title.includes(query) || address.includes(query);
        });
    }

    /**
     * Get records organized by groups
     */
    get groupedRecords() {
        const records = this.filteredRecords;

        if (!this.props.groupBy) {
            return [{name: null, records, color: null}];
        }

        const groups = {};
        for (const record of records) {
            const groupValue = record[this.props.groupBy];
            // Handle Many2one fields (array with [id, name])
            const groupKey = Array.isArray(groupValue)
                ? groupValue[1]
                : groupValue || "Undefined";

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    name: groupKey,
                    records: [],
                    color: this.getGroupColor(groupKey),
                };
            }
            groups[groupKey].records.push(record);
        }

        return Object.values(groups).sort((a, b) =>
            String(a.name).localeCompare(String(b.name))
        );
    }

    /**
     * Get total count of located records
     */
    get locatedCount() {
        return this.filteredRecords.filter(
            (r) =>
                r[this.props.fieldLatitude] &&
                r[this.props.fieldLongitude] &&
                this.validateCoordinates(
                    r[this.props.fieldLatitude],
                    r[this.props.fieldLongitude]
                )
        ).length;
    }

    /**
     * Get count of records without valid coordinates
     */
    get unlocatedCount() {
        return this.filteredRecords.length - this.locatedCount;
    }

    /**
     * Validate coordinates are within valid ranges
     */
    validateCoordinates(lat, lng) {
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }

    /**
     * Get display title for a record
     */
    getRecordTitle(record) {
        if (this.props.fieldTitle) {
            return record[this.props.fieldTitle] || record.display_name || "";
        }
        return record.display_name || "";
    }

    /**
     * Get address for a record
     */
    getRecordAddress(record) {
        if (this.props.fieldAddress) {
            return record[this.props.fieldAddress] || "";
        }
        return "";
    }

    /**
     * Check if a record has valid coordinates
     */
    hasValidCoordinates(record) {
        const lat = record[this.props.fieldLatitude];
        const lng = record[this.props.fieldLongitude];
        return lat && lng && this.validateCoordinates(lat, lng);
    }

    /**
     * Get a color for a group (generates consistent colors based on group name)
     */
    getGroupColor(groupName) {
        if (this.props.groupColors[groupName]) {
            return this.props.groupColors[groupName];
        }

        // Generate a color based on the hash of the group name
        const colors = [
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

        let hash = 0;
        for (let i = 0; i < String(groupName).length; i++) {
            hash = String(groupName).charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    /**
     * Toggle sidebar collapse state
     */
    toggleSidebar() {
        this.state.collapsed = !this.state.collapsed;
    }

    /**
     * Toggle group collapse state
     */
    toggleGroup(groupName) {
        this.state.collapsedGroups[groupName] = !this.state.collapsedGroups[groupName];
    }

    /**
     * Check if a group is collapsed
     */
    isGroupCollapsed(groupName) {
        return this.state.collapsedGroups[groupName] || false;
    }

    /**
     * Handle click on a pin item
     */
    onPinItemClick(record) {
        if (this.hasValidCoordinates(record)) {
            this.props.onPinClick(record);
        }
    }

    /**
     * Handle click on navigate button
     */
    onNavigateButtonClick(ev, record) {
        ev.stopPropagation();
        if (this.props.onNavigateClick && this.hasValidCoordinates(record)) {
            this.props.onNavigateClick(record);
        }
    }

    /**
     * Update search query
     */
    onSearchInput(ev) {
        this.state.searchQuery = ev.target.value;
    }

    /**
     * Clear search
     */
    clearSearch() {
        this.state.searchQuery = "";
    }

    /**
     * Generate Google Maps navigation URL
     */
    getGoogleMapsUrl(record) {
        const lat = record[this.props.fieldLatitude];
        const lng = record[this.props.fieldLongitude];
        return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    }
}
