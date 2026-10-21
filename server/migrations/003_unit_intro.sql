-- Regeltext einer Einheit (unit.intro, max. 2000 Zeichen): erscheint als Regelkarte vor der ersten Lektion.
-- Beispielsätze zu Wörtern (word.examples) liegen wie reading/tokens in items.extra.
ALTER TABLE units ADD COLUMN intro TEXT;
