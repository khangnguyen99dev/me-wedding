-- Allow images up to 50 MB (client-side cap in src/admin/lib/media.ts).
-- Note: the bucket limit cannot exceed the project's global upload limit
-- (Storage settings; 50 MB on the Free plan).
update storage.buckets
set file_size_limit = 52428800  -- 50 MB
where id = 'media';
