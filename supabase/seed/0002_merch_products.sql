-- Starter team store product: a business-card-size fridge/truck magnet with a
-- swappable barcode. Replace the design with your own at /admin/store.

insert into merch_products (name, description, design_svg, barcode_format, price_cents, vendor_name, print_specs)
values (
  'Barcode Magnet',
  'Business-card magnet with your name and personal barcode.',
  '<svg xmlns="http://www.w3.org/2000/svg" width="3.5in" height="2in" viewBox="0 0 350 200">
  <rect width="350" height="200" rx="12" fill="#ffffff"/>
  <rect width="350" height="44" rx="12" fill="#2f6b3a"/>
  <rect y="30" width="350" height="14" fill="#2f6b3a"/>
  <text x="20" y="29" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#ffffff">FIELD CREW</text>
  <text x="20" y="76" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="#1a1a1a">{{name}}</text>
  <text x="20" y="96" font-family="Arial, Helvetica, sans-serif" font-size="13" fill="#555555">{{title}}</text>
  <rect id="barcode-slot" x="20" y="108" width="310" height="80" fill="#eeeeee"/>
</svg>',
  'code128',
  800,
  null,
  '3.5" x 2" flexible magnet, 30 mil, full color, rounded corners'
);
