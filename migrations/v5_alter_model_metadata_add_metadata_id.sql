alter table model_metadata
    add metadata_id int null after metadata_provider;

/* Since Navigator will now try to look for this ID, invalidate all caches so that it can be rediscovered with the ID */
UPDATE model_metadata
    SET metadata_updated_at = '2000-01-01 00:00:00';