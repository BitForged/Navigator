CREATE TABLE file_sha256_cache (
                                   file_name VARCHAR(255) PRIMARY KEY,
                                   sha256_sum VARCHAR(64) NOT NULL,    -- SHA256 is 64 hex characters
                                   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);