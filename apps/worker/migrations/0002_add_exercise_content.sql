ALTER TABLE exercises ADD COLUMN content TEXT NOT NULL DEFAULT '{}';
ALTER TABLE exercises ADD COLUMN source_text TEXT;
ALTER TABLE exercises ADD COLUMN source_url TEXT;
