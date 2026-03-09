-- Migration: What-If Scenario Management
-- Description: Tables for storing and managing network topology what-if analysis scenarios
-- Author: System
-- Date: 2026-03-09

-- Main scenarios table
CREATE TABLE IF NOT EXISTS whatif_scenarios (
    id SERIAL PRIMARY KEY,
    graph_id VARCHAR(255) NOT NULL,
    graph_time VARCHAR(255) NOT NULL,
    scenario_name VARCHAR(255) NOT NULL,
    scenario_type VARCHAR(50) NOT NULL CHECK (scenario_type IN ('node_failure', 'link_failure', 'cost_change', 'multi_change')),
    scenario_config JSONB NOT NULL,
    baseline_matrix JSONB NOT NULL,
    modified_matrix JSONB NOT NULL,
    statistics JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(255),
    is_public BOOLEAN DEFAULT FALSE,
    description TEXT,
    CONSTRAINT unique_scenario_name UNIQUE(graph_id, graph_time, scenario_name)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_whatif_graph_id ON whatif_scenarios(graph_id);
CREATE INDEX IF NOT EXISTS idx_whatif_graph_time ON whatif_scenarios(graph_time);
CREATE INDEX IF NOT EXISTS idx_whatif_scenario_type ON whatif_scenarios(scenario_type);
CREATE INDEX IF NOT EXISTS idx_whatif_created_at ON whatif_scenarios(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatif_is_public ON whatif_scenarios(is_public) WHERE is_public = TRUE;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whatif_scenarios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_whatif_scenarios_updated_at ON whatif_scenarios;
CREATE TRIGGER trigger_update_whatif_scenarios_updated_at
    BEFORE UPDATE ON whatif_scenarios
    FOR EACH ROW
    EXECUTE FUNCTION update_whatif_scenarios_updated_at();

-- Scenario comparison history (for tracking multi-scenario comparisons)
CREATE TABLE IF NOT EXISTS whatif_comparisons (
    id SERIAL PRIMARY KEY,
    comparison_name VARCHAR(255) NOT NULL,
    scenario_ids INTEGER[] NOT NULL,
    graph_id VARCHAR(255) NOT NULL,
    graph_time VARCHAR(255) NOT NULL,
    comparison_result JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_whatif_comparisons_graph ON whatif_comparisons(graph_id, graph_time);
CREATE INDEX IF NOT EXISTS idx_whatif_comparisons_created_at ON whatif_comparisons(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE whatif_scenarios IS 'Stores what-if analysis scenarios for network topology changes';
COMMENT ON COLUMN whatif_scenarios.scenario_type IS 'Type of scenario: node_failure, link_failure, cost_change, or multi_change';
COMMENT ON COLUMN whatif_scenarios.scenario_config IS 'JSON configuration specific to scenario type';
COMMENT ON COLUMN whatif_scenarios.baseline_matrix IS 'Cost matrix before scenario application';
COMMENT ON COLUMN whatif_scenarios.modified_matrix IS 'Cost matrix after scenario application';
COMMENT ON COLUMN whatif_scenarios.statistics IS 'Computed statistics: paths_lost, paths_improved, avg_cost_change, etc.';
COMMENT ON COLUMN whatif_scenarios.is_public IS 'Whether scenario is visible to all users';

COMMENT ON TABLE whatif_comparisons IS 'Tracks multi-scenario comparison operations';
COMMENT ON COLUMN whatif_comparisons.scenario_ids IS 'Array of scenario IDs being compared';
COMMENT ON COLUMN whatif_comparisons.comparison_result IS 'Aggregated comparison results and statistics';
