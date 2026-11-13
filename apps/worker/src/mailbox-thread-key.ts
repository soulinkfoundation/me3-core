/**
 * One conversation key per message, whatever each row stored in thread_key: the root of
 * References / In-Reply-To, else the message's own Message-ID, else thread_key, else its id.
 *
 * Migration 0103 stores this expression as the generated column
 * mailbox_messages.canonical_thread_key and indexes it, so thread queries look the key up
 * instead of parsing every row's JSON headers. Changing the expression needs a new migration.
 */
export function mailboxCanonicalThreadKeyExpression(): string {
  const metadata = "metadata_json";
  const headers = "raw_headers_json";
  const replyReference = `COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(${metadata}) THEN json_extract(${metadata}, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${headers}) THEN COALESCE(json_extract(${headers}, '$.references'), json_extract(${headers}, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${metadata}) THEN json_extract(${metadata}, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(${headers}) THEN COALESCE(json_extract(${headers}, '$."in-reply-to"'), json_extract(${headers}, '$."In-Reply-To"')) END), '')
  )`;
  const ownMessageId = `CASE
    WHEN direction = 'outbound' AND json_valid(${metadata})
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(${metadata}, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(${headers})
      THEN NULLIF(TRIM(COALESCE(json_extract(${headers}, '$."message-id"'), json_extract(${headers}, '$."Message-ID"'), json_extract(${headers}, '$.messageId'))), '')
  END`;
  const source = `TRIM(COALESCE(${replyReference}, ${ownMessageId}, NULLIF(thread_key, ''), id))`;
  return `CASE
    WHEN INSTR(${source}, '<') > 0
      AND INSTR(SUBSTR(${source}, INSTR(${source}, '<')), '>') > 0
      THEN SUBSTR(
        ${source},
        INSTR(${source}, '<'),
        INSTR(SUBSTR(${source}, INSTR(${source}, '<')), '>')
      )
    ELSE ${source}
  END`;
}

export const MAILBOX_CANONICAL_THREAD_KEY_COLUMN = "canonical_thread_key";
export const MAILBOX_CANONICAL_THREAD_INDEX = "idx_mailbox_messages_canonical_thread";

/** The statements of migration 0103, shared by the SQL file's test and the runtime migration. */
export function mailboxCanonicalThreadKeyMigrationSql(): { addColumn: string; createIndex: string } {
  return {
    addColumn: `ALTER TABLE mailbox_messages ADD COLUMN ${MAILBOX_CANONICAL_THREAD_KEY_COLUMN} TEXT GENERATED ALWAYS AS (${mailboxCanonicalThreadKeyExpression()}) VIRTUAL`,
    createIndex: `CREATE INDEX IF NOT EXISTS ${MAILBOX_CANONICAL_THREAD_INDEX}
  ON mailbox_messages(
    mailbox_id,
    ${MAILBOX_CANONICAL_THREAD_KEY_COLUMN},
    COALESCE(sent_at, received_at, approved_at, created_at) DESC,
    id DESC
  )`,
  };
}

/** The indexed conversation key of a mailbox_messages row. */
export function mailboxCanonicalThreadKeySql(alias: string): string {
  return `${alias}.${MAILBOX_CANONICAL_THREAD_KEY_COLUMN}`;
}
