ALTER TABLE model_metadata
    ADD COLUMN updates_disabled BOOLEAN DEFAULT false NOT NULL;