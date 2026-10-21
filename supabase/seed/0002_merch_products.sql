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
  <rect width="2400" height="1200" rx="60" fill="#8ec2f4"/>
  <rect y="790" width="2400" height="410" fill="#24820c"/>
  <rect y="1100" width="2400" height="100" rx="60" fill="#24820c"/>
  <text x="745" y="440" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="300" font-weight="700" fill="#ffffff" stroke="#1a1a1a" stroke-width="8">JS</text>
  <text x="745" y="640" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="140" font-weight="700" fill="#ffffff" stroke="#1a1a1a" stroke-width="5" textLength="1370" lengthAdjust="spacingAndGlyphs">LANDSCAPING SERVICES</text>
  <text x="745" y="1072" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="210" font-weight="700" fill="#ffffff" textLength="1370" lengthAdjust="spacingAndGlyphs">FREE EVALUATION</text>
  <rect x="1500" y="34" width="866" height="1132" rx="46" fill="#ffffff" stroke="#24820c" stroke-width="16"/>
  <rect id="barcode-slot" x="1533" y="106" width="800" height="800" fill="#eeeeee"/>
  <text x="1933" y="1060" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="120" font-weight="700" fill="#24820c" textLength="800" lengthAdjust="spacingAndGlyphs">SCAN TO BOOK</text>
</svg>',
  'qrcode',
  'affiliate',
  4500,
  null,
  '24" x 12" vehicle magnet, 30 mil, UV-laminated, rounded corners. Sold in pairs (one per door).'
);
