ALTER TABLE users ADD COLUMN lang_set INTEGER NOT NULL DEFAULT 0;
UPDATE users SET lang_set = 1 WHERE language IS NOT NULL AND language != '';
