-- Seed ServiceTemplates. Data-driven: the UI never hardcodes services,
-- it just reads whatever templates exist in this table.

insert into service_templates (
  name, description, allowed_geometry_types, required_measurement_type,
  estimator_questions, required_photo_count, crew_steps, tools_required,
  equipment_required, materials_formula, quality_control_requirements,
  before_photo_requirements, after_photo_requirements
) values
(
  'Mulch Renovation',
  'Strip old mulch, edge beds, and install fresh mulch at standard depth.',
  array['Polygon'],
  'area',
  '[
    {"id": "mulch_type", "label": "Mulch type", "type": "select", "options": ["Double Ground Brown", "Black Dyed", "Red Dyed", "Cedar"], "required": true},
    {"id": "depth_in", "label": "Target depth (in)", "type": "number", "required": true}
  ]'::jsonb,
  4,
  array[
    'Remove debris and weeds from bed',
    'Edge bed line cleanly',
    'Rake and level existing mulch',
    'Install fresh mulch at target depth',
    'Blow off hard surfaces'
  ],
  array['Edger', 'Rake', 'Wheelbarrow', 'Leaf blower'],
  array['Mulch fork', 'Utility trailer'],
  '[{"material": "Mulch", "unit": "cubic yard", "coverage_per_unit": 100, "waste_factor_pct": 10}]'::jsonb,
  array['Even depth across bed', 'Clean, straight edge line', 'No mulch on turf or hardscape'],
  array['Wide shot of full bed before work'],
  array['Wide shot of full bed after mulch', 'Close-up of edge line']
),
(
  'Weed Removal',
  'Hand or chemical removal of weeds from beds, cracks, or turf areas.',
  array['Polygon', 'LineString'],
  'area',
  '[
    {"id": "method", "label": "Method", "type": "select", "options": ["Hand pull", "Chemical", "Both"], "required": true}
  ]'::jsonb,
  2,
  array[
    'Identify and treat/pull weeds in marked area',
    'Dispose of pulled weeds off-site',
    'Apply pre-emergent if scoped'
  ],
  array['Hand tools', 'Sprayer'],
  array[]::text[],
  '[]'::jsonb,
  array['No visible weeds remaining in treated area'],
  array['Before photo of weed coverage'],
  array['After photo of cleared area']
),
(
  'Soft Wash House',
  'Low-pressure chemical soft wash of house siding to remove algae, mold, and grime.',
  array['Polygon'],
  'area',
  '[
    {"id": "siding_type", "label": "Siding type", "type": "select", "options": ["Vinyl", "Brick", "Stucco", "Wood", "Fiber Cement"], "required": true},
    {"id": "stories", "label": "Number of stories", "type": "number", "required": true}
  ]'::jsonb,
  4,
  array[
    'Pre-wet surrounding landscaping',
    'Apply soft wash chemical mix to siding',
    'Let dwell per chemical spec',
    'Rinse from top to bottom at low pressure',
    'Rinse landscaping thoroughly after'
  ],
  array['Soft wash gun', 'Chemical mixing tank'],
  array['Surface cleaner unit', 'X-jet nozzle'],
  '[{"material": "Sodium Hypochlorite Mix", "unit": "gallon", "coverage_per_unit": 500, "waste_factor_pct": 5}]'::jsonb,
  array['No streaking', 'No chemical damage to plants', 'Windows and fixtures rinsed clean'],
  array['Wide shot of each elevation before wash'],
  array['Wide shot of each elevation after wash']
),
(
  'Pressure Wash Concrete',
  'High-pressure wash of concrete driveway, walkway, or patio surfaces.',
  array['Polygon'],
  'area',
  '[
    {"id": "surface_condition", "label": "Surface condition", "type": "select", "options": ["Light dirt", "Heavy stains", "Oil stains", "Mold/algae"], "required": true}
  ]'::jsonb,
  2,
  array[
    'Pre-treat stains with degreaser if needed',
    'Surface clean full area with rotary surface cleaner',
    'Edge/detail wash borders and corners',
    'Rinse overspray from adjacent landscaping'
  ],
  array['Pressure washer wand'],
  array['Rotary surface cleaner', 'Hot water pressure washer'],
  '[{"material": "Degreaser", "unit": "gallon", "coverage_per_unit": 1000, "waste_factor_pct": 5}]'::jsonb,
  array['Uniform clean with no streaking', 'No damage to expansion joints or landscaping'],
  array['Before photo showing stains/dirt'],
  array['After photo of cleaned surface']
)
on conflict do nothing;
