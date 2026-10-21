-- Starter team store product: a truck door magnet whose QR code is the
-- buyer's affiliate link. There's deliberately no phone number: scanning is
-- the only way to book, so every lead is credited to someone. Only the QR
-- code changes per magnet. Upload your real design (PNG is
-- fine) at /admin/store to replace it.

insert into merch_products (name, description, design_svg, barcode_format, barcode_source, price_cents, vendor_name, print_specs)
values (
  'Truck Door Magnet',
  'Vehicle magnet with a QR code that credits you for every scan.',
  '<svg xmlns="http://www.w3.org/2000/svg" width="24in" height="12in" viewBox="0 0 2400 1200">
  <rect width="2400" height="1200" rx="60" fill="#8ec2f2"/>
  <rect y="440" width="2400" height="250" fill="#ffffff"/>
  <rect y="690" width="2400" height="510" fill="#267f0e"/>
  <rect y="1100" width="2400" height="100" rx="60" fill="#267f0e"/>
  <text x="80" y="330" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="700" fill="#ffffff" stroke="#1a1a1a" stroke-width="6" textLength="1700" lengthAdjust="spacingAndGlyphs">JS LANDSCAPING SERVICES</text>
  <text x="80" y="630" font-family="Arial, Helvetica, sans-serif" font-size="170" font-weight="700" fill="#267f0e" textLength="1700" lengthAdjust="spacingAndGlyphs">FREE YARD EVALUATIONS</text>
  <text x="1200" y="1080" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="380" font-weight="700" fill="#ffffff" textLength="2200" lengthAdjust="spacingAndGlyphs">SCAN TO BOOK</text>
  <rect x="1840" y="30" width="520" height="620" rx="36" fill="#ffffff" stroke="#267f0e" stroke-width="14"/>
  <rect id="barcode-slot" x="1880" y="70" width="440" height="440" fill="#eeeeee"/>
  <text x="2100" y="600" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="80" font-weight="700" fill="#267f0e" textLength="440" lengthAdjust="spacingAndGlyphs">SCAN TO BOOK</text>
</svg>',
  'qrcode',
  'affiliate',
  4500,
  null,
  '24" x 12" vehicle magnet, 30 mil, UV-laminated, rounded corners. Sold in pairs (one per door).'
);
