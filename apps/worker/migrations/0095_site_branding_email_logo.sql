-- The email copy of a Site's logo: a PNG on a white tile, with its display size (me3-bli3.2.12).
ALTER TABLE site_branding ADD COLUMN email_logo_ref TEXT;
ALTER TABLE site_branding ADD COLUMN email_logo_width INTEGER;
ALTER TABLE site_branding ADD COLUMN email_logo_height INTEGER;
