-- Thread queries parsed every message's JSON headers to find its conversation, so a few hundred
-- messages were enough to exhaust D1 ("D1 DB is overloaded"). The conversation key is now a
-- generated column with an index; rows are not rewritten.
ALTER TABLE mailbox_messages ADD COLUMN canonical_thread_key TEXT GENERATED ALWAYS AS (CASE
    WHEN INSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), '<') > 0
      AND INSTR(SUBSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), INSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), '<')), '>') > 0
      THEN SUBSTR(
        TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)),
        INSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), '<'),
        INSTR(SUBSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), INSTR(TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id)), '<')), '>')
      )
    ELSE TRIM(COALESCE(COALESCE(
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.references') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$.references'), json_extract(raw_headers_json, '$.References')) END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.outbound_headers.in_reply_to') END), ''),
    NULLIF(TRIM(CASE WHEN json_valid(raw_headers_json) THEN COALESCE(json_extract(raw_headers_json, '$."in-reply-to"'), json_extract(raw_headers_json, '$."In-Reply-To"')) END), '')
  ), CASE
    WHEN direction = 'outbound' AND json_valid(metadata_json)
      THEN COALESCE(
        CASE
          WHEN INSTR(TRIM(COALESCE(provider_message_id, '')), '<') > 0
            AND INSTR(TRIM(COALESCE(provider_message_id, '')), '>') > 0
            THEN NULLIF(TRIM(provider_message_id), '')
        END,
        NULLIF(TRIM(json_extract(metadata_json, '$.outbound_headers.message_id')), '')
      )
    WHEN direction = 'inbound' AND json_valid(raw_headers_json)
      THEN NULLIF(TRIM(COALESCE(json_extract(raw_headers_json, '$."message-id"'), json_extract(raw_headers_json, '$."Message-ID"'), json_extract(raw_headers_json, '$.messageId'))), '')
  END, NULLIF(thread_key, ''), id))
  END) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_mailbox_messages_canonical_thread
  ON mailbox_messages(
    mailbox_id,
    canonical_thread_key,
    COALESCE(sent_at, received_at, approved_at, created_at) DESC,
    id DESC
  );
