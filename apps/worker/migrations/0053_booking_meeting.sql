ALTER TABLE bookings ADD COLUMN meeting_provider TEXT;
ALTER TABLE bookings ADD COLUMN meeting_url TEXT;
ALTER TABLE bookings ADD COLUMN meeting_host_url TEXT;
ALTER TABLE bookings ADD COLUMN meeting_guest_token_hash TEXT;
ALTER TABLE bookings ADD COLUMN meeting_title TEXT;
CREATE INDEX IF NOT EXISTS idx_bookings_soulink_upcoming
  ON bookings(site_id, starts_at) WHERE meeting_provider = 'soulink' AND status = 'confirmed';
CREATE TABLE IF NOT EXISTS site_booking_meetings (
  site_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  meeting_url TEXT NOT NULL,
  PRIMARY KEY (site_id, offer_id),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
