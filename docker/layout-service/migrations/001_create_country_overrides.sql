-- =============================================================================
-- Migration: 001_create_country_overrides.sql
-- Purpose: Add country_overrides table for managing hostname prefix to country
--          code mappings with support for custom overrides
-- =============================================================================

-- Create country_overrides table
CREATE TABLE IF NOT EXISTS country_overrides (
    id SERIAL PRIMARY KEY,
    prefix VARCHAR(255) NOT NULL UNIQUE,
    country_code VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    notes TEXT,
    CONSTRAINT prefix_lowercase CHECK (prefix = LOWER(prefix)),
    CONSTRAINT country_code_uppercase CHECK (country_code = UPPER(country_code)),
    CONSTRAINT country_code_length CHECK (LENGTH(country_code) = 3)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_country_overrides_prefix ON country_overrides(prefix);
CREATE INDEX IF NOT EXISTS idx_country_overrides_country ON country_overrides(country_code);
CREATE INDEX IF NOT EXISTS idx_country_overrides_created_at ON country_overrides(created_at DESC);

-- Create trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_country_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_country_overrides_updated_at ON country_overrides;
CREATE TRIGGER trigger_country_overrides_updated_at
    BEFORE UPDATE ON country_overrides
    FOR EACH ROW
    EXECUTE FUNCTION update_country_overrides_updated_at();

-- Add comment for documentation
COMMENT ON TABLE country_overrides IS 'Stores hostname prefix to country code override mappings for topology visualization';
COMMENT ON COLUMN country_overrides.prefix IS 'Hostname prefix (lowercase, e.g., "fra", "gbr", "zaf")';
COMMENT ON COLUMN country_overrides.country_code IS 'ISO 3166-1 alpha-3 or custom 3-letter country code (uppercase, e.g., "FRA", "GBR", "UNK")';
COMMENT ON COLUMN country_overrides.notes IS 'Optional notes about the override mapping';
