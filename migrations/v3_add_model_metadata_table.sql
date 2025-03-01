create table model_metadata
(
    id                  int auto_increment
        primary key,
    hash                varchar(255) unique    null,
    metadata_cache      LONGTEXT               null,
    metadata_provider   int                    null,
    metadata_updated_at DATETIME default NOW() null
);