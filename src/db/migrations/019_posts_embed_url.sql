-- Store the external link URL from post embeds for deduplication.
-- Posts sharing the same URL get a decay penalty in feed output.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS embed_url TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_embed_url ON posts(embed_url) WHERE embed_url IS NOT NULL;
