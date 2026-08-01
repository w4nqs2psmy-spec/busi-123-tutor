-- Seed public.topics from topics.json (spec_version 1.0.0).
--
-- Content — prompts, options, answer keys, rubrics — deliberately stays in
-- topics.json. This table carries only what the database needs for foreign
-- keys and per-LO reporting.
--
-- "LO2/LO3" on competitive-advantage is split into a real array here; as a
-- single string it silently breaks any group-by-outcome query. [F12]
--
-- Keep spec_version in step with topics.json `meta.spec_version`, since every
-- assessment_snapshot is stamped with it. [F20]

insert into public.topics (id, title, learning_outcomes, position, spec_version) values
  ('market-research',       'Primary & Secondary Market Research',            array['LO1'],        1, '1.0.0'),
  ('pestel',                'PESTEL Macro-Environment Analysis',              array['LO2'],        2, '1.0.0'),
  ('five-forces',           'Porter''s Five Forces & Industry Attractiveness', array['LO2'],       3, '1.0.0'),
  ('competitive-advantage', 'Sustainable Competitive Advantage',              array['LO2','LO3'],  4, '1.0.0'),
  ('business-model-canvas', 'Business Model Design (Business Model Canvas)',  array['LO3'],        5, '1.0.0'),
  ('entrepreneurial-csf',   'Critical Success Factors, Team & Networks',      array['LO4'],        6, '1.0.0'),
  ('sustainability',        'Global Context & the Triple Bottom Line',        array['LO5'],        7, '1.0.0')
on conflict (id) do update set
  title             = excluded.title,
  learning_outcomes = excluded.learning_outcomes,
  position          = excluded.position,
  spec_version      = excluded.spec_version;
