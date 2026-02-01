/** @odoo-module **/

/* global console */

import {Component, onWillStart, useState, useSubEnv} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {Layout} from "@web/search/layout";
import {LeafletMapModel} from "./leaflet_map_model.esm";
import {LeafletMapRenderer} from "./leaflet_map_renderer.esm";

/**
 * LeafletMapController is the main controller for the leaflet map view.
 * It manages the model lifecycle and coordinates between the search panel
 * and the renderer.
 *
 * Following Odoo Enterprise web_map Controller pattern.
 */
export class LeafletMapController extends Component {
    static template = "web_view_leaflet_map.LeafletMapController";
    static components = {Layout, LeafletMapRenderer};

    static props = {
        resModel: {type: String},
        arch: {type: Object, optional: true},
        archInfo: {type: Object},
        domain: {type: Array, optional: true},
        context: {type: Object, optional: true},
        fields: {type: Object, optional: true},
        limit: {type: Number, optional: true},
        display: {type: Object, optional: true},
        // Model and Renderer classes to use (allows overriding)
        Model: {type: Function, optional: true},
        Renderer: {type: Function, optional: true},
    };

    static defaultProps = {
        domain: [],
        context: {},
        fields: {},
    };

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.notification = useService("notification");

        // State for reactive updates
        // dataVersion is incremented after each data reload to force re-render
        this.state = useState({
            loading: true,
            dataVersion: 0,
        });

        // Set up sub-environment for child components
        useSubEnv({
            config: {
                ...this.env.config,
            },
        });

        // Create model instance
        const ModelClass = this.props.Model || LeafletMapModel;
        this.model = new ModelClass(
            this.env,
            {
                resModel: this.props.resModel,
                archInfo: this.props.archInfo,
                fields: this.props.fields,
                context: this.props.context,
            },
            {orm: this.orm}
        );

        // Initial data load
        onWillStart(async () => {
            await this.loadData();
        });
    }

    /**
     * Get the Renderer component class to use.
     */
    get RendererComponent() {
        return this.props.Renderer || LeafletMapRenderer;
    }

    /**
     * Load data from the model.
     */
    async loadData() {
        this.state.loading = true;
        try {
            await this.model.load({
                domain: this.props.domain,
                limit: this.props.limit,
                context: this.props.context,
            });
        } finally {
            this.state.loading = false;
        }
    }

    /**
     * Reload data (called after resequencing or domain changes).
     */
    async reloadData() {
        this.state.loading = true;
        try {
            await this.model.reload();
        } finally {
            this.state.loading = false;
            // Increment dataVersion to force re-render of child components
            this.state.dataVersion++;
        }
    }

    /**
     * Handle resequence event from the renderer.
     *
     * @param {Number} recordId - ID of the record being moved
     * @param {Number} targetGroupId - ID of the target group
     * @param {Number|null} previousRecordId - ID of the preceding record
     */
    async onResequence(recordId, targetGroupId, previousRecordId) {
        console.log("LeafletMapController.onResequence:", {
            recordId,
            targetGroupId,
            previousRecordId,
        });

        try {
            const result = await this.model.resequence(
                recordId,
                targetGroupId,
                previousRecordId
            );

            console.log("Resequence result:", result);

            if (result.success) {
                await this.reloadData();
            } else {
                // Show error notification if resequence failed
                this.notification.add(result.error || "Failed to reorder item", {
                    type: "danger",
                });
            }
            return result;
        } catch (error) {
            console.error("Resequence error:", error);
            this.notification.add(error.message || "Failed to reorder item", {
                type: "danger",
            });
            return {success: false, error: error.message};
        }
    }

    /**
     * Get props to pass to the Renderer component.
     */
    get rendererProps() {
        return {
            resModel: this.props.resModel,
            archInfo: this.props.archInfo,
            fields: this.props.fields,
            context: this.props.context,
            model: this.model,
            onResequence: this.onResequence.bind(this),
            // DataVersion triggers re-render when data changes
            dataVersion: this.state.dataVersion,
        };
    }
}
