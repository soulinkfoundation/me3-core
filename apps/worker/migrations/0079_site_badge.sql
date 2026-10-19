-- Owner's choice for the "Create your own ME3 site" badge on published pages.
-- NULL follows the install default; 'shown' or 'hidden' is an explicit choice.
ALTER TABLE owner_profile ADD COLUMN site_badge TEXT CHECK (site_badge IN ('shown', 'hidden'));
