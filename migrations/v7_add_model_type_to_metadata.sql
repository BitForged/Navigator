-- Step 1: Add the 'model_type' column as nullable since existing rows will need a type added (covered below)
ALTER TABLE model_metadata
    ADD COLUMN model_type INT NULL AFTER hash;

-- Step 2: Set the 'model_type' for all existing rows to 0 (LoRA; The only model type Navigator previously cached)
UPDATE model_metadata
SET model_type = 0;

-- Step 3: Alter the 'model_type' column to be NOT NULL (all further writes to this table should have a type enforced)
ALTER TABLE model_metadata
    MODIFY COLUMN model_type INT NOT NULL;