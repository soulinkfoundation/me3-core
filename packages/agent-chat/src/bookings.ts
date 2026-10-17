type BookingD1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
};

type DbAgentBookingRow = {
  site_username: string | null;
  booking_type: "one_to_one" | "class" | "retreat" | null;
  guest_name: string;
  guest_email: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  notes: string | null;
  payment_status: string | null;
  is_free_booking: number | null;
};

export type AgentBooking = {
  siteUsername: string | null;
  bookingType: "one_to_one" | "class" | "retreat" | null;
  guestName: string;
  guestEmail: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  notes: string | null;
  paymentStatus: string | null;
  isFreeBooking: boolean;
};

export async function readUpcomingBookingsForAgent(
  db: BookingD1Like,
  userId: string,
  input: { limit?: number } = {},
): Promise<{ bookings: AgentBooking[] }> {
  const limit = normalizeBookingLimit(input.limit);
  const rows = await db.prepare(
    `SELECT s.username AS site_username, b.booking_type, b.guest_name,
            b.guest_email, b.starts_at, b.ends_at, b.duration_minutes,
            b.notes, b.payment_status, b.is_free_booking
     FROM bookings b
     JOIN sites s ON s.id = b.site_id
     WHERE s.user_id = ?
       AND b.status = 'confirmed'
       AND b.starts_at >= ?
     ORDER BY b.starts_at ASC
     LIMIT ?`,
  )
    .bind(userId, new Date().toISOString(), limit)
    .all<DbAgentBookingRow>();

  return {
    bookings: (rows.results || []).map((row) => ({
      siteUsername: boundedBookingText(row.site_username, 120),
      bookingType: row.booking_type,
      guestName: boundedBookingText(row.guest_name, 300) || "Unnamed guest",
      guestEmail: boundedBookingText(row.guest_email, 320) || "",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      durationMinutes: row.duration_minutes,
      notes: boundedBookingText(row.notes, 2_000),
      paymentStatus: boundedBookingText(row.payment_status, 120),
      isFreeBooking: Boolean(row.is_free_booking),
    })),
  };
}

/**
 * Confirmed website bookings whose start falls on an owner-local date in
 * [dateFrom, dateTo]. Bookings belong in calendar answers, not a separate one.
 */
export async function readBookingsInRangeForAgent(
  db: BookingD1Like,
  userId: string,
  range: { dateFrom: string; dateTo: string; timezone: string },
): Promise<AgentBooking[]> {
  const dayMs = 86_400_000;
  // Widen by a day each side in UTC, then filter on the owner-local date.
  const from = new Date(Date.parse(`${range.dateFrom}T00:00:00Z`) - dayMs).toISOString();
  const to = new Date(Date.parse(`${range.dateTo}T00:00:00Z`) + 2 * dayMs).toISOString();
  const rows = await db.prepare(
    `SELECT s.username AS site_username, b.booking_type, b.guest_name,
            b.guest_email, b.starts_at, b.ends_at, b.duration_minutes,
            b.notes, b.payment_status, b.is_free_booking
     FROM bookings b
     JOIN sites s ON s.id = b.site_id
     WHERE s.user_id = ?
       AND b.status = 'confirmed'
       AND b.starts_at >= ? AND b.starts_at < ?
     ORDER BY b.starts_at ASC
     LIMIT 50`,
  )
    .bind(userId, from, to)
    .all<DbAgentBookingRow>();
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: range.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (rows.results || [])
    .filter((row) => {
      const day = localDate.format(new Date(row.starts_at));
      return day >= range.dateFrom && day <= range.dateTo;
    })
    .map((row) => ({
      siteUsername: boundedBookingText(row.site_username, 120),
      bookingType: row.booking_type,
      guestName: boundedBookingText(row.guest_name, 300) || "Unnamed guest",
      guestEmail: boundedBookingText(row.guest_email, 320) || "",
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      durationMinutes: row.duration_minutes,
      notes: boundedBookingText(row.notes, 2_000),
      paymentStatus: boundedBookingText(row.payment_status, 120),
      isFreeBooking: Boolean(row.is_free_booking),
    }));
}

function normalizeBookingLimit(value: number | undefined): number {
  if (value === undefined) return 8;
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new Error("Booking limit must be an integer from 1 to 20.");
  }
  return value;
}

function boundedBookingText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, limit);
}
