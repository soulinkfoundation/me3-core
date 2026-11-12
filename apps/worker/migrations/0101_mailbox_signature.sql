-- Owner's email signature (light Markdown), added to new mail, replies and forwards.
ALTER TABLE mailbox_aliases ADD COLUMN signature TEXT;
