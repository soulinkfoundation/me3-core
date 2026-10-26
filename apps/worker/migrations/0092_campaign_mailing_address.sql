-- The postal address a site's campaigns show in their footer, remembered for the next campaign.
ALTER TABLE sites ADD COLUMN campaign_mailing_address TEXT;
